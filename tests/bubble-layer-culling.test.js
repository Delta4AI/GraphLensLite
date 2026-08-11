// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BubbleSetLayer } from '../src/graph/bubble_layer.js';

// ==========================================================================
// Viewport culling. 1.17 made the group count unbounded (auto-group mints up to
// 50), and zoomed into one of them the other 49 were still building a Path2D
// and stroking/filling entirely off-canvas. The cull test is four comparisons
// against a graph-space bbox cached with the rings.
// ==========================================================================

/**
 * A sigma stand-in whose graph→viewport map is a pan: graph (x,y) lands at
 * (x - panX, y - panY) on an 800×600 canvas.
 */
function makeAdapter(nodes, pan = { x: 0, y: 0 }) {
  const attrs = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y, size: 10, hidden: false }]));
  const canvases = {};
  const strokes = [];
  const makeCanvas = () => {
    const canvas = { width: 800, height: 600, style: {}, remove() {} };
    const ctx = new Proxy(
      {},
      {
        get: (t, k) => {
          if (k === 'canvas') return canvas;
          if (k === 'fill' || k === 'stroke') return (...args) => strokes.push([k, ...args]);
          return () => {};
        },
        set: () => true,
      },
    );
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
      getDimensions: () => ({ width: 800, height: 600 }),
      getCamera: () => ({ getState: () => ({ x: pan.x, y: pan.y, ratio: 1, angle: 0 }) }),
      scaleSize: (s) => s,
      graphToViewport: (p) => ({ x: p.x - pan.x, y: p.y - pan.y }),
      viewportToGraph: (p) => ({ x: p.x + pan.x, y: p.y + pan.y }),
      pixelRatio: 1,
      on() {},
      off() {},
    },
    _attrs: attrs,
    _pan: pan,
    _paints: strokes,
  };
}

class FakePath2D {
  moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {} arc() {} quadraticCurveTo() {}
}

let rafQueue = [];
const frame = () => {
  const queued = rafQueue;
  rafQueue = [];
  for (const cb of queued) cb();
};

beforeEach(() => {
  rafQueue = [];
  vi.stubGlobal('Path2D', FakePath2D);
  vi.stubGlobal('requestAnimationFrame', (cb) => rafQueue.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => vi.unstubAllGlobals());

/** Two groups: "near" around the origin, "far" 100k graph units away. */
function makeLayer(pan) {
  const nodes = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 40, y: 0 },
    { id: 'c', x: 20, y: 30 },
    { id: 'x', x: 100000, y: 100000 },
    { id: 'y', x: 100040, y: 100000 },
    { id: 'z', x: 100020, y: 100030 },
  ];
  const adapter = makeAdapter(nodes, pan);
  const layer = new BubbleSetLayer(adapter, {
    DEFAULTS: { BUBBLE_GROUP_STYLE_TEMPLATE: {}, NODE: { SIZE: 20 } },
  });
  layer
    .getGroupHandle('near')
    .update({ members: ['a', 'b', 'c'], avoidMembers: [], fillOpacity: 0.3, avoidance: 0 });
  layer
    .getGroupHandle('far')
    .update({ members: ['x', 'y', 'z'], avoidMembers: [], fillOpacity: 0.3, avoidance: 0 });
  return { layer, adapter };
}

describe('viewport culling', () => {
  it('fits both groups but paints only the one on screen', () => {
    const { layer, adapter } = makeLayer({ x: 0, y: 0 });
    layer.scheduleRedraw();
    frame();

    // Both are fitted and cached — culling is a paint decision, not a fit one,
    // so panning back must not need a refit.
    expect(layer.outlines.get('near').graphPoints.length).toBeGreaterThan(2);
    expect(layer.outlines.get('far').graphPoints.length).toBeGreaterThan(2);
    // One fill + one stroke, for "near" alone.
    expect(adapter._paints.map(([kind]) => kind)).toEqual(['fill', 'stroke']);
  });

  it('paints the far group once the camera is over it', () => {
    const { layer, adapter } = makeLayer({ x: 100000, y: 100000 });
    layer.scheduleRedraw();
    frame();

    expect(adapter._paints.map(([kind]) => kind)).toEqual(['fill', 'stroke']);
    // Nothing on screen at the origin any more, so the near group is the culled
    // one now — same layer, opposite outcome.
    expect(layer.outlines.get('near').bbox.maxX).toBeLessThan(1000);
  });

  it('caches a graph-space bbox for every ring it keeps', () => {
    const { layer } = makeLayer({ x: 0, y: 0 });
    layer.scheduleRedraw();
    frame();

    for (const group of ['near', 'far']) {
      const { bbox, graphPoints } = layer.outlines.get(group);
      expect(bbox.minX).toBeLessThanOrEqual(Math.min(...graphPoints.map((p) => p.x)));
      expect(bbox.maxY).toBeGreaterThanOrEqual(Math.max(...graphPoints.map((p) => p.y)));
    }
  });
});
