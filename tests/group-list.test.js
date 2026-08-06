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
    <div id="groupStylePanelHome"><div id="groupStylePanel"></div></div>
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
    // Class + aria, not the attribute: an attribute-disabled button is outside
    // the delegated tooltip layer's reach, and the tooltip is what explains it.
    expect(toggleFor('g1').classList.contains('disabled')).toBe(true);
    expect(toggleFor('g1').getAttribute('aria-disabled')).toBe('true');
    expect(toggleFor('g1').textContent).toBe('＋');
    expect(toggleFor('g1').title).toContain('Select nodes first');
  });

  it('offers to add when the selection is outside the group', () => {
    render(['a', 'b'], []);
    expect(toggleFor('g1').classList.contains('disabled')).toBe(false);
    expect(toggleFor('g1').getAttribute('aria-disabled')).toBe('false');
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

    const parts = [...document.querySelectorAll(
      '.group-row[data-group="g1"] .group-row-source .group-source-part')].map((e) => e.textContent);
    // Two parts, and no "Node ›" section prefix — every row would carry it.
    expect(parts).toEqual(['⚙ follows Topology › degree', '＋ 1 added by hand']);
    expect(document.querySelector('.group-row[data-group="g2"] .group-row-source')).toBeNull();
  });

  it('omits the manual tally when a group is purely filter-driven', () => {
    mount();
    const cache = makeCache();
    layoutOf(cache).g1Props = new Set(['Node::x::y']);
    new GraphBubbleSetManager(cache).renderGroupList();

    const parts = [...document.querySelectorAll('.group-row-source .group-source-part')]
      .map((e) => e.textContent);
    expect(parts).toEqual(['⚙ follows x › y']);
  });
});

describe('the row ⋯ menu', () => {
  function render(groups = { g1: 'Kinases' }) {
    mount();
    const cache = makeCache(groups);
    const bs = new GraphBubbleSetManager(cache);
    bs.refreshBubbleStyleElements = vi.fn();
    bs.updateBubbleSetIfChanged = vi.fn(async () => {});
    bs.redrawBubbleSets = vi.fn(async () => {});
    bs.renderGroupList();
    return { cache, bs };
  }
  const open = async (group = 'g1') => {
    document.querySelector(`.group-row[data-group="${group}"] .group-row-more`).click();
    await Promise.resolve();
  };
  const rowLabels = () =>
    [...document.querySelectorAll('.rail-menu.open .rail-menu-label')].map((e) => e.textContent);
  const clickRow = (label) =>
    [...document.querySelectorAll('.rail-menu.open .rail-menu-item')]
      .find((r) => r.querySelector('.rail-menu-label').textContent === label).click();

  it('offers a source-specific clear only for the sources a group actually has', async () => {
    const { cache } = render();
    layoutOf(cache).g1Props = new Set(['Node::x::y']);
    await open();
    expect(rowLabels()).toContain('Detach filter');
    expect(rowLabels()).not.toContain('Clear manual nodes');

    // Escape, not a stray click: RailMenu closes on pointerdown, and a second
    // click on the anchor would just toggle the open menu shut.
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    layoutOf(cache).g1ManualMembers = new Set(['n1']);
    await open();
    expect(rowLabels()).toContain('Clear manual nodes');
    expect(rowLabels()).toContain('Detach filter');
  });

  it('clears one source and leaves the other standing', async () => {
    const { cache, bs } = render();
    layoutOf(cache).g1Props = new Set(['Node::x::y']);
    layoutOf(cache).g1ManualMembers = new Set(['n1']);
    cache.nodeRef = new Map([['n1', {}]]);
    bs.renderGroupList();

    await open();
    clickRow('Clear manual nodes');
    await Promise.resolve();

    expect(layoutOf(cache).g1ManualMembers.size).toBe(0);
    expect(layoutOf(cache).g1Props).toEqual(new Set(['Node::x::y']));
  });

  it('selects the group members', async () => {
    const { cache, bs } = render();
    layoutOf(cache).g1ManualMembers = new Set(['n1', 'n2']);
    cache.nodeRef = new Map([['n1', {}], ['n2', {}]]);
    bs.renderGroupList();

    await open();
    clickRow('Select members');

    expect(cache.sm.selectNodes).toHaveBeenCalledWith(expect.arrayContaining(['n1', 'n2']));
  });

  it('disables Select members for an empty group rather than selecting nothing', async () => {
    render();
    await open();
    const row = [...document.querySelectorAll('.rail-menu.open .rail-menu-item')]
      .find((r) => r.querySelector('.rail-menu-label').textContent === 'Select members');
    expect(row.classList.contains('disabled')).toBe(true);
    expect(row.getAttribute('aria-disabled')).toBe('true');
  });

  it('deletes the group and says so', async () => {
    const { cache, bs } = render({ g1: 'Kinases', g2: 'Hubs' });
    await open('g2');
    clickRow('Delete group');
    await Promise.resolve();
    await Promise.resolve();

    expect([...bs.traverseBubbleSets()]).toEqual(['g1']);
    expect(cache.ui.info).toHaveBeenCalledWith('Deleted group "Hubs"');
  });
});

