/* global ExcelJS */ // loaded as a global via vendored src/lib/exceljs.min.js script tag
import { Popup } from './popup.js';
import { StaticUtilities } from './static.js';
import { EXCEL_NODE_PROPERTIES, EXCEL_EDGE_PROPERTIES } from '../managers/io.js';
import { computeMergePlan, showMergePreview } from './excel_merge.js';
import { UNSAFE_OBJECT_KEYS } from '../config.js';


/** Columns every row has; the rest are property columns. */
const BASIC_HEADERS = new Set(['Del', 'Row #', 'Type', 'ID', 'Label', 'Description']);

/** Pending-change key: node and edge IDs live in separate namespaces. */
const rowKey = (type, id) => `${type}::${id}`;

class DataTable {
  #elementIndex = new Map();
  #indexedFileData = null;

  constructor(cache, containerId = 'dataTableContainer') {
    this.containerId = containerId;
    this.tableData = [];
    this.headers = [];
    this.currentEditingCell = null;
    this.onChangeCallback = null;
    this.sortState = {};
    this.headerIndexMap = new Map();
    this.currentTab = 'selectedNodes';
    this.fileData = null;
    // rowKey → { type, id, action: 'edit', values: { header: text } }
    //        | { type, id, action: 'delete' }
    this.pendingChanges = new Map();
    this.onPendingChangesCallback = null;

    this.cache = cache;

    // this.init();
  }

