/**
 * Neo4j session extensions — grow the current graph without a fresh import:
 *
 *  - Expand: preflight what surrounds the selected nodes (relationship type ×
 *    neighbor label, with counts), let the user pick pairs in a checklist,
 *    fetch, merge.
 *  - Join query: run an additional Cypher query against the connected server
 *    and merge its results (they may be disconnected from the current graph).
 *
 * Both exist only while a Neo4j session is active (successful Neo4j import in
 * this browser session — see startNeo4jSession / neo4jSessionActive in
 * neo4j_loader.js).
 *
 * Merging is deliberately NOT incremental rendering: new raw entities are
 * unioned into the session accumulator, toAppFormat re-runs over the full set
 * (keeps auto-colors stable across fetches), and the result goes through the
 * shared applyGraph replace pipeline. Current node positions are captured
 * first and stamped onto the payload so the arrangement survives; new nodes
 * are seeded near a positioned neighbor, falling back to the centroid of the
 * existing arrangement. Filter narrowing resets per merge (accepted);
 * property exclusions from the initial import re-apply silently.
 */

import { Popup } from './popup.js';
import { applyGraph } from '../managers/api_client.js';
import { settlePinnedForce } from '../graph/layout_algorithms.js';
import {
  runCypher,
  countQueryRows,
  collectGraph,
  toAppFormat,
  getNeo4jSession,
  LARGE_RESULT_ROW_THRESHOLD,
} from './neo4j_loader.js';

// New nodes land one SEED_RADIUS from their anchor, jittered so batches of
// siblings don't stack on the exact same spot. App-model units (the default
// layouts spread nodes over a few hundred units).
const SEED_RADIUS = 80;
const SEED_JITTER = 60;
const PREFLIGHT_TIMEOUT_MS = 30_000;

/**
 * Expansion matches nodes by `elementId()` — the app's node ids are the
 * legacy ids the HTTP graph format carries as `id`, while Neo4j 5 responses
 * carry `elementId` alongside. `id()` is deprecated and integer-typed (the
 * JSON ids are strings), so elementId is used unconditionally; Neo4j 4.x
 * servers (no elementId in results) are not supported for expansion.
 *
 * @param {object} session
 * @param {string[]} nodeIds  app node ids (= raw Neo4j node ids)
 * @returns {string[]}
 */
function elementIdsFor(session, nodeIds) {
  return nodeIds.map((id) => session.rawNodes.get(id)?.elementId ?? String(id));
}

/**
 * Preflight statement: one row per (relationship type, neighbor label) pair
 * around the given nodes, with counts, largest first. Ids travel as
 * parameters — never interpolated into the Cypher text. The leaf label
 * mirrors primaryLabel (class hierarchies store the leaf last); coalesce
 * keeps label-less neighbors matchable (list equality with null never
 * matches in Cypher).
 */
function buildExpandPreflight(elementIds) {
  return {
    statement:
      'MATCH (n) WHERE elementId(n) IN $ids ' +
      'MATCH (n)-[r]-(m) ' +
      "RETURN type(r) AS relType, coalesce(labels(m)[-1], '') AS neighborLabel, " +
      'count(*) AS cnt ORDER BY cnt DESC',
    parameters: { ids: elementIds },
    resultDataContents: ['row'],
  };
}

/**
 * Fetch statement for the checked pairs — exact (relType, neighborLabel)
 * matching via list membership, so checking (A→X) and (B→Y) does not also
 * fetch (A→Y).
 *
 * @param {string[]} elementIds
 * @param {Array<{relType: string, neighborLabel: string}>} pairs
 */
function buildExpandFetch(elementIds, pairs) {
  return {
    statement:
      'MATCH (n) WHERE elementId(n) IN $ids ' +
      'MATCH (n)-[r]-(m) ' +
      "WHERE [type(r), coalesce(labels(m)[-1], '')] IN $pairs " +
      'RETURN n, r, m',
    parameters: {
      ids: elementIds,
      pairs: pairs.map((pair) => [pair.relType, pair.neighborLabel]),
    },
    resultDataContents: ['graph'],
  };
}

