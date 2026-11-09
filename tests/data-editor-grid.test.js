// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataTable } from '../src/utilities/data_editor.js';
import { Popup } from '../src/utilities/popup.js';

// ==========================================================================
// The data editor's redesigned contract: one Tab stop with arrow keys (APG
// grid), Escape cancels an edit, staged changes are marked and counted in a
// bar with a review list, and adding an edge is a small form that validates
// in place.
// ==========================================================================

const CFG = { EXCEL_NODE_HEADER: 'Node filters', EXCEL_EDGE_HEADER: 'Edge filters' };
const P = 'Node filters::Bio::Score';

function mount() {
  document.body.innerHTML = '<div id="dataTableContainer"></div>';
  const nodes = ['n1', 'n2', 'n3'].map((id, i) => ({
    id,
    label: `L${i + 1}`,
    D4Data: { 'Node filters': { Bio: { Score: i + 1 } } },
  }));
  const cache = {
    CFG,
    ui: { error: (m) => { throw new Error(m); }, warning: vi.fn(), info: vi.fn() },
    selectedNodes: [],
    selectedEdges: [],
    nodeRef: new Map(nodes.map((n) => [n.id, n])),
    edgeRef: new Map(),
    gcm: {
      *traverseD4Data(e) {
        for (const [section, subs] of Object.entries(e.D4Data ?? {}))
          for (const [sub, props] of Object.entries(subs))
            for (const [prop, value] of Object.entries(props)) yield [section, sub, prop, value];
      },
    },
  };
  const dt = new DataTable(cache);
  dt.init();
  dt.populateFromFileData({ nodeDataHeaders: [{ subGroup: 'Bio', key: 'Score' }], edgeDataHeaders: [], nodes, edges: [] });
  return { dt, cache };
}

const key = (el, k, extra = {}) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
const cell = (dt, id, header) =>
  dt.tableBody.querySelector(`tr[data-key="Node::${id}"] td[data-col="${dt.headers.indexOf(header)}"]`);
