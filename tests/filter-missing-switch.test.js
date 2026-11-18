// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UIComponentManager } from '../src/managers/ui_components.js';

// ==========================================================================
// The filter row's ∅ switch: "do elements without a value for this property
// pass this filter?" Only on rows with gaps, and only shown while it differs
// from the mode's default: filled when they pass, struck when not, muted while
// the row decides nothing. The row's ⋯ menu sets it; a click on the shown
// switch puts it back. Both go through the UI's shared setter.
// ==========================================================================

const PADJ = 'Node filters::g::padj';
const FULL = 'Node filters::g::baseMean';

function makeCache(mode, filter) {
  const cache = {
    CFG: { EXCEL_EDGE_HEADER: 'Edge filters' },
    data: {
      selectedLayout: 'L',
      layouts: { L: { filterJoinMode: mode, filters: new Map([[PADJ, filter]]) } },
    },
    missingValueCounts: new Map([
      [PADJ, 37],
      [FULL, 0],
    ]),
    EVENT_LOCKS: { FILTERS_LOCKED_BY_MANUAL_QUERY: false },
    propIDToInvertibleRangeSliders: new Map(),
    ui: { setMissingPasses: vi.fn(async () => {}), error: vi.fn(), info: vi.fn() },
  };
  cache.uiComponents = new UIComponentManager(cache);
  return cache;
}

function paint(mode, filter, idle = false) {
  const cache = makeCache(mode, filter);
  const btn = cache.uiComponents.createMissingSwitch(PADJ);
  cache.uiComponents.paintMissingSwitch(btn, { fo: filter, mode, idle });
  return { btn, cache };
}

beforeEach(() => {
  document.body.innerHTML = '';
  for (const el of document.querySelectorAll('.rail-menu')) el.remove();
});

describe('filter row ∅ switch', () => {
  it('sits only on rows with gaps; others end in ⋯ alone', () => {
    const { cache } = paint('AND', { active: true });
    const [withGaps] = cache.uiComponents.createRowActions(PADJ, 'padj', { groupable: false });
    const noGaps = cache.uiComponents.createRowActions(FULL, 'baseMean', { groupable: false });
    expect(withGaps.classList.contains('filter-missing-switch')).toBe(true);
    expect(noGaps.map((el) => el.className)).toEqual(['filter-row-more']);
  });

  it('hides at the mode default, with the count still in the tooltip', () => {
    const { btn } = paint('AND', { active: true });
    expect(btn.hidden).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.title).toBe(
      'Without a value: kept — 37 nodes have no padj. They are judged on the other filters only. Click to remove them.'
    );
  });

  it('shows a choice that differs from the mode default, in either mode', () => {
    expect(paint('AND', { active: true, missingPasses: false }).btn.hidden).toBe(false);
    const { btn } = paint('OR', { active: true, missingPasses: true });
    expect(btn.hidden).toBe(false);
    expect(btn.title).toMatch(/^Without a value: added — /);
  });

  it('is muted, not dead, on an unticked or idle row', () => {
    const unticked = paint('AND', { active: false }).btn;
    expect(unticked.getAttribute('aria-disabled')).toBe('true');
    expect(unticked.title).toContain('Tick the filter');
    expect(paint('OR', { active: true }, true).btn.title).toContain('Edges is set to');
  });

  it('flips the current answer on click, and ignores clicks while muted', async () => {
    const { btn, cache } = paint('AND', { active: true, missingPasses: false });
    btn.click();
    await Promise.resolve();
    expect(cache.ui.setMissingPasses).toHaveBeenCalledWith([PADJ], true, expect.any(String));

    cache.uiComponents.paintMissingSwitch(btn, {
      fo: { active: false, missingPasses: false },
      mode: 'AND',
      idle: false,
    });
    btn.click();
    expect(cache.ui.setMissingPasses).toHaveBeenCalledOnce();
    expect(cache.ui.info).toHaveBeenCalledWith(expect.stringContaining('Tick the filter'));
  });

  it('is set from the row ⋯ menu, worded for the mode and the current choice', async () => {
    const itemFor = (mode, filter) => {
      document.body.innerHTML = '';
      const cache = makeCache(mode, filter);
      const cells = cache.uiComponents.createRowActions(PADJ, 'padj', { groupable: false });
      document.body.append(...cells);
      cells.at(-1).click();
      const item = [...document.querySelectorAll('.rail-menu.open .rail-menu-item')].find((el) =>
        el.textContent.includes('without padj')
      );
      return { cache, item, label: item.querySelector('.rail-menu-label').textContent };
    };
    expect(itemFor('AND', { active: true }).label).toBe('Remove the 37 nodes without padj');
    expect(itemFor('AND', { active: true, missingPasses: false }).label).toBe(
      'Keep the 37 nodes without padj'
    );
    expect(itemFor('OR', { active: true, missingPasses: true }).label).toBe(
      'Stop adding the 37 nodes without padj'
    );

    const { cache, item, label } = itemFor('OR', { active: true });
    expect(label).toBe('Add the 37 nodes without padj');
    item.click();
    await Promise.resolve();
    expect(cache.ui.setMissingPasses).toHaveBeenCalledWith([PADJ], true, expect.any(String));
  });
});