/**
 * Stitch statement: every relationship whose BOTH endpoints are already part
 * of the graph. Individual queries only return relationships their own
 * pattern matched, so two fetches about different entities never reveal how
 * their result sets interconnect — this closes that gap. Returns no new
 * nodes by construction (both endpoints constrained to $ids).
 *
 * USING JOIN ON m forces a NodeHashJoin: without it the planner (which
 * under-estimates the expansion when the loaded set contains supernodes)
 * checks `elementId(m) IN $ids` as a linear list scan PER expanded
 * relationship — a 372k-degree hub × a 500-id list took minutes; the hash
 * join makes it one O(1) probe per relationship. `<=` returns each
 * relationship once instead of once per direction (self-loops included).
 */
function buildStitchQuery(elementIds) {
  return {
    statement:
      'MATCH (n)-[r]-(m) ' +
      'USING JOIN ON m ' +
      'WHERE elementId(n) IN $ids AND elementId(m) IN $ids ' +
      'AND elementId(n) <= elementId(m) ' +
      'RETURN r',
    parameters: { ids: elementIds },
    resultDataContents: ['graph'],
  };
}

/** Element ids of everything the session has accumulated plus the given new nodes. */
function allElementIds(session, newNodes) {
  const ids = new Set();
  for (const node of session.rawNodes.values()) ids.add(node.elementId ?? String(node.id));
  for (const node of newNodes) ids.add(node.elementId ?? String(node.id));
  return [...ids];
}

/**
 * Run the stitch query and append its results to the fetched batch in place.
 * Stitched endpoints are already-known nodes and duplicate ids are deduped by
 * the session accumulator — the relationships are the point.
 */
async function appendStitch(session, nodes, relationships, opts) {
  const results = await runCypher(
    session.config,
    [buildStitchQuery(allElementIds(session, nodes))],
    opts,
  );
  const stitched = collectGraph(results);
  nodes.push(...stitched.nodes);
  relationships.push(...stitched.relationships);
}

/** The stitch checkbox row shared by the expand checklist and the join popup. */
function buildStitchRow() {
  const row = document.createElement('label');
  row.className = 'neo4j-stitch-row';
  row.title =
    'One extra query after the fetch: MATCH (n)-[r]-(m) with both endpoints already in the graph. Adds no nodes, only the missing links.';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = true;
  row.appendChild(checkbox);
  row.appendChild(
    document.createTextNode(
      ' Stitch: also fetch relationships between the new results and everything already loaded',
    ),
  );
  return { row, checkbox };
}

/**
 * Stamp captured positions onto nodes that already existed and seed the new
 * ones — near a positioned neighbor when one exists (expand), else at the
 * centroid of the captured arrangement (join query). Every node ends up
 * positioned, so the apply pipeline restores the arrangement instead of
 * inventing a new one. With nothing captured (no graph yet) the payload is
 * left untouched and the normal initial layout places everything.
 *
 * @param {{nodes: object[], edges: object[]}} data  app-format payload (mutated)
 * @param {Map<string, {x: number, y: number}>} positions  app-model (y-down)
 */
