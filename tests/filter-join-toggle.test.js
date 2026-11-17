// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import { UIManager } from '../src/managers/ui.js';

// ==========================================================================
// Segmented OR/AND control: sets how multiple active filters combine. OR is
// the default (match any); AND is non-strict (match every, but a property an
// element lacks does not exclude it). Changing it persists a global default
// and re-renders via the same handleFilterEvent path a filter checkbox uses.
// ==========================================================================

function makeUI() {
  const handleFilterEvent = vi.fn().mockResolvedValue(undefined);
  const cache = {
    data: { selectedLayout: 'L', layouts: { L: { filters: new Map() } } },
    EVENT_LOCKS: { FILTERS_LOCKED_BY_MANUAL_QUERY: false },
    fm: { handleFilterEvent },
  };
  const ui = new UIManager(cache, false);
  return { ui, cache, handleFilterEvent };
}

describe('UIManager.createFilterJoinToggle', () => {
  let ui, cache, handleFilterEvent;

  beforeEach(() => {
    window.localStorage.clear();
    ({ ui, cache, handleFilterEvent } = makeUI());
  });

  it('renders an OR/AND segmented group defaulting to OR', () => {
    const group = ui.createFilterJoinToggle();
    const segments = group.querySelectorAll('.filter-join-segment');

    expect(group.classList.contains('filter-join-toggle')).toBe(true);
    expect(group.getAttribute('role')).toBe('group');
    expect([...segments].map((s) => s.textContent)).toEqual([
      '＋ Build up OR',
      '− Narrow down AND',
    ]);
    expect([...segments].map((s) => s.dataset.mode)).toEqual(['OR', 'AND']);
    expect(segments[0].classList.contains('active')).toBe(true);
    expect(segments[1].classList.contains('active')).toBe(false);
    expect(cache.data.layouts.L.filterJoinMode).toBe('OR');
  });

  it('restores AND from localStorage and seeds the layout', () => {
    window.localStorage.setItem('gll.filterJoinMode', 'AND');

    const group = ui.createFilterJoinToggle();
    const segments = group.querySelectorAll('.filter-join-segment');

    expect(segments[1].classList.contains('active')).toBe(true);
    expect(segments[1].getAttribute('aria-pressed')).toBe('true');
    expect(cache.data.layouts.L.filterJoinMode).toBe('AND');
  });

  it('switches mode on click, persists it, and re-renders', async () => {
    const group = ui.createFilterJoinToggle();
    const [orBtn, andBtn] = group.querySelectorAll('.filter-join-segment');

    andBtn.click();
    await Promise.resolve();

    expect(cache.data.layouts.L.filterJoinMode).toBe('AND');
    expect(window.localStorage.getItem('gll.filterJoinMode')).toBe('AND');
    expect(andBtn.classList.contains('active')).toBe(true);
    expect(orBtn.classList.contains('active')).toBe(false);
    expect(handleFilterEvent).toHaveBeenCalledOnce();
  });

  it('changes nothing when filters are locked by a manual query, and says why', () => {
    cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY = true;
    ui.warning = vi.fn();
    const group = ui.createFilterJoinToggle();
    const andBtn = group.querySelectorAll('.filter-join-segment')[1];

    andBtn.click();

    expect(cache.data.layouts.L.filterJoinMode).toBe('OR');
    expect(handleFilterEvent).not.toHaveBeenCalled();
    expect(ui.warning).toHaveBeenCalledWith(expect.stringContaining('edited query'));
  });

  it('puts the mode back and reports it when the re-render fails', async () => {
    handleFilterEvent.mockRejectedValueOnce(new Error('render broke'));
    ui.error = vi.fn();
    const group = ui.createFilterJoinToggle();
    const [orBtn, andBtn] = group.querySelectorAll('.filter-join-segment');

    andBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(cache.data.layouts.L.filterJoinMode).toBe('OR');
    expect(orBtn.getAttribute('aria-pressed')).toBe('true');
    expect(ui.error).toHaveBeenCalledWith(expect.stringContaining('render broke'));
  });

  it('looks as dead as it behaves under the lock', () => {
    // The handler above bails, but the control was left undimmed and fully
    // interactive — the toolbar was missing from the locked dimming rules, so
    // the OR/AND switch and its options invited clicks that did nothing. jsdom
    // applies no stylesheet, hence the source assertion.
    const css = fs.readFileSync('src/style.css', 'utf8'); // vitest runs at the repo root
    expect(css).toContain('#filterContainer.locked .filter-toolbar-join');
  });

  it('ignores a click on the already-active mode', () => {
    const group = ui.createFilterJoinToggle();
    const orBtn = group.querySelectorAll('.filter-join-segment')[0];

    orBtn.click();

    expect(handleFilterEvent).not.toHaveBeenCalled();
  });

  it('invokes the onModeChange callback on init and on switch', () => {
    const seen = [];
    const group = ui.createFilterJoinToggle((mode) => seen.push(mode));
    expect(seen).toEqual(['OR']); // init

    group.querySelectorAll('.filter-join-segment')[1].click(); // AND
    expect(seen).toEqual(['OR', 'AND']);
  });
});

