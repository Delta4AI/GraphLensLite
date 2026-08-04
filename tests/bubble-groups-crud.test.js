// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphBubbleSetManager } from '../src/graph/bubble_sets.js';

// ==========================================================================
// Bubble groups as an unbounded, per-workspace collection.
//
// The count used to be four, implied by an object literal in config and
// hardcoded again as quadrant positions. A workspace now owns its own
// `bubbleSetStyle` map, so the invariants worth pinning are:
//   - a new key never collides with the legacy groupOne..groupFour,
//   - deleting a group leaves NO trace (a stray ${group}Props key would
//     resurrect it on the next load, see io.savedLayoutGroupKeys),
//   - traverseBubbleSets describes the SELECTED workspace and nothing else.
// ==========================================================================

function makeCache(layout = { bubbleSetStyle: {}, filters: new Map() }) {
  return {
    data: { selectedLayout: 'Default', layouts: { Default: layout } },
    DEFAULTS: { BUBBLE_GROUP_STYLE_TEMPLATE: {} },
    CFG: { AVOID_MEMBERS_IN_BUBBLE_GROUPS: true },
    INSTANCES: { BUBBLE_GROUPS: {} },
    lastBubbleSetMembers: new Map(),
    propIDsToNodeIDsToBeShown: new Map(),
    hiddenDanglingNodeIDs: new Set(),
    nodeRef: new Map(),
    selectedNodes: new Set(),
    graph: { draw: vi.fn(async () => {}), bubbleLayer: { removeGroup: vi.fn() } },
    history: { commit: vi.fn() },
    uiComponents: { refreshGroupChips: vi.fn() },
    ui: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), syncOverlays: vi.fn() },
  };
}

const bsFor = (cache) => new GraphBubbleSetManager(cache);

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('createGroup', () => {
  it('seeds all three per-layout stores', () => {
    const cache = makeCache();
    const key = bsFor(cache).createGroup({ name: 'Kinases' });
    const layout = cache.data.layouts.Default;

    expect(layout.bubbleSetStyle[key].labelText).toBe('Kinases');
    expect(layout[`${key}Props`]).toBeInstanceOf(Set);
    expect(layout[`${key}ManualMembers`]).toBeInstanceOf(Set);
  });

  it('mints keys that never collide with a legacy four-group workspace', () => {
    const legacy = { filters: new Map(), bubbleSetStyle: {} };
    for (const g of ['groupOne', 'groupTwo', 'groupThree', 'groupFour']) {
      legacy.bubbleSetStyle[g] = { fill: '#000' };
    }
    const bs = bsFor(makeCache(legacy));

    const first = bs.createGroup();
    const second = bs.createGroup();

    expect(first).toBe('g1');
    expect(second).toBe('g2');
    expect(Object.keys(legacy.bubbleSetStyle)).toHaveLength(6);
  });

  it('reuses a key freed by a delete instead of counting upward forever', async () => {
    const cache = makeCache();
    const bs = bsFor(cache);
    bs.createGroup();
    const second = bs.createGroup();
    await bs.deleteGroup(second);

    expect(bs.createGroup()).toBe('g2');
  });

  it('can seed property-derived membership from one filter', () => {
    const cache = makeCache();
    const key = bsFor(cache).createGroup({ fromProp: 'Node::x::y' });
    expect([...cache.data.layouts.Default[`${key}Props`]]).toEqual(['Node::x::y']);
  });

  it('refuses, loudly, when no workspace is loaded', () => {
    const cache = makeCache();
    cache.data.layouts = {};
    expect(bsFor(cache).createGroup()).toBeNull();
    expect(cache.ui.error).toHaveBeenCalled();
  });
});

describe('deleteGroup', () => {
  it('leaves no trace in any of the five places a group lives', async () => {
    const cache = makeCache();
    const bs = bsFor(cache);
    const key = bs.createGroup();
    cache.INSTANCES.BUBBLE_GROUPS[key] = { members: new Map() };
    cache.lastBubbleSetMembers.set(key, new Set(['n1']));

    await bs.deleteGroup(key);

    const layout = cache.data.layouts.Default;
    expect(layout.bubbleSetStyle[key]).toBeUndefined();
    expect(layout[`${key}Props`]).toBeUndefined();
    expect(layout[`${key}ManualMembers`]).toBeUndefined();
    expect(cache.INSTANCES.BUBBLE_GROUPS[key]).toBeUndefined();
    expect(cache.lastBubbleSetMembers.has(key)).toBe(false);
    expect(cache.graph.bubbleLayer.removeGroup).toHaveBeenCalledWith(key);
  });

  it('leaves the surviving groups untouched', async () => {
    const cache = makeCache();
    const bs = bsFor(cache);
    const a = bs.createGroup({ name: 'A' });
    const b = bs.createGroup({ name: 'B' });
    const c = bs.createGroup({ name: 'C' });
    cache.data.layouts.Default[`${c}ManualMembers`] = new Set(['n9']);

    await bs.deleteGroup(b);

    expect(Object.keys(cache.data.layouts.Default.bubbleSetStyle)).toEqual([a, c]);
    expect(cache.data.layouts.Default[`${c}ManualMembers`]).toEqual(new Set(['n9']));
  });

  it('is a no-op for a group that does not exist', async () => {
    const cache = makeCache();
    await bsFor(cache).deleteGroup('ghost');
    expect(cache.history.commit).not.toHaveBeenCalled();
  });
});