function seedMergedPositions(data, positions) {
  if (positions.size === 0) return;

  const neighbors = new Map();
  const link = (a, b) => {
    if (!neighbors.has(a)) neighbors.set(a, []);
    neighbors.get(a).push(b);
  };
  for (const edge of data.edges) {
    link(edge.source, edge.target);
    link(edge.target, edge.source);
  }

  let centroidX = 0;
  let centroidY = 0;
  for (const pos of positions.values()) {
    centroidX += pos.x;
    centroidY += pos.y;
  }
  centroidX /= positions.size;
  centroidY /= positions.size;

  const seedNear = (anchor) => {
    const angle = Math.random() * 2 * Math.PI;
    const jitter = () => (Math.random() - 0.5) * 2 * SEED_JITTER;
    return {
      x: anchor.x + Math.cos(angle) * SEED_RADIUS + jitter(),
      y: anchor.y + Math.sin(angle) * SEED_RADIUS + jitter(),
    };
  };

  for (const node of data.nodes) {
    let pos = positions.get(node.id);
    if (!pos) {
      let anchor = null;
      for (const neighborId of neighbors.get(node.id) ?? []) {
        anchor = positions.get(neighborId);
        if (anchor) break;
      }
      pos = seedNear(anchor ?? { x: centroidX, y: centroidY });
    }
    node.style = { ...node.style, x: pos.x, y: pos.y };
  }
}

/**
 * The merge primitive both flows share: capture positions, union the raw
 * entities into the session (Map.set — re-fetched ids refresh stale
 * properties), re-run toAppFormat over the whole accumulator with the
 * session's exclusions, seed positions, re-apply.
 *
 * @param {object} cache
 * @param {object[]} newNodes  raw Neo4j nodes
 * @param {object[]} newRels  raw Neo4j relationships
 * @param {{apply?: Function}} [deps]  injectable for tests
 * @returns {Promise<boolean>} true when the merged graph was rendered
 */
async function mergeAndApply(cache, newNodes, newRels, deps = {}) {
  const session = getNeo4jSession();
  const apply = deps.apply ?? applyGraph;

  // Capture the arrangement BEFORE anything else. getNodeData() syncs x/y
  // from the live graphology graph into the refs and returns app-model
  // (y-down) coordinates — the same space persisted positions use. (Reading
  // any later, e.g. after the apply started tearing down, would lose it.)
  const positions = new Map();
  for (const node of (await cache.graph?.getNodeData()) ?? []) {
    positions.set(node.id, { x: node.style.x, y: node.style.y });
  }

  for (const node of newNodes) session.rawNodes.set(node.id, node);
  for (const rel of newRels) session.rawRels.set(rel.id, rel);

  const data = toAppFormat(
    [...session.rawNodes.values()],
    [...session.rawRels.values()],
    session.exclusions,
  );
  seedMergedPositions(data, positions);

  // Declare the (single, current) workspace in the payload so preProcessData
  // takes the JSON-import path: with a layout whose positions cover every
  // node, no initial force layout fires. Bare stamped styles would take the
  // Excel path instead, whose post-render force pass visibly shuffles the
  // graph and then snaps back — the arrangement must land exactly where the
  // seeding put it, in one paint.
  if (positions.size > 0) {
    // ponytail: a workspace the user literally named "custom" (the Excel
    // sentinel, DEFAULTS.CUSTOM_LAYOUT_NAME) still triggers that force pass.
    const layoutName = cache.data?.selectedLayout || 'Default';
    data.selectedLayout = layoutName;
    data.layouts = {
      [layoutName]: {
        isCustom: true,
        positions: Object.fromEntries(
          data.nodes.map((node) => [node.id, { style: { x: node.style.x, y: node.style.y } }]),
        ),
      },
    };
  }

  const rendered = await apply(cache, data);
  if (rendered) {
    // applyGraph stamps its own data-source label — restore the session's
    // (this also re-shows the expand/join buttons via the label hook).
    cache.ui.setDataSourceLabel(`Neo4j: ${session.config.database}`);

    // Float the new nodes into place: an animated force pass over the full
    // graph with everything else pinned, then persist the settled positions
    // (graphology is the source of truth after the settle, so the
    // getNodeData-based persist reads the right direction).
    const newIds = data.nodes.filter((node) => !positions.has(node.id)).map((node) => node.id);
    if (positions.size > 0 && newIds.length > 0 && cache.graphData) {
      const settle = deps.settle ?? settlePinnedForce;
      await settle(cache.graphData, newIds);
      await cache.lm.persistNodePositions();
    }
  }
  return rendered;
}

