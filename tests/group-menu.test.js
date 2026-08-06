// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attachGroupMenu } from '../src/managers/group_menu.js';
import { UIManager } from '../src/managers/ui.js';
import { GraphBubbleSetManager } from '../src/graph/bubble_sets.js';

// ==========================================================================
// The shared group checklist.
//
// It replaced two 2×2 quadrant pies that used the SAME glyph for two different
// verbs (assign a property vs assign nodes) and could only ever address four
// groups. What matters here: the rows name the groups, the marks tell you what
// you are already in, and the list is rebuilt on every open — a menu cached
// from a previous open would show deleted groups and stale names.
// ==========================================================================

function makeCache(groups = { g1: 'Kinases', g2: 'Membrane' }) {
  const bubbleSetStyle = {};
  Object.entries(groups).forEach(([key, labelText], i) => {
    bubbleSetStyle[key] = { labelText, fill: ['#111', '#222', '#333'][i] ?? '#444' };
  });
  return {
    data: { selectedLayout: 'Default', layouts: { Default: { bubbleSetStyle } } },
    bs: { *traverseBubbleSets() { yield* Object.keys(bubbleSetStyle); } },
  };
}

function mount() {
  document.body.innerHTML = '<button id="anchor">open</button>';
  return document.getElementById('anchor');
}

const openMenu = () => document.querySelector('.rail-menu.open');
const rows = () => [...openMenu().querySelectorAll('.rail-menu-item')];
const labelsOf = () => rows().map((r) => r.querySelector('.rail-menu-label').textContent);

beforeEach(() => {
  document.body.innerHTML = '';
  for (const el of document.querySelectorAll('.rail-menu')) el.remove();
});

describe('group menu', () => {
  it('lists every group by name, plus the "new group" row', () => {
    const anchor = mount();
    attachGroupMenu(anchor, makeCache(), () => ({
      isChecked: () => false,
      onToggle: vi.fn(),
      onNew: vi.fn(),
      newLabel: 'New group from this filter',
    }));
    anchor.click();

    expect(labelsOf()).toEqual(['Kinases', 'Membrane', 'New group from this filter']);
  });

  it('ticks the groups the thing is already in', () => {
    const anchor = mount();
    attachGroupMenu(anchor, makeCache(), () => ({
      isChecked: (g) => g === 'g2',
      onToggle: vi.fn(),
      onNew: vi.fn(),
      newLabel: 'New',
    }));
    anchor.click();

    const [kinases, membrane] = rows();
    expect(kinases.classList.contains('checked')).toBe(false);
    expect(membrane.classList.contains('checked')).toBe(true);
  });

  it('marks partial membership apart from full — a third state ✓ cannot carry', () => {
    const anchor = mount();
    attachGroupMenu(anchor, makeCache(), () => ({
      isChecked: () => false,
      isPartial: (g) => g === 'g1',
      onToggle: vi.fn(),
      onNew: vi.fn(),
      newLabel: 'New',
    }));
    anchor.click();

    const [partial, plain] = rows();
    expect(partial.classList.contains('partial')).toBe(true);
    expect(partial.querySelector('.rail-menu-check').textContent).toBe('–');
    expect(partial.title).toContain('Some of the selection');
    expect(plain.classList.contains('partial')).toBe(false);
  });

  it('reports the group that was clicked and closes', () => {
    const anchor = mount();
    const onToggle = vi.fn();
    attachGroupMenu(anchor, makeCache(), () => ({
      isChecked: () => false, onToggle, onNew: vi.fn(), newLabel: 'New',
    }));
    anchor.click();
    rows()[1].click();

    expect(onToggle).toHaveBeenCalledWith('g2');
    expect(openMenu()).toBeNull();
  });

  it('offers only "new group" — with an explainer — when none exist yet', () => {
    const anchor = mount();
    const onNew = vi.fn();
    attachGroupMenu(anchor, makeCache({}), () => ({
      isChecked: () => false,
      onToggle: vi.fn(),
      onNew,
      newLabel: 'New group from this filter',
      emptyHint: 'A group draws a coloured bubble around the nodes you put in it.',
    }));
    anchor.click();

    expect(labelsOf()).toEqual(['New group from this filter']);
    expect(openMenu().querySelector('.group-menu-hint').textContent).toContain('coloured bubble');
    rows()[0].click();
    expect(onNew).toHaveBeenCalled();
  });

  it('rebuilds on every open, so a renamed or deleted group is never stale', () => {
    const anchor = mount();
    const cache = makeCache();
    attachGroupMenu(anchor, cache, () => ({
      isChecked: () => false, onToggle: vi.fn(), onNew: vi.fn(), newLabel: 'New',
    }));
    anchor.click();
    expect(labelsOf()).toContain('Kinases');

    anchor.click(); // close
    const styles = cache.data.layouts.Default.bubbleSetStyle;
    styles.g1.labelText = 'Renamed';
    delete styles.g2;
    anchor.click();

    expect(labelsOf()).toEqual(['Renamed', 'New']);
  });

  it('closes on Escape', () => {
    const anchor = mount();
    attachGroupMenu(anchor, makeCache(), () => ({
      isChecked: () => false, onToggle: vi.fn(), onNew: vi.fn(), newLabel: 'New',
    }));
    anchor.click();
    expect(openMenu()).not.toBeNull();

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(openMenu()).toBeNull();
  });

  it('paints each row with its group colour', () => {
    const anchor = mount();
    attachGroupMenu(anchor, makeCache(), () => ({
      isChecked: () => false, onToggle: vi.fn(), onNew: vi.fn(), newLabel: 'New',
    }));
    anchor.click();

    const dots = openMenu().querySelectorAll('.group-menu-dot');
    expect(dots).toHaveLength(2);
    expect(dots[0].style.background).toBe('rgb(17, 17, 17)');
  });

  // buildUI re-wires the static Selection-panel button on every graph load and
  // data edit, and the button outlives all of them.
  it('replaces its menu when an anchor is wired more than once', () => {
    const anchor = mount();
    const opts = () => ({
      isChecked: () => false, onToggle: vi.fn(), onNew: vi.fn(), newLabel: 'New',
    });
    for (let i = 0; i < 4; i++) attachGroupMenu(anchor, makeCache(), opts);

    anchor.click();
    expect(document.querySelectorAll('.rail-menu.open')).toHaveLength(1);
    expect(document.querySelectorAll('body > .rail-menu')).toHaveLength(1);
  });

  it('leaves nothing in the body once closed', () => {
    const anchor = mount();
    attachGroupMenu(anchor, makeCache(), () => ({
      isChecked: () => false, onToggle: vi.fn(), onNew: vi.fn(), newLabel: 'New',
    }));
    anchor.click();
    expect(document.querySelectorAll('body > .rail-menu')).toHaveLength(1);

    // Anchors here are filter chips and group rows, discarded on every rebuild.
    // A menu that outlives its anchor is an orphan nothing can reach or remove.
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelectorAll('body > .rail-menu')).toHaveLength(0);
  });

  it('reports a failing group action instead of dropping the rejection', async () => {
    const anchor = mount();
    const cache = makeCache();
    cache.ui = { error: vi.fn() };
    attachGroupMenu(anchor, cache, () => ({
      isChecked: () => false,
      onToggle: async () => {
        throw new Error('draw failed');
      },
      onNew: vi.fn(),
      newLabel: 'New',
    }));
    anchor.click();
    rows()[0].click();

    await vi.waitFor(() => expect(cache.ui.error).toHaveBeenCalledOnce());
    expect(cache.ui.error.mock.calls[0][0]).toContain('draw failed');
  });

  it('moves focus into the menu so it is reachable by keyboard', () => {
    const anchor = mount();
    attachGroupMenu(anchor, makeCache(), () => ({
      isChecked: () => false, onToggle: vi.fn(), onNew: vi.fn(), newLabel: 'New',
    }));
    anchor.click();

    // Body-appended, so the rows sit at the end of the tab order rather than
    // after the anchor — without a focus move there is no way in.
    expect(openMenu().contains(document.activeElement)).toBe(true);
  });

  it('closes when the panel under it scrolls, but not on its own overflow', () => {
    const anchor = mount();
    attachGroupMenu(anchor, makeCache(), () => ({
      isChecked: () => false, onToggle: vi.fn(), onNew: vi.fn(), newLabel: 'New',
    }));
    anchor.click();

    // Its own list scrolls (max-height + overflow-y) and must survive that.
    openMenu().dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(openMenu()).not.toBeNull();

    document.body.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(openMenu()).toBeNull();
  });
});

