// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeatmapLayer } from '../src/graph/heatmap_layer.js';

// ==========================================================================
// The heatmap's paint path. Its settings and its CSS size each had a test file;
// the thing it exists to do had none — so "pan/zoom never re-splats" (the heat
// key is viewport-INDEPENDENT, and a rebuild is a synchronous whole-offscreen
// getImageData) was unverified, as was the theme flip recolouring and the
// no-drawable-field verdict being cached.
//
// jsdom has no canvas, so the 2D contexts are recording stubs: what we assert is
// which work the layer decides to do, not the pixels.
// ==========================================================================

/** A 2D context stub that records the calls the paint path makes. */
function makeCtx(canvas) {
  const calls = { drawImage: 0, getImageData: 0, putImageData: 0, clearRect: 0 };
  const ctx = {
    canvas,
    _calls: calls,
    save() {}, restore() {}, setTransform() {}, transform() {}, translate() {}, scale() {},
    clearRect() { calls.clearRect += 1; },
    fillRect() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    drawImage() { calls.drawImage += 1; },
    getImageData(x, y, w, h) {
      calls.getImageData += 1;
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
    putImageData() { calls.putImageData += 1; },
  };
  return ctx;
}

function makeAdapter(nodes, { ratio = 1 } = {}) {
  const W = 400;
  const H = 300;
  const canvases = {};
  const layerCanvas = { width: W, height: H, style: {}, remove() {} };
  layerCanvas.getContext = () => (layerCanvas._ctx ??= makeCtx(layerCanvas));
  const camera = { x: 0.5, y: 0.5, ratio, angle: 0 };
  return {
    graph: {
      forEachNode: (fn) => nodes.forEach((n) => fn(n.id, n)),
    },
    sigma: {
      createCanvasContext(name) { canvases[name] = layerCanvas; },
      getCanvases: () => canvases,
      getDimensions: () => ({ width: W, height: H }),
      getCamera: () => ({ getState: () => camera }),
      graphToViewport: (p) => ({ x: p.x / camera.ratio, y: p.y / camera.ratio }),
      viewportToGraph: (p) => ({ x: p.x * camera.ratio, y: p.y * camera.ratio }),
      refresh: vi.fn(),
      pixelRatio: 1,
      on() {},
      off() {},
    },
    _camera: camera,
    _layerCanvas: layerCanvas,
  };
}

/** Offscreen canvases the layer creates for the splat field and the sprite. */
let offscreens = [];
let rafQueue = [];

/** Run the queued frame callbacks, like a browser tick. */
function frame() {
  const queued = rafQueue;
  rafQueue = [];
  for (const cb of queued) cb();
}

/** Ask for a redraw and let the frame happen. */
function redraw(layer) {
  layer.scheduleRedraw();
  frame();
}

beforeEach(() => {
  offscreens = [];
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    const el = realCreate(tag);
    if (tag === 'canvas') {
      el.getContext = () => (el._ctx ??= makeCtx(el));
      offscreens.push(el);
    }
    return el;
  });
  // Queue and flush, never inline: FrameCoalescer assigns its handle AFTER the
  // callback returns, so an inline stub leaves the handle set and every later
  // schedule short-circuits.
  rafQueue = [];
  vi.stubGlobal('requestAnimationFrame', (cb) => rafQueue.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const NODES = [
  { id: 'a', x: 0, y: 0 },
  { id: 'b', x: 100, y: 0 },
  { id: 'c', x: 50, y: 80 },
];

function makeLayer(nodes = NODES, opts) {
  const adapter = makeAdapter(nodes, opts);
  const layer = new HeatmapLayer(adapter, {});
  layer.heatmapEnabled = true;
  return { layer, adapter };
}

/** How many times the field offscreen has been read back (a full rebuild). */
const rebuilds = () => offscreens.reduce((n, c) => n + (c._ctx?._calls.getImageData ?? 0), 0);

describe('heatmap paint', () => {
  it('splats once and caches the field under its viewport-independent key', () => {
    const { layer } = makeLayer();

    redraw(layer);
    expect(rebuilds()).toBe(1);
    expect(layer.heatCache.canvas).toBeTruthy();

    // Same content, same view: the whole paint is skipped by the signature.
    const key = layer.heatCache.key;
    redraw(layer);
    expect(rebuilds()).toBe(1);
    expect(layer.heatCache.key).toBe(key);
  });

  it('re-composites on zoom WITHOUT re-splatting', () => {
    const { layer, adapter } = makeLayer();
    redraw(layer);
    const key = layer.heatCache.key;
    const composites = adapter._layerCanvas._ctx._calls.drawImage;

    adapter._camera.ratio = 0.5;
    redraw(layer);

    // The expensive half (splat + getImageData) did not run again...
    expect(rebuilds()).toBe(1);
    expect(layer.heatCache.key).toBe(key);
    // ...but the cheap half did: one drawImage of the cached offscreen.
    expect(adapter._layerCanvas._ctx._calls.drawImage).toBe(composites + 1);
  });

  it('re-splats when a node moves', () => {
    const { layer } = makeLayer();
    redraw(layer);
    const key = layer.heatCache.key;

    NODES[2].x += 40;
    try {
      redraw(layer);
      expect(rebuilds()).toBe(2);
      expect(layer.heatCache.key).not.toBe(key);
    } finally {
      NODES[2].x -= 40;
    }
  });

  it('re-splats when a field-shaping setting changes, but not for opacity', () => {
    const { layer } = makeLayer();
    redraw(layer);
    const afterFirst = rebuilds();

    layer.updateSettings({ gamma: 1.7 });
    redraw(layer);
    expect(rebuilds()).toBe(afterFirst + 1);

    // Opacity is composite-only: it rides the paint signature, not the heat key.
    const key = layer.heatCache.key;
    layer.updateSettings({ opacity: 0.42 });
    redraw(layer);
    expect(rebuilds()).toBe(afterFirst + 1);
    expect(layer.heatCache.key).toBe(key);
  });

  it('recolours on a theme flip — the ramp rides the key as its stops', () => {
    const { layer } = makeLayer();
    redraw(layer);
    const key = layer.heatCache.key;

    document.documentElement.setAttribute('data-theme', 'dark');
    try {
      redraw(layer);
      // A rebuild, because the colours come from the ramp LUT baked into the
      // offscreen. Keyed on the serialized STOPS rather than the theme name, so
      // a runtime ramp edit cannot serve a stale recolour either.
      expect(rebuilds()).toBe(2);
      expect(layer.heatCache.key).not.toBe(key);
    } finally {
      document.documentElement.removeAttribute('data-theme');
    }
  });

  it('caches the "nothing drawable" verdict instead of retrying every frame', () => {
    // A single node has a zero-extent bbox, so auto bandwidth is 0.
    const { layer } = makeLayer([{ id: 'only', x: 10, y: 10 }]);

    redraw(layer);
    expect(layer.heatCache.canvas).toBeNull();
    expect(rebuilds()).toBe(0);

    redraw(layer);
    expect(rebuilds()).toBe(0);
  });

  it('clears once when disabled and then stops working entirely', () => {
    const { layer, adapter } = makeLayer();
    redraw(layer);

    layer.heatmapEnabled = false;
    redraw(layer);
    expect(layer.cleared).toBe(true);
    const cleared = adapter._layerCanvas._ctx._calls.clearRect;
    const composites = adapter._layerCanvas._ctx._calls.drawImage;

    redraw(layer);
    // The disabled branch returns before any signature work; the clear is not
    // repeated and nothing is composited.
    expect(adapter._layerCanvas._ctx._calls.clearRect).toBe(cleared);
    expect(adapter._layerCanvas._ctx._calls.drawImage).toBe(composites);
  });
});