  init() {
    const container = document.getElementById(this.containerId);
    if (!container) {
      this.cache.ui.error(`Container with ID '${this.containerId}' not found`);
      return;
    }

    container.innerHTML = `
      <div class="data-table-warning-banner">
        <span><strong>⚠️</strong> Data modifications affect all workspaces globally</span>
        <button class="data-table-warning-close" title="Dismiss warning">×</button>
      </div>
      <div class="data-table-tabs">
        <button class="data-table-tab active" data-tab="selectedNodes">Selected Nodes</button>
        <button class="data-table-tab" data-tab="selectedEdges">Selected Edges</button>
        <button class="data-table-tab" data-tab="selectedElements">Selected Elements</button>
        <button class="data-table-tab" data-tab="allNodes">All Nodes</button>
        <button class="data-table-tab" data-tab="allEdges">All Edges</button>
        <button class="data-table-tab" data-tab="entireGraph">Entire Graph</button>
      </div>
      <div class="data-table-wrapper">
        <table id="dataTable" class="data-table">
          <thead id="dataTableHead"></thead>
          <tbody id="dataTableBody"></tbody>
        </table>
      </div>
    `;

    this.tabsContainer = container.querySelector('.data-table-tabs');
    this.table = container.querySelector('#dataTable');
    this.tableHead = container.querySelector('#dataTableHead');
    this.tableBody = container.querySelector('#dataTableBody');
    this.warningBanner = container.querySelector('.data-table-warning-banner');

    this.tabsContainer.addEventListener('click', this.handleTabClick.bind(this));
    this.tableBody.addEventListener('click', this.handleTableClick.bind(this));
    this.tableBody.addEventListener('focus', this.handleTableFocus.bind(this), true);
    this.tableBody.addEventListener('blur', this.handleTableBlur.bind(this), true);
    this.tableBody.addEventListener('keydown', this.handleTableKeydown.bind(this));
    this.tableBody.addEventListener('input', this.handleTableInput.bind(this));
    this.tableHead.addEventListener('click', this.handleHeaderTableClick.bind(this));

    // Handle warning banner dismissal
    const closeBtn = container.querySelector('.data-table-warning-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        if (this.warningBanner) {
          this.warningBanner.style.display = 'none';
          localStorage.setItem('dataEditorWarningDismissed', 'true');
        }
      });
    }

    // Check if warning was previously dismissed
    if (localStorage.getItem('dataEditorWarningDismissed') === 'true') {
      this.warningBanner.style.display = 'none';
    }
  }

  async handleTabClick(event) {
    if (event.target.classList.contains('data-table-tab')) {
      const tab = event.target.dataset.tab;
      await this.switchTab(tab);
    }
  }

  async switchTab(tab) {
    await this.cache.ui.showLoading('Data Editor', `Loading ${tab} this.cache.data...`);

    this.currentTab = tab;

    this.tabsContainer.querySelectorAll('.data-table-tab').forEach((btn) => {
      btn.classList.remove('active');
      if (btn.dataset.tab === tab) {
        btn.classList.add('active');
      }
    });

    this.sortState = {};
    this.loadTabData();

    await this.cache.ui.hideLoading();
  }

  loadTabData() {
    if (!this.fileData) {
      this.cache.ui.error('No fileData available');
      return;
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
  // copy of each edited row.
  #overlayPendingChanges() {
    const types = this.#tabTypes();
    const rowIndexByKey = new Map(this.tableData.map((row, i) => [rowKey(row[2], row[3]), i]));
    const deleted = new Set();

    for (const [key, change] of this.pendingChanges) {
      if (!types.includes(change.type)) continue;
      const index = rowIndexByKey.get(key);
      if (change.action === 'delete') {
        if (index !== undefined) deleted.add(index);
        continue;
      }
      // Edited or added rows stay listed even once deselected, so an unapplied
      // edit is never out of sight.
      let row = this.tableData[index];
      if (!row) {
        row = this.#buildRow(change.type, change.id, this.#elementFor(change.type, change.id));
        this.tableData.push(row);
      }
      for (const [header, value] of Object.entries(change.values)) {
        const col = this.headerIndexMap.get(header);
        if (col !== undefined) row[col] = value;
      }
    }

    if (deleted.size) this.tableData = this.tableData.filter((_, i) => !deleted.has(i));
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

  handleTableClick(event) {
    if (event.target.classList.contains('data-table-delete-row-btn')) {
      const rowIndex = parseInt(event.target.closest('td').dataset.row);
      this.handleDeleteRow(rowIndex);
    }
  }

  async handleHeaderTableClick(event) {
    await this.cache.ui.showLoading('Data Editor', 'Sorting ..');
    const headerDiv = event.target.closest('.data-table-sortable-header');
    if (headerDiv) {
      const columnIndex = parseInt(headerDiv.dataset.column);
      this.handleHeaderClick(columnIndex);
    }
    await this.cache.ui.hideLoading();
  }

  handleTableFocus(event) {
    if (event.target.contentEditable === 'true') {
      const rowIndex = parseInt(event.target.dataset.row);
      const colIndex = parseInt(event.target.dataset.col);
      this.handleCellFocus(event, rowIndex, colIndex);
    }
  }

  handleTableBlur(event) {
    if (event.target.contentEditable === 'true') {
      const rowIndex = parseInt(event.target.dataset.row);
      const colIndex = parseInt(event.target.dataset.col);
      this.handleCellBlur(event, rowIndex, colIndex);
    }
  }

  handleTableKeydown(event) {
    if (event.target.contentEditable === 'true') {
      const rowIndex = parseInt(event.target.dataset.row);
      const colIndex = parseInt(event.target.dataset.col);
      this.handleCellKeydown(event, rowIndex, colIndex);
    }
  }

  handleTableInput(event) {
    if (event.target.contentEditable === 'true') {
      const rowIndex = parseInt(event.target.dataset.row);
      const colIndex = parseInt(event.target.dataset.col);
      this.handleCellInput(event, rowIndex, colIndex);
    }
  }

  populateFromFileData(fileData) {
    if (!fileData) {
      this.cache.ui.error('No fileData provided');
      return;
    }

    this.fileData = structuredClone(fileData);
    this.loadTabData();
  }

  async refreshCurrentTab() {
    this.loadTabData();
  }

  reset() {
    this.sortState = {};
    this.pendingChanges.clear();
    this.notifyPendingChanges();
    this.loadTabData();
  }

  /** @returns {string} HTML — imported header text is escaped, the markup is ours. */
  formatHeaderForDisplay(header) {
    // Check if header contains the property structure (e.g., "Node filters::GROUP::PROPERTY")
    if (!header.includes('::')) {
      return StaticUtilities.escapeHtml(header);
    }

    const parts = header.split('::');
    if (parts.length !== 3) {
      return StaticUtilities.escapeHtml(header);
    }

    const [, group, property] = parts;

    // Determine scaling class based on property text length
    // Longer text gets smaller font (size-xs = 9px smallest)
    const len = property.length;
    let sizeClass = 'data-table-header-property';
    if (len > 20) {
      sizeClass += ' size-xs'; // 9px - smallest for longest text
    } else if (len > 18) {
      sizeClass += ' size-s'; // 10px
    } else if (len > 16) {
      sizeClass += ' size-m'; // 11px
    } else if (len > 14) {
      sizeClass += ' size-l'; // 12px
    }
    // ≤15 chars uses default 12px

    // Strip "Node filters" or "Edge filters" prefix since Type column already indicates this
    // Display group as a styled badge and property as main text with dynamic scaling
    // Always break into two lines: badge on first line, property on second line
    return `<span class="data-table-header-group-badge">${StaticUtilities.escapeHtml(group)}</span><br><span class="${sizeClass}">${StaticUtilities.escapeHtml(property)}</span>`;
  }

  render() {
    if (!this.tableHead || !this.tableBody) {
      this.cache.ui.error('Table elements not found');
      return;
    }

    const headerFragment = document.createDocumentFragment();
    const bodyFragment = document.createDocumentFragment();

    if (this.tableData.length === 0) {
      this.tableHead.innerHTML = '';
      this.tableBody.innerHTML = '<tr><td colspan="100%">No data available</td></tr>';
      this.updateExportButtonState();
      return;
    }

    const headerRow = document.createElement('tr');
    this.headers.forEach((header, index) => {
      const th = document.createElement('th');

      if (index === 0) {
        th.classList.add('data-table-delete-row-column');
      } else {
        const formattedHeader = this.formatHeaderForDisplay(header);
        th.innerHTML = `
        <div class="data-table-sortable-header" data-column="${index}">
          <span class="data-table-header-text">${formattedHeader}</span>
          <span class="data-table-sort-indicator">${this.getSortIndicator(index)}</span>
        </div>
      `;
      }

      headerRow.appendChild(th);
    });
    headerFragment.appendChild(headerRow);

    this.tableData.forEach((rowData, rowIndex) => {
      const tr = document.createElement('tr');
      const isNodeRow = rowData[2] === 'Node';

      rowData.forEach((cellData, colIndex) => {
        const td = document.createElement('td');
        td.dataset.row = rowIndex;
        td.dataset.col = colIndex;

        if (colIndex === 0) {
          const deleteBtn = document.createElement('button');
          deleteBtn.className = 'data-table-delete-row-btn';
          deleteBtn.title = `Delete row ${rowIndex + 1} (${rowData[2]} ${rowData[3]})`;
          deleteBtn.textContent = '×';
          td.appendChild(deleteBtn);
          td.classList.add('data-table-delete-row-column');
        } else {
          // Explicitly check for null/undefined to preserve 0 values
          td.textContent = cellData !== null && cellData !== undefined ? cellData : '';

          const isBasicColumn = colIndex <= 3;
          const isReservedColumn = colIndex === 4 || colIndex === 5;
          const isMismatchedColumn =
            (isNodeRow && this.headers[colIndex].startsWith(this.cache.CFG.EXCEL_EDGE_HEADER)) ||
            (!isNodeRow && this.headers[colIndex].startsWith(this.cache.CFG.EXCEL_NODE_HEADER));
          const shouldBeEditable = (!isBasicColumn || isReservedColumn) && !isMismatchedColumn;

          if (shouldBeEditable) {
            td.contentEditable = true;
          } else {
            td.classList.add('readonly');
          }
        }

        tr.appendChild(td);
      });

      bodyFragment.appendChild(tr);
    });

    this.tableHead.innerHTML = '';
    this.tableBody.innerHTML = '';
    this.tableHead.appendChild(headerFragment);
    this.tableBody.appendChild(bodyFragment);

    this.updateExportButtonState();
  }

  updateExportButtonState() {
    const exportBtn = document.getElementById('exportDataTableBtn');
    if (exportBtn) {
      if (this.tableData.length === 0) {
        exportBtn.classList.add('disabled');
        exportBtn.disabled = true;
      } else {
        exportBtn.classList.remove('disabled');
        exportBtn.disabled = false;
      }
    }
  }

  handleDeleteRow(rowIndex) {
    if (rowIndex >= 0 && rowIndex < this.tableData.length) {
      const [, , type, id] = this.tableData[rowIndex];
      const key = rowKey(type, id);

      // Deleting a row that was only added here just forgets the addition.
      if (this.#elementFor(type, id)) {
        this.pendingChanges.set(key, { type, id, action: 'delete' });
      } else {
        this.pendingChanges.delete(key);
      }

      this.loadTabData();

      if (this.onChangeCallback) {
        this.onChangeCallback(-1, -1, 'row_deleted');
      }

      this.notifyPendingChanges();
    }
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

  getSortIndicator(columnIndex) {
    const sortState = this.sortState[columnIndex];
    if (sortState === 'asc') return '▲';
    if (sortState === 'desc') return '▼';
    return '⇅';
  }

  handleCellFocus(event, rowIndex, colIndex) {
    const cell = event.target;
    this.currentEditingCell = { cell, rowIndex, colIndex };
    cell.classList.add('editing');

    const range = document.createRange();
    range.selectNodeContents(cell);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  handleCellBlur(event, rowIndex, colIndex) {
    const cell = event.target;
    cell.classList.remove('editing');
    const row = this.tableData[rowIndex];
    row[colIndex] = cell.textContent;
    this.trackChange(row[2], row[3], this.headers[colIndex], cell.textContent);

    if (this.onChangeCallback) {
      this.onChangeCallback(rowIndex, colIndex, cell.textContent);
    }

    this.notifyPendingChanges();
    this.currentEditingCell = null;
  }

  notifyPendingChanges() {
    if (this.onPendingChangesCallback) {
      // The pending changes are the whole difference from the loaded data.
      const hasPendingChanges = this.pendingChanges.size > 0;
      this.onPendingChangesCallback({
        hasPendingChanges,
        hasChangesFromOriginal: hasPendingChanges,
      });
    }
  }

  onPendingChangesUpdated(callback) {
    this.onPendingChangesCallback = callback;
  }

  handleCellKeydown(event, rowIndex, colIndex) {
    switch (event.key) {
      case 'Enter':
        event.preventDefault();
        this.moveToCell(rowIndex + 1, colIndex);
        break;
      case 'Tab':
        event.preventDefault();
        if (event.shiftKey) {
          this.moveToCell(rowIndex, colIndex - 1);
        } else {
          this.moveToCell(rowIndex, colIndex + 1);
        }
        break;
      case 'Escape':
        event.target.blur();
        break;
    }
  }

  handleCellInput(event, rowIndex, colIndex) {
    this.tableData[rowIndex][colIndex] = event.target.textContent;
  }

  moveToCell(rowIndex, colIndex) {
    if (colIndex >= this.headers.length) {
      colIndex = 2;
      rowIndex++;
    } else if (colIndex < 2) {
      colIndex = this.headers.length - 1;
      rowIndex--;
    }

    if (rowIndex < 0 || rowIndex >= this.tableData.length) {
      return;
    }

    const targetCell = this.tableBody.querySelector(
      `td[data-row="${rowIndex}"][data-col="${colIndex}"]`
    );
    if (targetCell && targetCell.contentEditable === 'true') {
      targetCell.focus();
    }
  }

  onChange(callback) {
    this.onChangeCallback = callback;
  }

  getData() {
    return {
      headers: [...this.headers],
      data: this.tableData.map((row) => [...row]),
    };
  }

  async addNode() {
    if (!this.cache || !this.tableData) return;

    let nodeID = await Popup.prompt('Enter Node ID: ');
    if (!nodeID) {
      this.cache.ui.info('Adding node canceled');
      return;
    }

    nodeID = nodeID.trim();
    if (!nodeID) {
      this.cache.ui.error('Node ID cannot be empty');
      return;
    }

    if (this.hasElement('Node', nodeID)) {
      this.cache.ui.error(`Node "${nodeID}" already exists`);
      return;
    }

    await this.addRow('Node', nodeID);
    this.cache.ui.success(`Node "${nodeID}" added. Click Apply to save changes.`);
  }

  async addEdge() {
    if (!this.cache || !this.tableData) return;

    let edgeID = await Popup.prompt('Enter Edge ID (format: sourceID::targetID): ');
    if (!edgeID) {
      this.cache.ui.info('Adding edge canceled');
      return;
    }

    edgeID = edgeID.trim();
    if (!edgeID) {
      this.cache.ui.error('Edge ID cannot be empty');
      return;
    }

    if (this.hasElement('Edge', edgeID)) {
      this.cache.ui.error(`Edge "${edgeID}" already exists`);
      return;
    }

    if (!edgeID.includes('::')) {
      this.cache.ui.error(
        `Edge ID must contain a double colon (::) to separate source and target nodes (e.g., "NodeA::NodeB")`
      );
      return;
    }

    const parts = edgeID.split('::');
    if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
      this.cache.ui.error(`Invalid Edge ID format. Use: "sourceID::targetID"`);
      return;
    }

    const [source, target] = parts.map((p) => p.trim());

    const sourceExists = this.hasElement('Node', source);
    const targetExists = this.hasElement('Node', target);

    if (!sourceExists) {
      this.cache.ui.error(`Source node "${source}" does not exist. Please create the node first.`);
      return;
    }

    if (!targetExists) {
      this.cache.ui.error(`Target node "${target}" does not exist. Please create the node first.`);
      return;
    }

    await this.addRow('Edge', edgeID);
    this.cache.ui.success(`Edge "${edgeID}" added. Click Apply to save changes.`);
  }

  async addColumn() {
    if (!this.cache || !this.tableData) return;

    // Create a custom form popup
    const formHtml = `
      <div style="display: flex; flex-direction: column; gap: 15px; margin: 10px 0;">
        <div>
          <label style="display: block; margin-bottom: 5px; font-weight: bold;">Property Type:</label>
          <div style="display: flex; gap: 20px;">
            <label style="cursor: pointer;">
              <input type="radio" name="propertyType" value="node" checked style="margin-right: 5px;">
              Node Property
            </label>
            <label style="cursor: pointer;">
              <input type="radio" name="propertyType" value="edge" style="margin-right: 5px;">
              Edge Property
            </label>
          </div>
        </div>

        <div>
          <label style="display: block; margin-bottom: 5px; font-weight: bold;">Property Name:</label>
          <input type="text" id="propertyNameInput" placeholder="e.g., Temperature, Weight"
                 style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
        </div>

        <div>
          <label style="display: block; margin-bottom: 5px; font-weight: bold;">Group Name:</label>
          <input type="text" id="groupNameInput" placeholder="e.g., Physics, Metadata"
                 style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
        </div>
      </div>

      <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
        <button onclick="window.addColumnCancel()" class="pink">Cancel</button>
        <button onclick="window.addColumnConfirm()" class="blue">Add Column</button>
      </div>
    `;

    return new Promise((resolve) => {
      this.cache.popup = new Popup(formHtml, {
        title: 'Add Property Column',
        showFullscreenButton: false,
      });

      // Store resolve function globally for button handlers
      window.addColumnConfirm = () => {
        const propertyTypeInput = document.querySelector('input[name="propertyType"]:checked');
        const propertyNameInput = document.getElementById('propertyNameInput');
        const groupNameInput = document.getElementById('groupNameInput');

        if (!propertyTypeInput || !propertyNameInput || !groupNameInput) {
          this.cache.popup.close();
          resolve(null);
          return;
        }

        const result = {
          isNodeProperty: propertyTypeInput.value === 'node',
          propertyName: propertyNameInput.value.trim(),
          groupName: groupNameInput.value.trim(),
        };

        this.cache.popup.close();
        resolve(result);
      };

      window.addColumnCancel = () => {
        this.cache.popup.close();
        resolve(null);
      };
    }).then((result) => {
      // Clean up global handlers
      delete window.addColumnConfirm;
      delete window.addColumnCancel;

      if (!result) {
        this.cache.ui.info('Adding column canceled');
        return;
      }

      const { isNodeProperty, propertyName, groupName } = result;

      if (!propertyName) {
        this.cache.ui.error('Property name cannot be empty');
        return;
      }

      if (!groupName) {
        this.cache.ui.error('Group name cannot be empty');
        return;
      }

      // Check if column already exists in the appropriate headers list
      const exists = (
        isNodeProperty ? this.fileData.nodeDataHeaders : this.fileData.edgeDataHeaders
      ).some((h) => h.subGroup === groupName && h.key === propertyName);

      if (exists) {
        this.cache.ui.error(
          `Column "${propertyName}" in group "${groupName}" already exists for ${isNodeProperty ? 'nodes' : 'edges'}`
        );
        return;
      }

      // Add to appropriate data headers list, inserting next to existing group members
      const targetHeaders = isNodeProperty
        ? this.fileData.nodeDataHeaders
        : this.fileData.edgeDataHeaders;
      const lastGroupIdx = targetHeaders.findLastIndex((h) => h.subGroup === groupName);
      const newHeader = { subGroup: groupName, key: propertyName };
      if (lastGroupIdx !== -1) {
        targetHeaders.splice(lastGroupIdx + 1, 0, newHeader);
      } else {
        targetHeaders.push(newHeader);
      }

      // Reload tab data to rebuild headers with proper filtering
      this.loadTabData();

      this.cache.ui.success(
        `Column "${propertyName}" (${groupName}) added for ${isNodeProperty ? 'nodes' : 'edges'}. Click Apply to save changes.`
      );
    });
  }

  async addRow(type = 'Node', id = '') {
    this.pendingChanges.set(rowKey(type, id), { type, id, action: 'edit', values: {} });
    this.notifyPendingChanges();
    // A tab that does not list this element type would hide the new row.
    if (this.#tabTypes().includes(type)) {
      this.loadTabData();
    } else {
      await this.switchTab('selectedElements');
    }
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

  clear() {
    this.tableData = [];
    this.headers = [];
    this.sortState = {};
    this.headerIndexMap.clear();
    this.render();
  }

  async update() {
    await this.cache.ui.showLoading('Updating Data', 'Updating Data from Data Table ..');
    try {
      const updatedFileData = this.getUpdatedFileData();

      if (!updatedFileData || (!updatedFileData.nodes && !updatedFileData.edges)) {
        this.cache.ui.error('No data to update with.');
        return;
      }

      const validationErrors = this.validateNewElements();
      if (validationErrors.length > 0) {
        await this.cache.ui.hideLoading();
        this.cache.ui.error(
          'Cannot apply changes:\n' +
            validationErrors.join('\n') +
            '\nPlease add at least one property to each new element.'
        );
        return;
      }

      this.pendingChanges.clear();

      await this.rebuildGraph(updatedFileData);

    } catch (err) {
      this.cache.ui.error(`Error updating graph: ${err}`);
    } finally {
      await this.cache.ui.hideLoading();
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

    // Reload data table with updated fileData to ensure headers are in sync
    this.fileData = updatedFileData;
    this.loadTabData();
  }

  /** Open a file picker and merge the chosen Excel file into the loaded graph. */
  importExcel() {
    if (!this.fileData) {
      this.cache.ui.error('Load a graph before importing.');
      return;
    }
    if (this.pendingChanges.size > 0) {
      this.cache.ui.error('Apply or reset the pending data editor changes before importing.');
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
        if (header === 'Label') {
          if (value) {
            cleanElem.label = value;
            if (isNode) {
              cleanElem.style.label = true;
              cleanElem.style.labelText = value;
            }
          }
          continue;
        }
        if (header === 'Description') {
          if (value) cleanElem.description = value;
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
    result.edges = result.edges.filter((edge) => {
      if (!nodeIds.has(edge.source)) {
        console.warn(`Edge ${edge.id} references non-existent source node: ${edge.source}`);
        return false;
      }
      if (!nodeIds.has(edge.target)) {
        console.warn(`Edge ${edge.id} references non-existent target node: ${edge.target}`);
        return false;
      }
      return true;
    });

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
      `<p>Explore and directly modify graph data through an interactive spreadsheet interface.</p>

<div class="alert-warning">
  <strong>⚠️ Important:</strong> Data modifications affect ALL views globally. Changing node/edge properties here will update them across all view presets. Only view-specific settings (positions, filters, styles, queries) are preserved per view.
</div>

<div class="alert-info">
  <strong>💡 Tip:</strong> All changes are staged until you click <span class="tooltip-dummy-buttons blue">✔ Apply</span>
</div>

<h3>Available Actions</h3>
<p><strong>Header buttons:</strong></p>
<ul>
  <li><span class="tooltip-dummy-buttons blue">✔ Apply</span> — Apply the changes to the graph</li>
  <li><span class="tooltip-dummy-buttons pink">⟳ Reset</span> — Discard all changes and restore original data</li>
  <li><span class="tooltip-dummy-buttons blue"><strong>+</strong>&nbsp;Node</span> — Create a new node in the graph</li>
  <li><span class="tooltip-dummy-buttons blue"><strong>+</strong>&nbsp;Edge</span> — Create a new edge between existing nodes</li>
  <li><span class="tooltip-dummy-buttons blue"><strong>+</strong>&nbsp;Column</span> — Add a new property column to the table</li>
  <li><span class="tooltip-dummy-buttons green">⤒ Import</span> — Merge an Excel file into the loaded graph: extend existing nodes/edges with new columns or values, and either add new ones too ("Extend &amp; add") or ignore unmatched file rows ("Extend existing only") — a preview shows what changes before anything is applied</li>
  <li><span class="tooltip-dummy-buttons green">⤓ Export</span> — Save current view as an Excel file</li>
</ul>

<h3>Working with the Editor</h3>
<ul>
  <li><strong>Sort columns:</strong> Click column headers to sort ascending/descending or restore original order</li>
  <li><strong>Edit cells:</strong> Click on editable cells to modify values (navigate with Tab/Shift+Tab/Enter/Escape)</li>
  <li><strong>Delete rows:</strong> Click the <span class="data-table-delete-row-btn tt">×</span> button to remove nodes or edges</li>
  <li><strong>Add elements:</strong>
    <ul>
      <li>New nodes/edges must have at least one property value before applying</li>
      <li>Edge IDs must use the format: <code>sourceNode::targetNode</code></li>
      <li>Both source and target nodes must exist before creating an edge</li>
    </ul>
  </li>
  <li><strong>Tabs:</strong> Switch between different views (selected elements vs. all existing data)</li>
</ul>
`,
      { title: 'Data Editor', width: '50vw', height: '60vh', lineHeight: '1.5em' }
    );
  }
}

function buildDataTable(fileData) {
  this.dataTable.onPendingChangesUpdated(({ hasPendingChanges, hasChangesFromOriginal }) => {
    const applyBtn = document.getElementById('updateDataTableBtn');
    const resetBtn = document.getElementById('resetDataTableBtn');

    if (applyBtn) {
      applyBtn.disabled = !hasPendingChanges;
    }

    if (resetBtn) {
      resetBtn.disabled = !hasChangesFromOriginal;
    }
  });
  this.dataTable.populateFromFileData(fileData);

  const applyBtn = document.getElementById('updateDataTableBtn');
  const resetBtn = document.getElementById('resetDataTableBtn');
  if (applyBtn) applyBtn.disabled = true;
  if (resetBtn) resetBtn.disabled = true;
}
export { DataTable, buildDataTable };
