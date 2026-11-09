/* global ExcelJS */ // loaded as a global via vendored src/lib/exceljs.min.js script tag
import { Popup } from './popup.js';
import { StaticUtilities } from './static.js';
import { EXCEL_NODE_PROPERTIES, EXCEL_EDGE_PROPERTIES } from '../managers/io.js';
import { computeMergePlan, showMergePreview } from './excel_merge.js';
import { UNSAFE_OBJECT_KEYS } from '../config.js';
import { RailMenu } from '../managers/rail.js';
import { buildAddMenu, buildReviewList, buildRowMenu } from './data_editor_forms.js';


/** Columns every row has; the rest are property columns. */
const BASIC_HEADERS = new Set(['Del', 'Row #', 'Type', 'ID', 'Label', 'Description']);

/** Pending-change key: node and edge IDs live in separate namespaces. */
const rowKey = (type, id) => `${type}::${id}`;

// Columns 0 and 1 (Del, Row #) are kept in the row arrays for the exporters'
// fixed indices but never rendered.
const TYPE_COL = 2;
const ID_COL = 3;
const FIRST_EDITABLE_COL = 4; // Label

/** The tab name each Rows × Type pair maps to; the rest of the app reads tab names. */
const SCOPE_TABS = {
  selection: { Node: 'selectedNodes', Edge: 'selectedEdges', Both: 'selectedElements' },
  all: { Node: 'allNodes', Edge: 'allEdges', Both: 'entireGraph' },
};
const NOUNS = { Node: ['node', 'nodes'], Edge: ['edge', 'edges'], Both: ['row', 'rows'] };
const PAGE_ROWS = 10;

const plural = (n, kind) => `${n} ${NOUNS[kind][n === 1 ? 0 : 1]}`;

const PANE_HTML = `
  <div class="data-toolbar">
    <div class="prop-seg" role="group" aria-label="Rows">
      <button type="button" data-scope="selection">Selection <span class="data-seg-count"></span></button>
      <button type="button" data-scope="all">All</button>
    </div>
    <div class="prop-seg" role="group" aria-label="Element type">
      <button type="button" data-kind="Node">Nodes <span class="data-seg-count"></span></button>
      <button type="button" data-kind="Edge">Edges <span class="data-seg-count"></span></button>
      <button type="button" data-kind="Both">Both</button>
    </div>
    <input type="search" class="data-filter" placeholder="Filter rows…" aria-label="Filter rows">
    <span class="data-count" aria-live="polite"></span>
    <span class="data-gap"></span>
    <button type="button" id="dataAddBtn" class="insp-btn">+ Add <span aria-hidden="true">▾</span></button>
    <button type="button" id="importDataTableBtn" class="insp-btn"
            title="Merge an Excel file into the current graph — preview the changes first">⤒ Import</button>
    <button type="button" id="exportDataTableBtn" class="insp-btn"
            title="Export the applied data for this Rows and Type view, with styling, as Excel">⤓ Export</button>
  </div>
  <div class="data-table-wrapper">
    <table id="dataTable" class="data-table" role="grid" aria-label="Graph data" aria-describedby="dataGridHint">
      <thead id="dataTableHead"></thead>
      <tbody id="dataTableBody"></tbody>
    </table>
    <div class="data-empty" hidden></div>
  </div>
  <span id="dataGridHint" class="visually-hidden">Arrow keys move between cells. Enter, F2 or typing edits a cell; Escape cancels.</span>
  <span class="data-status visually-hidden" role="status"></span>
  <div class="data-changes" hidden>
    <strong class="data-changes-count"></strong>
    <span class="data-changes-meta"></span>
    <span class="data-gap"></span>
    <button type="button" id="dataReviewBtn" class="insp-btn">Review</button>
    <button type="button" id="resetDataTableBtn" class="insp-btn">Discard</button>
    <button type="button" id="updateDataTableBtn" class="insp-btn primary">Apply</button>
  </div>`;

class DataTable {
  #elementIndex = new Map();
  #indexedFileData = null;

  constructor(cache, containerId = 'dataTableContainer') {
    this.containerId = containerId;
    this.tableData = [];
    this.headers = [];
    this.sortState = {};
    this.headerIndexMap = new Map();
    this.currentTab = 'selectedNodes';
    this.fileData = null;
    // rowKey → { type, id, action: 'edit', values: { header: text } }
    //        | { type, id, action: 'delete' }
    this.pendingChanges = new Map();
    // Property columns added here and not yet applied: { isNode, group, name, header }.
    this.addedColumns = [];
    this.onPendingChangesCallback = null;
    this.filterText = '';
    // The roving focus position: row key + column (or 'act' / 'head').
    this.activeCell = null;
    this.editing = null;
    // Set by carryOver when the replaced editor held focus; spent on the first
    // render with data, so it can never pull focus in later.
    this.restoreFocus = false;

    this.cache = cache;
  }

  /**
   * Take over the view of the editor this one replaces (cache.reset() builds a
   * new one on every load, Apply's rebuild included). Staged changes do not
   * carry over: they belong to the old graph, so losing them is said out loud.
   */
  carryOver(previous) {
    this.currentTab = previous.currentTab;
    this.filterText = previous.filterText;
    this.activeCell = previous.activeCell;
    // Anywhere in the old pane (grid, toolbar, empty state, changes bar): its DOM
    // is still in place here, and init() is about to replace it.
    this.restoreFocus = !!document.getElementById(previous.containerId)?.contains(document.activeElement);
    const { total } = previous.#changeCounts();
    if (total) {
      this.cache.ui.warning?.(
        `${total} unsaved data editor change${total === 1 ? ' was' : 's were'} discarded because the graph was replaced.`
      );
    }
  }

  get scope() {
    return this.currentTab.startsWith('selected') ? 'selection' : 'all';
  }

  get kind() {
    const types = this.#tabTypes();
    return types.length === 2 ? 'Both' : types[0];
  }

