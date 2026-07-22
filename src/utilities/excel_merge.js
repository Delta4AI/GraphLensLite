import { CFG } from '../config.js';
import { Popup } from './popup.js';

// Cap the id lists rendered in the preview modal; full counts are always shown.
const MAX_PREVIEW_IDS = 50;

// Join modes offered in the import preview. 'outer' upserts (default);
// 'left' only enriches matched rows and ignores unmatched file rows.
const JOIN_MODES = [
  {
    value: 'outer',
    label: 'Extend & add (full outer join)',
    description: 'Update matching nodes/edges and add new ones from the file.',
  },
  {
    value: 'left',
    label: 'Extend existing only (left join)',
    description: 'Update matching nodes/edges; rows in the file without a match in the graph are ignored.',
  },
];

function headerLabel(header) {
  return header.subGroup === CFG.EXCEL_UNCATEGORIZED_SUBHEADER
    ? header.key
    : `${header.key} [${header.subGroup}]`;
}

// Serialized view of the fields a merge can touch — used to detect whether an
// incoming row effectively changes an existing element.
function snapshot(element) {
  return JSON.stringify({
    label: element.label,
    description: element.description,
    type: element.type,
    style: element.style || {},
    D4Data: element.D4Data || {},
  });
}

/** Deep-merge incoming user data (group → subGroup → prop) into a clone. */
function mergeD4Data(existing, incoming) {
  const merged = structuredClone(existing || {});
  for (const [group, subGroups] of Object.entries(incoming || {})) {
    for (const [subGroup, props] of Object.entries(subGroups || {})) {
      if (Object.keys(props).length === 0) continue;
      if (!merged[group]) merged[group] = {};
      merged[group][subGroup] = { ...merged[group][subGroup], ...props };
    }
  }
  return merged;
}

// Overlay an incoming (freshly parsed) element onto a clone of the existing
// one. Incoming style/D4Data only carry values that were actually present in
// the file, so spreading them never resets unrelated properties to defaults.
function mergeElement(existing, incoming) {
  const merged = structuredClone(existing);
  if (incoming.label !== undefined) merged.label = incoming.label;
  if (incoming.description !== undefined) merged.description = incoming.description;
  if (incoming.type !== undefined) merged.type = incoming.type;
  merged.style = { ...(existing.style || {}), ...structuredClone(incoming.style || {}) };
  merged.D4Data = mergeD4Data(existing.D4Data, incoming.D4Data);
  return merged;
}

function mergeHeaders(currentHeaders, incomingHeaders) {
  const headers = currentHeaders.map((h) => ({ ...h }));
  const added = [];
  for (const header of incomingHeaders || []) {
    const exists = headers.some((c) => c.subGroup === header.subGroup && c.key === header.key);
    if (exists) continue;
    const entry = { subGroup: header.subGroup, key: header.key };
    // Insert next to existing group members to keep groups contiguous
    const lastGroupIdx = headers.findLastIndex((c) => c.subGroup === header.subGroup);
    if (lastGroupIdx !== -1) {
      headers.splice(lastGroupIdx + 1, 0, entry);
    } else {
      headers.push(entry);
    }
    added.push(headerLabel(entry));
  }
  return { headers, added };
}

// Ids are matched as strings: Excel numeric cells parse to numbers while ids
// that round-tripped through JSON or graphology are strings.
function mergeElements(currentList, incomingList) {
  const indexById = new Map(currentList.map((el, idx) => [String(el.id), idx]));
  const merged = currentList.map((el) => structuredClone(el));
  const added = [];
  const modified = [];
  let matchedUnchanged = 0;

  for (const incoming of incomingList || []) {
    const id = String(incoming.id);
    const idx = indexById.get(id);
    if (idx === undefined) {
      indexById.set(id, merged.length);
      merged.push(structuredClone(incoming));
      added.push(id);
    } else {
      const mergedElement = mergeElement(merged[idx], incoming);
      if (snapshot(merged[idx]) !== snapshot(mergedElement)) {
        merged[idx] = mergedElement;
        if (!modified.includes(id)) modified.push(id);
      } else {
        matchedUnchanged++;
      }
    }
  }

  return { merged, added, modified, matchedUnchanged };
}

/**
 * Compute a merge of freshly parsed Excel data into the currently loaded
 * graph data. Pure: neither input is mutated.
 *
 * @param {Object} current - { nodes, edges, nodeDataHeaders, edgeDataHeaders }
 * @param {Object} incoming - parseExcelToJson result (merge mode)
 * @param {Object} [options]
 * @param {'outer'|'left'} [options.joinMode='outer'] - 'outer' upserts;
 *   'left' only enriches matched rows and ignores unmatched file rows (which
 *   also drops any incoming edge onto a dropped new node — no dangling edges)
 * @returns {{fileData: Object, stats: Object}} merged fileData plus preview stats
 */
