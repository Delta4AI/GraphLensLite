// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { DataTable } from '../src/utilities/data_editor.js';

const CFG = { EXCEL_NODE_HEADER: 'Node filters', EXCEL_EDGE_HEADER: 'Edge filters' };
const NODE_P = 'Node filters::g::p';
const EDGE_W = 'Edge filters::g::w';

/** A DataTable over n1, n2 and an edge sharing n1's ID, rendered into a detached table. */
function makeTable() {
  const table = document.createElement('table');
  table.innerHTML = '<thead></thead><tbody></tbody>';
  const fileData = {
    nodeDataHeaders: [{ subGroup: 'g', key: 'p' }],
    edgeDataHeaders: [{ subGroup: 'g', key: 'w' }],
    nodes: [
      { id: 'n1', label: 'N1', D4Data: { 'Node filters': { g: { p: 1 } } } },
      { id: 'n2', label: 'N2', D4Data: { 'Node filters': { g: { p: 2 } } } },
    ],
    edges: [
      { id: 'n1', source: 'n1', target: 'n2', D4Data: { 'Edge filters': { g: { w: 5 } } } },
    ],
  };
  const cache = {
    CFG,
    ui: {
      error: (m) => {
        throw new Error(m);
      },
      showLoading: async () => {},
      hideLoading: async () => {},
      warning: vi.fn(),
    },
    selectedNodes: [],
    selectedEdges: [],
    nodeRef: new Map(fileData.nodes.map((n) => [n.id, { ...n, style: {} }])),
    edgeRef: new Map(fileData.edges.map((e) => [e.id, { ...e, style: {} }])),
    data: { layouts: {}, selectedLayout: 'Default' },
    style: { getNodeStyleOrDefaults: () => ({ style: {} }) },
    gcm: {
      *traverseD4Data(e) {
        for (const [section, subs] of Object.entries(e.D4Data ?? {}))
          for (const [sub, props] of Object.entries(subs))
            for (const [prop, value] of Object.entries(props)) yield [section, sub, prop, value];
      },
    },
  };
  const dt = new DataTable(cache);
  dt.tableHead = table.querySelector('thead');
  dt.tableBody = table.querySelector('tbody');
  dt.tabsContainer = document.createElement('div');
  dt.populateFromFileData(fileData);
  return { dt, cache, table };
}

/** Type a value into a cell the way the browser does: focus, text, blur. */
function typeInto({ dt, table }, rowIndex, header, text) {
  const col = dt.headers.indexOf(header);
  const cell = table.querySelector(`td[data-row="${rowIndex}"][data-col="${col}"]`);
  dt.handleCellFocus({ target: cell }, rowIndex, col);
  if (text !== undefined) cell.textContent = text;
  dt.handleCellBlur({ target: cell }, rowIndex, col);
}

const rows = (dt) => dt.tableData.map((r) => `${r[2]}:${r[3]}`);

