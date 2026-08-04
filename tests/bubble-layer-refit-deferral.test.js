// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BubbleSetLayer } from '../src/graph/bubble_layer.js';

// ==========================================================================
// Refit deferral.
//
// #paint runs on every sigma afterRender. Fitting an outline is bubblesets'
// marching-squares pass over an influence field, which on a dense graph with
// avoidance on costs far more than a 16 ms frame — so dragging a member used
// to re-fit 60×/second and the canvas crawled.
//
// The contract: a fit that stays inside the frame budget keeps re-fitting live
// (small graphs behave exactly as before); past it, POSITION changes coast on
// the cached hull and re-fit once motion stops, while MEMBERSHIP and STYLE
// changes — discrete user actions — always fit immediately.
// ==========================================================================

/** Sigma/graphology stand-ins: only what the paint path reads. */
function makeAdapter(nodes) {
  const attrs = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y, size: 10, hidden: false }]));
  const canvases = {};
  const makeCanvas = () => {
    const canvas = { width: 800, height: 600, style: {}, remove() {} };
    const ctx = new Proxy({}, { get: (t, k) => (k === 'canvas' ? canvas : () => {}) });
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
      getCamera: () => ({ getState: () => ({ x: 0.5, y: 0.5, ratio: 1, angle: 0 }) }),
      scaleSize: (s) => s,
      graphToViewport: (p) => p,
      viewportToGraph: (p) => p,
      pixelRatio: 1,
      on() {},
      off() {},
    },
    _attrs: attrs,
  };
}

function makeLayer(nodes) {
  const adapter = makeAdapter(nodes);
  const layer = new BubbleSetLayer(adapter, {
    DEFAULTS: { BUBBLE_GROUP_STYLE_TEMPLATE: {}, NODE: { SIZE: 20 } },
  });
  const handle = layer.getGroupHandle('g1');
  handle.update({ members: nodes.map((n) => n.id), avoidMembers: [], fillOpacity: 0.3, avoidance: 0 });
  return { layer, adapter };
}


const NODES = [
  { id: 'a', x: 0, y: 0 },
  { id: 'b', x: 10, y: 0 },
  { id: 'c', x: 5, y: 8 },
];

class FakePath2D {
  moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {} arc() {} quadraticCurveTo() {}
}

// scheduleRedraw guards on `rafHandle !== null`, so a stub that runs the
// callback INLINE leaves the handle assigned afterwards and every later
// redraw short-circuits. Queue and flush, exactly like the real thing.
let rafQueue = [];
const frame = () => {
  const queued = rafQueue;
  rafQueue = [];
  for (const cb of queued) cb();
};