describe('editing a row in place', () => {
  function render() {
    mount();
    const cache = makeCache();
    const bs = new GraphBubbleSetManager(cache);
    bs.refreshBubbleStyleElements = vi.fn();
    bs.updateBubbleSetIfChanged = vi.fn(async () => {});
    bs.redrawBubbleSets = vi.fn(async () => {});
    cache.INSTANCES.BUBBLE_GROUPS.g1 = { update: vi.fn(async () => {}) };
    cache.gcm = { decideToRenderOrDraw: vi.fn(async () => {}) };
    bs.renderGroupList();
    return { cache, bs };
  }

  it('writes the name straight onto labelText — the string drawn on the hull', async () => {
    const { cache } = render();
    const input = document.querySelector('.group-name');
    input.value = '  Kinases  ';
    input.dispatchEvent(new window.Event('change'));
    await Promise.resolve();
    await Promise.resolve();

    expect(layoutOf(cache).bubbleSetStyle.g1.labelText).toBe('Kinases');
  });

  it('writes the swatch onto the fill and the label plate together', async () => {
    const { cache } = render();
    const swatch = document.querySelector('.group-swatch');
    swatch.value = '#00ff00';
    swatch.dispatchEvent(new window.Event('change'));
    await Promise.resolve();
    await Promise.resolve();

    expect(layoutOf(cache).bubbleSetStyle.g1.fill).toBe('#00ff00');
    expect(layoutOf(cache).bubbleSetStyle.g1.labelBackgroundFill).toBe('#00ff00');
  });
});

describe('refreshBubbleStyleElements — the single settings pane', () => {
  // Rewritten for this rework: there used to be one panel per group, all built
  // eagerly, and this looped over every one. With an unbounded number of groups
  // there is ONE pane, rebuilt for the selected row, so this syncs only that.
  function mountPane(group, style) {
    document.body.innerHTML = `
      <div id="groupList"></div>
      <div id="groupStylePanel">
        <input data-property="Bubble Set ${group} Fill Color">
        <input data-property="Bubble Set ${group} Label Text">
        <div data-property="Bubble Set ${group} Padding">
          <input type="range"><input type="number">
        </div>
        <label class="switch" data-property="Bubble Set ${group} Label"><input type="checkbox"></label>
        <select data-property="Bubble Set ${group} Label Placement">
          <option value="top">top</option><option value="bottom">bottom</option>
        </select>
        <span class="bubbleSetOptionalLabelConfig"></span>
      </div>`;
    const cache = makeCache({ [group]: style.labelText });
    Object.assign(layoutOf(cache).bubbleSetStyle[group], style);
    const bs = new GraphBubbleSetManager(cache);
    bs.selectedGroup = group;
    return { cache, bs };
  }

  it('writes the selected group\'s stored values onto the pane', () => {
    const { bs } = mountPane('g1', {
      labelText: 'Kinases', fill: '#123456', padding: 0.42, labelPlacement: 'top', label: true,
    });
    bs.refreshBubbleStyleElements();

    expect(document.querySelector('[data-property="Bubble Set g1 Fill Color"]').value).toBe('#123456');
    expect(document.querySelector('[data-property="Bubble Set g1 Label Text"]').value).toBe('Kinases');
    expect(document.querySelector('[data-property="Bubble Set g1 Padding"] input[type="range"]').value).toBe('0.42');
    expect(document.querySelector('[data-property="Bubble Set g1 Label Placement"]').value).toBe('top');
  });

  it('greys the pane for a group with no members, and un-greys it once it has some', () => {
    const { cache, bs } = mountPane('g1', { labelText: 'Kinases', label: true });
    const pane = document.getElementById('groupStylePanel');

    bs.refreshBubbleStyleElements();
    expect(pane.classList.contains('disabled')).toBe(true);

    layoutOf(cache).g1ManualMembers = new Set(['n1']);
    cache.nodeRef = new Map([['n1', {}]]);
    bs.refreshBubbleStyleElements();
    expect(pane.classList.contains('disabled')).toBe(false);
  });

  it('disables the label sub-controls when the label is off', () => {
    const { cache, bs } = mountPane('g1', { labelText: 'K', label: false });
    bs.refreshBubbleStyleElements();
    expect(document.querySelector('.bubbleSetOptionalLabelConfig').classList.contains('disabled')).toBe(true);

    layoutOf(cache).bubbleSetStyle.g1.label = true;
    bs.refreshBubbleStyleElements();
    expect(document.querySelector('.bubbleSetOptionalLabelConfig').classList.contains('disabled')).toBe(false);
  });

  it('syncs the Label switch — it had no data-property, so nothing could', () => {
    const { cache, bs } = mountPane('g1', { labelText: 'K', label: true });
    // createSwitch exposes setChecked; the harness switch needs the same shape.
    const sw = document.querySelector('[data-property="Bubble Set g1 Label"]');
    let checked = null;
    sw.setChecked = (v) => { checked = v; };

    bs.refreshBubbleStyleElements();
    expect(checked).toBe(true);

    layoutOf(cache).bubbleSetStyle.g1.label = false;
    bs.refreshBubbleStyleElements();
    expect(checked).toBe(false);
  });

  it('is a no-op, not a crash, when no group is selected', () => {
    const { bs } = mountPane('g1', { labelText: 'K' });
    bs.selectedGroup = 'deleted';
    expect(() => bs.refreshBubbleStyleElements()).not.toThrow();
  });
});