// The toolbar box over the rows' ∅ switches ("do elements without a value
// pass?"): a tri-state over the rows the panel lists right now.
describe('UIManager.createMissingValueBox', () => {
  let ui, cache, handleFilterEvent;

  /** Rows as buildFilterUI lays them out: a ∅ switch on each row with gaps. */
  function panel({ searching = false, hidden = [] } = {}) {
    document.body.innerHTML = `
      <div id="filterContainer" class="${searching ? 'filters-searching' : ''}">
        <div class="filter-section filter-section-active">
          ${['a', 'b', 'c']
            .map(
              (p) => `<div class="filter-row" ${hidden.includes(p) ? 'hidden' : ''}>
                <button class="filter-missing-switch" data-prop="N::g::${p}"></button></div>`
            )
            .join('')}
        </div>
        <div class="filter-section">
          <div class="filter-row"><button class="filter-missing-switch" data-prop="E::g::w"></button></div>
        </div>
      </div>`;
    const box = ui.createMissingValueBox();
    document.getElementById('filterContainer').prepend(box);
    ui.syncMissingValueBox();
    return box;
  }

  beforeEach(() => {
    ({ ui, cache, handleFilterEvent } = makeUI());
    cache.data.layouts.L.filterJoinMode = 'AND';
    for (const p of ['N::g::a', 'N::g::b', 'N::g::c', 'E::g::w']) {
      cache.data.layouts.L.filters.set(p, { active: true });
    }
  });

  const click = async (box) => {
    const input = box.querySelector('input');
    input.checked = !input.checked; // what a click does, mixed included
    input.dispatchEvent(new window.Event('change'));
    await Promise.resolve();
  };
  const passes = (p) => cache.data.layouts.L.filters.get(p).missingPasses;

  it('is mixed when the listed rows differ, and a click makes them all pass', async () => {
    cache.data.layouts.L.filters.get('N::g::b').missingPasses = false;
    const box = panel();
    const input = box.querySelector('input');
    expect(input.indeterminate).toBe(true);
    expect(box.textContent).toContain('Keep nodes without a value');
    expect(box.textContent).toContain('On 2 of 3 filters with gaps');

    await click(box);

    // Passing is narrow down's default, so it is stored as unset.
    expect(['N::g::a', 'N::g::b', 'N::g::c'].map(passes)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(handleFilterEvent).toHaveBeenCalledOnce();
  });

  it('turns all off from fully ticked, and only on the rows the search lists', async () => {
    const box = panel({ searching: true, hidden: ['c'] });
    expect(box.querySelector('input').checked).toBe(true);

    await click(box);

    expect(passes('N::g::a')).toBe(false);
    expect(passes('N::g::b')).toBe(false);
    expect(passes('N::g::c')).toBeUndefined(); // searched out
    expect(passes('E::g::w')).toBe(false); // a search spans both sections
  });

  it('leaves the section that is not on screen alone', async () => {
    const box = panel();
    await click(box);
    expect(passes('E::g::w')).toBeUndefined();
  });

  it('does nothing while a hand-typed query drives the filters', async () => {
    cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY = true;
    ui.warning = vi.fn();
    const box = panel();
    await click(box);
    expect(passes('N::g::a')).toBeUndefined();
    expect(box.querySelector('input').checked).toBe(true);
    expect(handleFilterEvent).not.toHaveBeenCalled();
  });
});
