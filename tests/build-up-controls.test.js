// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UIManager } from '../src/managers/ui.js';

// ==========================================================================
// The controls around build up: the Links choice (shown only while building
// up), the switch for elements without properties (shown only when the graph
// has some), dimmed edge rows while their ticks change nothing, and the card
// that explains an empty stage and offers both ways out.
// ==========================================================================

const NODE_P = 'Node filters::g::type';
const EDGE_P = 'Edge filters::g::kind';

function makeUI(layout = {}) {
  document.body.innerHTML = `
    <div id="outerGraphContainer"></div>
    <div id="filterContainer"><div class="filter-toolbar"></div></div>`;
  const handleFilterEvent = vi.fn(async () => {});
  const cache = {
    CFG: { EXCEL_EDGE_HEADER: 'Edge filters' },
    EVENT_LOCKS: { FILTERS_LOCKED_BY_MANUAL_QUERY: false },
    fm: { handleFilterEvent },
    nodeRef: new Map([
      ['a', { features: new Set([NODE_P]) }],
      ['bare', { features: new Set() }],
    ]),
    edgeRef: new Map(),
    propToNodes: new Map([[NODE_P, []]]),
    propToEdgeIDs: new Map([[EDGE_P, []]]),
    activeProps: new Set(),
    uiComponents: {
      getCheckboxTT: () => 'tick',
      getInertCheckboxTT: () => 'inert',
      getIdleEdgeRowTT: () => 'idle edge row',
    },
    data: {
      selectedLayout: 'L',
      filterDefaults: new Map(),
      layouts: {
        L: {
          filters: new Map([
            [NODE_P, { active: true }],
            [EDGE_P, { active: true }],
          ]),
          filterJoinMode: 'OR',
          ...layout,
        },
      },
    },
  };
  const ui = new UIManager(cache, false);
  return { ui, cache, handleFilterEvent };
}

/** Filter rows the way buildFilterUI renders them, with their checkbox parts. */
function rows(ids) {
  const container = document.getElementById('filterContainer');
  for (const id of ids) {
    const row = document.createElement('div');
    row.className = 'filter-row';
    row.dataset.propId = id;
    row.innerHTML =
      `<span class="checkboxWrapper" id="filter-${id}-checkbox-wrapper">` +
      `<input type="checkbox" id="filter-${id}-checkbox"><span id="filter-${id}-checkbox-inner"></span></span>`;
    container.appendChild(row);
  }
  document.querySelector('.filter-toolbar').appendChild(new UIManager({}, false).createFilterConstraintCount());
}

beforeEach(() => window.localStorage.clear());

describe('Links toggle', () => {
  it('sets the workspace links and re-renders', async () => {
    const { ui, cache, handleFilterEvent } = makeUI();
    const select = ui.createFilterLinksToggle().querySelector('select');
    expect(select.value).toBe('all');

    select.value = 'ticked';
    select.dispatchEvent(new Event('change'));
    await Promise.resolve();
    expect(cache.data.layouts.L.filterLinks).toBe('ticked');
    expect(select.value).toBe('ticked');
    expect(handleFilterEvent).toHaveBeenCalled();
  });
});

describe('Elements without properties', () => {
  it('counts them and switches them off for the workspace', async () => {
    const { ui, cache, handleFilterEvent } = makeUI();
    const box = ui.createPropertylessCheckbox();
    expect(box.hidden).toBe(false);
    expect(box.textContent).toBe('Include 1 element without properties');

    const input = box.querySelector('input');
    input.checked = false;
    input.dispatchEvent(new Event('change'));
    await Promise.resolve();
    expect(cache.data.layouts.L.includePropertyless).toBe(false);
    expect(handleFilterEvent).toHaveBeenCalled();
  });
});

describe('Build up with links on All', () => {
  it('dims edge rows, whose ticks change nothing, and says why', () => {
    const { ui } = makeUI();
    rows([NODE_P, EDGE_P]);
    ui.updateFilterConstraintHints();
    const dimmed = [...document.querySelectorAll('.filter-row-inert')].map((r) => r.dataset.propId);
    expect(dimmed).toEqual([EDGE_P]);
    expect(document.querySelector(`[data-prop-id="${EDGE_P}"] .checkboxWrapper`).title).toBe('idle edge row');
  });

  it('does not count a ticked edge filter as contributing', () => {
    const { ui } = makeUI();
    rows([NODE_P, EDGE_P]);
    ui.updateFilterConstraintHints();
    expect(document.getElementById('filterConstraintCount').textContent).toBe(
      '1 of 2 filters contribute'
    );
  });
});

describe('Empty stage while building up', () => {
  it('appears with nothing ticked, and Tick all filters ticks every row', async () => {
    const { ui, cache, handleFilterEvent } = makeUI();
    for (const filter of cache.data.layouts.L.filters.values()) filter.active = false;
    rows([NODE_P, EDGE_P]);
    ui.updateFilterConstraintHints();

    const card = document.getElementById('buildUpEmptyState');
    expect(card.hidden).toBe(false);
    card.querySelector('.p-button').click();
    await Promise.resolve();
    expect([...cache.data.layouts.L.filters.values()].every((f) => f.active)).toBe(true);
    expect(handleFilterEvent).toHaveBeenCalled();

    ui.updateFilterConstraintHints();
    expect(card.hidden).toBe(true);
  });
});
