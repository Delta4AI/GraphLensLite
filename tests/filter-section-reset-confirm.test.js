// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { UIComponentManager } from '../src/managers/ui_components.js';
import { Popup } from '../src/utilities/popup.js';

// ==========================================================================
// A section's ⟳ resets every filter in it, and filter changes are not in the
// undo history, so it asks first and resets only on an explicit yes.
// ==========================================================================

function clickReset(answer) {
  const confirm = vi.spyOn(Popup, 'confirm').mockResolvedValue(answer);
  const cache = {
    propIDs: new Set(['Node filters::g::a', 'Node filters::g::b', 'Node filters::h::c']),
    fm: { resetFilters: vi.fn(async () => {}) },
  };
  const btn = new UIComponentManager(cache).createSectionResetButton('Node filters', 'g');
  btn.onclick();
  return { cache, confirm };
}

describe('section reset confirmation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('names how many filters it resets and resets them on confirm', async () => {
    const { cache, confirm } = clickReset(true);
    await vi.waitFor(() => expect(cache.fm.resetFilters).toHaveBeenCalledWith('Node filters', 'g'));
    expect(confirm.mock.calls[0][0]).toMatch(/^Reset the 2 filters in Node filters › g /);
  });

  it.each([false, null])('leaves the filters alone when the answer is %s', async (answer) => {
    const { cache, confirm } = clickReset(answer);
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
    await Promise.resolve();
    expect(cache.fm.resetFilters).not.toHaveBeenCalled();
  });
});
