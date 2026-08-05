// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { DataTable } from '../src/utilities/data_editor.js';

const CFG = { EXCEL_NODE_HEADER: 'Node filters', EXCEL_EDGE_HEADER: 'Edge filters' };

/**
 * A DataTable wired straight to a detached table, so render() can be driven alone.
 * `header` lands in column 1; columns 0/2/3 are the fixed delete/Type/ID columns.
 */
function tableWith(header, id = 'n1') {
  const table = document.createElement('table');
  table.innerHTML = '<thead></thead><tbody></tbody>';
  const dt = new DataTable({ CFG, ui: { error: () => {} } });
  dt.tableHead = table.querySelector('thead');
  dt.tableBody = table.querySelector('tbody');
  dt.headers = ['', header, 'Type', 'ID'];
  dt.tableData = [['', 'value', 'Node', id]];
  dt.render();
  return dt;
}

describe('DataTable.render escapes imported text', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('does not execute markup smuggled in through a column header', () => {
    const dt = tableWith(
      'Node filters::<img src=x onerror=alert(1)>::<script>alert(2)</script>',
    );

    expect(dt.tableHead.querySelector('img')).toBeNull();
    expect(dt.tableHead.querySelector('script')).toBeNull();
    expect(dt.tableHead.querySelector('.data-table-header-group-badge').textContent).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('escapes a header that carries no :: structure', () => {
    const dt = tableWith('<img src=x onerror=alert(1)>');

    expect(dt.tableHead.querySelector('img')).toBeNull();
    expect(dt.tableHead.querySelector('.data-table-header-text').textContent).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('keeps a quote-laden element id inside the delete-button title', () => {
    const id = '" onmouseover="alert(1)';
    const dt = tableWith('Node filters::G::P', id);

    const btn = dt.tableBody.querySelector('.data-table-delete-row-btn');
    expect(btn.getAttribute('onmouseover')).toBeNull();
    expect(btn.title).toBe(`Delete row 1 (Node ${id})`);
    expect(btn.textContent).toBe('×');
  });
});
