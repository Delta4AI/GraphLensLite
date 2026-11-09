// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DropdownChecklist, UIComponentManager } from '../src/managers/ui_components.js';
import { UIManager } from '../src/managers/ui.js';

// ==========================================================================
// The filter rows' keyboard contract. The category list used to be an <h5>
// that only a mouse could open; it is now a disclosure button over a checkbox
// group (APG), so these tests drive it the way a keyboard user does.
// ==========================================================================

const PROP = 'Node filters::Topology::Cluster';
const VALUES = ['a', 'b', 'c'];

function makeCache() {
  return {
    data: {
      selectedLayout: 'L',
      filterDefaults: new Map([[PROP, { isCategory: true, categories: new Set(VALUES) }]]),
      layouts: { L: { filters: new Map([[PROP, { active: true, categories: new Set(VALUES) }]]) } },
    },
    EVENT_LOCKS: { FILTERS_LOCKED_BY_MANUAL_QUERY: false },
    propIDToDropdownChecklists: new Map(),
    nodeRef: new Map([
      ['n1', { featureValues: new Map([[PROP, 'a']]) }],
      ['n2', { featureValues: new Map([[PROP, 'a']]) }],
      ['n3', { featureValues: new Map([[PROP, 'b']]) }],
    ]),
    edgeRef: new Map(),
    fm: { handleFilterEvent: vi.fn(async () => {}) },
    ui: { error: vi.fn(), warning: vi.fn() },
  };
}

function mountList(cache) {
  const list = new DropdownChecklist(PROP, cache);
  const host = document.createElement('div');
  document.body.appendChild(host);
  list.appendTo(host);
  return list;
}

const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
const menuBoxes = () => [...document.querySelectorAll('.filter-cat-menu input[type="checkbox"]')];

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('category list', () => {
  it('opens from the keyboard showing the real selection, toggles, and returns focus', async () => {
    const cache = makeCache();
    const list = mountList(cache);
    const trigger = list.anchor;
    expect(trigger.tagName).toBe('BUTTON');

    trigger.focus();
    key(trigger, 'ArrowDown');
    await Promise.resolve();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    // All + one box per value, all ticked: the list mirrors the model on open.
    const [all, a, b] = menuBoxes();
    expect(menuBoxes().map((box) => box.checked)).toEqual([true, true, true, true]);
    expect(document.activeElement).toBe(all);
    expect(document.querySelector('.filter-cat-menu').textContent).toContain('2'); // two nodes carry "a"

    key(all, 'ArrowDown');
    expect(document.activeElement).toBe(a);

    a.click(); // Space on a focused checkbox is a click
    await vi.waitFor(() => expect(cache.fm.handleFilterEvent).toHaveBeenCalledTimes(1));
    expect(list.selectedCategories.has('a')).toBe(false);
    expect(trigger.textContent).toContain('2 of 3');
    expect(all.indeterminate).toBe(true);

    key(b, 'Enter'); // Enter on a value keeps only that value
    await vi.waitFor(() => expect(cache.fm.handleFilterEvent).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    expect(cache.fm.handleFilterEvent).toHaveBeenCalledTimes(2); // Alt-click is one filter pass
    expect([...list.selectedCategories]).toEqual(['b']);
    expect(trigger.textContent).toContain('b'); // one kept value is named, not "1 of 3"

    // Tab inside the list stays there; Tab off the last field closes it and
    // lands back on the field.
    key(menuBoxes()[1], 'Tab');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const last = menuBoxes().at(-1);
    last.focus();
    key(last, 'Tab');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    trigger.click();
    await Promise.resolve();

    key(document.activeElement, 'Escape');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });
});

describe('category list search', () => {
  it('scopes All to the values the search shows, and says when nothing matches', async () => {
    const cache = makeCache();
    const values = Array.from({ length: 12 }, (_, i) => (i < 3 ? `protein ${i}` : `gene ${i}`));
    cache.data.filterDefaults.get(PROP).categories = new Set(values);
    cache.data.layouts.L.filters.get(PROP).categories = new Set(values);
    const list = mountList(cache);
    list.anchor.click();
    await Promise.resolve();

    const search = document.querySelector('.filter-cat-search');
    search.value = 'prot';
    search.dispatchEvent(new Event('input'));
    const all = menuBoxes()[0];
    expect(all.closest('label').textContent).toContain('All matching');

    all.click(); // every shown value is ticked, so All unticks just those
    await vi.waitFor(() => expect(cache.fm.handleFilterEvent).toHaveBeenCalledTimes(1));
    expect(list.selectedCategories.size).toBe(9);
    expect([...list.selectedCategories].some((v) => v.startsWith('protein'))).toBe(false);

    search.value = 'zzz';
    search.dispatchEvent(new Event('input'));
    expect(document.querySelector('.filter-cat-empty').hidden).toBe(false);
    expect(document.querySelector('.filter-cat-empty').textContent).toContain('zzz');
  });
});

describe('section checkbox', () => {
  it('shows mixed when some filters are on, and a click turns them all on', async () => {
    const cache = makeCache();
    const other = 'Node filters::Topology::Degree';
    cache.data.layouts.L.filters.set(other, { active: false });
    document.body.innerHTML = '<div id="filterContainer"></div>';
    const ui = Object.create(UIManager.prototype);
    ui.cache = cache;
    ui.toggleSubSection = vi.fn(async (enable) => {
      for (const fo of cache.data.layouts.L.filters.values()) fo.active = enable;
      ui.syncSectionCheckboxes();
    });
    cache.ui = ui;
    const box = new UIComponentManager(cache).createSectionCheckbox('Node filters', 'Topology');
    document.getElementById('filterContainer').appendChild(box);

    ui.syncSectionCheckboxes();
    expect(box.indeterminate).toBe(true);
    expect(box.checked).toBe(false);

    box.click();
    await vi.waitFor(() => expect(ui.toggleSubSection).toHaveBeenCalledWith(true, 'Node filters', 'Topology'));
    expect(box.checked).toBe(true);
    expect(box.indeterminate).toBe(false);
  });
});
