// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { GraphLayoutManager } from '../src/graph/layout.js';

/** A layout manager over one workspace, with changeLayout stubbed (it only renders). */
function managerWith(layout) {
  document.body.innerHTML = '<select id="selectView"></select>';
  const cache = {
    nodeRef: new Map([['n1', { type: 'circle', style: { size: 30 } }]]),
    edgeRef: new Map(),
    data: { selectedLayout: 'Default', layouts: { Default: layout, 'Default (copy)': {} } },
    ui: { info: vi.fn(), error: vi.fn() },
    uiComponents: { buildDropdownOptions: vi.fn() },
  };
  const lm = new GraphLayoutManager(cache);
  lm.changeLayout = vi.fn(async () => {
    cache.data.selectedLayout = document.getElementById('selectView').value;
  });
  return { cache, lm };
}

describe('Duplicate workspace', () => {
  it('copies every workspace setting under the next free name', async () => {
    const { cache, lm } = managerWith({
      internals: { renderer: 'live handle' },
      positions: new Map([['n1', { style: { x: 1, y: 2 } }]]),
      filters: new Map([['p', { active: false }]]),
      filterJoinMode: 'AND',
      filterStrict: true,
      annotations: [{ id: 'a1', text: 'note' }],
    });
    // jsdom's <select> only takes a value it has an option for.
    const select = document.getElementById('selectView');
    select.append(new Option('Default (copy 2)'));

    await lm.duplicateSelectedLayout();

    const copy = cache.data.layouts['Default (copy 2)'];
    expect(cache.data.selectedLayout).toBe('Default (copy 2)');
    expect(copy.filterJoinMode).toBe('AND');
    expect(copy.filterStrict).toBe(true);
    expect(copy.annotations).toEqual([{ id: 'a1', text: 'note' }]);
    expect(copy.internals).toBeNull();
    expect(copy.nodeStyles.get('n1').style.size).toBe(30);
    // A deep copy: editing the copy leaves the source alone.
    copy.positions.get('n1').style.x = 50;
    expect(cache.data.layouts.Default.positions.get('n1').style.x).toBe(1);
  });
});
