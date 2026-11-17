// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { UIComponentManager } from '../src/managers/ui_components.js';

// ==========================================================================
// The filter row's ∅ switch: "do elements without a value for this property
// pass this filter?" Only on rows with gaps; filled when they pass, struck
// when not, ringed when that differs from the mode's default, muted while the
// row decides nothing. A click flips it through the UI's shared setter.
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

describe('filter row ∅ switch', () => {
  it('sits only on rows with gaps; others keep the column with a spacer', () => {
    const { cache } = paint('AND', { active: true });
    const [withGaps] = cache.uiComponents.createRowActions(PADJ, 'padj', { groupable: false });
    const [noGaps] = cache.uiComponents.createRowActions(FULL, 'baseMean', { groupable: false });
    expect(withGaps.classList.contains('filter-missing-switch')).toBe(true);
    expect(noGaps.className).toBe('filter-row-spacer');
  });

  it('shows the mode default as pressed and plain, with the count in the tooltip', () => {
    const { btn } = paint('AND', { active: true });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.classList.contains('changed')).toBe(false);
    expect(btn.title).toBe(
      'Without a value: kept — 37 nodes have no padj. They are judged on the other filters only. Click to remove them.'
    );
  });

  it('rings a choice that differs from the mode default, in either mode', () => {
    expect(
      paint('AND', { active: true, missingPasses: false }).btn.classList.contains('changed')
    ).toBe(true);
    const { btn } = paint('OR', { active: true, missingPasses: true });
    expect(btn.classList.contains('changed')).toBe(true);
    expect(btn.title).toMatch(/^Without a value: added — /);
  });

  it('is muted, not dead, on an unticked or idle row', () => {
    const unticked = paint('AND', { active: false }).btn;
    expect(unticked.getAttribute('aria-disabled')).toBe('true');
    expect(unticked.title).toContain('Tick the filter');
    expect(paint('OR', { active: true }, true).btn.title).toContain('Edges is set to');
  });

  it('flips the current answer on click, and ignores clicks while muted', async () => {
    const { btn, cache } = paint('AND', { active: true });
    btn.click();
    await Promise.resolve();
    expect(cache.ui.setMissingPasses).toHaveBeenCalledWith([PADJ], false, expect.any(String));

    cache.uiComponents.paintMissingSwitch(btn, { fo: { active: false }, mode: 'AND', idle: false });
    btn.click();
    expect(cache.ui.setMissingPasses).toHaveBeenCalledOnce();
    expect(cache.ui.info).toHaveBeenCalledWith(expect.stringContaining('Tick the filter'));
  });
});
