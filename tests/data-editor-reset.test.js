// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { DataTable } from '../src/utilities/data_editor.js';

const CFG = { EXCEL_NODE_HEADER: 'Node filters', EXCEL_EDGE_HEADER: 'Edge filters' };

/** A DataTable over two rows, wired to a detached table so render() can run. */
function tableWithRows() {
  const table = document.createElement('table');
  table.innerHTML = '<thead></thead><tbody></tbody>';
  const dt = new DataTable({ CFG, ui: { error: () => {} } });
  dt.tableHead = table.querySelector('thead');
  dt.tableBody = table.querySelector('tbody');
  dt.headers = ['', 'Index', 'Type', 'ID'];
  dt.tableData = [
    ['', 1, 'Node', 'n1'],
    ['', 2, 'Node', 'n2'],
  ];
  dt.tableDataBackup = dt.tableData.map((row) => [...row]);
  dt.originalOrder = dt.tableData.map((_, i) => i);
  return dt;
}

describe('DataTable.reset', () => {
  it('discards pending edits and deletions, not just the table', () => {
    const dt = tableWithRows();
    dt.onPendingChangesCallback = vi.fn();

    dt.trackChange('n1', 'Node'); // a cell edit
    dt.handleDeleteRow(1); // a row deletion
    expect(dt.pendingChanges.size).toBe(2);

    dt.reset();

    // Apply replays pendingChanges — anything left here comes back.
    expect(dt.pendingChanges.size).toBe(0);
    expect(dt.tableData).toHaveLength(2);
    expect(dt.onPendingChangesCallback).toHaveBeenLastCalledWith(
      expect.objectContaining({ hasPendingChanges: false }),
    );
  });
});
