// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphBubbleSetManager } from '../src/graph/bubble_sets.js';

// ==========================================================================
// The Groups list under Overlays › Groups.
//
// It is the home the feature never had: naming, colour, membership and the
// route to styling in one place. The behaviours worth pinning are the ones a
// user reads as truth — the ＋/－ button saying what a click will do, and the
// row admitting when a group has two membership sources at once.
// ==========================================================================

function makeCache(groups = { g1: 'Kinases' }) {
  const bubbleSetStyle = {};
  Object.entries(groups).forEach(([key, labelText], i) => {
    bubbleSetStyle[key] = { labelText, fill: ['#403C53', '#C33D35'][i] ?? '#888' };
  });
  const layout = { filters: new Map(), bubbleSetStyle };
  for (const key of Object.keys(bubbleSetStyle)) {
    layout[`${key}Props`] = new Set();
    layout[`${key}ManualMembers`] = new Set();
  }
  return {
    data: { selectedLayout: 'Default', layouts: { Default: layout } },
    DEFAULTS: { BUBBLE_GROUP_STYLE_TEMPLATE: {} },
    INSTANCES: { BUBBLE_GROUPS: {} },
    lastBubbleSetMembers: new Map(),
    propIDsToNodeIDsToBeShown: new Map(),
    hiddenDanglingNodeIDs: new Set(),
    nodeRef: new Map(),
    selectedNodes: [],
    graph: { draw: vi.fn(async () => {}), bubbleLayer: { removeGroup: vi.fn() } },
    history: { commit: vi.fn() },
    uiComponents: { refreshGroupChips: vi.fn() },
    sm: { selectNodes: vi.fn() },
    ui: {
      info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(),
      syncOverlays: vi.fn(), buildGroupStylePanel: vi.fn(),
    },
  };
}

function mount() {
  document.body.innerHTML = `
    <div id="groupList"></div>
    <div id="groupStylePanel"></div>
  `;
}

const layoutOf = (cache) => cache.data.layouts.Default;
const toggleFor = (group) => document.querySelector(`.group-row-toggle[data-group="${group}"]`);

beforeEach(() => {
  document.body.innerHTML = '';
  for (const el of document.querySelectorAll('.rail-menu')) el.remove();
});

describe('group list rows', () => {
  it('renders one row per group with its name, colour and count', () => {
    mount();
    const cache = makeCache({ g1: 'Kinases', g2: 'Hubs' });
    layoutOf(cache).g1ManualMembers = new Set(['n1', 'n2']);
    cache.nodeRef = new Map([['n1', {}], ['n2', {}]]);

    new GraphBubbleSetManager(cache).renderGroupList();

    const rows = document.querySelectorAll('.group-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.group-name').value).toBe('Kinases');
    expect(rows[0].querySelector('.group-count').textContent).toBe('2 nodes');
    expect(rows[0].querySelector('.group-swatch').value).toBe('#403c53');
    expect(rows[1].querySelector('.group-count').textContent).toBe('0 nodes');
  });

  it('singularises a one-node count', () => {
    mount();
    const cache = makeCache();
    layoutOf(cache).g1ManualMembers = new Set(['n1']);
    cache.nodeRef = new Map([['n1', {}]]);
    new GraphBubbleSetManager(cache).renderGroupList();
    expect(document.querySelector('.group-count').textContent).toBe('1 node');
  });

  it('shows the empty state instead of an empty list', () => {
    mount();
    new GraphBubbleSetManager(makeCache({})).renderGroupList();
    expect(document.querySelectorAll('.group-row')).toHaveLength(0);
    expect(document.querySelector('.group-empty').textContent).toContain('No groups yet');
    expect(document.getElementById('groupList').classList.contains('is-empty')).toBe(true);
  });
});