describe('updateBubbleSetIfChanged with a runtime-created group', () => {
  // Found live: the fixed four were always pre-seeded into lastBubbleSetMembers
  // by workspace creation, so the baseline was never missing. A group created
  // at runtime has no entry, and setsAreEqual(undefined, …) threw inside
  // afterMembershipChange — which aborted the draw AND stranded the loading
  // overlay, so the whole app locked up the first time you filled a new group.
  it('treats a missing baseline as empty instead of throwing', async () => {
    const cache = makeCache();
    const bs = bsFor(cache);
    const key = bs.createGroup();
    cache.data.layouts.Default[`${key}ManualMembers`] = new Set(['n1']);
    cache.nodeRef = new Map([['n1', {}]]);
    cache.INSTANCES.BUBBLE_GROUPS[key] = {
      members: new Map(),
      update: vi.fn(async () => {}),
      drawBubbleSets: vi.fn(async () => {}),
    };

    await expect(bs.updateBubbleSetIfChanged()).resolves.toBeUndefined();

    expect(cache.INSTANCES.BUBBLE_GROUPS[key].update).toHaveBeenCalled();
    expect(cache.lastBubbleSetMembers.get(key)).toEqual(new Set(['n1']));
  });
});

describe('traverseBubbleSets', () => {
  it('describes the selected workspace, at any size', () => {
    const layout = { filters: new Map(), bubbleSetStyle: {} };
    const cache = makeCache(layout);
    const bs = bsFor(cache);
    for (let i = 0; i < 7; i++) bs.createGroup();

    expect([...bs.traverseBubbleSets()]).toHaveLength(7);
  });

  it('yields nothing for a workspace with no groups', () => {
    expect([...bsFor(makeCache()).traverseBubbleSets()]).toEqual([]);
  });

  it('follows a workspace switch', () => {
    const cache = makeCache();
    cache.data.layouts.Other = { filters: new Map(), bubbleSetStyle: { gX: {} } };
    const bs = bsFor(cache);
    bs.createGroup();

    expect([...bs.traverseBubbleSets()]).toEqual(['g1']);
    cache.data.selectedLayout = 'Other';
    expect([...bs.traverseBubbleSets()]).toEqual(['gX']);
  });

  it('survives being asked before any graph is loaded', () => {
    const bs = bsFor(makeCache());
    bs.cache.data = {};
    expect([...bs.traverseBubbleSets()]).toEqual([]);
  });
});

describe('selectionMembership', () => {
  function withSelection(selected, manual) {
    const layout = { filters: new Map(), bubbleSetStyle: { g1: {} }, g1ManualMembers: new Set(manual) };
    const cache = makeCache(layout);
    cache.selectedNodes = selected;
    return bsFor(cache);
  }

  it('reports none, some and all — the three states the ＋/－ button needs', () => {
    expect(withSelection(['a', 'b'], []).selectionMembership('g1')).toBe('none');
    expect(withSelection(['a', 'b'], ['a']).selectionMembership('g1')).toBe('some');
    expect(withSelection(['a', 'b'], ['a', 'b']).selectionMembership('g1')).toBe('all');
  });

  it('reports none for an empty selection rather than vacuously "all"', () => {
    // every() on [] is true, which would render "－ 0" on an untouched group.
    expect(withSelection([], ['a']).selectionMembership('g1')).toBe('none');
  });
});

describe('duplicateGroup', () => {
  it('copies the style and both membership stores', async () => {
    const cache = makeCache();
    const bs = bsFor(cache);
    bs.renderGroupList = vi.fn();
    bs.syncGroupRows = vi.fn();
    bs.refreshBubbleStyleElements = vi.fn();
    bs.updateBubbleSetIfChanged = vi.fn(async () => {});
    bs.redrawBubbleSets = vi.fn(async () => {});

    const src = bs.createGroup({ name: 'Kinases' });
    const layout = cache.data.layouts.Default;
    layout[`${src}Props`] = new Set(['propA']);
    layout[`${src}ManualMembers`] = new Set(['n1', 'n2']);
    layout.bubbleSetStyle[src].padding = 0.42;

    await bs.duplicateGroup(src);

    const copy = Object.keys(layout.bubbleSetStyle).find((g) => g !== src);
    expect(layout.bubbleSetStyle[copy].padding).toBe(0.42);
    expect(layout.bubbleSetStyle[copy].labelText).toBe('Kinases copy');
    expect(layout[`${copy}Props`]).toEqual(new Set(['propA']));
    expect(layout[`${copy}ManualMembers`]).toEqual(new Set(['n1', 'n2']));
    // A copy that shared the source's Sets would mutate it on the next edit.
    expect(layout[`${copy}ManualMembers`]).not.toBe(layout[`${src}ManualMembers`]);
  });
});