  init() {
    const container = document.getElementById(this.containerId);
    if (!container) {
      this.cache.ui.error(`Container with ID '${this.containerId}' not found`);
      return;
    }
    container.innerHTML = PANE_HTML;
    const $ = (sel) => container.querySelector(sel);
    this.toolbar = $('.data-toolbar');
    this.table = $('#dataTable');
    this.tableHead = $('#dataTableHead');
    this.tableBody = $('#dataTableBody');
    this.emptyEl = $('.data-empty');
    this.changesBar = $('.data-changes');
    this.filterInput = $('.data-filter');
    this.countEl = $('.data-count');
    this.statusEl = $('.data-status');

    this.toolbar.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-scope], [data-kind]');
      if (!btn) return;
      await this.switchTab(SCOPE_TABS[btn.dataset.scope ?? this.scope][btn.dataset.kind ?? this.kind]);
    });
    this.filterInput.value = this.filterText;
    this.filterInput.addEventListener('input', () => {
      this.filterText = this.filterInput.value;
      this.render();
    });
    this.addMenu = new RailMenu($('#dataAddBtn'), (el) => buildAddMenu(this, el));
    this.reviewMenu = new RailMenu($('#dataReviewBtn'), (el) => buildReviewList(this, el));
    $('#importDataTableBtn').addEventListener('click', () => this.importExcel());
    $('#exportDataTableBtn').addEventListener('click', () => this.exportToExcel());
    $('#resetDataTableBtn').addEventListener('click', () => this.discard());
    $('#updateDataTableBtn').addEventListener('click', () => this.update());

    this.table.addEventListener('keydown', (e) => this.#onGridKey(e));
    this.table.addEventListener('click', (e) => this.#onGridClick(e));
    this.table.addEventListener('dblclick', (e) => {
      const td = e.target.closest('td[data-col]');
      if (td && this.#isEditableCell(td)) this.startEdit(td);
    });
    this.table.addEventListener('focusin', (e) => this.#onFocusIn(e));
    this.table.addEventListener('focusout', (e) => {
      if (this.editing?.td === e.target) this.commitEdit();
    });
    this.render();
  }

  async switchTab(tab) {
    if (!Object.values(SCOPE_TABS).some((tabs) => Object.values(tabs).includes(tab))) {
      throw new Error(`Unknown data editor view "${tab}".`);
    }
    this.currentTab = tab;
    this.sortState = {};
    if (this.fileData) this.loadTabData();
    else this.render();
  }

  loadTabData() {
    if (!this.fileData) {
      throw new Error('The data editor has no graph data loaded.');
    }

    this.headers = [...BASIC_HEADERS];

    // Deduplicate headers to prevent duplicate columns
    const nodeHeaders = this.fileData.nodeDataHeaders.map(
      (o) => `${this.cache.CFG.EXCEL_NODE_HEADER}::${o.subGroup}::${o.key}`
    );
    const edgeHeaders = this.fileData.edgeDataHeaders.map(
      (o) => `${this.cache.CFG.EXCEL_EDGE_HEADER}::${o.subGroup}::${o.key}`
    );
    const uniqueNodeHeaders = [...new Set(nodeHeaders)];
    const uniqueEdgeHeaders = [...new Set(edgeHeaders)];

    // Filter headers based on current tab
    const nodeOnlyTabs = ['selectedNodes', 'allNodes'];
    const edgeOnlyTabs = ['selectedEdges', 'allEdges'];
    const allPropertyTabs = ['selectedElements', 'entireGraph'];

    if (nodeOnlyTabs.includes(this.currentTab)) {
      this.headers.push(...uniqueNodeHeaders);
    } else if (edgeOnlyTabs.includes(this.currentTab)) {
      this.headers.push(...uniqueEdgeHeaders);
    } else if (allPropertyTabs.includes(this.currentTab)) {
      this.headers.push(...uniqueNodeHeaders);
      this.headers.push(...uniqueEdgeHeaders);
    }

    this.headerIndexMap.clear();
    this.headers.forEach((header, index) => {
      this.headerIndexMap.set(header, index);
    });

    this.tableData = [];

    switch (this.currentTab) {
      case 'selectedNodes':
        this.loadSelectedNodes();
        break;
      case 'selectedEdges':
        this.loadSelectedEdges();
        break;
      case 'selectedElements':
        this.loadSelectedElements();
        break;
      case 'allNodes':
        this.loadAllNodes();
        break;
      case 'allEdges':
        this.loadAllEdges();
        break;
      case 'entireGraph':
        this.loadEntireGraph();
        break;
    }

    this.#overlayPendingChanges();

    this.tableData.forEach((row, index) => {
      row[1] = index + 1;
    });

    this.#sortRows();
    this.render();
  }

  /** Element types the current tab lists. */
  #tabTypes() {
    if (['selectedNodes', 'allNodes'].includes(this.currentTab)) return ['Node'];
    if (['selectedEdges', 'allEdges'].includes(this.currentTab)) return ['Edge'];
    return ['Node', 'Edge'];
  }

  // Pending changes are the only record of unapplied edits; the table is
  // re-derived from fileData on every load and the edits laid over it here.
  // Keeping edits in the table instead meant every reload appended another
  // copy of each edited row. Rows staged for deletion stay listed (marked),
  // so a deletion can be seen and restored until Apply.
  #overlayPendingChanges() {
    const types = this.#tabTypes();
    const rowIndexByKey = new Map(this.tableData.map((row, i) => [rowKey(row[TYPE_COL], row[ID_COL]), i]));

    for (const [key, change] of this.pendingChanges) {
      if (!types.includes(change.type)) continue;
      // Edited, added and deleted rows stay listed even once deselected, so an
      // unapplied change is never out of sight.
      let row = this.tableData[rowIndexByKey.get(key)];
      if (change.action === 'delete') {
        if (!row) this.tableData.push(this.#buildRow(change.type, change.id, this.#elementFor(change.type, change.id)));
        continue;
      }
      if (!row) {
        row = this.#buildRow(change.type, change.id, this.#elementFor(change.type, change.id));
        this.tableData.push(row);
      }
      for (const [header, value] of Object.entries(change.values)) {
        const col = this.headerIndexMap.get(header);
        if (col !== undefined) row[col] = value;
      }
    }
  }

  /** The loaded (unedited) element of that type and id, or undefined for a new one. */
  #elementFor(type, id) {
    if (this.#indexedFileData !== this.fileData) {
      this.#elementIndex = new Map();
      for (const node of this.fileData?.nodes ?? []) this.#elementIndex.set(rowKey('Node', node.id), node);
      for (const edge of this.fileData?.edges ?? []) this.#elementIndex.set(rowKey('Edge', edge.id), edge);
      this.#indexedFileData = this.fileData;
    }
    return this.#elementIndex.get(rowKey(type, id));
  }

  #sortRows() {
    const [column, direction] =
      Object.entries(this.sortState).find(([, dir]) => dir === 'asc' || dir === 'desc') ?? [];
    if (!direction) return;
    const col = Number(column);
    const sign = direction === 'asc' ? 1 : -1;
    this.tableData.sort((a, b) => {
      const aVal = a[col] ?? '';
      const bVal = b[col] ?? '';
      const aNum = parseFloat(aVal);
      const bNum = parseFloat(bVal);
      if (!isNaN(aNum) && !isNaN(bNum)) return sign * (aNum - bNum);
      return sign * String(aVal).toLowerCase().localeCompare(String(bVal).toLowerCase());
    });
  }

  loadSelectedNodes() {
    if (!this.fileData.nodes || !this.cache.selectedNodes) return;

    const selectedNodeSet = new Set(this.cache.selectedNodes);
    const selectedNodes = this.fileData.nodes.filter((node) => selectedNodeSet.has(node.id));
    this.addNodesToTable(selectedNodes);
  }

  loadSelectedEdges() {
    if (!this.fileData.edges || !this.cache.selectedEdges) return;

    const selectedEdgeSet = new Set(this.cache.selectedEdges);
    const selectedEdges = this.fileData.edges.filter((edge) => selectedEdgeSet.has(edge.id));
    this.addEdgesToTable(selectedEdges);
  }

  loadSelectedElements() {
    if (!this.cache.selectedNodes && !this.cache.selectedEdges) return;

    if (this.fileData.nodes && this.cache.selectedNodes) {
      const selectedNodeSet = new Set(this.cache.selectedNodes);
      const selectedNodes = this.fileData.nodes.filter((node) => selectedNodeSet.has(node.id));
      this.addNodesToTable(selectedNodes);
    }

    if (this.fileData.edges && this.cache.selectedEdges) {
      const selectedEdgeSet = new Set(this.cache.selectedEdges);
      const selectedEdges = this.fileData.edges.filter((edge) => selectedEdgeSet.has(edge.id));
      this.addEdgesToTable(selectedEdges);
    }
  }

  loadAllNodes() {
    if (!this.fileData.nodes) return;
    this.addNodesToTable(this.fileData.nodes);
  }

  loadAllEdges() {
    if (!this.fileData.edges) return;
    this.addEdgesToTable(this.fileData.edges);
  }

  loadEntireGraph() {
    if (this.fileData.nodes) {
      this.addNodesToTable(this.fileData.nodes);
    }
    if (this.fileData.edges) {
      this.addEdgesToTable(this.fileData.edges);
    }
  }

  addNodesToTable(nodes) {
    for (const node of nodes) this.tableData.push(this.#buildRow('Node', node.id, node));
  }

  addEdgesToTable(edges) {
    for (const edge of edges) this.tableData.push(this.#buildRow('Edge', edge.id, edge));
  }

  /** A row for the current headers; `element` is undefined for a row being added. */
  #buildRow(type, id, element) {
    const row = new Array(this.headers.length).fill('');
    row[2] = type;
    row[3] = id;
    if (!element) return row;
    row[4] = element.label || '';
    row[5] = element.description || '';
    for (const [section, subSection, prop, data] of this.cache.gcm.traverseD4Data(element)) {
      const headerIdx = this.headerIndexMap.get(`${section}::${subSection}::${prop}`);
      if (headerIdx !== undefined) row[headerIdx] = data;
    }
    return row;
  }

  populateFromFileData(fileData) {
    if (!fileData) {
      this.cache.ui.error('No fileData provided');
      return;
    }

    this.fileData = structuredClone(fileData);
    // Staged edits belong to the graph they were made on. A load builds a new
    // editor (carryOver says what was lost); this guards any path that does not.
    this.pendingChanges.clear();
    this.addedColumns = [];
    this.notifyPendingChanges();
    this.loadTabData();
  }

  async refreshCurrentTab() {
    // A selection change re-derives the rows; an open edit would be lost with them.
    if (this.editing) this.commitEdit();
    this.loadTabData();
  }

  reset() {
    this.sortState = {};
    this.pendingChanges.clear();
    for (const column of this.addedColumns) this.#removeColumnHeader(column);
    this.addedColumns = [];
    this.notifyPendingChanges();
    this.loadTabData();
  }

  /** Header text for a column: the property name, or the basic column's own name. */
  #columnName(col) {
    // "Type" is also a common property name; the basic column says what it holds.
    if (col === TYPE_COL) return 'Element';
    const header = this.headers[col];
    const parts = header.split('::');
    return parts.length === 3 ? parts[2] : header;
  }

  /** The group a property column sits under, prefixed by its element type under Both. */
  #columnGroup(col) {
    const parts = this.headers[col].split('::');
    if (col <= FIRST_EDITABLE_COL + 1 || parts.length !== 3) return '';
    if (this.kind !== 'Both') return parts[1];
    const type = parts[0] === this.cache.CFG.EXCEL_EDGE_HEADER ? 'Edge' : 'Node';
    return `${type} · ${parts[1]}`;
  }

  /** Rendered columns: ID first (it is frozen), the element type only when both types are listed. */
  #visibleColumns() {
    const cols = [ID_COL];
    if (this.kind === 'Both') cols.push(TYPE_COL);
    for (let col = ID_COL + 1; col < this.headers.length; col++) cols.push(col);
    return cols;
  }

  /** Indexes into tableData that pass the row filter. */
  #visibleRows() {
    const q = this.filterText.trim().toLowerCase();
    const out = [];
    this.tableData.forEach((row, i) => {
      if (!q || row.some((v, col) => col >= TYPE_COL && String(v ?? '').toLowerCase().includes(q))) out.push(i);
    });
    return out;
  }

  #isEditable(type, col) {
    if (col < FIRST_EDITABLE_COL) return false;
    const header = this.headers[col];
    const { EXCEL_NODE_HEADER, EXCEL_EDGE_HEADER } = this.cache.CFG;
    return !(
      (type === 'Node' && header.startsWith(EXCEL_EDGE_HEADER)) ||
      (type === 'Edge' && header.startsWith(EXCEL_NODE_HEADER))
    );
  }

  #isEditableCell(td) {
    return td?.tagName === 'TD' && td.dataset.col !== undefined && !td.hasAttribute('aria-readonly');
  }

  /** What a row is in the pending changes: 'deleted', 'added', 'edited' or ''. */
  #rowState(type, id) {
    const change = this.pendingChanges.get(rowKey(type, id));
    if (!change) return type === 'Edge' && this.#deletedEnd(id) ? 'cascade' : '';
    if (change.action === 'delete') return 'deleted';
    return this.#elementFor(type, id) ? 'edited' : 'added';
  }

  /** The staged-for-deletion node an edge hangs off, which takes the edge with it on Apply. */
  #deletedEnd(edgeId) {
    const edge = this.#elementFor('Edge', edgeId);
    if (!edge) return null;
    return [edge.source, edge.target].find((n) => this.pendingChanges.get(rowKey('Node', n))?.action === 'delete') ?? null;
  }

  /** @returns {Node[]|null} The empty-state content for this view, or null when there are rows. */
  #emptyState(shown) {
    const message = (text, action, onClick) => {
      const p = document.createElement('p');
      p.textContent = text;
      if (!action) return [p];
      const btn = document.createElement('button');
      btn.type = 'button';
      // One filled button per surface: Apply owns it while changes are staged.
      btn.className = this.#changeCounts().total ? 'insp-btn' : 'insp-btn primary';
      btn.textContent = action;
      btn.addEventListener('click', onClick);
      return [p, btn];
    };
    const kind = this.kind;
    if (!this.fileData) return message('Load a graph to see its nodes and edges here.');
    if (!this.tableData.length) {
      if (this.scope === 'selection') {
        const all = this.#counts('all')[kind];
        return message(
          `No ${NOUNS[kind][1]} selected. Select some on the graph, or list them all.`,
          `Show all ${plural(all, kind)}`,
          () => this.switchTab(SCOPE_TABS.all[kind])
        );
      }
      return message(`This graph has no ${NOUNS[kind][1]}.`);
    }
    if (!shown) {
      return message(`No rows match "${this.filterText.trim()}".`, 'Clear filter', () => {
        this.filterText = '';
        if (this.filterInput) this.filterInput.value = '';
        this.render();
        this.filterInput?.focus();
      });
    }
    return null;
  }

  #counts(scope) {
    const counts =
      scope === 'selection'
        ? { Node: this.cache.selectedNodes?.length ?? 0, Edge: this.cache.selectedEdges?.length ?? 0 }
        : { Node: this.fileData?.nodes?.length ?? 0, Edge: this.fileData?.edges?.length ?? 0 };
    for (const change of this.pendingChanges.values()) {
      if (change.action !== 'delete' && !this.#elementFor(change.type, change.id)) counts[change.type] += 1;
    }
    counts.Both = counts.Node + counts.Edge;
    return counts;
  }

  #syncToolbar(shown) {
    if (!this.toolbar) return;
    const sel = this.#counts('selection');
    const inScope = this.#counts(this.scope);
    for (const btn of this.toolbar.querySelectorAll('[data-scope]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.scope === this.scope));
    }
    for (const btn of this.toolbar.querySelectorAll('[data-kind]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.kind === this.kind));
    }
    const setCount = (sel_, n) => {
      const el = this.toolbar.querySelector(`${sel_} .data-seg-count`);
      if (el) el.textContent = this.fileData ? String(n) : '';
    };
    setCount('[data-scope="selection"]', sel[this.kind]);
    setCount('[data-kind="Node"]', inScope.Node);
    setCount('[data-kind="Edge"]', inScope.Edge);
    const total = this.tableData.length;
    this.countEl.textContent = !this.fileData
      ? ''
      : this.filterText.trim()
        ? `${shown} of ${total}`
        : plural(total, this.kind);
    const loaded = !!this.fileData;
    for (const id of ['dataAddBtn', 'importDataTableBtn']) {
      const btn = this.toolbar.querySelector(`#${id}`);
      if (btn) btn.disabled = !loaded;
    }
  }

  /** Counts of what is staged, for the changes bar. */
  #changeCounts() {
    let edited = 0;
    let added = 0;
    let deleted = 0;
    for (const change of this.pendingChanges.values()) {
      if (change.action === 'delete') deleted++;
      else if (!this.#elementFor(change.type, change.id)) added++;
      else edited += Object.keys(change.values).length;
    }
    const columns = this.addedColumns.length;
    return { edited, added, deleted, columns, total: edited + added + deleted + columns };
  }

  #syncChangesBar() {
    if (!this.changesBar) return;
    const { edited, added, deleted, columns, total } = this.#changeCounts();
    if (!total) {
      // Hiding the bar (or the review list) under focus would drop it to <body>.
      const held = this.changesBar.contains(document.activeElement) || this.reviewMenu?.el.contains(document.activeElement);
      if (this.reviewMenu?.isOpen) this.reviewMenu.close();
      this.changesBar.hidden = true;
      this.#announce(this.lastAnnounced ? 'No unsaved changes.' : '');
      // After the current redraw: this runs at the top of render(), before the rows are rebuilt.
      if (held) queueMicrotask(() => (this.table && !this.table.hidden ? this.focusActiveCell() : this.filterInput?.focus()));
      return;
    }
    this.changesBar.hidden = false;
    const noun = total === 1 ? 'change' : 'changes';
    this.changesBar.querySelector('.data-changes-count').textContent = `${total} unsaved ${noun}`;
    const parts = [
      edited && `${edited} edited`,
      added && `${added} added`,
      deleted && `${deleted} deleted`,
      columns && `${columns} new column${columns === 1 ? '' : 's'}`,
    ].filter(Boolean);
    const meta = this.changesBar.querySelector('.data-changes-meta');
    const problems = this.validateNewElements();
    meta.classList.toggle('problem', problems.length > 0);
    meta.textContent = problems.length
      ? problems[0].replace(/^• /, '') + ' before Apply'
      : `${parts.join(' · ')} · applies to every workspace`;
    this.#announce(`${total} unsaved ${noun}.${problems.length ? ` ${meta.textContent}.` : ''}`);
    const apply = this.changesBar.querySelector('#updateDataTableBtn');
    apply.textContent = `Apply ${total} ${noun}`;
    // Blocked while a new row still owes a value; the line beside it says which.
    // aria-disabled, not disabled: it stays in the Tab order and a click jumps
    // to the row that blocks it.
    apply.setAttribute('aria-disabled', String(problems.length > 0));
  }

  /** One always-present live region; only a changed message is written, so redraws stay quiet. */
  #announce(text) {
    if (!this.statusEl || text === (this.lastAnnounced ?? '')) return;
    this.lastAnnounced = text;
    this.statusEl.textContent = text;
  }

  render() {
    if (!this.tableHead || !this.tableBody) {
      this.cache.ui.error('Table elements not found');
      return;
    }
    this.table ??= this.tableHead.closest('table');
    const rows = this.#visibleRows();
    this.#syncToolbar(rows.length);
    this.#syncChangesBar();
    this.updateExportButtonState();

    const empty = this.#emptyState(rows.length);
    if (this.emptyEl) {
      this.emptyEl.hidden = !empty;
      this.emptyEl.replaceChildren(...(empty ?? []));
    }
    // Emptying the table under focus would drop it to <body> (Apply's rebuild,
    // a selection refresh, a sort): note it and put focus back after.
    const hadFocus = !!this.table?.contains(document.activeElement) && !this.editing;
    this.table?.toggleAttribute('hidden', !!empty);
    this.tableHead.replaceChildren();
    this.tableBody.replaceChildren();
    if (empty) {
      // init() renders before any data arrives: keep a carried-over focus for
      // the render that has data, and spend it there either way.
      if (hadFocus || (this.restoreFocus && this.fileData)) {
        this.restoreFocus = false;
        (this.emptyEl?.querySelector('button') ?? this.filterInput)?.focus();
      }
      return;
    }

    const cols = this.#visibleColumns();
    this.tableHead.append(this.#groupHeaderRow(cols), this.#headerRow(cols));
    const fragment = document.createDocumentFragment();
    for (const r of rows) fragment.appendChild(this.#bodyRow(r, cols));
    this.tableBody.appendChild(fragment);
    this.table?.setAttribute('aria-rowcount', String(rows.length + 2));
    // scrollIntoView honours scroll-padding: keep the active cell clear of the
    // frozen ⋯ + ID columns (the sticky header's height is fixed in CSS).
    // Widths, not offsetLeft: a stuck cell's offsetLeft grows with the scroll.
    const actHead = this.tableHead.querySelector('.data-head-row .data-act');
    const idHead = this.tableHead.querySelector('.data-head-row .data-id');
    const wrapper = this.table?.parentElement;
    if (actHead && idHead && wrapper) wrapper.style.scrollPaddingLeft = `${actHead.offsetWidth + idHead.offsetWidth}px`;
    this.#placeRovingFocus();
    if (hadFocus || this.restoreFocus) {
      this.restoreFocus = false;
      this.focusActiveCell();
    }
  }

  #groupHeaderRow(cols) {
    const tr = document.createElement('tr');
    tr.className = 'data-group-row';
    tr.appendChild(document.createElement('th')).className = 'data-act';
    let last = null;
    for (const col of cols) {
      const group = this.#columnGroup(col);
      if (last && last.textContent === group) {
        last.colSpan += 1;
        continue;
      }
      last = document.createElement('th');
      last.textContent = group;
      if (col === ID_COL) last.className = 'data-id';
      tr.appendChild(last);
    }
    return tr;
  }

  #headerRow(cols) {
    const tr = document.createElement('tr');
    tr.className = 'data-head-row';
    const act = document.createElement('th');
    act.className = 'data-act';
    act.dataset.col = 'act';
    act.tabIndex = -1;
    const hidden = document.createElement('span');
    hidden.className = 'visually-hidden';
    hidden.textContent = 'Actions';
    act.appendChild(hidden);
    tr.appendChild(act);
    for (const col of cols) {
      const th = document.createElement('th');
      th.dataset.col = col;
      if (col === ID_COL) th.className = 'data-id';
      const direction = this.sortState[col];
      if (direction) th.setAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'data-sort';
      btn.tabIndex = -1;
      btn.textContent = this.#columnName(col);
      const group = this.#columnGroup(col);
      btn.title = `${group ? `${group} › ` : ''}${btn.textContent} — sort`;
      const arrow = document.createElement('span');
      arrow.className = 'data-sort-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : '⇅';
      btn.appendChild(arrow);
      th.appendChild(btn);
      tr.appendChild(th);
    }
    return tr;
  }

  #bodyRow(r, cols) {
    const row = this.tableData[r];
    const type = row[TYPE_COL];
    const id = row[ID_COL];
    const state = this.#rowState(type, id);
    const change = this.pendingChanges.get(rowKey(type, id));
    const loaded = state === 'edited' ? this.#buildRow(type, id, this.#elementFor(type, id)) : null;

    const tr = document.createElement('tr');
    tr.dataset.row = r;
    tr.dataset.key = rowKey(type, id);
    const gone = state === 'deleted' || state === 'cascade';
    if (gone) tr.classList.add('data-row-deleted');
    if (state === 'added') tr.classList.add('data-row-added');
    const endNode = state === 'cascade' ? this.#deletedEnd(id) : null;

    const act = document.createElement('td');
    act.className = 'data-act';
    act.dataset.col = 'act';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'data-row-btn';
    btn.tabIndex = -1;
    const noun = type.toLowerCase();
    if (state === 'cascade') {
      // Nothing to do on the edge itself: restoring its node brings it back.
      btn.remove();
      act.tabIndex = -1;
    } else if (state === 'deleted') {
      btn.textContent = '↺';
      btn.dataset.action = 'restore';
      btn.setAttribute('aria-label', `Restore ${noun} ${id}`);
      btn.title = `Restore ${noun} ${id}`;
    } else {
      btn.textContent = '⋯';
      btn.dataset.action = 'menu';
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-label', `${type} ${id} actions`);
    }
    if (state !== 'cascade') act.appendChild(btn);
    tr.appendChild(act);

    for (const col of cols) {
      const td = document.createElement('td');
      td.dataset.row = r;
      td.dataset.col = col;
      td.tabIndex = -1;
      const value = row[col];
      td.textContent = value !== null && value !== undefined ? value : '';
      if (col === ID_COL) {
        td.classList.add('data-id');
        if (state === 'added' || gone) {
          td.append(' '); // a word break for the accessible name: "n1001 New"
          const pill = document.createElement('span');
          pill.className = `data-pill ${state === 'added' ? 'added' : 'deleted'}`;
          pill.textContent = state === 'added' ? 'New' : endNode ? `Deleted with ${endNode}` : 'Deleted';
          td.appendChild(pill);
        }
      }
      if (gone || !this.#isEditable(type, col)) {
        td.setAttribute('aria-readonly', 'true');
        td.classList.add('readonly');
        const why = this.#readonlyReason(type, col, state, endNode);
        if (why) td.title = why;
      }
      if (loaded && Object.hasOwn(change.values, this.headers[col])) {
        td.classList.add('data-cell-edited');
        td.title = `Was: ${loaded[col] === '' || loaded[col] === undefined ? '(empty)' : loaded[col]}`;
      }
      tr.appendChild(td);
    }
    return tr;
  }

  /** Why a cell cannot be edited, for its tooltip; null when the column says it. */
  #readonlyReason(type, col, state, endNode) {
    if (state === 'cascade') return `Removed with node ${endNode} on Apply. Restore the node to keep it.`;
    if (state === 'deleted') return 'Restore the row to edit it.';
    if (col === ID_COL) return `IDs cannot be edited. Add a new ${type.toLowerCase()} and delete this one.`;
    if (col === TYPE_COL) return null;
    return `${type === 'Node' ? 'Edge' : 'Node'} property, not used by ${type.toLowerCase()}s.`;
  }

  updateExportButtonState() {
    const exportBtn = document.getElementById('exportDataTableBtn');
    if (exportBtn) exportBtn.disabled = this.tableData.length === 0;
  }

  // ---------------------------------------------------------------- the grid
  // One Tab stop (APG grid): the active cell carries tabindex 0, the rest -1.
  // Arrow keys move; Enter, F2 or typing edits; Escape cancels an edit.

  /** The element that takes focus for a cell: its button when it holds one. */
  #focusTarget(cell) {
    return cell.querySelector(':scope > button') ?? cell;
  }

  /** Every navigable row, header first, each as its list of cells. */
  #gridRows() {
    return [...this.table.querySelectorAll('tr.data-head-row, tbody tr')].map((tr) => [
      ...tr.querySelectorAll(':scope > [data-col]'),
    ]);
  }

  #cellFor(target) {
    return target?.closest?.('th[data-col], td[data-col]') ?? null;
  }

  #positionOf(cell) {
    const tr = cell.parentElement;
    return { key: tr.dataset.key ?? 'head', col: cell.dataset.col };
  }

  #placeRovingFocus() {
    const rows = this.#gridRows();
    if (!rows.length) return;
    let cell = null;
    if (this.activeCell) {
      // Matched by dataset, not selector: keys are imported IDs and may hold any character.
      const tr =
        this.activeCell.key === 'head'
          ? this.table.querySelector('tr.data-head-row')
          : [...this.tableBody.rows].find((row) => row.dataset.key === this.activeCell.key);
      cell = [...(tr?.children ?? [])].find((c) => c.dataset.col === String(this.activeCell.col)) ?? null;
    }
    cell ??= rows[1]?.[1] ?? rows[0][1] ?? rows[0][0];
    this.#focusTarget(cell).tabIndex = 0;
    this.rovingEl = this.#focusTarget(cell);
  }

  #setActive(cell, { focus = true } = {}) {
    if (this.rovingEl && this.rovingEl !== this.#focusTarget(cell)) this.rovingEl.tabIndex = -1;
    const target = this.#focusTarget(cell);
    target.tabIndex = 0;
    this.rovingEl = target;
    this.activeCell = this.#positionOf(cell);
    if (focus) {
      target.focus();
      cell.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }

  /** Move focus to the active cell, e.g. after a popover closes or a row was added. */
  focusActiveCell() {
    if (!this.table || this.table.hidden) return;
    this.#placeRovingFocus();
    const cell = this.#cellFor(this.rovingEl);
    if (cell) this.#setActive(cell);
  }

  #onFocusIn(e) {
    const cell = this.#cellFor(e.target);
    if (cell && cell.parentElement.matches('tr.data-head-row, tbody tr')) this.#setActive(cell, { focus: false });
  }

  #move(cell, dRow, dCol, { toRowEdge, toGridEdge } = {}) {
    const rows = this.#gridRows();
    const r = rows.findIndex((cells) => cells.includes(cell));
    const c = rows[r].indexOf(cell);
    let nr = toGridEdge ? (toGridEdge < 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, r + dRow));
    const width = rows[nr].length;
    let nc = toRowEdge ? (toRowEdge < 0 ? 0 : width - 1) : Math.max(0, Math.min(width - 1, c + dCol));
    if (toGridEdge) nc = toGridEdge < 0 ? 0 : width - 1;
    this.#setActive(rows[nr][nc]);
  }

  #onGridKey(e) {
    if (this.editing) return this.#onEditKey(e);
    const cell = this.#cellFor(e.target);
    if (!cell) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const moves = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      PageUp: [-PAGE_ROWS, 0],
      PageDown: [PAGE_ROWS, 0],
    };
    if (moves[e.key]) {
      e.preventDefault();
      return this.#move(cell, ...moves[e.key]);
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const edge = e.key === 'Home' ? -1 : 1;
      return this.#move(cell, 0, 0, ctrl ? { toGridEdge: edge } : { toRowEdge: edge });
    }
    if (!this.#isEditableCell(cell)) return; // buttons keep their native Enter/Space
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      this.startEdit(cell);
    } else if (e.key.length === 1 && !ctrl && !e.altKey) {
      e.preventDefault();
      this.startEdit(cell, e.key);
    }
  }

  #onEditKey(e) {
    const { td } = this.editing;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // the edit is the innermost layer
      this.cancelEdit();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.commitEdit();
      this.#move(td, 1, 0);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      this.commitEdit();
      this.#move(td, 0, e.shiftKey ? -1 : 1);
    }
  }

  /** Enter edit mode on a cell; `initial` replaces its text (type-to-replace). */
  startEdit(td, initial) {
    if (this.editing) this.commitEdit();
    this.editing = { td, original: td.textContent };
    td.setAttribute('contenteditable', 'true');
    td.classList.add('editing');
    if (initial !== undefined) td.textContent = initial;
    td.focus();
    const range = document.createRange();
    range.selectNodeContents(td);
    if (initial !== undefined) range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  #leaveEdit() {
    const { td } = this.editing;
    this.editing = null;
    td.removeAttribute('contenteditable');
    td.classList.remove('editing');
    return td;
  }

  commitEdit() {
    if (!this.editing) return;
    const td = this.#leaveEdit();
    const r = Number(td.dataset.row);
    const col = Number(td.dataset.col);
    const row = this.tableData[r];
    const text = td.textContent;
    row[col] = text;
    this.trackChange(row[TYPE_COL], row[ID_COL], this.headers[col], text);
    this.notifyPendingChanges();
    // Mark the cell in place: a full render here would rebuild every row on
    // each Tab through a column.
    const change = this.pendingChanges.get(rowKey(row[TYPE_COL], row[ID_COL]));
    const element = this.#elementFor(row[TYPE_COL], row[ID_COL]);
    const edited = !!element && !!change?.values && Object.hasOwn(change.values, this.headers[col]);
    td.classList.toggle('data-cell-edited', edited);
    if (edited) {
      const was = this.#buildRow(row[TYPE_COL], row[ID_COL], element)[col];
      td.title = `Was: ${was === '' || was === undefined ? '(empty)' : was}`;
    } else {
      td.removeAttribute('title');
    }
  }

  cancelEdit() {
    if (!this.editing) return;
    const { original } = this.editing;
    const td = this.#leaveEdit();
    td.textContent = original;
    td.focus();
  }

  async #onGridClick(e) {
    const sort = e.target.closest('.data-sort');
    if (sort) {
      const col = Number(sort.parentElement.dataset.col);
      this.activeCell = { key: 'head', col: String(col) };
      this.handleHeaderClick(col);
      return this.focusActiveCell();
    }
    const btn = e.target.closest('.data-row-btn');
    if (!btn) return;
    const tr = btn.closest('tr');
    const [type, ...rest] = tr.dataset.key.split('::');
    const id = rest.join('::');
    if (btn.dataset.action === 'restore') return this.restoreRow(type, id);
    // Built on first use: a menu per row up front would be thousands of them.
    if (!btn.rowMenu) {
      btn.rowMenu = new RailMenu(btn, (el) =>
        buildRowMenu(this, el, { type, id, added: this.#rowState(type, id) === 'added' })
      );
      this.rowMenu = btn.rowMenu;
      btn.rowMenu.open();
    } else {
      this.rowMenu = btn.rowMenu;
    }
  }

  async showInGraph(type, id) {
    this.rowMenu?.close();
    await this.cache.gcm.focusElements([id], type === 'Node');
  }

  /** Stage a row for deletion (or forget a row that was only added here). */
  deleteRow(type, id) {
    this.rowMenu?.close();
    const key = rowKey(type, id);
    if (this.#elementFor(type, id)) {
      this.pendingChanges.set(key, { type, id, action: 'delete' });
      this.activeCell = { key, col: 'act' };
    } else {
      this.pendingChanges.delete(key);
    }
    this.loadTabData();
    this.notifyPendingChanges();
    this.focusActiveCell();
  }

  restoreRow(type, id) {
    const key = rowKey(type, id);
    if (this.pendingChanges.get(key)?.action === 'delete') this.pendingChanges.delete(key);
    this.activeCell = { key, col: 'act' };
    this.loadTabData();
    this.notifyPendingChanges();
    this.focusActiveCell();
  }

  handleDeleteRow(rowIndex) {
    const row = this.tableData[rowIndex];
    if (row) this.deleteRow(row[TYPE_COL], row[ID_COL]);
  }

  handleHeaderClick(columnIndex) {
    const currentSort = this.sortState[columnIndex];
    this.sortState = {};

    if (!currentSort) {
      this.sortState[columnIndex] = 'asc';
    } else if (currentSort === 'asc') {
      this.sortState[columnIndex] = 'desc';
    } else {
      this.sortState[columnIndex] = null;
    }

    this.loadTabData();
  }

  notifyPendingChanges() {
    this.#syncChangesBar();
    if (this.onPendingChangesCallback) {
      // The pending changes are the whole difference from the loaded data.
      this.onPendingChangesCallback({ hasPendingChanges: this.#changeCounts().total > 0 });
    }
  }

  onPendingChangesUpdated(callback) {
    this.onPendingChangesCallback = callback;
  }

  /** Each staged change as a line for the review list, with its own undo. */
  changeList() {
    const items = [];
    const reload = () => {
      this.loadTabData();
      this.notifyPendingChanges();
    };
    for (const [key, change] of this.pendingChanges) {
      const { type, id } = change;
      const noun = type.toLowerCase();
      if (change.action === 'delete') {
        const edges =
          type === 'Node'
            ? (this.fileData?.edges ?? []).filter((e) => e.source === id || e.target === id).length
            : 0;
        items.push({
          what: `${id} · deleted ${noun}`,
          detail: edges ? `and its ${plural(edges, 'Edge')}` : 'removed on Apply',
          undo: () => {
            this.pendingChanges.delete(key);
            reload();
          },
        });
        continue;
      }
      const element = this.#elementFor(type, id);
      if (!element) {
        const n = Object.entries(change.values).filter(
          ([header, v]) => !BASIC_HEADERS.has(header) && String(v).trim() !== ''
        ).length;
        items.push({
          what: `${id} · new ${noun}`,
          detail: n ? `${n} property value${n === 1 ? '' : 's'}` : 'needs a property value',
          undo: () => {
            this.pendingChanges.delete(key);
            reload();
          },
        });
        continue;
      }
      const loaded = this.#buildRow(type, id, element);
      for (const [header, after] of Object.entries(change.values)) {
        if (this.addedColumns.some((c) => c.header === header)) continue; // listed under its column
        const col = this.headerIndexMap.get(header);
        const name = header.split('::').at(-1);
        items.push({
          what: `${id} · ${name}`,
          before: String(col === undefined ? '' : (loaded[col] ?? '')),
          after: String(after),
          undo: () => {
            delete change.values[header];
            if (!Object.keys(change.values).length) this.pendingChanges.delete(key);
            reload();
          },
        });
      }
    }
    for (const column of this.addedColumns) {
      const filled = [...this.pendingChanges.values()].filter(
        (c) => c.action !== 'delete' && String(c.values[column.header] ?? '').trim() !== ''
      ).length;
      items.push({
        what: `${column.name} · new column`,
        detail: `${column.group}, ${column.isNode ? 'nodes' : 'edges'}${filled ? ` · ${filled} value${filled === 1 ? '' : 's'}` : ''}`,
        undo: () => {
          this.#undoColumn(column);
          reload();
        },
      });
    }
    return items;
  }

  async discard() {
    const { total } = this.#changeCounts();
    const noun = total === 1 ? 'change' : 'changes';
    const ok = await Popup.confirm(
      `Discard ${total} unsaved ${noun}? They have not been applied to the graph and cannot be brought back.`,
      `Discard ${noun}`
    );
    if (ok) this.reset();
  }

  /** Node IDs an edge can use now: loaded ones not staged for deletion, plus new ones. */
  nodeChoices() {
    const out = (this.fileData?.nodes ?? []).filter((n) => this.hasElement('Node', n.id)).map((n) => [n.id, n.label]);
    for (const change of this.pendingChanges.values()) {
      if (change.type === 'Node' && change.action !== 'delete' && !this.#elementFor('Node', change.id)) {
        out.push([change.id, change.values.Label]);
      }
    }
    return out;
  }

  /** Existing property groups, for the new-column form's suggestions. */
  propertyGroups() {
    const groups = [...(this.fileData?.nodeDataHeaders ?? []), ...(this.fileData?.edgeDataHeaders ?? [])].map(
      (h) => h.subGroup
    );
    return [...new Set(groups)];
  }

  /** @returns {Promise<{field: string, message: string}|null>} a problem to show, or null when added. */
  async addNode(rawId, label = '') {
    const id = String(rawId ?? '').trim();
    if (!id) return { field: 'id', message: 'Enter an ID for the node.' };
    if (id.includes('::')) return { field: 'id', message: 'A node ID cannot contain "::" (it joins edge ends).' };
    if (this.hasElement('Node', id)) return { field: 'id', message: `Node "${id}" already exists.` };
    await this.addRow('Node', id, label.trim() ? { Label: label.trim() } : {});
    return null;
  }

  /** @returns {Promise<{field: string, message: string}|null>} */
  async addEdge(rawSource, rawTarget) {
    const source = String(rawSource ?? '').trim();
    const target = String(rawTarget ?? '').trim();
    if (!source) return { field: 'source', message: 'Pick the node the edge starts at.' };
    if (!target) return { field: 'target', message: 'Pick the node the edge ends at.' };
    for (const [field, nodeId] of [['source', source], ['target', target]]) {
      if (nodeId.includes('::')) return { field, message: 'A node ID cannot contain "::".' };
      if (this.pendingChanges.get(rowKey('Node', nodeId))?.action === 'delete') {
        return { field, message: `Node "${nodeId}" is staged for deletion. Restore it first.` };
      }
      if (!this.hasElement('Node', nodeId)) return { field, message: `There is no node "${nodeId}". Add it first.` };
    }
    const id = `${source}::${target}`;
    if (this.hasElement('Edge', id)) return { field: 'target', message: `An edge from ${source} to ${target} already exists.` };
    await this.addRow('Edge', id);
    return null;
  }

  /** @returns {Promise<{field: string, message: string}|null>} */
  async addColumn({ name: rawName, group: rawGroup, isNode }) {
    const name = String(rawName ?? '').trim();
    const group = String(rawGroup ?? '').trim();
    if (!name) return { field: 'name', message: 'Enter a name for the column.' };
    if (!group) return { field: 'group', message: 'Enter a group, e.g. Metadata.' };
    if (name.includes('::') || group.includes('::')) {
      return { field: name.includes('::') ? 'name' : 'group', message: 'Names cannot contain "::".' };
    }
    const targetHeaders = isNode ? this.fileData.nodeDataHeaders : this.fileData.edgeDataHeaders;
    if (targetHeaders.some((h) => h.subGroup === group && h.key === name)) {
      return { field: 'name', message: `"${name}" already exists in ${group} for ${isNode ? 'nodes' : 'edges'}.` };
    }
    // Next to the group's other columns, so the grouped header stays one span.
    const lastGroupIdx = targetHeaders.findLastIndex((h) => h.subGroup === group);
    const newHeader = { subGroup: group, key: name };
    if (lastGroupIdx !== -1) targetHeaders.splice(lastGroupIdx + 1, 0, newHeader);
    else targetHeaders.push(newHeader);

    const type = isNode ? 'Node' : 'Edge';
    const header = `${isNode ? this.cache.CFG.EXCEL_NODE_HEADER : this.cache.CFG.EXCEL_EDGE_HEADER}::${group}::${name}`;
    // Staged like any other change, so Review and Discard can take it back.
    this.addedColumns.push({ isNode, group, name, header });
    this.notifyPendingChanges();
    if (!this.#tabTypes().includes(type)) await this.switchTab(SCOPE_TABS[this.scope][type]);
    else this.loadTabData();
    const first = this.tableData[this.#visibleRows()[0]];
    if (first) this.activeCell = { key: rowKey(first[TYPE_COL], first[ID_COL]), col: String(this.headerIndexMap.get(header)) };
    return null;
  }

  #removeColumnHeader({ isNode, group, name }) {
    const headers = isNode ? this.fileData.nodeDataHeaders : this.fileData.edgeDataHeaders;
    const at = headers.findIndex((h) => h.subGroup === group && h.key === name);
    if (at !== -1) headers.splice(at, 1);
  }

  /** Take back an added column and every staged value typed into it. */
  #undoColumn(column) {
    this.#removeColumnHeader(column);
    this.addedColumns = this.addedColumns.filter((c) => c !== column);
    for (const [key, change] of this.pendingChanges) {
      if (change.action === 'delete' || !Object.hasOwn(change.values, column.header)) continue;
      delete change.values[column.header];
      if (this.#elementFor(change.type, change.id) && !Object.keys(change.values).length) this.pendingChanges.delete(key);
    }
  }

  async addRow(type = 'Node', id = '', values = {}) {
    const key = rowKey(type, id);
    this.pendingChanges.set(key, { type, id, action: 'edit', values: { ...values } });
    this.notifyPendingChanges();
    // A filter or a view without this element type would hide the new row.
    this.filterText = '';
    if (this.filterInput) this.filterInput.value = '';
    if (this.#tabTypes().includes(type)) {
      this.loadTabData();
    } else {
      await this.switchTab(SCOPE_TABS[this.scope][type]);
    }
    // Land on the new row's first property cell, where a value is still owed.
    const firstProperty = this.headers.findIndex(
      (h, col) => col > FIRST_EDITABLE_COL + 1 && this.#isEditable(type, col)
    );
    this.activeCell = { key, col: String(firstProperty > 0 ? firstProperty : FIRST_EDITABLE_COL) };
  }

  /** True when `type`/`id` exists after the pending changes are applied. */
  hasElement(type, id) {
    const change = this.pendingChanges.get(rowKey(type, id));
    if (change) return change.action !== 'delete';
    return (type === 'Node' ? this.cache.nodeRef : this.cache.edgeRef).has(id);
  }

  /**
   * Record a cell's text as a pending edit. A value equal to the loaded one
   * withdraws the edit, so clicking into a cell and out again changes nothing.
   */
  trackChange(type, id, header, value) {
    const key = rowKey(type, id);
    const element = this.#elementFor(type, id);
    let loaded = '';
    if (element) {
      const loadedRow = this.#buildRow(type, id, element);
      loaded = String(loadedRow[this.headerIndexMap.get(header)] ?? '');
    }

    let change = this.pendingChanges.get(key);
    if (!change) {
      if (value === loaded) return;
      change = { type, id, action: 'edit', values: {} };
      this.pendingChanges.set(key, change);
    }

    if (value === loaded) {
      delete change.values[header];
    } else {
      change.values[header] = value;
    }
    // An added row stays pending even while empty; an edited one does not.
    if (element && Object.keys(change.values).length === 0) this.pendingChanges.delete(key);
  }

  async update() {
    // Checked before anything runs: a blocked Apply must not raise the loading
    // overlay or the "edges removed" notice for changes it then refuses.
    const problems = this.validateNewElements();
    if (problems.length > 0) {
      this.#focusFirstProblem();
      this.cache.ui.error(problems[0].replace(/^• /, '') + ' before Apply.');
      return;
    }
    await this.cache.ui.showLoading('Updating Data', 'Updating Data from Data Table ..');
    try {
      const updatedFileData = this.getUpdatedFileData();
      if (!updatedFileData || (!updatedFileData.nodes && !updatedFileData.edges)) {
        this.cache.ui.error('No data to update with.');
        return;
      }
      // Taken out before the rebuild (which repopulates the table) and put back
      // if it throws, so a failed Apply can be retried.
      const staged = { changes: new Map(this.pendingChanges), columns: [...this.addedColumns] };
      this.pendingChanges.clear();
      this.addedColumns = [];
      try {
        await this.rebuildGraph(updatedFileData);
      } catch (err) {
        // The rebuild may already have swapped in a new editor (cache.reset()).
        // ...but only if that one already has its pane; a throw before init()
        // leaves the old editor as the visible one.
        const current = this.cache.dataTable?.table?.isConnected ? this.cache.dataTable : this;
        current.pendingChanges = staged.changes;
        current.addedColumns = staged.columns;
        current.notifyPendingChanges();
        throw err;
      }
    } catch (err) {
      this.cache.ui.error(`Error updating graph: ${err}`);
    } finally {
      await this.cache.ui.hideLoading();
    }
  }

  /** Move to the first new row still owing a property value. */
  #focusFirstProblem() {
    for (const change of this.pendingChanges.values()) {
      if (change.action === 'delete' || this.#elementFor(change.type, change.id)) continue;
      const owes = !Object.entries(change.values).some(
        ([header, value]) => !BASIC_HEADERS.has(header) && String(value).trim() !== ''
      );
      if (!owes) continue;
      const col = this.headers.findIndex((h, c) => c > FIRST_EDITABLE_COL + 1 && this.#isEditable(change.type, c));
      if (col > 0) this.activeCell = { key: rowKey(change.type, change.id), col: String(col) };
      this.focusActiveCell();
      return;
    }
  }

  /**
   * Tear down the current graph and rebuild it from updatedFileData (which
   * must carry the preserved layouts/selectedLayout). Shared by the Apply
   * button and the Excel import merge.
   */
  async rebuildGraph(updatedFileData) {
    await this.cache.graph?.destroy();
    this.cache.graph = null;

    // The log is cleared by destroyGraphAndRollBackUI below.
    await this.cache.gcm.destroyGraphAndRollBackUI();
    this.cache.gcm.resetEventLocks();

    // Reset lasso button visual state to match default behavior (no lasso mode)
    const lassoBtn = document.getElementById('lassoToggleBtn');
    if (lassoBtn) {
      lassoBtn.classList.remove('active');
    }
    this.cache.io.preProcessData(updatedFileData);

    // Clear any saved query to prevent filtering issues with new columns
    const currentLayout = this.cache.data.layouts[this.cache.data.selectedLayout];
    if (currentLayout && currentLayout.query) {
      delete currentLayout.query;
      this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY = false;
    }

    this.cache.buildDataTable(updatedFileData);
    this.cache.ui.buildUI();

    await this.cache.gcm.createGraphInstance();
    if (!this.cache.graph) {
      this.cache.ui.error('Graph not initialized, aborting.');
      return;
    }
    await this.cache.graph.render();

    // Refresh UI to update node/edge counts and filter availability
    this.cache.ui.refreshUI();

  }

  /** Open a file picker and merge the chosen Excel file into the loaded graph. */
  importExcel() {
    if (!this.fileData) {
      this.cache.ui.error('Load a graph before importing.');
      return;
    }
    if (this.#changeCounts().total > 0) {
      this.cache.ui.error('Apply or discard the unsaved data editor changes before importing.');
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.ods';
    input.addEventListener('change', () => this.handleImportFile(input.files[0]));
    input.click();
  }

  async handleImportFile(file) {
    if (!file) return;

    let incoming = null;
    await this.cache.ui.showLoading('Import', `Reading ${file.name} ..`);
    try {
      const buffer = await file.arrayBuffer();
      incoming = await this.cache.io.parseExcelToJson(buffer, {
        merge: true,
        knownNodeIDs: new Set((this.fileData.nodes || []).map((n) => String(n.id))),
      });
    } catch (err) {
      this.cache.ui.error(`Error reading Excel file: ${err}`);
    } finally {
      await this.cache.ui.hideLoading();
    }
    if (!incoming) return;

    // Both plans up front: computeMergePlan is pure and cheap, so the modal
    // toggles between ready results without async machinery.
    const plans = {
      outer: computeMergePlan(this.fileData, incoming),
      left: computeMergePlan(this.fileData, incoming, { joinMode: 'left' }),
    };
    const plan = await showMergePreview(plans, file.name);
    if (!plan) {
      this.cache.ui.info('Import canceled');
      return;
    }

    await this.cache.ui.showLoading('Import', `Merging ${file.name} into the graph ..`);
    try {
      this.seedImportedPositions(plan);
      await this.rebuildGraph({
        ...plan.fileData,
        layouts: this.cache.data.layouts,
        selectedLayout: this.cache.data.selectedLayout,
      });
      const s = plan.stats;
      const ignored = s.ignoredNodes.length + s.ignoredEdges.length;
      this.cache.ui.success(
        `Imported "${file.name}": ${s.nodes.added.length} new / ${s.nodes.modified.length} updated nodes, ` +
          `${s.edges.added.length} new / ${s.edges.modified.length} updated edges.` +
          (ignored > 0 ? ` ${ignored} unmatched file row(s) ignored.` : '')
      );
    } catch (err) {
      this.cache.ui.error(`Error merging Excel file: ${err}`);
    } finally {
      await this.cache.ui.hideLoading();
    }
  }

  /**
   * Honour X/Y coordinates from the imported file for NEW nodes by seeding the
   * current workspace's positions map; existing node positions are never
   * touched. New nodes without coordinates fall back to the renderer's
   * deterministic placeholder ring.
   */
  seedImportedPositions(plan) {
    const positions = this.cache.data.layouts[this.cache.data.selectedLayout]?.positions;
    if (!positions) return;

    const addedIds = new Set(plan.stats.nodes.added);
    for (const node of plan.fileData.nodes) {
      const id = String(node.id);
      if (!addedIds.has(id) || positions.has(id)) continue;
      if (Number.isFinite(node.style?.x) && Number.isFinite(node.style?.y)) {
        positions.set(id, { style: { x: node.style.x, y: node.style.y } });
      }
    }
  }

  validateNewElements() {
    const errors = [];

    for (const change of this.pendingChanges.values()) {
      if (change.action === 'delete' || this.#elementFor(change.type, change.id)) continue;

      const hasProperty = Object.entries(change.values).some(
        ([header, value]) => !BASIC_HEADERS.has(header) && String(value).trim() !== ''
      );
      if (!hasProperty) {
        errors.push(`• ${change.type} "${change.id}" requires at least one property value`);
      }
    }

    return errors;
  }

  getUpdatedFileData() {
    const result = {
      nodes: [],
      edges: [],
      nodeDataHeaders: [...this.fileData.nodeDataHeaders],
      edgeDataHeaders: [...this.fileData.edgeDataHeaders],
      // Preserve existing layouts and selected layout to maintain per-view configurations
      layouts: this.cache.data.layouts,
      selectedLayout: this.cache.data.selectedLayout,
      // filterDefaults will be rebuilt by preProcessData() from the headers
    };

    const allowedKeys = new Set([
      'D4Data',
      'id',
      'label',
      'source',
      'style',
      'target',
      'description',
      'type',
    ]);

    // Edits are partial: only the cells the user changed, laid over the loaded
    // element, so editing under one tab never drops the columns another shows.
    const applyEdit = (change) => {
      const isNode = change.type === 'Node';
      const elem = isNode
        ? this.cache.nodeRef.get(change.id) || this.createNode(change.id)
        : this.cache.edgeRef.get(change.id) || this.createEdge(change.id);

      const cleanElem = {};
      for (const key of allowedKeys) {
        if (Object.prototype.hasOwnProperty.call(elem, key)) {
          cleanElem[key] = elem[key];
        }
      }
      cleanElem.D4Data = structuredClone(this.#elementFor(change.type, change.id)?.D4Data ?? {});

      for (const [header, value] of Object.entries(change.values)) {
        // An emptied Label or Description cell clears the field: the table
        // shows it empty, so Apply must not quietly keep the old text.
        if (header === 'Label') {
          if (value) {
            cleanElem.label = value;
          } else {
            delete cleanElem.label;
          }
          if (isNode) {
            cleanElem.style.label = Boolean(value);
            cleanElem.style.labelText = value;
          }
          continue;
        }
        if (header === 'Description') {
          if (value) cleanElem.description = value;
          else delete cleanElem.description;
          continue;
        }
        const [group, subGroup, prop] = StaticUtilities.decodePropHashId(header);
        // A header from a loaded file names object keys here; one spelled
        // like a prototype key would write onto Object.prototype.
        if ([group, subGroup, prop].some((key) => UNSAFE_OBJECT_KEYS.has(key))) continue;
        if (String(value).trim() === '') {
          delete cleanElem.D4Data[group]?.[subGroup]?.[prop];
          continue;
        }
        cleanElem.D4Data[group] ??= {};
        cleanElem.D4Data[group][subGroup] ??= {};
        cleanElem.D4Data[group][subGroup][prop] = isNaN(value) ? value : Number(value);
      }

      return cleanElem;
    };

    const changed = new Set();
    for (const [key, change] of this.pendingChanges) {
      changed.add(key);
      if (change.action === 'delete') continue;
      const elem = applyEdit(change);
      change.type === 'Node' ? result.nodes.push(elem) : result.edges.push(elem);
    }

    for (const node of this.fileData.nodes ?? []) {
      if (!changed.has(rowKey('Node', node.id))) result.nodes.push(structuredClone(node));
    }
    for (const edge of this.fileData.edges ?? []) {
      if (!changed.has(rowKey('Edge', edge.id))) result.edges.push(structuredClone(edge));
    }

    const nodeIds = new Set(result.nodes.map((n) => n.id));
    const dropped = result.edges.filter((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target));
    if (dropped.length > 0) {
      result.edges = result.edges.filter((edge) => !dropped.includes(edge));
      this.cache.ui.warning(
        `${dropped.length} edge${dropped.length === 1 ? '' : 's'} removed because a node ` +
          `${dropped.length === 1 ? 'it connects' : 'they connect'} was deleted.`
      );
    }

    return result;
  }

  createNode(id) {
    return {
      id: id,
      ...this.cache.style.getNodeStyleOrDefaults(id),
    };
  }

  createEdge(id) {
    const [source, target] = id.split('::');
    return {
      id: id,
      source: source,
      target: target,
      ...this.cache.style.getEdgeStyleOrDefaults(id),
    };
  }

  async exportToExcel() {
    const { total } = this.#changeCounts();
    if (total > 0) {
      const ok = await Popup.confirm(
        `Export the applied data? Your ${total} unsaved change${total === 1 ? ' is' : 's are'} not included until you apply ${total === 1 ? 'it' : 'them'}.`,
        'Export applied data'
      );
      if (!ok) return;
    }
    await this.cache.ui.showLoading('Data Editor', 'Exporting Table to Excel ..');

    try {
      const workbook = new ExcelJS.Workbook();

      let nodesToExport = [];
      let edgesToExport = [];

      switch (this.currentTab) {
        case 'selectedNodes':
          nodesToExport = this.getNodesFromTableData();
          break;
        case 'selectedEdges':
          edgesToExport = this.getEdgesFromTableData();
          break;
        case 'selectedElements':
          nodesToExport = this.getNodesFromTableData();
          edgesToExport = this.getEdgesFromTableData();
          break;
        case 'allNodes':
          nodesToExport = this.getNodesFromTableData();
          break;
        case 'allEdges':
          edgesToExport = this.getEdgesFromTableData();
          break;
        case 'entireGraph':
          nodesToExport = this.getNodesFromTableData();
          edgesToExport = this.getEdgesFromTableData();
          break;
      }

      const positions = this.cache.data.layouts[this.cache.data.selectedLayout]?.positions;

      const propIdToExcelHeader = (propId) => {
        const [, subGroup, key] = StaticUtilities.decodePropHashId(propId);
        return subGroup === this.cache.CFG.EXCEL_UNCATEGORIZED_SUBHEADER
          ? key
          : `${key} [${subGroup}]`;
      };

      // Use filterDefaults key order (group-contiguous) instead of Set iteration order
      const orderedNodeProps = [...this.cache.data.filterDefaults.keys()].filter((propId) =>
        this.cache.nodeExclusiveProps.has(propId)
      );
      const orderedEdgeProps = [...this.cache.data.filterDefaults.keys()].filter((propId) =>
        this.cache.edgeExclusiveProps.has(propId)
      );

      if (nodesToExport.length > 0) {
        const nodesSheet = workbook.addWorksheet('nodes');
        const nodesHeader = [
          ...EXCEL_NODE_PROPERTIES.map((p) => p.column),
          ...orderedNodeProps.map(propIdToExcelHeader),
        ];
        nodesSheet.addRow(nodesHeader);

        for (const node of nodesToExport) {
          const pos = positions?.get(node.id);
          const exportNode = pos
            ? { ...node, style: { ...node.style, x: pos.style.x, y: pos.style.y } }
            : node;
          const row = [];

          for (const prop of EXCEL_NODE_PROPERTIES) {
            const value = prop.get ? prop.get(exportNode) : '';
            row.push(value);
          }

          for (const customProp of orderedNodeProps) {
            const [group, subGroup, prop] = StaticUtilities.decodePropHashId(customProp);

            const value =
              node.D4Data && node.D4Data[group] && node.D4Data[group][subGroup]
                ? node.D4Data[group][subGroup][prop]
                : '';
            row.push(value);
          }

          nodesSheet.addRow(row);
        }
      }

      if (edgesToExport.length > 0) {
        const edgesSheet = workbook.addWorksheet('edges');
        const edgesHeader = [
          ...EXCEL_EDGE_PROPERTIES.map((p) => p.column),
          ...orderedEdgeProps.map(propIdToExcelHeader),
        ];
        edgesSheet.addRow(edgesHeader);

        for (const edge of edgesToExport) {
          const row = [];

          for (const prop of EXCEL_EDGE_PROPERTIES) {
            const value = prop.get ? prop.get(edge) : '';
            row.push(value);
          }

          for (const customProp of orderedEdgeProps) {
            const [group, subGroup, prop] = StaticUtilities.decodePropHashId(customProp);

            const value =
              edge.D4Data && edge.D4Data[group] && edge.D4Data[group][subGroup]
                ? edge.D4Data[group][subGroup][prop]
                : '';
            row.push(value);
          }

          edgesSheet.addRow(row);
        }
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const suffix = this.currentTab === 'entireGraph' ? '' : this.currentTab;
      link.download = this.cache.io.buildExportFilename('xlsx', suffix);

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      this.cache.ui.info('Excel file exported successfully!');
    } catch (error) {
      this.cache.ui.error('Failed to export Excel file: ' + error.message);
    } finally {
      await this.cache.ui.hideLoading();
    }
  }

  getNodesFromTableData() {
    const nodes = [];
    for (const row of this.tableData) {
      if (row[2] === 'Node') {
        const nodeId = row[3];
        const node = this.cache.nodeRef.get(nodeId);
        if (node) {
          nodes.push(node);
        }
      }
    }
    return nodes;
  }

  getEdgesFromTableData() {
    const edges = [];
    for (const row of this.tableData) {
      if (row[2] === 'Edge') {
        const edgeId = row[3];
        const edge = this.cache.edgeRef.get(edgeId);
        if (edge) {
          edges.push(edge);
        }
      }
    }
    return edges;
  }

  help() {
    this.cache.popup = new Popup(
      `<p>A spreadsheet of the graph's nodes and edges. Edits are collected and reach the graph together when you apply them.</p>

<h3>Choosing rows</h3>
<ul>
  <li><strong>Selection | All</strong> — only what is selected on the graph, or every row.</li>
  <li><strong>Nodes | Edges | Both</strong> — which element type to list.</li>
  <li><strong>Filter rows</strong> — keeps the rows where any cell contains the text.</li>
  <li>Click a column name to sort by it; click again to reverse, a third time to restore the order.</li>
</ul>

<h3>Editing</h3>
<ul>
  <li>Tab into the table once, then move with the arrow keys (Home/End, Ctrl+Home/End, Page Up/Down jump).</li>
  <li><strong>Enter</strong>, <strong>F2</strong>, typing, or a double-click edits a cell. Enter saves and moves down, Tab saves and moves right, <strong>Escape cancels</strong>.</li>
  <li>Edited cells turn amber (the old value is in the tooltip), new rows green, deleted rows red and struck through until you apply.</li>
  <li>Each row's <strong>⋯</strong> menu shows the element in the graph or deletes it; <strong>↺</strong> restores a deleted row.</li>
  <li><strong>+ Add</strong> creates a node, an edge (pick its source and target) or a property column. A new node or edge needs at least one property value.</li>
</ul>

<h3>Applying</h3>
<ul>
  <li>The bar at the bottom counts the unsaved changes. <strong>Review</strong> lists them, each with its own Undo; <strong>Discard</strong> drops them all; <strong>Apply</strong> rebuilds the graph with them.</li>
  <li>Data is shared by every workspace: an applied change shows in all of them. Positions, filters, styles and queries stay per workspace.</li>
  <li>Deleting a node also removes its edges when you apply.</li>
</ul>

<h3>Files</h3>
<ul>
  <li><strong>⤒ Import</strong> merges an Excel file into the graph, with a preview of what changes first.</li>
  <li><strong>⤓ Export</strong> saves the rows shown here, with their styling, as Excel.</li>
</ul>
`,
      { title: 'Data Editor', width: '50vw', height: '60vh', lineHeight: '1.5em' }
    );
  }
}

function buildDataTable(fileData) {
  this.dataTable.populateFromFileData(fileData);
}
export { DataTable, buildDataTable };
