// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createStyleDiv } from '../src/managers/ui_style_div.js';
import { DEFAULTS, CFG } from '../src/config.js';

// ==========================================================================
// Select Elements' typed-list rows: "＋ Add" and Enter add to the selection,
// "− Remove" takes out. They replaced one button plus a mode switch, whose
// forgotten state made Enter remove what the user meant to add.
// ==========================================================================

function build() {
  const sm = {
    addNodeOrEdgeIDsToSelectionWrapper: vi.fn(async () => {}),
    addNodeOrEdgeLabelsToSelectionWrapper: vi.fn(async () => {}),
  };
  const cache = {
    DEFAULTS,
    CFG,
    data: { selectedLayout: 'Default', layouts: { Default: { bubbleSetStyle: {} } } },
    bs: { traverseBubbleSets: () => [], communityOptions: { resolution: 1 } },
    ui: {},
    sm,
    nodeLabels: ['A'],
    edgeLabels: [],
  };
  document.body.replaceChildren(createStyleDiv(cache));
  return sm;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('Select Elements lookup rows', () => {
  it('adds with ＋ Add and Enter, removes with − Remove', async () => {
    const sm = build();
    const input = document.getElementById('selectByNodeIDsInput');
    input.value = ' n1,n2 ';

    document.getElementById('selectByNodeIDsAddButton').click();
    document.getElementById('selectByNodeIDsRemoveButton').click();
    input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter' }));
    await flush();

    expect(sm.addNodeOrEdgeIDsToSelectionWrapper.mock.calls).toEqual([
      ['n1,n2', true, true],
      ['n1,n2', true, false],
      ['n1,n2', true, true],
    ]);
  });

  it('routes label rows by label, and offers no mode switch', async () => {
    const sm = build();
    document.getElementById('selectByNodeLabelsInput').value = 'A';
    document.getElementById('selectByNodeLabelsRemoveButton').click();
    await flush();

    expect(sm.addNodeOrEdgeLabelsToSelectionWrapper).toHaveBeenCalledWith('A', true, false);
    expect(document.querySelector('[id$="Switch"][id^="selectBy"]')).toBeNull();
  });
});
