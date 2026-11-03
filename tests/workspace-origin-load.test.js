// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { History } from '../src/managers/history.js';

vi.mock('../src/graph/sigma_adapter.js', () => ({ SigmaAdapter: class {} }));
const { GraphCoreManager } = await import('../src/graph/core.js');

// ==========================================================================
// "Reset to as loaded" needs an origin for the workspace a file opens in:
// the first render of a graph is where that snapshot is taken, and a
// rebuild of the graph (data edit, merge) throws every origin away.
// ==========================================================================

function makeCache() {
  const cache = {
    EVENT_LOCKS: {},
    nodePositionsFromExcelImport: new Map(),
    data: {
      selectedLayout: 'Default',
      layouts: { Default: { positions: new Map(), filters: new Map([['p', { active: true }]]) } },
    },
    ui: { debug() {}, showLoading: async () => {}, hideLoading: async () => {}, error: vi.fn(), clearLog() {} },
    metrics: { updateMetricUI: async () => {} },
    graph: { render: async () => {}, destroy: async () => {} },
    INSTANCES: {},
  };
  cache.history = new History(cache);
  return cache;
}

/** GraphCoreManager with the steps unrelated to history stubbed out. */
function coreFor(cache) {
  const gcm = new GraphCoreManager(cache);
  gcm.registerHotkeyEvents = () => {};
  gcm.registerGlobalEventListeners = () => {};
  gcm.preRenderEvent = async () => {};
  gcm.applyHideDisconnectedState = async () => {};
  return gcm;
}

globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);

describe('workspace origin on load', () => {
  it('the first render of a graph records the open workspace as loaded', async () => {
    const cache = makeCache();
    await coreFor(cache).initialAfterRenderEvent();
    expect(cache.ui.error).not.toHaveBeenCalled();
    expect(cache.history.hasOrigin('Default')).toBe(true);
  });

  it('tearing the graph down forgets every origin', async () => {
    const cache = makeCache();
    const gcm = coreFor(cache);
    await gcm.initialAfterRenderEvent();
    await gcm.destroyGraphAndRollBackUI();
    expect(cache.history.hasOrigin('Default')).toBe(false);
  });
});
