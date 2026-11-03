import { describe, it, expect, vi } from 'vitest';
import { GraphBubbleSetManager } from '../src/graph/bubble_sets.js';

// The drop of a dragged group label is what the saved file keeps: it has to
// land in the workspace's bubbleSetStyle and be undoable under a fitting name.
function makeCache() {
  const update = vi.fn(async () => {});
  const cache = {
    data: { selectedLayout: 'Default', layouts: { Default: { filters: new Map(), bubbleSetStyle: { g: { labelText: 'G' } } } } },
    INSTANCES: { BUBBLE_GROUPS: { g: { update } } },
    history: { commit: vi.fn() },
  };
  return { cache, update };
}

describe('GraphBubbleSetManager.setLabelShift', () => {
  it('stores the drop in the saved style, paints it, and records it for undo', async () => {
    const { cache, update } = makeCache();
    await new GraphBubbleSetManager(cache).setLabelShift('g', 12, -4);
    expect(cache.data.layouts.Default.bubbleSetStyle.g).toMatchObject({ labelShiftX: 12, labelShiftY: -4 });
    expect(update).toHaveBeenCalledWith({ labelShiftX: 12, labelShiftY: -4 });
    expect(cache.history.commit).toHaveBeenCalledWith('Move group label');
  });

  it('names a reset as a reset, and refuses a group that is gone', async () => {
    const { cache } = makeCache();
    const bs = new GraphBubbleSetManager(cache);
    await bs.setLabelShift('g', 0, 0);
    expect(cache.history.commit).toHaveBeenCalledWith('Reset group label position');
    await expect(bs.setLabelShift('gone', 1, 1)).rejects.toThrow('no longer exists');
  });
});
