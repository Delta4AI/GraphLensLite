// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GraphLayoutManager } from '../src/graph/layout.js';

// ==========================================================================
// changeLayout × bubble hulls: switching between workspaces with different
// groups used to flash the INCOMING groups' colors on the OUTGOING shape
// (the group sync repaints the layer before the tween), then briefly show
// the stale shape again after the tween. The choreography under test:
//   - the hulls are hidden BEFORE any incoming state (styles, group sync)
//     can repaint them, and revealed again when the switch is done
//   - a switch that was cancelled mid-tween by a newer one must NOT reveal
//     the hulls while the newer switch is still animating (its live cancel
//     handle marks that ownership)
// ==========================================================================

function createCache(calls) {
  const asyncNoop = async () => {};
  const noop = () => {};
  const graph = {
    updateNodeData: asyncNoop,
    updateEdgeData: asyncNoop,
    pendingLayoutTransition: false,
    layoutTransitionCancel: null,
    runLayoutTransition: vi.fn(async () => calls.push('tween')),
    bubbleLayer: {
      setFaded: vi.fn((faded) => calls.push(faded ? 'hide' : 'reveal')),
    },
  };
  return {
    nodeRef: new Map(),
    edgeRef: new Map(),
    EVENT_LOCKS: {},
    data: {
      selectedLayout: 'Circle',
      layouts: {
        Circle: { positions: new Map([['a', { style: { x: 1, y: 2 } }]]) },
      },
    },
    ui: {
      showLoading: asyncNoop, hideLoading: asyncNoop, holdLoading: noop,
      releaseLoading: noop, buildFilterUI: noop, updateFilterLockState: noop,
      clearActivePropsCacheOnLayoutChange: noop, info: noop, debug: noop,
    },
    qm: { updateQueryTextArea: noop },
    metrics: { updateMetricUI: asyncNoop },
    gcm: { decideToRenderOrDraw: asyncNoop, applyHideDisconnectedState: asyncNoop },
    bs: {
      updateBubbleSetIfChanged: vi.fn(async () => calls.push('group-sync')),
      renderGroupList: noop,
      refreshBubbleStyleElements: noop,
    },
    history: { reset: noop },
    graph,
  };
}

let rafQueue = [];
beforeEach(() => {
  rafQueue = [];
  globalThis.requestAnimationFrame = (cb) => {
    // changeLayout awaits one frame right after showLoading — run it inline.
    cb();
    return 1;
  };
  document.body.innerHTML = '<select id="selectView"><option>Circle</option></select>';
  document.getElementById('selectView').value = 'Circle';
});

describe('changeLayout — bubble hull hand-off', () => {
  it('hides the hulls before the group sync and reveals them at the end', async () => {
    const calls = [];
    const cache = createCache(calls);
    await new GraphLayoutManager(cache).changeLayout();

    expect(calls.indexOf('hide')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('hide')).toBeLessThan(calls.indexOf('group-sync'));
    expect(calls.indexOf('group-sync')).toBeLessThan(calls.indexOf('tween'));
    expect(calls[calls.length - 1]).toBe('reveal');
  });

  it('releases the loading hold and reveals when the selected workspace is missing', async () => {
    const calls = [];
    const cache = createCache(calls);
    cache.ui.releaseLoading = vi.fn();
    cache.ui.hideLoading = vi.fn(async () => {});
    // #selectView names a workspace that no longer exists → the layout lookup
    // throws. A leaked hold would block every hideLoading() until reload.
    delete cache.data.layouts.Circle;

    await expect(new GraphLayoutManager(cache).changeLayout()).rejects.toThrow();

    expect(cache.ui.releaseLoading).toHaveBeenCalled();
    expect(cache.ui.hideLoading).toHaveBeenCalled();
    expect(calls).toContain('reveal');
    expect(cache.graph.pendingLayoutTransition).toBe(false);
  });

  it('does not reveal when a newer switch owns the tween (cancelled mid-flight)', async () => {
    const calls = [];
    const cache = createCache(calls);
    // Simulate being cancelled: when this switch's tween returns, the NEWER
    // switch's cancel handle is live on the adapter.
    cache.graph.runLayoutTransition = vi.fn(async () => {
      cache.graph.layoutTransitionCancel = () => {};
    });
    await new GraphLayoutManager(cache).changeLayout();

    expect(calls).toContain('hide');
    expect(calls).not.toContain('reveal');
  });
});
