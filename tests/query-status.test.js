// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryManager } from '../src/managers/query.js';

// ==========================================================================
// The query toolbar says what the box is doing to the graph, and "Reset to
// filters" really hands the graph back to the panel. ⟳ Sync used to unlock
// the panel and rewrite the text without re-filtering, so the graph kept the
// query's result under a panel that claimed to be in control.
// ==========================================================================

function makeQM({ locked = false } = {}) {
  document.body.innerHTML = `
    <span class="query-status"><span class="query-status-pill"></span><span class="query-status-text"></span></span>
    <button id="queryUpdateBtn"></button><button id="querySelectBtn"></button>`;
  const text = document.createElement('div');
  const cache = {
    query: { valid: true, text, overlay: document.createElement('div'), caret: { style: {} } },
    EVENT_LOCKS: { FILTERS_LOCKED_BY_MANUAL_QUERY: locked },
    data: { selectedLayout: 'L', layouts: { L: { filters: new Map() } } },
    uniquePropHierarchy: { 'Node filters': { g: new Set(['type']) } },
    ui: { unlockFiltersAndResetQuery: vi.fn(async () => {}), updateFilterLockState: vi.fn() },
  };
  const qm = new QueryManager(cache);
  const type = (str) => {
    text.textContent = str;
    qm.handleQueryValidationEvent(true);
  };
  return { qm, cache, type };
}

const status = () => ({
  state: document.querySelector('.query-status').dataset.state,
  text: document.querySelector('.query-status-text').textContent,
});

describe('query status line', () => {
  let ctx;
  beforeEach(() => {
    ctx = makeQM();
  });

  it('reads Synced after a render pass, Edited after a change, Error with the culprit', () => {
    ctx.type('Node filters::g::type IN [a]');
    ctx.qm.markApplied();
    expect(status().state).toBe('synced');

    ctx.type('Node filters::g::type IN [a, b]');
    expect(status()).toEqual({ state: 'edited', text: 'Not applied · Ctrl+Enter filters the graph' });

    ctx.type('Node filters::g::type IN [a] AND wat');
    expect(status().state).toBe('error');
    expect(status().text).toContain('Not recognised: AND, wat.');
  });

  it('reads Applied while the query locks the panel', () => {
    ctx.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY = true;
    ctx.type('Node filters::g::type IN [a]');
    ctx.qm.markApplied();
    expect(status().state).toBe('applied');
  });

  it('does not run Filter graph on a broken query (Ctrl+Enter bypasses the disabled button)', async () => {
    ctx.cache.fm = { handleFilterEvent: vi.fn() };
    ctx.type('wat');
    await ctx.qm.handleQueryUpdateEvent();
    expect(ctx.cache.fm.handleFilterEvent).not.toHaveBeenCalled();
  });
});

describe('Reset to filters', () => {
  it('re-applies the panel filters when a query was filtering the graph', async () => {
    const { qm, cache } = makeQM({ locked: true });
    await qm.resetToFilters();
    expect(cache.ui.unlockFiltersAndResetQuery).toHaveBeenCalledOnce();
  });

  it('only rewrites the text while the panel is already in control', async () => {
    const { qm, cache } = makeQM();
    qm.resetQuery = vi.fn();
    await qm.resetToFilters();
    expect(qm.resetQuery).toHaveBeenCalledOnce();
    expect(cache.ui.unlockFiltersAndResetQuery).not.toHaveBeenCalled();
  });
});
