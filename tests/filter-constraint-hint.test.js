// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { UIManager } from '../src/managers/ui.js';

// ==========================================================================
// The AND join's constraint census. Under AND only a *narrowed* filter
// constrains the graph — one left at its loaded default means "don't care",
// so its checkbox is inert and the derived query can legitimately be empty.
// Nothing on a filter row used to show that, which reads as a broken panel.
// The census names how many filters are doing work; inert rows are dimmed.
// The narrowed test itself is shared with the query derivation (query.js
// isFilterNarrowed), so the hint and the query can never disagree.
// ==========================================================================

const CAT = (values) => ({ isCategory: true, categories: new Set(values) });
const NUM = (lo, hi) => ({ isCategory: false, isInverted: false, lowerThreshold: lo, upperThreshold: hi });

/** A filter row in the shape buildFilterUI produces, plus the toolbar span. */
function dom(propIDs) {
  document.body.innerHTML = `
    <div id="filterContainer">
      <div class="filter-toolbar"></div>
      ${propIDs
        .map(
          (id) => `<div class="filter-row" data-prop-id="${id}">
                     <div class="filter-row-col1"></div>
                     <div class="filter-row-col2"></div>
                     <div class="filter-row-col3"></div>
                   </div>`
        )
        .join('')}
    </div>`;
}

function makeUI({ mode = 'AND', filters = [], defaults = [] } = {}) {
  const cache = {
    data: {
      selectedLayout: 'L',
      filterDefaults: new Map(defaults),
      layouts: { L: { filters: new Map(filters), filterJoinMode: mode } },
    },
    EVENT_LOCKS: { FILTERS_LOCKED_BY_MANUAL_QUERY: false },
  };
  const ui = new UIManager(cache, false);
  dom(filters.map(([id]) => id));
  document.querySelector('.filter-toolbar').appendChild(ui.createFilterConstraintCount());
  return { ui, cache };
}

const census = () => document.getElementById('filterConstraintCount');
const inertIds = () =>
  [...document.querySelectorAll('.filter-row-inert')].map((r) => r.dataset.propId);

// One narrowed categorical (b dropped), one untouched categorical, one
// untouched slider — the shape of a freshly loaded panel after one edit.
const THREE = {
  defaults: [
    ['N::g::type', CAT(['a', 'b'])],
    ['N::g::zone', CAT(['x', 'y'])],
    ['N::g::score', NUM(0, 1)],
  ],
  filters: [
    ['N::g::type', { active: true, ...CAT(['a']) }],
    ['N::g::zone', { active: true, ...CAT(['x', 'y']) }],
    ['N::g::score', { active: true, ...NUM(0, 1) }],
  ],
};

describe('filter constraint census', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '';
  });

  it('counts only narrowed filters under AND, and dims the rest', () => {
    const { ui } = makeUI({ mode: 'AND', ...THREE });
    ui.updateFilterConstraintHints();

    expect(census().hidden).toBe(false);
    expect(census().textContent).toBe('1 of 3 filters constrain the graph');
    expect(inertIds()).toEqual(['N::g::zone', 'N::g::score']);
  });

  it('says so plainly when nothing is narrowed — the empty-query case', () => {
    const { ui } = makeUI({
      mode: 'AND',
      defaults: THREE.defaults,
      filters: [
        ['N::g::type', { active: true, ...CAT(['a', 'b']) }],
        ['N::g::zone', { active: true, ...CAT(['x', 'y']) }],
      ],
    });
    ui.updateFilterConstraintHints();

    expect(census().textContent).toMatch(/^No filter constrains the graph/);
    expect(inertIds()).toEqual(['N::g::type', 'N::g::zone']);
  });

  it('stays out of the way under OR, where active already means constraining', () => {
    const { ui } = makeUI({ mode: 'OR', ...THREE });
    ui.updateFilterConstraintHints();

    expect(census().hidden).toBe(true);
    expect(inertIds()).toEqual([]);
  });

  it('clears the dimming when the join switches back to OR', () => {
    const { ui, cache } = makeUI({ mode: 'AND', ...THREE });
    ui.updateFilterConstraintHints();
    expect(inertIds().length).toBe(2);

    cache.data.layouts.L.filterJoinMode = 'OR';
    ui.updateFilterConstraintHints();
    expect(inertIds()).toEqual([]);
    expect(census().hidden).toBe(true);
  });

  it('does not dim a switched-off filter — off is not the same as inert', () => {
    const { ui } = makeUI({
      mode: 'AND',
      defaults: THREE.defaults,
      filters: [
        ['N::g::type', { active: true, ...CAT(['a']) }],
        ['N::g::zone', { active: false, ...CAT(['x', 'y']) }],
      ],
    });
    ui.updateFilterConstraintHints();

    expect(inertIds()).toEqual([]);
    expect(census().textContent).toBe('1 of 2 filters constrain the graph');
  });

  it('leaves unusable properties out of the census entirely', () => {
    const { ui } = makeUI({
      mode: 'AND',
      defaults: THREE.defaults,
      filters: [
        ['N::g::type', { active: true, ...CAT(['a']) }],
        ['N::g::zone', { active: true, unusable: true, ...CAT(['x', 'y']) }],
      ],
    });
    ui.updateFilterConstraintHints();

    expect(census().textContent).toBe('1 of 1 filters constrain the graph');
    expect(inertIds()).toEqual([]);
  });

  it('counts a moved slider and an inverted one as constraining', () => {
    const { ui } = makeUI({
      mode: 'AND',
      defaults: [
        ['N::g::a', NUM(0, 1)],
        ['N::g::b', NUM(0, 1)],
        ['N::g::c', NUM(0, 1)],
      ],
      filters: [
        ['N::g::a', { active: true, ...NUM(0.2, 1) }],
        ['N::g::b', { active: true, ...NUM(0, 1), isInverted: true }],
        ['N::g::c', { active: true, ...NUM(0, 1) }],
      ],
    });
    ui.updateFilterConstraintHints();

    expect(census().textContent).toBe('2 of 3 filters constrain the graph');
    expect(inertIds()).toEqual(['N::g::c']);
  });

  it('hides the census when there are no filters at all', () => {
    const { ui } = makeUI({ mode: 'AND', filters: [], defaults: [] });
    ui.updateFilterConstraintHints();

    expect(census().hidden).toBe(true);
  });

  it('survives a missing filter panel', () => {
    const { ui } = makeUI({ mode: 'AND', ...THREE });
    document.body.innerHTML = '';
    expect(() => ui.updateFilterConstraintHints()).not.toThrow();
  });
});