describe('DataTable pending changes', () => {
  it('re-clicking a selected node after touching a cell never duplicates its row', async () => {
    const t = makeTable();
    t.cache.selectedNodes = ['n1'];
    await t.dt.refreshCurrentTab();

    typeInto(t, 0, NODE_P); // click in and out without typing
    expect(t.dt.pendingChanges.size).toBe(0);

    typeInto(t, 0, 'Label', 'edited');
    for (let i = 0; i < 3; i++) await t.dt.refreshCurrentTab(); // each canvas click redraws
    expect(rows(t.dt)).toEqual(['Node:n1']);
    expect(t.dt.tableData[0][4]).toBe('edited');
  });

  it('typing the loaded value back withdraws the edit', async () => {
    const t = makeTable();
    t.cache.selectedNodes = ['n1'];
    await t.dt.refreshCurrentTab();
    typeInto(t, 0, NODE_P, '9');
    typeInto(t, 0, NODE_P, '1');
    expect(t.dt.pendingChanges.size).toBe(0);
  });

  it('keeps edits made under different tabs and never drops other columns', async () => {
    const t = makeTable();
    t.cache.selectedNodes = ['n1'];
    await t.dt.refreshCurrentTab();
    typeInto(t, 0, 'Label', 'edited');

    await t.dt.switchTab('entireGraph');
    expect(rows(t.dt)).toEqual(['Node:n1', 'Node:n2', 'Edge:n1']);
    typeInto(t, 0, NODE_P, '7');
    await t.dt.switchTab('selectedEdges');

    const out = t.dt.getUpdatedFileData();
    const n1 = out.nodes.find((n) => n.id === 'n1');
    expect(n1.label).toBe('edited');
    expect(n1.D4Data['Node filters'].g.p).toBe(7);
    // The edge shares n1's ID but was never edited.
    expect(out.edges.find((e) => e.id === 'n1').D4Data['Edge filters'].g.w).toBe(5);
  });

  it('a deleted row stays deleted across redraws and is dropped on apply', async () => {
    const t = makeTable();
    t.cache.selectedNodes = ['n1', 'n2'];
    await t.dt.refreshCurrentTab();
    t.dt.handleDeleteRow(0);
    await t.dt.refreshCurrentTab();
    expect(rows(t.dt)).toEqual(['Node:n2']);
    const out = t.dt.getUpdatedFileData();
    expect(out.nodes.map((n) => n.id)).toEqual(['n2']);
    // Its edge goes with it, and the user is told.
    expect(out.edges).toEqual([]);
    expect(t.cache.ui.warning).toHaveBeenCalledWith(expect.stringContaining('1 edge removed'));
  });

  it('an emptied label cell clears the label on apply', async () => {
    const t = makeTable();
    t.cache.selectedNodes = ['n1'];
    await t.dt.refreshCurrentTab();
    typeInto(t, 0, 'Label', '');
    const n1 = t.dt.getUpdatedFileData().nodes.find((n) => n.id === 'n1');
    expect(n1.label).toBeUndefined();
    expect(n1.style.label).toBe(false);
  });

  it('an ID added and then deleted again leaves nothing pending', async () => {
    const t = makeTable();
    await t.dt.addRow('Node', 'n3');
    expect(t.dt.hasElement('Node', 'n3')).toBe(true);
    t.dt.handleDeleteRow(0);
    expect(t.dt.pendingChanges.size).toBe(0);
    expect(t.dt.hasElement('Node', 'n3')).toBe(false);
  });

  it('keeps a column sort across edits and redraws', async () => {
    const t = makeTable();
    await t.dt.switchTab('allNodes');
    t.dt.handleHeaderClick(4); // Label ascending
    t.dt.handleHeaderClick(4); // descending
    expect(rows(t.dt)).toEqual(['Node:n2', 'Node:n1']);
    typeInto(t, 1, NODE_P, '9');
    await t.dt.refreshCurrentTab();
    expect(rows(t.dt)).toEqual(['Node:n2', 'Node:n1']);
  });

  it('lists an added row while it is not selected and requires a property to apply', async () => {
    const t = makeTable();
    await t.dt.addRow('Node', 'n3');
    expect(rows(t.dt)).toEqual(['Node:n3']);
    expect(t.dt.validateNewElements()).toHaveLength(1);
    typeInto(t, 0, NODE_P, '3');
    expect(t.dt.validateNewElements()).toEqual([]);
    expect(t.dt.getUpdatedFileData().nodes.find((n) => n.id === 'n3').D4Data).toEqual({
      'Node filters': { g: { p: 3 } },
    });
  });

  it('an emptied property cell removes the property', async () => {
    const t = makeTable();
    await t.dt.switchTab('allEdges');
    typeInto(t, 0, EDGE_W, '');
    const edge = t.dt.getUpdatedFileData().edges[0];
    expect(edge.D4Data['Edge filters'].g.w).toBeUndefined();
  });
});

describe('DataTable apply with a hostile header', () => {
  it('never writes a prototype-named column onto Object.prototype', async () => {
    const t = makeTable();
    t.dt.populateFromFileData({
      ...t.dt.fileData,
      nodeDataHeaders: [{ subGroup: '__proto__', key: 'polluted' }],
    });
    await t.dt.switchTab('allNodes');
    typeInto(t, 0, 'Node filters::__proto__::polluted', 'yes');
    t.dt.getUpdatedFileData();
    expect({}.polluted).toBeUndefined();
  });
});