/**
 * Checklist over the preflight pairs. Resolves with the checked pairs and
 * the stitch choice, or null on cancel. All pairs (and stitch) start checked;
 * the summed count of the checked rows doubles as the size warning (same
 * threshold as the import preflight).
 *
 * @param {Array<{relType: string, neighborLabel: string, count: number}>} pairs
 * @returns {Promise<{pairs: Array<{relType: string, neighborLabel: string, count: number}>, stitch: boolean}|null>}
 */
function showExpandChecklist(pairs) {
  return new Promise((resolve) => {
    const content = document.createElement('div');
    const intro = document.createElement('p');
    intro.className = 'neo4j-hint';
    intro.textContent =
      'Neighbors of the selected nodes, grouped by relationship type and label. ' +
      'Checked groups are fetched and merged into the graph.';
    content.appendChild(intro);

    const heading = document.createElement('div');
    heading.className = 'neo4j-props-heading';
    const headingLabel = document.createElement('label');
    const toggleAll = document.createElement('input');
    toggleAll.type = 'checkbox';
    headingLabel.appendChild(toggleAll);
    headingLabel.appendChild(document.createTextNode(' Neighbor groups'));
    heading.appendChild(headingLabel);
    content.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'neo4j-props-list';
    const rowBoxes = [];
    pairs.forEach((pair, index) => {
      const row = document.createElement('label');
      row.className = 'neo4j-prop-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      checkbox.dataset.index = index;
      rowBoxes.push(checkbox);
      row.appendChild(checkbox);

      const name = document.createElement('span');
      name.className = 'neo4j-prop-name';
      name.textContent = `${pair.relType} → ${pair.neighborLabel || 'Node'}`;
      row.appendChild(name);

      const count = document.createElement('span');
      count.className = 'neo4j-prop-type';
      count.textContent = String(pair.count);
      count.title = 'Matching relationships';
      row.appendChild(count);

      list.appendChild(row);
    });
    content.appendChild(list);

    const warning = document.createElement('div');
    warning.className = 'neo4j-warning';
    warning.setAttribute('role', 'status'); // announced when the sum crosses the threshold
    warning.hidden = true;
    content.appendChild(warning);

    const { row: stitchRow, checkbox: stitchBox } = buildStitchRow();
    content.appendChild(stitchRow);

    const footer = document.createElement('div');
    footer.className = 'p-footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'p-button p-button-secondary';
    const fetchBtn = document.createElement('button');
    fetchBtn.textContent = 'Fetch & merge';
    fetchBtn.className = 'p-button p-button-primary';
    footer.appendChild(cancelBtn);
    footer.appendChild(fetchBtn);
    content.appendChild(footer);

    const syncState = () => {
      const checked = rowBoxes.filter((box) => box.checked);
      toggleAll.checked = checked.length === rowBoxes.length;
      toggleAll.indeterminate = checked.length > 0 && checked.length < rowBoxes.length;
      fetchBtn.disabled = checked.length === 0;
      const sum = checked.reduce((total, box) => total + pairs[box.dataset.index].count, 0);
      warning.hidden = sum <= LARGE_RESULT_ROW_THRESHOLD;
      warning.textContent = warning.hidden
        ? ''
        : `The checked groups sum to ${sum.toLocaleString()} relationships, which may be slow to fetch and render.`;
    };
    syncState();
    toggleAll.addEventListener('change', () => {
      rowBoxes.forEach((box) => (box.checked = toggleAll.checked));
      syncState();
    });
    list.addEventListener('change', syncState);

    let resolved = false;
    const popup = new Popup(content, {
      title: 'Expand from Neo4j',
      width: '480px',
      showFullscreenButton: false,
      closeOnClickOutside: false,
      onClose: () => {
        if (!resolved) resolve(null);
      },
    });

    fetchBtn.addEventListener('click', () => {
      resolved = true;
      popup.close();
      resolve({
        pairs: rowBoxes.filter((box) => box.checked).map((box) => pairs[box.dataset.index]),
        stitch: stitchBox.checked,
      });
    });
    cancelBtn.addEventListener('click', () => {
      resolved = true;
      popup.close();
      resolve(null);
    });
  });
}