function computeMergePlan(current, incoming, { joinMode = 'outer' } = {}) {
  let incomingNodes = incoming.nodes || [];
  let incomingEdges = incoming.edges || [];
  const ignoredNodes = [];
  const ignoredEdges = [];
  if (joinMode === 'left') {
    const idsOf = (list) => new Set((list || []).map((el) => String(el.id)));
    const nodeIds = idsOf(current.nodes);
    const edgeIds = idsOf(current.edges);
    ignoredNodes.push(...incomingNodes.filter((n) => !nodeIds.has(String(n.id))).map((n) => String(n.id)));
    ignoredEdges.push(...incomingEdges.filter((e) => !edgeIds.has(String(e.id))).map((e) => String(e.id)));
    incomingNodes = incomingNodes.filter((n) => nodeIds.has(String(n.id)));
    incomingEdges = incomingEdges.filter((e) => edgeIds.has(String(e.id)));
  }

  const nodes = mergeElements(current.nodes || [], incomingNodes);
  const edges = mergeElements(current.edges || [], incomingEdges);
  const nodeHeaders = mergeHeaders(current.nodeDataHeaders || [], incoming.nodeDataHeaders);
  const edgeHeaders = mergeHeaders(current.edgeDataHeaders || [], incoming.edgeDataHeaders);

  const hasChanges =
    nodes.added.length > 0 ||
    nodes.modified.length > 0 ||
    edges.added.length > 0 ||
    edges.modified.length > 0 ||
    nodeHeaders.added.length > 0 ||
    edgeHeaders.added.length > 0;

  return {
    fileData: {
      nodes: nodes.merged,
      edges: edges.merged,
      nodeDataHeaders: nodeHeaders.headers,
      edgeDataHeaders: edgeHeaders.headers,
    },
    stats: {
      joinMode,
      nodes: { added: nodes.added, modified: nodes.modified, unchanged: nodes.matchedUnchanged },
      edges: { added: edges.added, modified: edges.modified, unchanged: edges.matchedUnchanged },
      newNodeColumns: nodeHeaders.added,
      newEdgeColumns: edgeHeaders.added,
      ignoredNodes,
      ignoredEdges,
      skippedNodeRows: incoming.skippedNodeRows || 0,
      skippedEdgeRows: incoming.skippedEdgeRows || 0,
      hasChanges,
    },
  };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function statTile(count, label, kind) {
  const tile = el('div', `merge-stat ${count > 0 ? kind : 'zero'}`);
  const prefix = count > 0 ? (kind === 'add' ? '+' : '~') : '';
  tile.appendChild(el('span', 'merge-stat-num', `${prefix}${count}`));
  tile.appendChild(el('span', 'merge-stat-label', label));
  return tile;
}

function idListDetails(title, ids) {
  const details = el('details', 'merge-preview-details');
  details.appendChild(el('summary', null, `${title} (${ids.length})`));
  const shown = ids.slice(0, MAX_PREVIEW_IDS).join(', ');
  const more = ids.length > MAX_PREVIEW_IDS ? ` … and ${ids.length - MAX_PREVIEW_IDS} more` : '';
  const list = el('div', 'merge-preview-ids', shown + more);
  // Scrollable region must be keyboard-reachable (WCAG 2.1.1)
  list.tabIndex = 0;
  details.appendChild(list);
  return details;
}

function appendColumnsAndNotes(content, stats) {
  const newColumns = [
    ...stats.newNodeColumns.map((c) => `${c} (nodes)`),
    ...stats.newEdgeColumns.map((c) => `${c} (edges)`),
  ];
  if (newColumns.length > 0) {
    const columns = el('div', 'merge-preview-columns');
    columns.appendChild(el('div', 'merge-preview-columns-label', 'New property columns'));
    newColumns.forEach((c) => columns.appendChild(el('span', 'merge-preview-col-badge', c)));
    content.appendChild(columns);
  }

  const notes = [];
  if (stats.nodes.unchanged > 0 || stats.edges.unchanged > 0) {
    notes.push(
      `${stats.nodes.unchanged} node row(s) and ${stats.edges.unchanged} edge row(s) ` +
        `match the current graph and stay unchanged.`
    );
  }
  if (stats.ignoredNodes?.length > 0 || stats.ignoredEdges?.length > 0) {
    notes.push(
      `${stats.ignoredNodes.length} node row(s) and ${stats.ignoredEdges.length} edge row(s) ` +
        `have no match in the graph and will be ignored.`
    );
  }
  if (stats.skippedNodeRows > 0 || stats.skippedEdgeRows > 0) {
    notes.push(
      `${stats.skippedNodeRows} node row(s) and ${stats.skippedEdgeRows} edge row(s) ` +
        `were skipped while reading the file (see notifications).`
    );
  }
  notes.forEach((note) => content.appendChild(el('div', 'merge-preview-note', note)));
}

// Everything below the file name / mode picker: stat grid, columns, notes,
// id lists and the warning. Re-rendered by the modal when the mode toggles.
function buildStatsBody(stats) {
  const content = el('div', 'merge-preview-body');

  const grid = el('div', 'merge-preview-grid');
  grid.appendChild(statTile(stats.nodes.added.length, 'New nodes', 'add'));
  grid.appendChild(statTile(stats.nodes.modified.length, 'Updated nodes', 'mod'));
  grid.appendChild(statTile(stats.edges.added.length, 'New edges', 'add'));
  grid.appendChild(statTile(stats.edges.modified.length, 'Updated edges', 'mod'));
  content.appendChild(grid);

  appendColumnsAndNotes(content, stats);

  if (stats.nodes.added.length > 0) content.appendChild(idListDetails('New nodes', stats.nodes.added));
  if (stats.nodes.modified.length > 0)
    content.appendChild(idListDetails('Updated nodes', stats.nodes.modified));
  if (stats.edges.added.length > 0) content.appendChild(idListDetails('New edges', stats.edges.added));
  if (stats.edges.modified.length > 0)
    content.appendChild(idListDetails('Updated edges', stats.edges.modified));

  if (stats.hasChanges) {
    const warning = el('div', 'alert-warning');
    const strong = el('strong', null, '⚠️ Important: ');
    warning.appendChild(strong);
    warning.appendChild(
      document.createTextNode(
        'Merging updates the data across all workspaces and cannot be undone. ' +
          'Export your graph first if you need a fallback.'
      )
    );
    content.appendChild(warning);
  } else {
    content.appendChild(
      el('div', 'alert-info', 'No changes detected — this file matches the current graph.')
    );
  }

  return content;
}

function buildMergePreviewContent(stats, fileName) {
  const content = el('div', 'merge-preview');
  content.appendChild(el('div', 'merge-preview-file', `📄 ${fileName}`));
  content.appendChild(buildStatsBody(stats));
  return content;
}

function buildJoinModeRow(mode, checked, onSelect) {
  const label = el('label', 'merge-join-mode');
  const radio = el('input');
  radio.type = 'radio';
  radio.name = 'merge-join-mode';
  radio.value = mode.value;
  radio.checked = checked;
  radio.addEventListener('change', () => onSelect(mode.value));
  const text = el('span', 'merge-join-mode-text');
  text.appendChild(el('strong', null, mode.label));
  text.appendChild(document.createTextNode(` — ${mode.description}`));
  label.appendChild(radio);
  label.appendChild(text);
  return label;
}

/**
 * Show the import preview modal offering both join modes.
 *
 * @param {{outer: Object, left: Object}} plans - computeMergePlan results per mode
 * @param {string} fileName - name of the imported file
 * @returns {Promise<Object|null>} the chosen plan on Import, null on cancel
 */
function showMergePreview(plans, fileName) {
  return new Promise((resolve) => {
    const content = el('div', 'merge-preview');
    content.appendChild(el('div', 'merge-preview-file', `📄 ${fileName}`));

    let selected = 'outer';
    const body = el('div');
    const footer = el('div', 'p-footer');
    const cancelBtn = el('button', 'p-button p-button-secondary', 'Cancel');
    const importBtn = el('button', 'p-button p-button-primary', '✔ Import');

    const render = () => {
      body.replaceChildren(buildStatsBody(plans[selected].stats));
      importBtn.disabled = !plans[selected].stats.hasChanges;
    };

    const modes = el('div', 'merge-join-modes');
    modes.setAttribute('role', 'radiogroup');
    modes.setAttribute('aria-label', 'Import mode');
    for (const mode of JOIN_MODES) {
      modes.appendChild(
        buildJoinModeRow(mode, mode.value === selected, (value) => {
          selected = value;
          render();
        })
      );
    }
    content.appendChild(modes);
    content.appendChild(body);
    render();

    footer.appendChild(cancelBtn);
    footer.appendChild(importBtn);
    content.appendChild(footer);

    let isResolved = false;
    const popup = new Popup(content, {
      title: 'Import & Merge Excel',
      width: '480px',
      showFullscreenButton: false,
      closeOnClickOutside: false,
      onClose: () => {
        if (!isResolved) resolve(null);
      },
    });

    importBtn.addEventListener('click', () => {
      isResolved = true;
      popup.close();
      resolve(plans[selected]);
    });
    cancelBtn.addEventListener('click', () => {
      isResolved = true;
      popup.close();
      resolve(null);
    });

    setTimeout(() => (plans.outer.stats.hasChanges ? importBtn : cancelBtn).focus(), 0);
  });
}

export { computeMergePlan, buildMergePreviewContent, showMergePreview };