describe('the ＋/－ button says what a click will do', () => {
  function render(selected, manual) {
    mount();
    const cache = makeCache();
    cache.selectedNodes = selected;
    layoutOf(cache).g1ManualMembers = new Set(manual);
    cache.nodeRef = new Map([...selected, ...manual].map((id) => [id, {}]));
    new GraphBubbleSetManager(cache).renderGroupList();
    return cache;
  }

  it('disables itself, without a count, when nothing is selected', () => {
    render([], []);
    expect(toggleFor('g1').disabled).toBe(true);
    expect(toggleFor('g1').textContent).toBe('＋');
    expect(toggleFor('g1').title).toContain('Select nodes first');
  });

  it('offers to add when the selection is outside the group', () => {
    render(['a', 'b'], []);
    expect(toggleFor('g1').disabled).toBe(false);
    expect(toggleFor('g1').textContent).toBe('＋ 2');
    expect(toggleFor('g1').classList.contains('remove')).toBe(false);
  });

  it('offers to remove only when the WHOLE selection is inside', () => {
    render(['a', 'b'], ['a', 'b']);
    expect(toggleFor('g1').textContent).toBe('－ 2');
    expect(toggleFor('g1').classList.contains('remove')).toBe(true);
  });

  it('still offers to add when the selection only partly overlaps', () => {
    render(['a', 'b'], ['a']);
    expect(toggleFor('g1').textContent).toBe('＋ 2');
    expect(toggleFor('g1').title).toContain('some are already in it');
  });
});

describe('the source line', () => {
  it('appears only for a filter-driven group, and names both sources', () => {
    mount();
    const cache = makeCache({ g1: 'Kinases', g2: 'Hubs' });
    layoutOf(cache).g1Props = new Set(['Node::Topology::degree']);
    layoutOf(cache).g1ManualMembers = new Set(['n5']);
    cache.propIDsToNodeIDsToBeShown.set('Node::Topology::degree', ['n1']);
    cache.nodeRef = new Map([['n1', {}], ['n5', {}]]);

    new GraphBubbleSetManager(cache).renderGroupList();

    const source = document.querySelector('.group-row[data-group="g1"] .group-row-source');
    expect(source.textContent).toBe('⚙ Node › Topology › degree · +1 manual');
    expect(document.querySelector('.group-row[data-group="g2"] .group-row-source')).toBeNull();
  });

  it('omits the manual tally when a group is purely filter-driven', () => {
    mount();
    const cache = makeCache();
    layoutOf(cache).g1Props = new Set(['Node::x::y']);
    new GraphBubbleSetManager(cache).renderGroupList();

    expect(document.querySelector('.group-row-source').textContent).toBe('⚙ Node › x › y');
  });
});

describe('selecting a row', () => {
  it('rebuilds the settings pane for that group only', () => {
    mount();
    const cache = makeCache({ g1: 'Kinases', g2: 'Hubs' });
    const bs = new GraphBubbleSetManager(cache);
    bs.renderGroupList();

    expect(cache.ui.buildGroupStylePanel).toHaveBeenLastCalledWith('g1');

    document.querySelector('.group-row[data-group="g2"]').click();
    expect(cache.ui.buildGroupStylePanel).toHaveBeenLastCalledWith('g2');
    expect(document.querySelector('.group-row[data-group="g2"]').classList.contains('active'))
      .toBe(true);
  });

  it('falls back to a surviving group when the selected one is deleted', async () => {
    mount();
    const cache = makeCache({ g1: 'Kinases', g2: 'Hubs' });
    const bs = new GraphBubbleSetManager(cache);
    bs.renderGroupList();
    document.querySelector('.group-row[data-group="g2"]').click();
    expect(bs.selectedGroup).toBe('g2');

    await bs.deleteGroup('g2');
    bs.renderGroupList();

    expect(bs.selectedGroup).toBe('g1');
  });

  it('does not hijack a click meant for a control inside the row', () => {
    mount();
    const cache = makeCache({ g1: 'Kinases', g2: 'Hubs' });
    const bs = new GraphBubbleSetManager(cache);
    bs.renderGroupList();

    // The ⋯ button lives inside row g2; clicking it must not also select g2
    // out from under the menu that is about to open.
    document.querySelector('.group-row[data-group="g2"] .group-row-more').click();
    expect(bs.selectedGroup).toBe('g1');
  });
});