/**
 * Expand flow: preflight → checklist → fetch → merge. Entry point for the
 * selection-HUD button; no-ops without an active session or selection.
 *
 * @param {object} cache
 * @param {{fetchImpl?: Function, checklist?: Function, apply?: Function}} [deps]
 * @returns {Promise<boolean>} true when a merged graph was rendered
 */
async function expandNeo4jSelection(cache, deps = {}) {
  const session = getNeo4jSession();
  const selected = cache.selectedNodes ?? [];
  if (!session || selected.length === 0) return false;

  const checklist = deps.checklist ?? showExpandChecklist;
  const opts = deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {};
  const progress = async (message) => {
    if (message) await cache.ui.showLoading('Neo4j', message);
    else await cache.ui.hideLoading();
  };

  try {
    const ids = elementIdsFor(session, selected);

    await progress('Checking the neighborhood …');
    const preflight = await runCypher(session.config, [buildExpandPreflight(ids)], {
      ...opts,
      timeoutMs: PREFLIGHT_TIMEOUT_MS,
    });
    await progress(null);

    const pairs = (preflight[0]?.data ?? []).map(({ row }) => ({
      relType: row[0],
      neighborLabel: row[1],
      count: row[2],
    }));
    if (pairs.length === 0) {
      cache.ui.info('The selected nodes have no neighbors in Neo4j.');
      return false;
    }

    const chosen = await checklist(pairs);
    if (!chosen || chosen.pairs.length === 0) return false;

    await progress('Fetching neighbors …');
    const results = await runCypher(session.config, [buildExpandFetch(ids, chosen.pairs)], opts);
    const { nodes, relationships } = collectGraph(results);
    if (nodes.length === 0) {
      await progress(null);
      // Counts said otherwise, so the data changed under us — nothing to merge.
      cache.ui.info('The expansion returned no graph elements.');
      return false;
    }

    if (chosen.stitch) {
      await progress('Stitching …');
      await appendStitch(session, nodes, relationships, opts);
    }
    await progress(null);

    return await mergeAndApply(cache, nodes, relationships, deps);
  } catch (err) {
    await progress(null);
    cache.ui.error(`Neo4j expand: ${err.message}`);
    return false;
  }
}

/** @returns {HTMLElement} join-query form body */
function buildJoinForm(database) {
  const form = document.createElement('div');
  form.innerHTML = `
    <div class="neo4j-field">
      <label for="neo4j-join-query">Cypher query</label>
      <textarea id="neo4j-join-query" rows="4" class="p-prompt neo4j-query"
        placeholder="MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 100"></textarea>
      <span class="neo4j-hint">Must return nodes, relationships, or paths.</span>
    </div>
    <div id="neo4j-join-error" class="neo4j-error" role="alert" hidden></div>
    <div class="neo4j-info" id="neo4j-join-info"></div>
    <div class="p-footer">
      <button id="neo4j-join-cancel-btn" class="p-button p-button-secondary">Cancel</button>
      <button id="neo4j-join-fetch-btn" class="p-button p-button-primary">Fetch &amp; merge</button>
    </div>
  `;
  // textContent — the database name is user input and must not hit innerHTML.
  form.querySelector('#neo4j-join-info').textContent =
    `Runs against the connected session (database "${database}") and merges the ` +
    'results into the current graph. Results may be disconnected from it. ' +
    'Properties excluded at import stay excluded — re-import to change that.';

  const { row, checkbox } = buildStitchRow();
  checkbox.id = 'neo4j-join-stitch';
  form.insertBefore(row, form.querySelector('#neo4j-join-error'));
  return form;
}

