// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
    expect([...segments].map((s) => s.textContent)).toEqual(['OR', 'AND']);
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

  it('does nothing when filters are locked by a manual query', () => {
    cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY = true;
    const group = ui.createFilterJoinToggle();
    const andBtn = group.querySelectorAll('.filter-join-segment')[1];

    andBtn.click();

    expect(cache.data.layouts.L.filterJoinMode).toBe('OR');
    expect(handleFilterEvent).not.toHaveBeenCalled();
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

describe('UIManager.createFilterStrictCheckbox', () => {
  let ui, cache, handleFilterEvent;

  beforeEach(() => {
    window.localStorage.clear();
    ({ ui, cache, handleFilterEvent } = makeUI());
  });

  it("renders a hidden 'Complete cases only' checkbox defaulting to off", () => {
    const box = ui.createFilterStrictCheckbox();
    const input = box.querySelector('input[type=checkbox]');

    expect(box.classList.contains('filter-strict-checkbox')).toBe(true);
    expect(box.hidden).toBe(true);
    expect(box.textContent).toContain('Complete cases only');
    expect(input.checked).toBe(false);
    expect(cache.data.layouts.L.filterStrict).toBe(false);
  });

  it('restores the on state from localStorage', () => {
    window.localStorage.setItem('gll.filterStrict', '1');

    const box = ui.createFilterStrictCheckbox();

    expect(box.querySelector('input').checked).toBe(true);
    expect(cache.data.layouts.L.filterStrict).toBe(true);
  });

  it('persists and re-renders on change', async () => {
    const box = ui.createFilterStrictCheckbox();
    const input = box.querySelector('input');

    input.checked = true;
    input.dispatchEvent(new window.Event('change'));
    await Promise.resolve();

    expect(cache.data.layouts.L.filterStrict).toBe(true);
    expect(window.localStorage.getItem('gll.filterStrict')).toBe('1');
    expect(handleFilterEvent).toHaveBeenCalledOnce();
  });

  it('does nothing when filters are locked by a manual query', async () => {
    const box = ui.createFilterStrictCheckbox();
    const input = box.querySelector('input');
    cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY = true;

    input.checked = true;
    input.dispatchEvent(new window.Event('change'));
    await Promise.resolve();

    expect(cache.data.layouts.L.filterStrict).toBe(false);
    expect(input.checked).toBe(false); // reverted
    expect(handleFilterEvent).not.toHaveBeenCalled();
  });

  it('is revealed by the join toggle only under AND', () => {
    const box = ui.createFilterStrictCheckbox();
    const group = ui.createFilterJoinToggle((mode) => {
      box.hidden = mode !== 'AND';
    });
    const [orBtn, andBtn] = group.querySelectorAll('.filter-join-segment');

    expect(box.hidden).toBe(true); // starts OR
    andBtn.click();
    expect(box.hidden).toBe(false);
    orBtn.click();
    expect(box.hidden).toBe(true);
  });
});
