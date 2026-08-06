// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { History } from '../src/managers/history.js';

// ==========================================================================
// Global undo/redo. The load-bearing property: a snapshot is the WHOLE view
// state of the current workspace, restored through the same lm.changeLayout()
// path a workspace switch uses — so a future feature that stores something new
// on the layout is undoable without touching this module.
// ==========================================================================

function makeLayout(overrides = {}) {
  return {
    internals: { renderer: 'live handle' },
    layoutType: 'force',
    positions: new Map([['n1', { style: { x: 1, y: 2 } }]]),
    filters: new Map([['p1', { active: true }]]),
    nodeStyles: new Map(),
    edgeStyles: new Map(),
    groupOneManualMembers: new Set(),
    ...overrides,
  };
}

function makeCache() {
  document.body.innerHTML = `
    <button id="historyUndoBtn" class="disabled">↶</button>
    <button id="historyRedoBtn" class="disabled">↷</button>
    <select id="selectView"><option>Default</option><option>Other</option></select>`;

  const cache = {
    graph: {},
    nodeRef: new Map([['n1', {}]]),
    data: { selectedLayout: 'Default', layouts: { Default: makeLayout() } },
    ui: {
      toggleDisabledElements(ids, enable) {
        for (const id of ids) {
          document.getElementById(id)?.classList.toggle('disabled', !enable);
        }
      },
    },
  };
  cache.lm = { changeLayout: vi.fn(async () => {}) };
  return cache;
}

const layoutOf = (cache) => cache.data.layouts[cache.data.selectedLayout];
const enabled = (id) => !document.getElementById(id).classList.contains('disabled');