const bar = () => document.querySelector('.data-changes');

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('data editor grid', () => {
  it('starts on Selection with an empty state that offers every row', async () => {
    const { dt } = mount();
    expect(document.querySelector('[data-scope="selection"]').getAttribute('aria-pressed')).toBe('true');
    const empty = document.querySelector('.data-empty');
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toContain('No nodes selected');

    empty.querySelector('button').click(); // "Show all 3 nodes"
    await vi.waitFor(() => expect(dt.currentTab).toBe('allNodes'));
    expect(document.querySelector('.data-count').textContent).toBe('3 nodes');
  });

  it('is one Tab stop that arrow keys move through', async () => {
    const { dt } = mount();
    await dt.switchTab('allNodes');
    const stops = [...dt.table.querySelectorAll('[tabindex="0"]')];
    expect(stops).toHaveLength(1);

    stops[0].focus();
    key(stops[0], 'ArrowDown');
    key(document.activeElement, 'ArrowRight');
    expect(document.activeElement).not.toBe(stops[0]);
    expect(dt.table.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(document.activeElement.getAttribute('tabindex')).toBe('0');
  });

  it('cancels an edit on Escape and stages one on Enter, marking and counting it', async () => {
    const { dt } = mount();
    await dt.switchTab('allNodes');
    const score = cell(dt, 'n1', P);
    score.focus();

    key(score, '9'); // typing replaces the value
    expect(score.isContentEditable || score.getAttribute('contenteditable') === 'true').toBe(true);
    expect(score.textContent).toBe('9');
    key(score, 'Escape');
    expect(score.textContent).toBe('1');
    expect(dt.pendingChanges.size).toBe(0);
    expect(bar().hidden).toBe(true);

    key(score, 'Enter');
    score.textContent = '42';
    key(score, 'Enter');
    expect(score.classList.contains('data-cell-edited')).toBe(true);
    expect(score.title).toBe('Was: 1');
    expect(bar().hidden).toBe(false);
    expect(bar().textContent).toContain('1 unsaved change');
    expect(document.getElementById('updateDataTableBtn').textContent).toBe('Apply 1 change');
    // Enter moved on to the next row.
    expect(document.activeElement).toBe(cell(dt, 'n2', P));
  });

  it('keeps a deleted row listed until it is restored, and undoes from the review list', async () => {
    const { dt } = mount();
    await dt.switchTab('allNodes');
    dt.deleteRow('Node', 'n2');
    const row = dt.tableBody.querySelector('tr[data-key="Node::n2"]');
    expect(row.classList.contains('data-row-deleted')).toBe(true);
    expect(row.textContent).toContain('Deleted');
    expect(bar().textContent).toContain('1 deleted');

    document.getElementById('dataReviewBtn').click();
    const undo = [...document.querySelectorAll('.data-review button')].find((b) => b.textContent === 'Undo');
    expect(undo.getAttribute('aria-label')).toContain('n2');
    undo.click();
    expect(dt.pendingChanges.size).toBe(0);
    expect(bar().hidden).toBe(true);
    expect(dt.tableBody.querySelector('tr[data-key="Node::n2"]').classList.contains('data-row-deleted')).toBe(false);
  });

  it('adds an edge from a form that says what is wrong next to the field', async () => {
    const { dt } = mount();
    await dt.switchTab('allNodes');
    document.getElementById('dataAddBtn').click();
    const edgeItem = [...document.querySelectorAll('.rail-menu-item')].find((b) => b.textContent.includes('Edge'));
    edgeItem.click();
    const [source, target, id] = document.querySelectorAll('.data-add-form input');
    source.value = 'n1';
    target.value = 'nope';
    target.dispatchEvent(new Event('input'));
    expect(id.value).toBe('n1::nope');

    document.querySelector('.data-add-form').requestSubmit();
    await vi.waitFor(() => expect(target.getAttribute('aria-invalid')).toBe('true'));
    expect(document.getElementById(target.getAttribute('aria-describedby')).textContent).toContain('no node "nope"');
    expect(dt.pendingChanges.size).toBe(0);

    target.value = 'n3';
    document.querySelector('.data-add-form').requestSubmit();
    await vi.waitFor(() => expect(dt.pendingChanges.has('Edge::n1::n3')).toBe(true));
    expect(dt.currentTab).toBe('allEdges'); // the new row is shown, not hidden by the Nodes view
    expect(dt.tableBody.querySelector('tr[data-key="Edge::n1::n3"]').classList.contains('data-row-added')).toBe(true);
  });

  it('starts a newly loaded graph with no staged changes', async () => {
    const { dt } = mount();
    await dt.switchTab('allNodes');
    dt.deleteRow('Node', 'n1');
    await dt.addColumn({ name: 'Notes', group: 'Meta', isNode: true });
    expect(bar().hidden).toBe(false);

    dt.populateFromFileData({ ...dt.fileData, nodeDataHeaders: [{ subGroup: 'Bio', key: 'Score' }] });
    expect(dt.pendingChanges.size).toBe(0);
    expect(dt.addedColumns).toEqual([]);
    expect(bar().hidden).toBe(true);
  });

  it('blocks Apply while a new node owes a value, and says which', async () => {
    const { dt } = mount();
    await dt.switchTab('allNodes');
    await dt.addNode('n9', 'Nine');
    const apply = document.getElementById('updateDataTableBtn');
    expect(apply.getAttribute('aria-disabled')).toBe('true'); // still focusable; a click jumps to n9
    expect(bar().textContent).toContain('"n9" requires at least one property value');

    const score = cell(dt, 'n9', P);
    dt.startEdit(score);
    score.textContent = '4';
    dt.commitEdit();
    expect(apply.getAttribute('aria-disabled')).toBe('false');
  });

  it('stages an added column, so Discard takes it back', async () => {
    const { dt } = mount();
    await dt.switchTab('allNodes');
    await dt.addColumn({ name: 'Notes', group: 'Meta', isNode: true });
    expect(bar().textContent).toContain('1 new column');
    expect(dt.headers).toContain('Node filters::Meta::Notes');

    dt.reset(); // what Discard runs once confirmed
    expect(dt.headers).not.toContain('Node filters::Meta::Notes');
    expect(dt.fileData.nodeDataHeaders.some((h) => h.key === 'Notes')).toBe(false);
    expect(bar().hidden).toBe(true);
  });

  it('keeps a deletion listed after the selection moves on', async () => {
    const { dt, cache } = mount();
    cache.selectedNodes = ['n1'];
    await dt.refreshCurrentTab();
    dt.deleteRow('Node', 'n1');
    cache.selectedNodes = ['n2'];
    await dt.refreshCurrentTab();
    expect(dt.tableBody.querySelector('tr[data-key="Node::n1"]').classList.contains('data-row-deleted')).toBe(true);
  });

  it('asks before a new graph replaces staged changes, and only then', async () => {
    const { dt } = mount();
    const confirm = vi.spyOn(Popup, 'confirm');
    expect(await dt.confirmDiscard()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();

    await dt.switchTab('allNodes');
    dt.deleteRow('Node', 'n2');
    confirm.mockResolvedValueOnce(false);
    expect(await dt.confirmDiscard()).toBe(false);
    expect(confirm.mock.calls[0][0]).toContain('discards 1 unsaved data editor change');
    expect(dt.stagedCount).toBe(1);

    confirm.mockResolvedValueOnce(true);
    expect(await dt.confirmDiscard()).toBe(true);
    expect(dt.stagedCount).toBe(0); // the editor that replaces this one has nothing left to warn about
    confirm.mockRestore();
  });

  it('keeps focus in the table when the last change is undone from Review', async () => {
    const { dt } = mount();
    await dt.switchTab('allNodes');
    dt.deleteRow('Node', 'n2');
    document.getElementById('dataReviewBtn').click();
    [...document.querySelectorAll('.data-review button')].find((b) => b.textContent === 'Undo').click();
    await Promise.resolve();
    expect(document.activeElement).not.toBe(document.body);
    expect(dt.table.contains(document.activeElement)).toBe(true);
    expect(document.querySelector('.data-status').textContent).toBe('No unsaved changes.');
  });

  it('keeps focus on its cell when a selection change redraws the rows', async () => {
    const { dt, cache } = mount();
    cache.selectedNodes = ['n1', 'n2'];
    await dt.refreshCurrentTab();
    const score = cell(dt, 'n2', P);
    score.focus();
    cache.selectedNodes = ['n2', 'n3'];
    await dt.refreshCurrentTab();
    expect(document.activeElement).toBe(cell(dt, 'n2', P));
    expect(document.activeElement).not.toBe(score); // a rebuilt cell, focused again
  });

  it('hands its view to the editor that replaces it on a reload, and says what was lost', async () => {
    const { dt, cache } = mount();
    await dt.switchTab('allEdges');
    dt.filterText = 'x';
    const next = new DataTable(cache);
    next.carryOver(dt);
    expect(next.currentTab).toBe('allEdges');
    expect(next.filterText).toBe('x');
    expect(cache.ui.warning).not.toHaveBeenCalled();

    await dt.switchTab('allNodes');
    dt.deleteRow('Node', 'n1');
    new DataTable(cache).carryOver(dt);
    expect(cache.ui.warning).toHaveBeenCalledWith(expect.stringContaining('1 unsaved data editor change was discarded'));
  });

  it('spends a carried-over focus on the first render, never later', async () => {
    const { dt, cache } = mount();
    await dt.switchTab('allNodes');
    cell(dt, 'n1', P).focus();
    // A reload in the default Selection view: the new editor's table is empty.
    await dt.switchTab('selectedNodes');
    // The old editor's empty state now holds focus, as Apply's button would.
    document.querySelector('.data-empty button').focus();
    const next = new DataTable(cache);
    next.carryOver(dt);
    next.init();
    next.populateFromFileData(dt.fileData);
    expect(document.querySelector('.data-empty').contains(document.activeElement)).toBe(true);

    // Later, the user works elsewhere; a selection refresh must not pull focus into the grid.
    const elsewhere = document.body.appendChild(document.createElement('input'));
    elsewhere.focus();
    cache.selectedNodes = ['n2'];
    await next.refreshCurrentTab();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('puts the edits back on the visible editor when Apply fails before the new one has a pane', async () => {
    const { dt, cache } = mount();
    await dt.switchTab('allNodes');
    const score = cell(dt, 'n1', P);
    dt.startEdit(score);
    score.textContent = '7';
    dt.commitEdit();
    cache.ui.showLoading = async () => {};
    cache.ui.hideLoading = async () => {};
    cache.ui.error = vi.fn();
    cache.data = { layouts: {}, selectedLayout: 'L' };
    dt.rebuildGraph = async () => {
      cache.dataTable = new DataTable(cache); // what cache.reset() does, before init()
      throw new Error('boom');
    };
    await dt.update();
    expect(cache.ui.error).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(dt.pendingChanges.size).toBe(1);
    expect(bar().hidden).toBe(false);
  });
});

describe('data editor staging rules', () => {
  // Numeric ids, as a JSON file with `"id": 1` loads them, and one edge 1 → 2.
  function mountNumeric() {
    document.body.innerHTML = '<div id="dataTableContainer"></div>';
    const nodes = [1, 2, 3].map((id) => ({ id, label: `N${id}`, D4Data: { 'Node filters': { Bio: { Score: id } } } }));
    const edges = [{ id: '1::2', source: 1, target: 2, D4Data: { 'Edge filters': { Bio: { W: 1 } } } }];
    const cache = {
      CFG,
      ui: { error: (m) => { throw new Error(m); }, warning: vi.fn(), info: vi.fn() },
      selectedNodes: [],
      selectedEdges: [],
      nodeRef: new Map(nodes.map((n) => [n.id, n])),
      edgeRef: new Map(edges.map((e) => [e.id, e])),
      style: { getNodeStyleOrDefaults: () => ({}), getEdgeStyleOrDefaults: () => ({}) },
      data: { layouts: {}, selectedLayout: 'Default' },
      gcm: {
        *traverseD4Data(e) {
          for (const [section, subs] of Object.entries(e.D4Data ?? {}))
            for (const [sub, props] of Object.entries(subs))
              for (const [prop, value] of Object.entries(props)) yield [section, sub, prop, value];
        },
      },
    };
    const dt = new DataTable(cache);
    dt.init();
    dt.populateFromFileData({
      nodeDataHeaders: [{ subGroup: 'Bio', key: 'Score' }],
      edgeDataHeaders: [{ subGroup: 'Bio', key: 'W' }],
      nodes,
      edges,
    });
    return dt;
  }

  it('finds numeric node ids typed as text, and keeps a new edge to them on Apply', async () => {
    const dt = mountNumeric();
    expect(await dt.addNode('3')).toMatchObject({ message: 'Node "3" already exists.' });
    expect(await dt.addEdge('3', '1')).toBeNull();
    dt.trackChange('Edge', '3::1', 'Edge filters::Bio::W', '5');
    const edge = dt.getUpdatedFileData().edges.find((e) => e.id === '3::1');
    expect(edge).toMatchObject({ source: 3, target: 1 });
  });

  it('blocks Apply for a new edge whose node is gone', async () => {
    const dt = mountNumeric();
    await dt.addNode('x1', 'X');
    dt.trackChange('Node', 'x1', 'Node filters::Bio::Score', '1');
    await dt.addEdge('x1', '2');
    dt.trackChange('Edge', 'x1::2', 'Edge filters::Bio::W', '1');
    expect(dt.validateNewElements()).toEqual([]);
    dt.deleteRow('Node', 'x1');
    expect(dt.validateNewElements()).toEqual([expect.stringContaining('needs node "x1": restore it')]);
  });

  it('marks an edited edge as going with its deleted node', async () => {
    const dt = mountNumeric();
    await dt.switchTab('allEdges');
    dt.trackChange('Edge', '1::2', 'Edge filters::Bio::W', '7');
    dt.deleteRow('Node', '1');
    dt.loadTabData();
    expect(dt.tableBody.querySelector('tr[data-key="Edge::1::2"]').classList.contains('data-row-deleted')).toBe(true);
  });

  it('takes a blocked Apply to the problem row, even in another view', async () => {
    const dt = mountNumeric();
    dt.cache.ui.error = vi.fn();
    await dt.addEdge('3', '1'); // no property value yet
    await dt.switchTab('allNodes');
    await dt.update();
    expect(dt.currentTab).toBe('allEdges');
    expect(document.activeElement.closest('tr').dataset.key).toBe('Edge::3::1');
  });

  it('exports only the rows the filter shows', async () => {
    const dt = mountNumeric();
    await dt.switchTab('allNodes');
    dt.filterText = 'N2';
    expect(dt.getNodesFromTableData().map((n) => n.id)).toEqual([2]);
  });

  it('counts every Rows and Type segment', async () => {
    const dt = mountNumeric();
    await dt.switchTab('allNodes');
    const count = (sel) => document.querySelector(`${sel} .data-seg-count`).textContent;
    expect([count('[data-scope="all"]'), count('[data-kind="Both"]')]).toEqual(['3', '4']);
  });

  it('commits on Shift+Enter instead of typing a newline, and moves up', async () => {
    const dt = mountNumeric();
    await dt.switchTab('allNodes');
    const at = (id) => dt.tableBody.querySelector(`tr[data-key="Node::${id}"] td[data-col="${dt.headers.indexOf(P)}"]`);
    at(2).focus();
    key(at(2), 'Enter');
    at(2).textContent = '8';
    key(at(2), 'Enter', { shiftKey: true });
    expect(dt.pendingChanges.get('Node::2').values[P]).toBe('8');
    expect(document.activeElement).toBe(at(1));
  });

  it('brings a row\'s staged edits back when it is restored', async () => {
    const dt = mountNumeric();
    await dt.switchTab('allNodes');
    dt.trackChange('Node', 2, 'Node filters::Bio::Score', '9');
    dt.deleteRow('Node', 2);
    dt.restoreRow('Node', 2);
    expect(dt.pendingChanges.get('Node::2')).toMatchObject({ action: 'edit', values: { 'Node filters::Bio::Score': '9' } });
  });
});
