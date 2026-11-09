// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataTable } from '../src/utilities/data_editor.js';

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
    expect(apply.disabled).toBe(true);
    expect(bar().textContent).toContain('"n9" requires at least one property value');

    const score = cell(dt, 'n9', P);
    dt.startEdit(score);
    score.textContent = '4';
    dt.commitEdit();
    expect(apply.disabled).toBe(false);
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
});