describe('the settings pane lives inside the open row', () => {
  // A shared pane below the list made "where do I click to style this one" a
  // guess. As a real disclosure the chevron answers it, and the settings sit
  // next to the group they belong to.
  function render(groups = { g1: 'Kinases', g2: 'Hubs' }) {
    mount();
    const cache = makeCache(groups);
    const bs = new GraphBubbleSetManager(cache);
    bs.renderGroupList();
    return { cache, bs };
  }
  const pane = () => document.getElementById('groupStylePanel');
  const chevron = (g) => document.querySelector(`.group-row[data-group="${g}"] .group-row-chevron`);

  it('parents the pane into the open row, not the card', () => {
    render();
    expect(pane().closest('.group-row')?.dataset.group).toBe('g1');
  });

  it('moves the pane when another row is opened', () => {
    const { bs } = render();
    chevron('g2').click();
    expect(bs.selectedGroup).toBe('g2');
    expect(pane().closest('.group-row')?.dataset.group).toBe('g2');
    expect(chevron('g2').getAttribute('aria-expanded')).toBe('true');
    expect(chevron('g1').getAttribute('aria-expanded')).toBe('false');
  });

  it('collapses the open row and parks the pane, without re-opening another', () => {
    const { bs } = render();
    chevron('g1').click();
    expect(bs.selectedGroup).toBeNull();
    expect(document.querySelectorAll('.group-row.active')).toHaveLength(0);
    // Parked, not destroyed — every listener on it has to survive.
    expect(pane().parentElement.id).toBe('groupStylePanelHome');
  });

  it('survives repeated rebuilds — the pane is one element, re-parented', () => {
    const { bs } = render();
    const original = pane();
    for (let i = 0; i < 5; i++) bs.renderGroupList();
    expect(pane()).toBe(original);
    expect(document.querySelectorAll('#groupStylePanel')).toHaveLength(1);
  });

  it('parks the pane when the last group is deleted', async () => {
    const { bs } = render({ g1: 'Only' });
    await bs.deleteGroup('g1');
    bs.renderGroupList();
    expect(pane().parentElement.id).toBe('groupStylePanelHome');
  });
});

describe('selecting a row', () => {
  it('rebuilds the settings pane for that group only', () => {
    mount();
    const cache = makeCache({ g1: 'Kinases', g2: 'Hubs' });
    const bs = new GraphBubbleSetManager(cache);
    bs.renderGroupList();

    expect(cache.ui.buildGroupStylePanel).toHaveBeenLastCalledWith('g1');

    document.querySelector('.group-row[data-group="g2"] .group-row-head').click();
    expect(cache.ui.buildGroupStylePanel).toHaveBeenLastCalledWith('g2');
    expect(document.querySelector('.group-row[data-group="g2"]').classList.contains('active'))
      .toBe(true);
  });

  it('falls back to a surviving group when the selected one is deleted', async () => {
    mount();
    const cache = makeCache({ g1: 'Kinases', g2: 'Hubs' });
    const bs = new GraphBubbleSetManager(cache);
    bs.renderGroupList();
    document.querySelector('.group-row[data-group="g2"] .group-row-head').click();
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

    // The ⋯ button lives inside row g2's head; clicking it must not also select
    // g2 out from under the menu that is about to open.
    document.querySelector('.group-row[data-group="g2"] .group-row-more').click();
    expect(bs.selectedGroup).toBe('g1');
  });

  it('leaves clicks inside the settings pane alone', () => {
    // A switch is a <label><span> — neither a button nor an input, so a
    // handler on the whole ROW let the click through and the rebuild destroyed
    // the control before its toggle completed. Selection is the head's job.
    mount();
    const cache = makeCache({ g1: 'Kinases', g2: 'Hubs' });
    const bs = new GraphBubbleSetManager(cache);
    bs.renderGroupList();
    const openRow = document.querySelector('.group-row[data-group="g1"]');
    const pane = openRow.querySelector('#groupStylePanel');
    const sw = document.createElement('label');
    sw.className = 'switch';
    const span = document.createElement('span');
    sw.appendChild(span);
    pane.appendChild(sw);

    const renders = vi.spyOn(bs, 'renderGroupList');
    span.click();

    expect(renders).not.toHaveBeenCalled();
    // …and the control is still standing.
    expect(document.querySelector('#groupStylePanel .switch span')).toBe(span);
  });
});
