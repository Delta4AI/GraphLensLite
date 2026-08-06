// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UIManager } from '../src/managers/ui.js';
import { CFG } from '../src/config.js';

// ==========================================================================
// buildFilterUI end to end over one numeric and one categorical property.
//
// The load-bearing detail, and the reason this file exists: a range slider's
// appendListeners() resolves its parts with getElementById, so it MUST run
// after the row is in the document. Every earlier test faked the rows, so a
// refactor that wired the widget while the row was still detached passed the
// whole suite — and would have thrown on the first real numeric filter.
// ==========================================================================

const NUM = (lo, hi) => ({
  isCategory: false,
  isBoolean: false,
  isInverted: false,
  lowerThreshold: lo,
  upperThreshold: hi,
});
const CAT = (values) => ({
  isCategory: true,
  isBoolean: false,
  categories: new Set(values),
});

function makeUI() {
  const filters = new Map([
    ['Node filters::Topology::Degree', { active: true, ...NUM(0, 10) }],
    ['Node filters::Topology::Type', { active: true, ...CAT(['a', 'b']) }],
  ]);
  const defaults = new Map([
    ['Node filters::Topology::Degree', NUM(0, 10)],
    ['Node filters::Topology::Type', CAT(['a', 'b'])],
  ]);
  const stub = () => document.createElement('span');
  const cache = {
    CFG,
    data: {
      selectedLayout: 'L',
      filterDefaults: defaults,
      layouts: { L: { filters, filterJoinMode: 'OR' } },
    },
    EVENT_LOCKS: { FILTERS_LOCKED_BY_MANUAL_QUERY: false },
    nodeExclusiveProps: new Set(['Node filters::Topology::Degree']),
    mixedProps: new Set(),
    propIDToInvertibleRangeSliders: new Map(),
    propIDToDropdownChecklists: new Map(),
    propIDToBooleanToggles: new Map(),
    uiComponents: {
      createSectionToggleButton: stub,
      createSectionResetButton: stub,
      createCheckbox: stub,
      createGroupChip: stub,
      createAddOrRemoveToSelectionGroup: stub,
      createConstraintCount: stub,
    },
    qm: { updateQueryTextArea: vi.fn() },
    fm: { handleFilterEvent: vi.fn(async () => {}) },
  };
  document.body.innerHTML = '<div id="filterContainer"></div>';
  return new UIManager(cache, false);
}

describe('buildFilterUI', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '';
  });

  it('wires a range slider only once its row is in the document', () => {
    const ui = makeUI();

    // appendListeners() dereferences this.slider — off-document it is null and
    // this call throws, which is the regression being guarded.
    expect(() => ui.buildFilterUI()).not.toThrow();

    const slider = ui.cache.propIDToInvertibleRangeSliders.get('Node filters::Topology::Degree');
    expect(slider.slider).not.toBeNull();
    expect(slider.thumbStart).not.toBeNull();
    expect(document.getElementById(slider.sliderId).closest('.filter-row')).not.toBeNull();
  });

  it('builds the toolbar, one section, one sub-group and a row per property', () => {
    const ui = makeUI();
    ui.buildFilterUI();
    const container = document.getElementById('filterContainer');

    expect(container.querySelectorAll('.filter-toolbar')).toHaveLength(1);
    expect(container.querySelectorAll('.filter-section')).toHaveLength(1);
    expect(container.querySelectorAll('.filter-subgroup')).toHaveLength(1);
    expect([...container.querySelectorAll('.filter-row')].map((r) => r.dataset.propId)).toEqual([
      'Node filters::Topology::Degree',
      'Node filters::Topology::Type',
    ]);
    // The search matches on this, not on scraped label text.
    expect(container.querySelector('.filter-row').dataset.search).toBe(
      'node filters topology degree'
    );
  });

  it('shows the lock bar and marks the container only while locked', () => {
    const ui = makeUI();
    ui.buildFilterUI();
    const container = document.getElementById('filterContainer');
    expect(container.classList.contains('locked')).toBe(false);
    expect(document.getElementById('filterLockStatusBar').style.display).toBe('none');

    ui.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY = true;
    ui.buildFilterUI();
    expect(container.classList.contains('locked')).toBe(true);
    expect(document.getElementById('filterLockStatusBar').style.display).toBe('flex');
  });

  it('renders a mixed-type property as an inert row with the reason', () => {
    const ui = makeUI();
    const propID = 'Node filters::Topology::Mixed';
    ui.cache.data.layouts.L.filters.set(propID, { active: true });
    ui.cache.data.filterDefaults.set(propID, {
      unusable: true,
      numericCount: 3,
      textCount: 2,
    });

    ui.buildFilterUI();

    const row = document.querySelector(`[data-prop-id="${propID}"]`);
    expect(row.classList.contains('filter-row-unusable')).toBe(true);
    expect(row.querySelector('.filter-unusable-reason').textContent).toContain('3 numeric');
    // No widget and no per-row actions on an unusable row.
    expect(row.querySelector('input')).toBeNull();
  });
});