describe('History', () => {
  let cache;
  let history;

  beforeEach(() => {
    cache = makeCache();
    history = new History(cache);
    cache.history = history;
    history.reset();
  });

  it('records what changed since the last commit under one label', () => {
    layoutOf(cache).filters.get('p1').active = false;
    history.commit('Filter change');

    expect(history.canUndo).toBe(true);
    expect(history.undoLabel).toBe('Filter change');
  });

  it('restores the previous state through changeLayout', async () => {
    layoutOf(cache).filters.get('p1').active = false;
    history.commit('Filter change');

    await history.undo();

    expect(layoutOf(cache).filters.get('p1').active).toBe(true);
    // Second argument: the loading overlay's own wording. Without it the
    // restore borrowed changeLayout's "Switching Workspace" full-screen header,
    // so undoing a slider tweak flashed a workspace switch that never happened.
    expect(cache.lm.changeLayout).toHaveBeenCalledWith('Undone: Filter change', {
      header: 'Undoing',
      text: 'Filter change',
    });
  });

  it('redoes what it undid', async () => {
    layoutOf(cache).filters.get('p1').active = false;
    history.commit('Filter change');
    await history.undo();

    expect(history.canRedo).toBe(true);
    await history.redo();

    expect(layoutOf(cache).filters.get('p1').active).toBe(false);
    expect(cache.lm.changeLayout).toHaveBeenLastCalledWith('Redone: Filter change', {
      header: 'Redoing',
      text: 'Filter change',
    });
  });

  it('covers anything stored on the layout, not a fixed list of operations', async () => {
    layoutOf(cache).positions.set('n1', { style: { x: 99, y: 99 } });
    layoutOf(cache).groupOneManualMembers.add('n1');
    layoutOf(cache).somethingAFutureFeatureAdded = 'set';
    history.commit('Arrange selection (grid)');

    await history.undo();

    expect(layoutOf(cache).positions.get('n1').style.x).toBe(1);
    expect(layoutOf(cache).groupOneManualMembers.size).toBe(0);
    expect(layoutOf(cache).somethingAFutureFeatureAdded).toBeUndefined();
  });

  it('keeps the live renderer handle out of the snapshot', async () => {
    const handle = layoutOf(cache).internals;
    layoutOf(cache).layoutType = 'circular';
    history.commit('Re-layout (circular)');
    await history.undo();

    // Same object, not a structuredClone of it — a cloned handle is a dead one.
    expect(layoutOf(cache).internals).toBe(handle);
  });

  it('snapshots are copies: mutating the layout afterwards cannot reach them', async () => {
    history.commit('Node style change');
    layoutOf(cache).filters.get('p1').active = false;
    history.commit('Filter change');

    await history.undo();
    expect(layoutOf(cache).filters.get('p1').active).toBe(true);
  });

  it('a new change drops the redo branch', async () => {
    layoutOf(cache).layoutType = 'circular';
    history.commit('Re-layout (circular)');
    await history.undo();
    expect(history.canRedo).toBe(true);

    layoutOf(cache).layoutType = 'grid';
    history.commit('Re-layout (grid)');

    expect(history.canRedo).toBe(false);
    expect(history.undoLabel).toBe('Re-layout (grid)');
  });

  it('never records its own restore as a change', async () => {
    // changeLayout runs the app's own post-switch choreography, which itself
    // calls commit-adjacent code paths; a restore that recorded itself would
    // make undo a toggle that never gets further back.
    cache.lm.changeLayout = vi.fn(async () => history.commit('Filter change'));
    layoutOf(cache).filters.get('p1').active = false;
    history.commit('Filter change');

    await history.undo();

    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
  });

  it('ignores a reset fired by its own restore, which would wipe the redo branch', async () => {
    // changeLayout re-runs the initial-render choreography, and that path calls
    // history.reset() — obeying it mid-undo left nothing to redo.
    cache.lm.changeLayout = vi.fn(async () => history.reset());
    layoutOf(cache).layoutType = 'grid';
    history.commit('Re-layout (grid)');

    await history.undo();

    expect(history.canRedo).toBe(true);
    expect(history.redoLabel).toBe('Re-layout (grid)');
  });

  it('drives the rail buttons and names the pending action', async () => {
    expect(enabled('historyUndoBtn')).toBe(false);
    expect(document.getElementById('historyUndoBtn').title).toBe('Nothing to undo');

    layoutOf(cache).layoutType = 'grid';
    history.commit('Re-layout (grid)');

    expect(enabled('historyUndoBtn')).toBe(true);
    expect(document.getElementById('historyUndoBtn').title).toContain('Undo: Re-layout (grid)');

    await history.undo();
    expect(enabled('historyUndoBtn')).toBe(false);
    expect(enabled('historyRedoBtn')).toBe(true);
    expect(document.getElementById('historyRedoBtn').title).toContain('Redo: Re-layout (grid)');
  });

  it('reset forgets everything — a rebuilt graph invalidates every snapshot', () => {
    layoutOf(cache).layoutType = 'grid';
    history.commit('Re-layout (grid)');

    history.reset();

    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(enabled('historyUndoBtn')).toBe(false);
  });

  it('caps the stack, deepest on a small graph', () => {
    for (let i = 0; i < 30; i++) {
      layoutOf(cache).layoutType = `type-${i}`;
      history.commit(`Re-layout (type-${i})`);
    }
    expect(history.past).toHaveLength(20);
    expect(history.undoLabel).toBe('Re-layout (type-29)');
  });

  it('keeps fewer steps on a big graph, where a snapshot is expensive', () => {
    for (let i = 0; i < 3000; i++) cache.nodeRef.set(`n${i}`, {});
    for (let i = 0; i < 30; i++) {
      layoutOf(cache).layoutType = `type-${i}`;
      history.commit(`Re-layout (type-${i})`);
    }
    expect(history.past).toHaveLength(5);
  });

  it('does nothing without a graph or a workspace', async () => {
    const bare = new History({ data: {} });
    bare.reset();
    expect(bare.canUndo).toBe(false);
    expect(await bare.undo()).toBe(false);
    expect(() => bare.commit('Filter change')).not.toThrow();
  });

  it('skips an entry whose workspace has been deleted', async () => {
    layoutOf(cache).layoutType = 'grid';
    history.commit('Re-layout (grid)');
    delete cache.data.layouts.Default;

    expect(await history.undo()).toBe(false);
    expect(cache.lm.changeLayout).not.toHaveBeenCalled();
  });

  it('re-baselines instead of recording across a workspace switch', () => {
    cache.data.layouts.Other = makeLayout({ layoutType: 'grid' });
    cache.data.selectedLayout = 'Other';

    history.commit('Filter change');

    // The before-state belonged to another workspace; restoring it here would
    // paint one workspace's state onto another.
    expect(history.canUndo).toBe(false);
    layoutOf(cache).layoutType = 'circular';
    history.commit('Re-layout (circular)');
    expect(history.canUndo).toBe(true);
  });
});