// --------------------------------------------------------------------------
// The Selection panel's "Add to group" button wires the same menu to three
// GraphBubbleSetManager methods by name. A typo there is invisible to every
// other test — the menu still opens, the click just does nothing.
// --------------------------------------------------------------------------

describe('UIManager.buildAddToGroupButton wiring', () => {
  function setUp(membership = 'none') {
    document.body.innerHTML = '<button id="addToGroupBtn">Add to group</button>';
    const cache = makeCache({ g1: 'Kinases' });
    cache.bs = {
      ...cache.bs,
      selectionMembership: vi.fn(() => membership),
      toggleSelectedNodesInManualGroup: vi.fn(async () => {}),
      createGroupFromSelection: vi.fn(async () => {}),
    };
    const ui = Object.create(UIManager.prototype);
    ui.cache = cache;
    ui.buildAddToGroupButton();
    document.getElementById('addToGroupBtn').click();
    return cache;
  }

  it('calls the methods the manager actually exposes', () => {
    for (const name of [
      'selectionMembership',
      'toggleSelectedNodesInManualGroup',
      'createGroupFromSelection',
    ]) {
      expect(typeof GraphBubbleSetManager.prototype[name]).toBe('function');
    }
  });

  it('marks a fully-covered group as checked and toggles it on click', () => {
    const cache = setUp('all');

    expect(rows()[0].querySelector('.rail-menu-check').textContent).not.toBe('');
    rows()[0].click();
    expect(cache.bs.toggleSelectedNodesInManualGroup).toHaveBeenCalledWith('g1');
  });

  it('reports partial membership without claiming the group is checked', () => {
    setUp('some');
    const row = rows()[0];
    expect(row.className).toContain('partial');
  });

  it('creates a group from the selection through the last row', () => {
    const cache = setUp();
    const newRow = rows().at(-1);

    expect(newRow.textContent).toContain('New group from selection');
    newRow.click();
    expect(cache.bs.createGroupFromSelection).toHaveBeenCalled();
  });
});
