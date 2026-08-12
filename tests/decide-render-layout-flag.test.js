// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphCoreManager } from '../src/graph/core.js';

// ==========================================================================
// decideToRenderOrDraw × cache.layoutChanged. The flag is raised by
// handleLayoutChangeLoadingEvent (Arrange/Re-layout) but was never reset, so
// the FIRST arrange of a session forced the full re-indexing render() branch
// onto every later style- or filter-only update. Contract: a successful
// render consumes the flag; a failed one keeps it up so the next call
// re-renders.
// ==========================================================================

function createCache() {
  const asyncNoop = async () => {};
  return {
    layoutChanged: false,
    styleChanged: false,
    bubbleSetChanged: false,
    EVENT_LOCKS: {},
    ui: { showLoading: asyncNoop, hideLoading: asyncNoop, error: vi.fn() },
    metrics: { updateMetricUI: asyncNoop },
    graph: { render: vi.fn(async () => true), draw: vi.fn(async () => true) },
  };
}

function createManager(cache) {
  const gcm = new GraphCoreManager(cache);
  // The real preRenderEvent runs the whole filter pipeline — irrelevant here.
  gcm.preRenderEvent = async () => {};
  return gcm;
}

beforeEach(() => {
  globalThis.requestAnimationFrame = (cb) => {
    cb();
    return 1;
  };
});

describe('decideToRenderOrDraw — layoutChanged lifecycle', () => {
  it('consumes the flag after a successful render, so later updates draw', async () => {
    const cache = createCache();
    const gcm = createManager(cache);

    cache.layoutChanged = true;
    await gcm.decideToRenderOrDraw();
    expect(cache.graph.render).toHaveBeenCalledTimes(1);
    expect(cache.layoutChanged).toBe(false);

    // A style/filter-only follow-up must take the cheap draw branch again.
    await gcm.decideToRenderOrDraw();
    expect(cache.graph.render).toHaveBeenCalledTimes(1);
    expect(cache.graph.draw).toHaveBeenCalledTimes(1);
  });

  it('keeps the flag up when the render throws, so the next call re-renders', async () => {
    const cache = createCache();
    const gcm = createManager(cache);
    cache.graph.render.mockRejectedValueOnce(new Error('boom'));

    cache.layoutChanged = true;
    await gcm.decideToRenderOrDraw();
    expect(cache.layoutChanged).toBe(true);

    await gcm.decideToRenderOrDraw();
    expect(cache.graph.render).toHaveBeenCalledTimes(2);
    expect(cache.layoutChanged).toBe(false);
  });
});
