// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UIManager } from '../src/managers/ui.js';

// ==========================================================================
// uncheckAllCheckboxes: the reset the manual-query path runs before it
// re-derives the filter UI from the query text. It has to clear BOTH halves
// of the state — the per-property checkboxes and the boolean Any/True/False
// toggles — because a query with only IS TRUE would otherwise inherit a
// segment from whatever was on screen before.
// ==========================================================================

const PROPS = ['Node filters::G::A', 'Node filters::G::B'];

function mount(cache) {
  document.body.innerHTML = PROPS.map(
    (id) => `
      <label id="filter-${id}-checkbox-wrapper">
        <input type="checkbox" id="filter-${id}-checkbox" checked>
        <span id="filter-${id}-checkbox-inner">✔</span>
      </label>`,
  ).join('');
  return new UIManager(cache);
}

function makeCache(toggles = []) {
  const filters = new Map(PROPS.map((id) => [id, { active: true }]));
  return {
    propIDs: PROPS,
    activeProps: new Set(PROPS),
    propIDToBooleanToggles: new Map(toggles.map((t, i) => [PROPS[i], t])),
    data: { selectedLayout: 'Default', layouts: { Default: { filters } } },
    uiComponents: { getCheckboxTT: () => 'tooltip' },
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('UIManager.uncheckAllCheckboxes', () => {
  it('clears every checkbox, its filter state and the active set', () => {
    const cache = makeCache();
    const ui = mount(cache);

    ui.uncheckAllCheckboxes();

    for (const id of PROPS) {
      expect(document.getElementById(`filter-${id}-checkbox`).checked).toBe(false);
      expect(document.getElementById(`filter-${id}-checkbox-inner`).textContent).toBe('');
      expect(cache.data.layouts.Default.filters.get(id).active).toBe(false);
    }
    expect(cache.activeProps.size).toBe(0);
  });

  it('resets every boolean toggle to Any', () => {
    const toggles = [{ resetToAny: vi.fn() }, { resetToAny: vi.fn() }];
    const cache = makeCache(toggles);
    mount(cache).uncheckAllCheckboxes();

    for (const toggle of toggles) expect(toggle.resetToAny).toHaveBeenCalledOnce();
  });
});
