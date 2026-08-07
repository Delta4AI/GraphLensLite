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
import { buildChecklistSection, openChecklistPopup } from './checklist_popup.js';
import { applyGraph } from '../managers/api_client.js';
import { settlePinnedForce } from '../graph/layout_algorithms.js';
import {
  runCypher,
  connectionHint,
  NEO4J_DATA_SOURCE,
  fetchGraphWithPreflight,
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
// A merge re-applies the whole graph, so filter narrowing goes back to the
// loaded defaults and the undo stack is reset (mergeAndApply). Said in both
// flows' copy rather than discovered afterwards.
const MERGE_RESET_NOTE =
  'Merging resets filter narrowing and clears the undo history; node positions are kept.';

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
      // DISTINCT: an undirected match sees a relationship once per endpoint,
      // so anything internal to the selection was counted twice (self-loops
      // likewise), and the checklist over-reported it.
      'count(DISTINCT r) AS cnt ORDER BY cnt DESC',
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
  // The WHERE alone made the server expand EVERY relationship of every
  // selected node and only then discard the unchecked ones — keeping 1 of 20
  // neighbour groups still traversed all 20. Relationship types cannot be
  // parameterised, so the chosen ones go into the pattern as escaped
  // literals; the WHERE stays, because it is what matches exact PAIRS.
  const types = [...new Set(pairs.map((pair) => pair.relType))].filter(Boolean);
  const typeFilter = types.length ? `:${types.map(escapeRelType).join('|')}` : '';
  return {
    statement:
      'MATCH (n) WHERE elementId(n) IN $ids ' +
      `MATCH (n)-[r${typeFilter}]-(m) ` +
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
 * Backtick-quote a relationship type for use in a pattern. Types come from the
 * server's own preflight, not from user text, but quoting is what makes a type
 * containing a space, a hyphen or a backtick legal Cypher rather than a syntax
 * error — and it is what keeps the interpolation inert.
 */
function escapeRelType(type) {
  return `\`${String(type).replace(/`/g, '``')}\``;
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
function buildStitchQuery(elementIds, newIds = null) {
  // Incremental form: a relationship between two nodes that were BOTH already
  // stitched was found by the earlier pass, so only those touching the new
  // batch can be missing. Requiring one endpoint in $newIds turns work that
  // grew with the whole accumulated graph into work that scales with the batch.
  // No `<=` here — with asymmetric sets it would drop a new↔old relationship
  // whose new endpoint sorts higher, and collectGraph dedupes by id anyway.
  if (newIds) {
    return {
      statement:
        'MATCH (n)-[r]-(m) ' +
        'USING JOIN ON m ' +
        'WHERE elementId(n) IN $newIds AND elementId(m) IN $ids ' +
        'RETURN r',
      parameters: { ids: elementIds, newIds },
      resultDataContents: ['graph'],
    };
  }
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
  const allIds = allElementIds(session, nodes);
  const newIds = nodes.map((node) => node.elementId ?? String(node.id));

  // The batch-scoped form is only sound when every node ALREADY in the graph
  // has been through a stitch — then the only relationships that can still be
  // missing are the ones touching this batch. A merge the user chose not to
  // stitch leaves ids uncovered, and tracking that as a plain "have we ever
  // stitched" flag silently skipped them forever; hence the covered set.
  // Pairs where BOTH ends are already covered were examined by an earlier
  // stitch, so the uncovered ids — this batch plus anything merged without
  // stitching — are the only endpoints that can still be missing a link.
  // Falling back to the full sweep instead meant one unstitched merge made
  // every later stitch re-examine the whole accumulated graph, forever.
  const covered = session.stitchedIds;
  const uncovered = covered == null ? null : [...new Set([...allIds.filter((id) => !covered.has(id)), ...newIds])];
  const query = uncovered ? buildStitchQuery(allIds, uncovered) : buildStitchQuery(allIds);

  const results = await runCypher(session.config, [query], opts);
  // allIds is everything loaded plus this batch, so it IS the new covered set.
  session.stitchedIds = new Set(allIds);
  const stitched = collectGraph(results);
  nodes.push(...stitched.nodes);
  relationships.push(...stitched.relationships);
}

/**
 * Stitching is an enhancement, not the payload: the fetch has already
 * succeeded by the time it runs, and an unplannable USING JOIN hint used to
 * throw the whole expand or join away with it. Degrade to the unstitched
 * merge and say what is missing.
 */
async function stitchOrWarn(cache, session, nodes, relationships, opts) {
  if (session.hasElementIds === false) {
    cache.ui.warning(
      'Neo4j: linking the new results to the loaded graph needs Neo4j 5 or newer ' +
        "(this server's results carry no elementId). Merging without those extra links.",
    );
    return;
  }
  try {
    await appendStitch(session, nodes, relationships, opts);
  } catch (err) {
    cache.ui.warning(
      `Neo4j: the data arrived but linking it to the loaded graph failed (${connectionHint(err)}). ` +
        'Merging without those extra links.',
    );
  }
}

/** The stitch checkbox row shared by the expand checklist and the join popup. */
function buildStitchRow() {
  const supported = getNeo4jSession()?.hasElementIds !== false;
  const row = document.createElement('label');
  row.className = 'neo4j-stitch-row';
  row.title = supported
    ? 'One extra query after the fetch: MATCH (n)-[r]-(m) with both endpoints already in the graph. Adds no nodes, only the missing links.'
    : "Needs Neo4j 5 or newer — this server's results carry no elementId to match on.";
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = supported;
  checkbox.disabled = !supported;
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
    cache.ui.setDataSourceLabel(`Neo4j: ${session.config.database}`, NEO4J_DATA_SOURCE);

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
    // A merge is structural: earlier snapshots describe a smaller graph.
    cache.history?.reset();
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
  const content = document.createElement('div');
  const intro = document.createElement('p');
  intro.className = 'neo4j-hint';
  intro.textContent =
    'Neighbors of the selected nodes, grouped by relationship type and label. ' +
    'Checked groups are fetched and merged into the graph. ' +
    MERGE_RESET_NOTE;
  content.appendChild(intro);

  const warning = document.createElement('div');
  warning.className = 'neo4j-warning';
  warning.setAttribute('role', 'status'); // announced when the sum crosses the threshold
  warning.hidden = true;

  let fetchBtn = null;
  const syncState = (checked) => {
    const sum = checked.reduce((total, pair) => total + pair.count, 0);
    warning.hidden = sum <= LARGE_RESULT_ROW_THRESHOLD;
    warning.textContent = warning.hidden
      ? ''
      : `The checked groups sum to ${sum.toLocaleString()} relationships, which may be slow to fetch and render.`;
    if (fetchBtn) fetchBtn.disabled = checked.length === 0;
  };

  const { elements, rows } = buildChecklistSection({
    title: 'Neighbor groups',
    rows: pairs.map((pair) => ({
      label: `${pair.relType} → ${pair.neighborLabel || 'Node'}`,
      meta: String(pair.count),
      metaTitle: 'Matching relationships',
      data: pair,
    })),
    onChange: syncState,
  });
  content.append(...elements, warning);

  const { row: stitchRow, checkbox: stitchBox } = buildStitchRow();
  content.appendChild(stitchRow);

  const checkedPairs = () => rows.filter((row) => row.input.checked).map((row) => row.data);
  return openChecklistPopup({
    title: 'Expand from Neo4j',
    content,
    confirmLabel: 'Fetch & merge',
    // The button does not exist during the section's first sync, so catch it up
    // here — nothing checked must mean nothing to fetch.
    onReady: (button) => {
      fetchBtn = button;
      syncState(checkedPairs());
    },
    onConfirm: () => ({ pairs: checkedPairs(), stitch: stitchBox.checked }),
  });
}

/**
 * Relationships the checked pairs will bring back, from the preflight's own
 * per-pair counts.
 *
 * @param {Array<{relType: string, neighborLabel: string, count: number}>} pairs
 * @param {Array<{relType: string, neighborLabel: string}>} chosen
 * @returns {number}
 */
function expectedRelationshipCount(pairs, chosen) {
  const wanted = new Set(chosen.map((p) => `${p.relType}\u0000${p.neighborLabel}`));
  return pairs
    .filter((p) => wanted.has(`${p.relType}\u0000${p.neighborLabel}`))
    .reduce((sum, p) => sum + (Number(p.count) || 0), 0);
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

  if (session.hasElementIds === false) {
    // Every expand statement matches on elementId(n); on a 4.x server the ids
    // in $ids match nothing, which surfaced as a confident "no neighbors".
    cache.ui.error(
      'Expanding needs Neo4j 5 or newer — this server\'s results carry no elementId.',
    );
    return false;
  }

  const checklist = deps.checklist ?? showExpandChecklist;
  // Import and join both hand their query a signal; expand ran under the
  // full-screen overlay with none, so a slow neighbourhood locked the UI for
  // up to the five-minute timeout with nothing to press.
  const controller = new AbortController();
  const opts = { signal: controller.signal };
  if (deps.fetchImpl) opts.fetchImpl = deps.fetchImpl;
  const progress = async (message) => {
    if (message) {
      await cache.ui.showLoading('Neo4j', message);
      cache.ui.setLoadingCancel?.(() => controller.abort());
    } else {
      await cache.ui.hideLoading();
    }
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

    // The import path blocks on a confirm above this threshold; expand showed
    // the counts as passive text, so a 500k-relationship expansion was one
    // click away with nothing in the way.
    const expected = expectedRelationshipCount(pairs, chosen.pairs);
    if (expected > LARGE_RESULT_ROW_THRESHOLD) {
      const proceed = await (deps.confirm ?? Popup.confirm)(
        `Expanding will fetch about ${expected.toLocaleString()} relationships, which may be ` +
          'slow to fetch and render. Continue anyway? (Tip: uncheck the larger groups.)',
      );
      if (proceed !== true) return false;
    }

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
      await stitchOrWarn(cache, session, nodes, relationships, opts);
    }
    await progress(null);

    return await mergeAndApply(cache, nodes, relationships, deps);
  } catch (err) {
    await progress(null);
    // The user pressed Cancel — they know; reporting it back would be telling
    // them off for cancelling.
    if (err?.name === 'AbortError') return false;
    cache.ui.error(`Neo4j expand: ${connectionHint(err)}`);
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
    'Properties excluded at import stay excluded — re-import to change that. ' +
    MERGE_RESET_NOTE;

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
    // Cancel and × abort the in-flight query instead of leaving it to run out
    // its timeout (see openNeo4jPopup).
    let controller = null;
    const settle = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const dismiss = () => {
      controller?.abort();
      popup.close();
      settle(false);
    };

    const popup = new Popup(form, {
      title: 'Add Neo4j Query',
      width: '480px',
      showFullscreenButton: false,
      closeOnClickOutside: false,
      onClose: () => {
        if (!dataFetched) {
          controller?.abort();
          settle(false);
        }
      },
    });

    const setBusy = (message) => {
      fetchBtn.disabled = !!message;
      fetchBtn.innerHTML = message
        ? `<span class="neo4j-btn-spinner"></span>${message}`
        : 'Fetch &amp; merge';
    };
    const showError = (message) => {
      // Same detached-box problem as openNeo4jPopup: once popup.close() has
      // run, the merge is past the point of no return and the inline box is
      // gone, so the message has to reach the toast layer.
      if (!errorBox.isConnected) {
        cache.ui.error(message);
        return;
      }
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
      controller = new AbortController();
      const opts = { signal: controller.signal };
      if (deps.fetchImpl) opts.fetchImpl = deps.fetchImpl;

      try {
        const graph = await fetchGraphWithPreflight({
          config: session.config,
          query,
          opts,
          confirm,
          // The labels go inside the Fetch button, so they stay short.
          countingLabel: 'Counting …',
          fetchingLabel: 'Fetching …',
          busy: (message) => setBusy(message),
          onError: showError,
          // The × stays live while the query runs, and onClose settles the
          // promise — so a dismissal mid-flight means the user is done. Merging
          // anyway would replace their graph (and reset filters and undo) after
          // the popup they cancelled had already gone.
          shouldContinue: () => !settled,
        });
        if (!graph) return;
        const { nodes, relationships } = graph;

        if (stitchBox.checked) {
          setBusy('Stitching …');
          await stitchOrWarn(cache, session, nodes, relationships, opts);
        }

        if (settled) return;
        dataFetched = true;
        popup.close();
        settle(await mergeAndApply(cache, nodes, relationships, deps));
      } catch (err) {
        if (err?.name === 'AbortError') return; // the user closed the dialog
        setBusy(null);
        showError(`Neo4j: ${connectionHint(err)}`);
        // The popup is already closed, so nothing will ever settle this
        // promise — its caller would wait for a retry that cannot happen.
        if (dataFetched) settle(false);
      }
    };

    fetchBtn.addEventListener('click', handleFetch);
    cancelBtn.addEventListener('click', dismiss);
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
  escapeRelType,
  elementIdsFor,
  SEED_RADIUS,
  SEED_JITTER,
};
