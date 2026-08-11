// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BubbleSetLayer } from '../src/graph/bubble_layer.js';
import { DEFAULTS } from '../src/config.js';

// ==========================================================================
// referenceRects is the public seam feeding bubble_tuning (the layout-aware
// initial group settings behind ✨ Re-tune): the rects a FIT would consume, at
// the ratio-1 reference scale. Its only test reference stubbed it out, so the
// hidden/missing skip and the zoom-cancelling mapping were unverified — and a
// wrong mapping here silently mis-tunes every new group.
// ==========================================================================

/**
 * Sigma stand-in with an explicit camera ratio. graphToViewport applies the
 * zoom about the canvas centre, exactly as sigma does, so referenceRects has
 * something real to cancel.
 */
function makeAdapter(nodes, ratio = 1) {
  const attrs = new Map(nodes.map(({ id, ...rest }) => [id, rest]));
  const W = 800;
  const H = 600;
  const canvases = {};
  const makeCanvas = () => {
    const canvas = { width: W, height: H, style: {}, remove() {} };
    const ctx = new Proxy({}, { get: (t, k) => (k === 'canvas' ? canvas : () => {}), set: () => true });
    canvas.getContext = () => ctx;
    return canvas;
  };
  return {
    graph: {
      hasNode: (id) => attrs.has(id),
      getNodeAttributes: (id) => attrs.get(id),
    },
    sigma: {
      createCanvasContext(name) { canvases[name] = makeCanvas(); },
      getCanvases: () => canvases,
      getDimensions: () => ({ width: W, height: H }),
      getCamera: () => ({ getState: () => ({ x: 0.5, y: 0.5, ratio, angle: 0 }) }),
      // Node radius shrinks with the zoom; scaleSize(s, 1) asks for it at ratio 1.
      scaleSize: (s, r = ratio) => s / r,
      graphToViewport: (p) => ({ x: W / 2 + (p.x - W / 2) / ratio, y: H / 2 + (p.y - H / 2) / ratio }),
      viewportToGraph: (p) => ({ x: W / 2 + (p.x - W / 2) * ratio, y: H / 2 + (p.y - H / 2) * ratio }),
      pixelRatio: 1,
      on() {},
      off() {},
    },
  };
}

const makeLayer = (nodes, ratio) =>
  new BubbleSetLayer(makeAdapter(nodes, ratio), {
    DEFAULTS: { BUBBLE_GROUP_STYLE_TEMPLATE: {}, NODE: { SIZE: 20 } },
  });

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => vi.unstubAllGlobals());

describe('referenceRects', () => {
  it('returns one node-sized rect per id, centred on the node', () => {
    const layer = makeLayer([{ id: 'a', x: 400, y: 300, size: 10 }]);

    expect(layer.referenceRects(['a'])).toEqual([
      { x: 390, y: 290, width: 20, height: 20 },
    ]);
  });

  it('skips hidden nodes and ids the graph does not have', () => {
    const layer = makeLayer([
      { id: 'a', x: 400, y: 300, size: 10 },
      { id: 'b', x: 500, y: 300, size: 10, hidden: true },
    ]);

    expect(layer.referenceRects(['a', 'b', 'ghost'])).toHaveLength(1);
  });

  it('is zoom-invariant — the same rects at any camera ratio', () => {
    const nodes = [
      { id: 'a', x: 300, y: 200, size: 10 },
      { id: 'b', x: 500, y: 400, size: 14 },
    ];

    const atOne = makeLayer(nodes, 1).referenceRects(['a', 'b']);
    const zoomedIn = makeLayer(nodes, 0.25).referenceRects(['a', 'b']);
    const zoomedOut = makeLayer(nodes, 4).referenceRects(['a', 'b']);

    expect(zoomedIn).toEqual(atOne);
    expect(zoomedOut).toEqual(atOne);
  });

  it('falls back to the default node size for a node with none', () => {
    const layer = makeLayer([{ id: 'a', x: 400, y: 300 }]);
    const [rect] = layer.referenceRects(['a']);

    expect(rect.width).toBe(DEFAULTS.NODE.SIZE);
  });

  it('accepts any iterable, including a Set of member ids', () => {
    const layer = makeLayer([
      { id: 'a', x: 400, y: 300, size: 10 },
      { id: 'b', x: 420, y: 300, size: 10 },
    ]);

    expect(layer.referenceRects(new Set(['a', 'b']))).toHaveLength(2);
    expect(layer.referenceRects([])).toEqual([]);
  });
});
