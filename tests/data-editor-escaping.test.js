// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { DataTable } from '../src/utilities/data_editor.js';

const CFG = { EXCEL_NODE_HEADER: 'Node filters', EXCEL_EDGE_HEADER: 'Edge filters' };

/** A DataTable over one node carrying a hostile property header and ID, rendered into a detached table. */
function tableWith({ group = 'G', key = 'P', id = 'n1' } = {}) {
  const table = document.createElement('table');
  table.innerHTML = '<thead></thead><tbody></tbody>';
  const node = { id, D4Data: { 'Node filters': { [group]: { [key]: 'value' } } } };
  const dt = new DataTable({
    CFG,
    ui: { error: (m) => { throw new Error(m); } },
    nodeRef: new Map([[id, node]]),
    edgeRef: new Map(),
    gcm: {
      *traverseD4Data(e) {
        for (const [section, subs] of Object.entries(e.D4Data ?? {}))
          for (const [sub, props] of Object.entries(subs))
            for (const [prop, value] of Object.entries(props)) yield [section, sub, prop, value];
      },
    },
  });
  dt.tableHead = table.querySelector('thead');
  dt.tableBody = table.querySelector('tbody');
  dt.currentTab = 'allNodes';
  dt.populateFromFileData({ nodeDataHeaders: [{ subGroup: group, key }], edgeDataHeaders: [], nodes: [node], edges: [] });
  return dt;
}

describe('DataTable.render escapes imported text', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('does not execute markup smuggled in through a column header', () => {
    const dt = tableWith({ group: '<img src=x onerror=alert(1)>', key: '<script>alert(2)</script>' });

    expect(dt.tableHead.querySelector('img')).toBeNull();
    expect(dt.tableHead.querySelector('script')).toBeNull();
    expect(dt.tableHead.querySelector('.data-group-row').textContent).toContain('<img src=x onerror=alert(1)>');
    expect([...dt.tableHead.querySelectorAll('.data-sort')].map((b) => b.firstChild.textContent)).toContain(
      '<script>alert(2)</script>'
    );
  });

  it('keeps a quote-laden element id inside the row button label', () => {
    const id = '" onmouseover="alert(1)';
    const dt = tableWith({ id });

    const btn = dt.tableBody.querySelector('.data-row-btn');
    expect(btn.getAttribute('onmouseover')).toBeNull();
    expect(btn.getAttribute('aria-label')).toBe(`Node ${id} actions`);
  });
});
