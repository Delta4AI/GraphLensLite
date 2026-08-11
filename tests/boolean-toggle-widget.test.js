// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BooleanToggle, UIComponentManager } from '../src/managers/ui_components.js';
import { QueryManager } from '../src/managers/query.js';
import { GraphFilterManager } from '../src/graph/filter.js';

// ==========================================================================
// BooleanToggle (§6.1): three-state Any/True/False segment for boolean-
// classified properties. State lives in the layout filter's categories Set
// (Any = {'true','false'}) so query generation and persistence reuse the
// categorical machinery. Plus: query generation emits IS TRUE / IS FALSE
// and skips unusable (§6.2) filters.
// ==========================================================================

const PROP = 'Node filters::group::flag';

function makeCache(categories) {
  const handleFilterEvent = vi.fn().mockResolvedValue(undefined);
  return {
    data: {
      selectedLayout: 'L',
      layouts: { L: { filters: new Map([[PROP, { active: true, categories }]]) } },
    },
    propIDToBooleanToggles: new Map(),
    EVENT_LOCKS: { FILTERS_LOCKED_BY_MANUAL_QUERY: false },
    fm: { handleFilterEvent },
  };
}

describe('BooleanToggle', () => {
  let cache, toggle, parent;

  beforeEach(() => {
    document.body.innerHTML = '';
    cache = makeCache(new Set(['true', 'false']));
    toggle = new BooleanToggle(PROP, cache);
    parent = document.createElement('div');
    toggle.appendTo(parent);
  });

  it('renders three segments with Any active for the default state', () => {
    const segments = [...parent.querySelectorAll('.filter-join-segment')];
    expect(segments.map((s) => s.textContent)).toEqual(['Any', 'True', 'False']);
    expect(segments[0].classList.contains('active')).toBe(true);
    expect(cache.propIDToBooleanToggles.get(PROP)).toBe(toggle);
  });

  it('narrows to True on click, mutating the layout filter in place', async () => {
    const [, trueBtn] = parent.querySelectorAll('.filter-join-segment');
    trueBtn.click();
    await Promise.resolve();

    expect([...cache.data.layouts.L.filters.get(PROP).categories]).toEqual(['true']);
    expect(toggle.state()).toBe('true');
    expect(cache.fm.handleFilterEvent).toHaveBeenCalledOnce();
  });

  it('ignores clicks on the active segment and while filters are locked', async () => {
    const [anyBtn, trueBtn] = parent.querySelectorAll('.filter-join-segment');
    anyBtn.click(); // already active
    cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY = true;
    trueBtn.click();
    await Promise.resolve();

    expect(cache.fm.handleFilterEvent).not.toHaveBeenCalled();
    expect(toggle.state()).toBe('any');
  });

  it('derives state from a loaded single-value categories set', () => {
    const loadedCache = makeCache(new Set(['false']));
    const loadedToggle = new BooleanToggle(PROP, loadedCache);
    expect(loadedToggle.state()).toBe('false');
  });

  it('applyFromQuery: one leaf narrows, the complementary leaf widens to Any', () => {
    toggle.resetToAny();
    toggle.applyFromQuery('true');
    expect(toggle.state()).toBe('true');

    toggle.applyFromQuery('false'); // second leaf of a generated Any condition
    expect(toggle.state()).toBe('any');

    toggle.resetToAny();
    toggle.applyFromQuery('false');
    expect(toggle.state()).toBe('false');
    toggle.applyFromQuery('false'); // idempotent
    expect(toggle.state()).toBe('false');
  });
});

