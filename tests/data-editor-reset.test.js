// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { DataTable } from '../src/utilities/data_editor.js';

const CFG = { EXCEL_NODE_HEADER: 'Node filters', EXCEL_EDGE_HEADER: 'Edge filters' };

/** A DataTable listing two nodes, wired to a detached table so render() can run. */
function tableWithRows() {
  const table = document.createElement('table');
  table.innerHTML = '<thead></thead><tbody></tbody>';
  const nodes = [
    { id: 'n1', label: 'N1' },
    { id: 'n2', label: 'N2' },
  ];
  const dt = new DataTable({
    CFG,
    ui: { error: () => {} },
    nodeRef: new Map(nodes.map((n) => [n.id, n])),
    edgeRef: new Map(),
    gcm: { *traverseD4Data() {} },
  });
  dt.tableHead = table.querySelector('thead');
  dt.tableBody = table.querySelector('tbody');
  dt.currentTab = 'allNodes';
  dt.populateFromFileData({ nodeDataHeaders: [], edgeDataHeaders: [], nodes, edges: [] });
  return dt;
}

describe('DataTable.reset', () => {
  it('discards pending edits and deletions, not just the table', () => {
    const dt = tableWithRows();
    dt.onPendingChangesCallback = vi.fn();

    dt.trackChange('Node', 'n1', 'Label', 'edited'); // a cell edit
    dt.handleDeleteRow(1); // a row deletion
    expect(dt.pendingChanges.size).toBe(2);

    dt.reset();

    // Apply replays pendingChanges — anything left here comes back.
    expect(dt.pendingChanges.size).toBe(0);
    expect(dt.tableData.map((r) => [r[3], r[4]])).toEqual([
      ['n1', 'N1'],
      ['n2', 'N2'],
    ]);
    expect(dt.onPendingChangesCallback).toHaveBeenLastCalledWith(
      expect.objectContaining({ hasPendingChanges: false }),
    );
  });
});