/**
 * Join-query flow: a slim popup (query only — the session is already
 * authenticated) with the same count preflight and huge-result confirm as the
 * initial import, then merge.
 *
 * @param {object} cache
 * @param {{fetchImpl?: Function, confirm?: Function, apply?: Function}} [deps]
 * @returns {Promise<boolean>} true when a merged graph was rendered
 */
function openNeo4jJoinPopup(cache, deps = {}) {
  const session = getNeo4jSession();
  if (!session) return Promise.resolve(false);

  const form = buildJoinForm(session.config.database);
  // Grab element references before constructing the Popup — it relocates the
  // .p-footer out of the content element (see openNeo4jPopup).
  const fetchBtn = form.querySelector('#neo4j-join-fetch-btn');
  const cancelBtn = form.querySelector('#neo4j-join-cancel-btn');
  const errorBox = form.querySelector('#neo4j-join-error');
  const queryBox = form.querySelector('#neo4j-join-query');
  const stitchBox = form.querySelector('#neo4j-join-stitch');

  return new Promise((resolve) => {
    let settled = false;
    let dataFetched = false;
    const settle = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const popup = new Popup(form, {
      title: 'Add Neo4j Query',
      width: '480px',
      showFullscreenButton: false,
      closeOnClickOutside: false,
      onClose: () => {
        if (!dataFetched) settle(false);
      },
    });

    const setBusy = (message) => {
      fetchBtn.disabled = !!message;
      cancelBtn.disabled = !!message;
      fetchBtn.innerHTML = message
        ? `<span class="neo4j-btn-spinner"></span>${message}`
        : 'Fetch &amp; merge';
    };
    const showError = (message) => {
      errorBox.textContent = message;
      errorBox.hidden = false;
    };

    const handleFetch = async () => {
      errorBox.hidden = true;
      const query = queryBox.value.trim();
      if (!query) {
        showError('A Cypher query is required.');
        return;
      }
      const confirm = deps.confirm ?? Popup.confirm;
      const opts = deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {};

      try {
        setBusy('Counting …');
        const rowCount = await countQueryRows(session.config, query, opts);
        if (rowCount !== null && rowCount > LARGE_RESULT_ROW_THRESHOLD) {
          setBusy(null);
          const proceed = await confirm(
            `The query matches ${rowCount.toLocaleString()} rows, which may be slow to fetch and render. Continue anyway? (Tip: add a LIMIT clause.)`,
          );
          if (proceed !== true) return;
        }

        setBusy('Fetching …');
        const results = await runCypher(
          session.config,
          [{ statement: query, resultDataContents: ['graph'] }],
          opts,
        );
        const { nodes, relationships } = collectGraph(results);
        if (nodes.length === 0) {
          setBusy(null);
          showError(
            'The query returned no graph elements. Return nodes, relationships, or paths (e.g. MATCH (n)-[r]->(m) RETURN n, r, m).',
          );
          return;
        }

        if (stitchBox.checked) {
          setBusy('Stitching …');
          await appendStitch(session, nodes, relationships, opts);
        }

        dataFetched = true;
        popup.close();
        settle(await mergeAndApply(cache, nodes, relationships, deps));
      } catch (err) {
        setBusy(null);
        showError(`Neo4j: ${err.message}`);
      }
    };

    fetchBtn.addEventListener('click', handleFetch);
    cancelBtn.addEventListener('click', () => {
      popup.close();
      settle(false);
    });
    setTimeout(() => queryBox.focus(), 100);
  });
}

export {
  expandNeo4jSelection,
  openNeo4jJoinPopup,
  mergeAndApply,
  seedMergedPositions,
  showExpandChecklist,
  buildExpandPreflight,
  buildExpandFetch,
  buildStitchQuery,
  elementIdsFor,
  SEED_RADIUS,
  SEED_JITTER,
};