// A boolean segment narrows the graph exactly like a slider or a checklist, so
// the two places that walk "every widget for this section" have to include it.
describe('BooleanToggle in the shared filter surfaces', () => {
  const boolCache = () => {
    const cache = makeCache(new Set(['true', 'false']));
    cache.propIDs = new Set([PROP]);
    cache.propIDToInvertibleRangeSliders = new Map();
    cache.propIDToDropdownChecklists = new Map();
    cache.ui = { checkCheckbox: vi.fn(), showLoading: vi.fn(), hideLoading: vi.fn() };
    cache.bs = { cleanupManualGroupMembers: vi.fn() };
    cache.gcm = { decideToRenderOrDraw: vi.fn().mockResolvedValue(undefined) };
    cache.EVENT_LOCKS.QUERY_UPDATE_EVENT = false;
    cache.qm = { resetQuery: vi.fn(), updateQueryTextArea: vi.fn(), handleQueryValidationEvent: vi.fn() };
    cache.CFG = { QUERY_BTN_USE_CURRENT_FILTER: true };
    cache.query = { text: document.createElement('div') };
    return cache;
  };

  it('section reset widens a narrowed segment back to Any', async () => {
    const cache = boolCache();
    const toggle = new BooleanToggle(PROP, cache);
    toggle.appendTo(document.createElement('div'));
    await toggle.handleSelection('true');
    expect(toggle.state()).toBe('true');

    await new GraphFilterManager(cache).resetFilters('Node filters', 'group');

    expect(toggle.state()).toBe('any');
    expect([...cache.data.layouts.L.filters.get(PROP).categories].sort()).toEqual([
      'false',
      'true',
    ]);
  });

  it('"Add to query" writes an IS TRUE / IS FALSE predicate, never "(undefined)"', async () => {
    const cache = boolCache();
    const toggle = new BooleanToggle(PROP, cache);
    toggle.appendTo(document.createElement('div'));
    const ui = new UIComponentManager(cache);

    // Any: both leaves, matching what the query generator emits.
    ui.createAddToQueryButton(PROP).click();
    expect(cache.data.layouts.L.query).toBe(`((${PROP} IS TRUE) OR (${PROP} IS FALSE))`);

    delete cache.data.layouts.L.query;
    await toggle.handleSelection('false');
    ui.createAddToQueryButton(PROP).click();
    expect(cache.data.layouts.L.query).toBe(`(${PROP} IS FALSE)`);
    expect(cache.data.layouts.L.query).not.toContain('undefined');
  });
});

describe('updateQueryTextArea with boolean and unusable filters', () => {
  let qm, cache;

  function makeQueryCache(filters, filterDefaults) {
    document.body.innerHTML =
      '<button id="queryUpdateBtn"></button><button id="querySelectBtn"></button>';
    return {
      data: {
        selectedLayout: 'L',
        layouts: { L: { filters, filterJoinMode: 'OR' } },
        filterDefaults,
      },
      uniquePropHierarchy: {
        'Node filters': { group: new Set(['flag', 'mix']) },
      },
      query: {
        text: document.createElement('div'),
        overlay: document.createElement('div'),
        valid: true,
      },
    };
  }

  it('emits IS TRUE for a narrowed boolean and a TRUE/FALSE pair for Any', () => {
    const anyFilter = {
      active: true,
      isBoolean: true,
      isCategory: true,
      unusable: false,
      categories: new Set(['true', 'false']),
    };
    const trueFilter = { ...anyFilter, categories: new Set(['true']) };

    cache = makeQueryCache(new Map([[PROP, trueFilter]]), new Map([[PROP, anyFilter]]));
    qm = new QueryManager(cache);
    qm.updateQueryTextArea();
    expect(cache.query.text.textContent).toBe(`(${PROP} IS TRUE)`);

    cache = makeQueryCache(new Map([[PROP, anyFilter]]), new Map([[PROP, anyFilter]]));
    qm = new QueryManager(cache);
    qm.updateQueryTextArea();
    expect(cache.query.text.textContent).toBe(`((${PROP} IS TRUE) OR (${PROP} IS FALSE))`);
  });

  it('skips unusable filters entirely (§6.2)', () => {
    const unusableFilter = {
      active: true, // even if something re-activated it
      unusable: true,
      isCategory: true,
      categories: new Set(['apple']),
    };
    cache = makeQueryCache(
      new Map([['Node filters::group::mix', unusableFilter]]),
      new Map([['Node filters::group::mix', unusableFilter]])
    );
    qm = new QueryManager(cache);
    qm.updateQueryTextArea();

    expect(cache.query.text.textContent).toBe('');
  });

  it('round-trips IS TRUE through encode without validation errors', () => {
    const boolFilter = {
      active: true,
      isBoolean: true,
      isCategory: true,
      unusable: false,
      categories: new Set(['true']),
    };
    cache = makeQueryCache(new Map([[PROP, boolFilter]]), new Map([[PROP, boolFilter]]));
    qm = new QueryManager(cache);
    qm.updateQueryTextArea();

    expect(cache.query.valid).toBe(true);
    expect(cache.query.overlay.innerHTML).toContain('q-kw-istrue');
    expect(cache.query.overlay.innerHTML).not.toContain('q-error');
  });
});
