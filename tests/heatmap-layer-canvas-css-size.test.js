import { describe, it, expect, beforeEach } from 'vitest';
import { HeatmapLayer } from '../src/graph/heatmap_layer.js';

// ==========================================================================
// Regression (mirrors bubble-layer-canvas-css-size.test.js): the heatmap
// custom canvas is registered via sigma.createCanvasContext(), which never sets
// its CSS display size. #prepareCanvas must own the CSS size (not just the
// backing store) so the field overlays the WebGL layers 1:1 on a >1 DPR display
// — otherwise it renders dpr* too large until a panel toggle forces a sigma
// resize. Exercised through the disabled-paint branch, which calls
// #prepareCanvas and returns (no node/offscreen machinery needed).
// ==========================================================================

function makeCanvas() {
  const ctx = {
    setTransform: () => {},
    clearRect: () => {},
  };
  return { width: 0, height: 0, style: {}, getContext: () => ctx, remove: () => {} };
}

function makeSigma(pixelRatio, dims) {
  const handlers = new Map();
  const canvas = makeCanvas();
  const sigma = {
    pixelRatio,
    createCanvasContext: () => sigma,
    getCanvases: () => ({ heatmap: canvas }),
    getDimensions: () => ({ width: dims.width, height: dims.height }),
    on: (ev, fn) => handlers.set(ev, fn),
    off: () => {},
    emit: (ev) => handlers.get(ev)?.(),
  };
  return { sigma, canvas };
}

let rafQueue = [];
beforeEach(() => {
  rafQueue = [];
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

describe('HeatmapLayer — canvas CSS display size (non-primary DPR bug)', () => {
  it('sets the CSS display size to the viewport CSS px at dpr 2', () => {
    const { sigma, canvas } = makeSigma(2, { width: 800, height: 600 });
    const layer = new HeatmapLayer({ sigma });

    // Heatmap defaults to disabled; force a paint through the disabled branch,
    // which clears via #prepareCanvas.
    layer.cleared = false;
    sigma.emit('afterRender');
    flushRaf();

    expect(canvas.width).toBe(800 * 2);
    expect(canvas.style.width).toBe('800px');
    expect(canvas.style.height).toBe('600px');
  });

  it('keeps the CSS size correct at dpr 1 (primary monitor)', () => {
    const { sigma, canvas } = makeSigma(1, { width: 1024, height: 768 });
    const layer = new HeatmapLayer({ sigma });

    layer.cleared = false;
    sigma.emit('afterRender');
    flushRaf();

    expect(canvas.width).toBe(1024);
    expect(canvas.style.width).toBe('1024px');
    expect(canvas.style.height).toBe('768px');
  });
});