beforeEach(() => {
  vi.useFakeTimers();
  rafQueue = [];
  // jsdom has no Path2D, and the painter runs AFTER the sync — without it the
  // throw escapes scheduleRedraw and the test never reaches its assertion.
  vi.stubGlobal('Path2D', FakePath2D);
  vi.stubGlobal('requestAnimationFrame', (cb) => rafQueue.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('refit deferral', () => {
  it('re-fits every frame while fits stay inside the frame budget', () => {
    const { layer, adapter } = makeLayer(NODES);
    layer.scheduleRedraw(); frame();
    const fits = () => layer.fitDurations.size;
    expect(fits()).toBe(1);

    // A cheap fit was measured, so a move must re-fit immediately.
    const before = layer.outlines.get('g1')?.key;
    adapter._attrs.get('a').x = 40;
    layer.scheduleRedraw(); frame();
    expect(layer.outlines.get('g1')?.key).not.toBe(before);
  });

  it('coasts on the cached hull when the last fit blew the budget', () => {
    const { layer, adapter } = makeLayer(NODES);
    layer.scheduleRedraw(); frame();
    const cachedKey = layer.outlines.get('g1').key;
    const cachedPoints = layer.outlines.get('g1').graphPoints;

    // Pretend the fit is expensive from here on.
    layer.fitDurations.set('g1', 500);

    for (let i = 0; i < 20; i++) {
      adapter._attrs.get('a').x = 40 + i;
      layer.scheduleRedraw(); frame();
    }

    // 20 "frames" of dragging and not one re-fit: same key, same geometry.
    expect(layer.outlines.get('g1').key).toBe(cachedKey);
    expect(layer.outlines.get('g1').graphPoints).toBe(cachedPoints);
  });

  it('re-fits once when motion stops', () => {
    const { layer, adapter } = makeLayer(NODES);
    layer.scheduleRedraw(); frame();
    const cachedKey = layer.outlines.get('g1').key;
    layer.fitDurations.set('g1', 500);

    adapter._attrs.get('a').x = 90;
    layer.scheduleRedraw(); frame();
    expect(layer.outlines.get('g1').key).toBe(cachedKey);

    vi.advanceTimersByTime(200);

    expect(layer.outlines.get('g1').key).not.toBe(cachedKey);
  });

  it('restarts the settle timer on each frame, so a drag fits once at the end', () => {
    const { layer, adapter } = makeLayer(NODES);
    layer.scheduleRedraw(); frame();
    layer.fitDurations.set('g1', 500);
    const cachedKey = layer.outlines.get('g1').key;

    // A continuous drag: each frame extends the window, so it never fires mid-drag.
    for (let i = 0; i < 10; i++) {
      adapter._attrs.get('a').x = 40 + i;
      layer.scheduleRedraw(); frame();
      vi.advanceTimersByTime(50); // shorter than the settle window
    }
    expect(layer.outlines.get('g1').key).toBe(cachedKey);

    vi.advanceTimersByTime(200);
    expect(layer.outlines.get('g1').key).not.toBe(cachedKey);
  });

  it('never defers a MEMBERSHIP change, however expensive the fit', () => {
    const { layer } = makeLayer(NODES);
    layer.scheduleRedraw(); frame();
    const cachedKey = layer.outlines.get('g1').key;
    layer.fitDurations.set('g1', 500);

    // Dropping a member is a discrete user action: it must land at once.
    layer.getGroupHandle('g1').update({ members: ['a', 'b'], avoidMembers: [], avoidance: 0 });
    layer.scheduleRedraw(); frame();

    expect(layer.outlines.get('g1').key).not.toBe(cachedKey);
  });

  it('never defers a STYLE change', () => {
    const { layer } = makeLayer(NODES);
    layer.scheduleRedraw(); frame();
    const cachedKey = layer.outlines.get('g1').key;
    layer.fitDurations.set('g1', 500);

    layer.getGroupHandle('g1').update({
      members: NODES.map((n) => n.id), avoidMembers: [], avoidance: 0, padding: 2.5,
    });
    layer.scheduleRedraw(); frame();

    expect(layer.outlines.get('g1').key).not.toBe(cachedKey);
  });

  it('always fits the first time — there is no cached hull to coast on', () => {
    const { layer } = makeLayer(NODES);
    layer.fitDurations.set('g1', 500); // "expensive" before anything was drawn
    layer.scheduleRedraw(); frame();
    expect(layer.outlines.get('g1')?.graphPoints.length).toBeGreaterThan(2);
  });

  it('drops a removed group from the duration cache', () => {
    const { layer } = makeLayer(NODES);
    layer.scheduleRedraw(); frame();
    expect(layer.fitDurations.has('g1')).toBe(true);
    layer.removeGroup('g1');
    expect(layer.fitDurations.has('g1')).toBe(false);
  });

  it('cancels a pending settle on destroy', () => {
    const { layer, adapter } = makeLayer(NODES);
    layer.scheduleRedraw(); frame();
    layer.fitDurations.set('g1', 500);
    adapter._attrs.get('a').x = 90;
    layer.scheduleRedraw(); frame();

    layer.destroy();
    expect(() => vi.advanceTimersByTime(500)).not.toThrow();
  });
});
