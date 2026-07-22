import { describe, it, expect, beforeEach } from 'vitest';
import { BubbleSetLayer } from '../src/graph/bubble_layer.js';

// ==========================================================================
// Regression: bubble groups land in the WRONG PLACE on a non-primary,
// higher-DPR display until the style panel is toggled.
//
// Root cause: sigma.createCanvasContext() creates the layer canvas with only
// `position:absolute` — no CSS width/height. The layer's own #prepareCanvas
// sizes the BACKING STORE (canvas.width = width*dpr) but never the CSS DISPLAY
// size (canvas.style.width). The only code that sets the CSS size is sigma's
// resize(), which runs once at construction (before this canvas exists) and
// early-returns when dimensions are unchanged. So the canvas displays at its
// backing-store size in CSS px = width*dpr:
//   - dpr 1 (primary monitor): width*1 == width  -> coincidentally correct
//   - dpr 2 (laptop monitor):  width*2           -> 2x too large/offset
// Toggling the style panel changes container width -> sigma.resize() runs past
// its early-return -> sets the CSS size -> bubbles snap back into place.
//
// The fix makes the layer own its full canvas sizing (backing store + CSS),
// so it is correct regardless of whether/when sigma.resize() has run.
// ==========================================================================

function makeCanvas() {
  const ctx = {
    setTransform: () => {},
    clearRect: () => {},
    save: () => {},
    restore: () => {},
    fill: () => {},
    stroke: () => {},
    beginPath: () => {},
    roundRect: () => {},
    measureText: () => ({ width: 10 }),
    fillText: () => {},
    translate: () => {},
    rotate: () => {},
    set fillStyle(_v) {},
    set strokeStyle(_v) {},
    set lineWidth(_v) {},
    set globalAlpha(_v) {},
    set font(_v) {},
    set textAlign(_v) {},
    set textBaseline(_v) {},
  };
  return {
    width: 0,
    height: 0,
    style: {},
    getContext: () => ctx,
    remove: () => {},
  };
}

function makeSigma(pixelRatio, dims) {
  const handlers = new Map();
  const canvas = makeCanvas();
  const labelCanvas = makeCanvas();
  const sigma = {
    pixelRatio,
    createCanvasContext: () => sigma,
    getCanvases: () => ({ bubbleSets: canvas, bubbleSetsLabels: labelCanvas }),
    getDimensions: () => ({ width: dims.width, height: dims.height }),
    getCamera: () => ({ getState: () => ({ x: 0, y: 0, ratio: 1, angle: 0 }) }),
    graphToViewport: (g) => ({ x: dims.width / 2 + g.x, y: dims.height / 2 - g.y }),
    viewportToGraph: (v) => ({ x: v.x - dims.width / 2, y: dims.height / 2 - v.y }),
    scaleSize: (s) => s,
    on: (ev, fn) => handlers.set(ev, fn),
    off: () => {},
    emit: (ev) => handlers.get(ev)?.(),
  };
  return { sigma, canvas, labelCanvas };
}

function makeGraph(nodes) {
  const map = new Map(nodes.map((n) => [n.id, { size: 20, hidden: false, ...n }]));
  return { hasNode: (id) => map.has(id), getNodeAttributes: (id) => map.get(id) };
}

function makeCache() {
  return { DEFAULTS: { BUBBLE_GROUP_STYLE: { groupOne: {} } } };
}

class FakePath2D {
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  closePath() {}
}

let rafQueue = [];
beforeEach(() => {
  rafQueue = [];
  globalThis.Path2D = FakePath2D;
  globalThis.requestAnimationFrame = (cb) => {
    rafQueue.push(cb);
    return rafQueue.length;
  };
  globalThis.cancelAnimationFrame = () => {};
  if (!globalThis.window) globalThis.window = {};
  globalThis.window.devicePixelRatio = 1;
});

function flushRaf() {
  const q = rafQueue;
  rafQueue = [];
  q.forEach((cb) => cb());
}

const TRI = [
  { id: 'a', x: -50, y: -50 },
  { id: 'b', x: 50, y: -50 },
  { id: 'c', x: 0, y: 50 },
];

describe('BubbleSetLayer — canvas CSS display size (non-primary DPR bug)', () => {
  it('sets the CSS display size to the viewport CSS px, not the backing store, at dpr 2', () => {
    const { sigma, canvas, labelCanvas } = makeSigma(2, { width: 800, height: 600 });
    const layer = new BubbleSetLayer({ sigma, graph: makeGraph(TRI) }, makeCache());

    layer.getGroupHandle('groupOne').update({ members: ['a', 'b', 'c'], label: false });
    flushRaf();

    // Backing store is scaled by dpr (unchanged behavior).
    expect(canvas.width).toBe(800 * 2);
    expect(canvas.height).toBe(600 * 2);

    // CSS display size MUST be the logical viewport size so the canvas overlays
    // the WebGL layers 1:1. Without this the bubble is drawn dpr* too large and
    // lands in the wrong place on a >1 DPR display.
    expect(canvas.style.width).toBe('800px');
    expect(canvas.style.height).toBe('600px');
    expect(labelCanvas.style.width).toBe('800px');
    expect(labelCanvas.style.height).toBe('600px');
  });

  it('keeps the CSS size correct at dpr 1 (primary monitor)', () => {
    const { sigma, canvas } = makeSigma(1, { width: 1024, height: 768 });
    const layer = new BubbleSetLayer({ sigma, graph: makeGraph(TRI) }, makeCache());

    layer.getGroupHandle('groupOne').update({ members: ['a', 'b', 'c'], label: false });
    flushRaf();

    expect(canvas.width).toBe(1024);
    expect(canvas.style.width).toBe('1024px');
    expect(canvas.style.height).toBe('768px');
  });

  it('keeps the overlay 1:1 when the DPR changes mid-session (monitor A -> B)', () => {
    // Monitor A (dpr 1): apply a group, paint correctly.
    const { sigma, canvas } = makeSigma(1, { width: 800, height: 600 });
    const layer = new BubbleSetLayer({ sigma, graph: makeGraph(TRI) }, makeCache());
    layer.getGroupHandle('groupOne').update({ members: ['a', 'b', 'c'], label: false });
    flushRaf();
    expect(canvas.style.width).toBe('800px');

    // Drag to monitor B (dpr 2): sigma.pixelRatio flips but the CSS box is
    // unchanged. A repaint must keep the CSS display size at the logical
    // viewport px — not the width*2 backing store — or the hull renders 2x too
    // large and lands in the wrong place.
    sigma.pixelRatio = 2;
    sigma.emit('afterRender');
    flushRaf();

    expect(canvas.width).toBe(800 * 2);
    expect(canvas.style.width).toBe('800px');
    expect(canvas.style.height).toBe('600px');
  });
});
