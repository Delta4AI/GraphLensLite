/**
 * Neo4j connector.
 *
 * Fetches graph data from a Neo4j server via the HTTP transactional Cypher
 * API (`POST {url}/db/{database}/tx/commit`) — plain `fetch`, no driver
 * dependency. The `graph` result format returns nodes/relationships directly,
 * which map onto the app's native `{nodes, edges, ...headers}` payload.
 *
 * Requires the server's HTTP connector (default port 7474/7473); Neo4j ships
 * with `server.http_access_control_allow_origin=*`, so browser and Electron
 * contexts both work. Neo4j Aura exposes only Bolt and is not supported.
 *
 * The interactive flow lives in `openNeo4jPopup` (gll.js wires the buttons):
 * connection form → row-count preflight (warn when huge) → fetch →
 * property-exclusion checklist → render via the shared applyGraph pipeline.
 */

import { Popup } from './popup.js';
import { buildChecklistSection, openChecklistPopup } from './checklist_popup.js';
import { StaticUtilities } from './static.js';
import { applyGraph } from '../managers/api_client.js';
import { DEFAULTS, hslToHex, GOLDEN_ANGLE_DEG } from '../config.js';

const sanitizeForAST = StaticUtilities.sanitizeForAST;
// Edge strokes get this alpha suffix so auto-colored edges stay subordinate
// to nodes, matching the translucency of the default edge color.
const EDGE_COLOR_ALPHA = '90';
const EXAMPLE_MAX_LENGTH = 40;

const DEFAULT_DATABASE = 'neo4j';
// Public read-only demo server run by Neo4j Labs; the credentials are
// published (username = password = database, github.com/neo4j-graph-examples).
// The query pulls the best-answered "neo4j"-tagged questions (sort key is
// `answers`, not answer_count) with their 1-hop neighborhood — ~1.5k nodes /
// ~1.8k rows, sized to show rendering performance while staying under the
// LARGE_RESULT_ROW_THRESHOLD confirm popup.
const DEMO_SETTINGS = {
  url: 'https://demo.neo4jlabs.com:7473',
  username: 'stackoverflow',
  password: 'stackoverflow',
  database: 'stackoverflow',
  query: 'MATCH (q:Question)-[:TAGGED]->(:Tag {name: "neo4j"})\n' +
    'WITH q ORDER BY q.answers DESC LIMIT 200\n' +
    'MATCH (q)-[r]-(x) RETURN q, r, x LIMIT 2000',
};
const LARGE_RESULT_ROW_THRESHOLD = 2000;
const COUNT_TIMEOUT_MS = 30_000;
const QUERY_TIMEOUT_MS = 300_000;
// Arrays longer than this (e.g. embedding vectors) are deselected by default
// in the property checklist.
const LARGE_ARRAY_THRESHOLD = 32;
const SETTINGS_STORAGE_KEY = 'gllNeo4jConnection';

/** @returns {string} the tx/commit endpoint for a base URL + database name */
function buildTxUrl(baseUrl, database) {
  const url = new URL(baseUrl); // throws on malformed input — caught by caller
  const base = url.href.replace(/\/+$/, '');
  return `${base}/db/${encodeURIComponent(database || DEFAULT_DATABASE)}/tx/commit`;
}

/** Base64 for the Basic-auth header; TextEncoder round-trip keeps non-ASCII credentials intact. */
function basicAuth(username, password) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  return 'Basic ' + btoa(String.fromCharCode(...bytes));
}

// Status-log lines for executed queries are truncated to keep the log legible.
const QUERY_LOG_MAX_LENGTH = 160;

/** One grey status-log line per executed Cypher statement (no-op outside the app). */
function logStatements(statements) {
  const ui = globalThis.cache?.ui;
  if (!ui) return;
  for (const { statement } of statements) {
    const oneLine = statement.replace(/\s+/g, ' ').trim();
    const text = StaticUtilities.truncate(oneLine, QUERY_LOG_MAX_LENGTH);
    // Marked sensitive: the statement carries the user's literal values.
    ui.logMessage(text, 'grey', false, '🛢️', { sensitive: true });
  }
}

/**
 * POST one or more Cypher statements to the tx/commit endpoint.
 *
 * @param {{url: string, database?: string, username: string, password: string}} config
 * @param {Array<{statement: string, resultDataContents?: string[]}>} statements
 * @param {{timeoutMs?: number, fetchImpl?: Function, signal?: AbortSignal}} [opts]
 * @returns {Promise<object[]>} the `results` array
 * @throws {Error} on network failure, non-2xx status, or Cypher errors
 */
async function runCypher(config, statements, opts = {}) {
  logStatements(statements);
  const fetchImpl = opts.fetchImpl ?? fetch;
  // The caller's signal (a dismissed dialog) races the timeout; whichever
  // fires first ends the request.
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? QUERY_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let response;
  try {
    response = await fetchImpl(buildTxUrl(config.url, config.database), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: basicAuth(config.username, config.password),
      },
      body: JSON.stringify({ statements }),
      signal,
    });
  } catch (err) {
    // Tagged HERE, where the transport is the only thing that can have failed.
    // connectionHint used to infer this from the JS type, and the callers' try
    // blocks wrap the whole import — so an ordinary TypeError in the merge path
    // was reported to the user as a network problem.
    if (err) err.transport = true;
    throw err;
  }

  if (response.status === 401) {
    throw new Error('Authentication failed — check username and password.');
  }
  if (!response.ok) {
    // "Neo4j returned HTTP 404." named none of the causes, and the database is
    // the usual one — the tx endpoint carries its name in the path.
    throw new Error(`Neo4j returned HTTP ${response.status}. ${statusHint(response.status, config)}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    const first = payload.errors[0];
    // The message alone: "Neo.ClientError.Statement.SyntaxError: …" makes the
    // user read a driver constant before the sentence that tells them what to
    // fix. The code stays on the error as data (and in the activity log).
    const err = new Error(first.message || first.code);
    err.neo4jCode = first.code;
    throw err;
  }
  return payload.results ?? [];
}

/** What a non-2xx status usually means here, in the user's terms. */
function statusHint(status, config) {
  const db = config.database || DEFAULT_DATABASE;
  if (status === 404) {
    return `Either the database "${db}" does not exist, or the URL is not the HTTP/HTTPS endpoint (default port 7474/7473, not the Bolt 7687).`;
  }
  if (status === 403) return 'The user is authenticated but not allowed to read this database.';
  if (status === 503) return 'The database is starting up or unavailable — try again shortly.';
  if (status >= 500) return 'The server failed while handling the query; its logs will say why.';
  return 'Check the URL and that it points at the HTTP connector, not Bolt.';
}

/** Write clauses that make a query unsafe to run twice (count preflight + fetch). */
const WRITE_CLAUSE_RE = /\b(CREATE|MERGE|SET|DELETE|REMOVE|DROP|FOREACH)\b/i;

// A procedure call can write without naming a write clause (apoc.refactor.*,
// apoc.atomic.*, custom procedures), and LOAD CSV can feed one. Neither is
// worth trying to enumerate, so anything carrying them skips the preflight.
const OPAQUE_CALL_RE = /\bCALL\s+[a-zA-Z_][\w.]*\s*\(|\bLOAD\s+CSV\b/i;

// A trailing LIMIT the query already carries answers the only question the
// preflight asks — "is this bigger than the threshold?" — for free.
const TRAILING_LIMIT_RE = /\bLIMIT\s+(\d+)\s*;?\s*$/i;

/**
 * Turn a transport failure into something the user can act on. Every flow —
 * connect, expand, join — fails these same three ways, and the raw text names
 * none of the causes: "Failed to fetch" is what a wrong port, a disabled HTTP
 * connector and a CORS rejection all look like from here.
 *
 * A dead server is matched by TYPE, not by message: only Chromium words it
 * "Failed to fetch", so matching the string left Firefox and Safari users
 * without the URL/CORS guidance.
 */
function connectionHint(err) {
  if (err?.name === 'TimeoutError') {
    return (
      'The request timed out. Add a LIMIT, narrow the pattern, or run it in the Neo4j ' +
      'browser first to see how long it really takes.'
    );
  }
  if (err?.transport) {
    return 'Could not reach the server — check the URL, that the HTTP connector is enabled, and CORS settings.';
  }
  return err?.message ?? String(err);
}

/**
 * Preflight row count by wrapping the query in a CALL subquery (Neo4j 4.1+).
 * Returns null when the count cannot be determined (older server, query shape
 * the wrapper cannot handle) — callers then proceed without a size warning.
 *
 * Write-shaped queries are skipped outright: the preflight fully executes the
 * user's Cypher, so counting first would apply their writes twice.
 *
 * @returns {Promise<number|null>}
 */
async function countQueryRows(config, query, opts = {}) {
  if (WRITE_CLAUSE_RE.test(query) || OPAQUE_CALL_RE.test(query)) return null;
  // A query already bounded below the threshold cannot trip the warning, so
  // the preflight would only buy a second full execution of the user's query.
  const limit = Number(TRAILING_LIMIT_RE.exec(query)?.[1]);
  if (limit && limit <= LARGE_RESULT_ROW_THRESHOLD) return limit;
  try {
    const results = await runCypher(
      config,
      // Newlines, because a query may end in a // comment; the trailing
      // semicolon a copy-paste brings along is not legal mid-subquery. The
      // count stops one row past the threshold — the exact number above it
      // buys nothing, and counting it all is what made every import cost 2x.
      [{ statement: countStatement(query) }],
      { ...opts, timeoutMs: opts.timeoutMs ?? COUNT_TIMEOUT_MS },
    );
    const value = results[0]?.data?.[0]?.row?.[0];
    return typeof value === 'number' ? value : null;
  } catch (err) {
    // A Cypher error means the CALL wrapper cannot take this query's shape —
    // that is what returning null is for, and so is a preflight that outruns
    // its own budget: the fetch has ten times the timeout and deserves its
    // chance. A wrong password or an unreachable server is neither, and
    // swallowing those cost a second doomed roundtrip.
    if (err?.neo4jCode || err?.name === 'TimeoutError') return null;
    throw err;
  }
}

/** The counting wrapper: capped one row past the threshold, comment-safe. */
function countStatement(query) {
  const body = query.replace(/\s*;\s*$/, '');
  return (
    `CALL {\n${body}\n}\n` +
    `WITH * LIMIT ${LARGE_RESULT_ROW_THRESHOLD + 1}\n` +
    `RETURN count(*) AS rowCount`
  );
}

/**
 * Count → warn if huge → fetch → reject an empty result. Shared by the import
 * flow and the join popup, which had it (and its two user-facing strings)
 * written out twice.
 *
 * Returns null when the user declined the size warning, abandoned the flow, or
 * the query returned nothing graph-shaped — the caller has already been told
 * which. `busy` is the caller's own progress surface (full-screen overlay vs
 * in-button spinner), so its wording stays with the caller.
 *
 * @returns {Promise<{nodes: object[], relationships: object[]}|null>}
 */
async function fetchGraphWithPreflight({
  config,
  query,
  opts = {},
  confirm,
  busy,
  onError,
  shouldContinue,
  countingLabel = 'Counting matching rows …',
  fetchingLabel = 'Fetching graph data …',
}) {
  await busy(countingLabel);
  const rowCount = await countQueryRows(config, query, opts);
  await busy(null);

  if (rowCount !== null && rowCount > LARGE_RESULT_ROW_THRESHOLD) {
    const proceed = await confirm(
      `The query matches more than ${LARGE_RESULT_ROW_THRESHOLD.toLocaleString()} rows, which may be slow to fetch and render. Continue anyway? (Tip: add a LIMIT clause.)`,
    );
    if (proceed !== true) return null;
  }
  // The confirm is a await point long enough for the user to close the dialog
  // that started this.
  if (shouldContinue && !shouldContinue()) return null;

  await busy(fetchingLabel);
  const results = await runCypher(config, [{ statement: query, resultDataContents: ['graph'] }], opts);
  const graph = collectGraph(results);
  await busy(null);

  if (graph.nodes.length === 0) {
    onError(
      'The query returned no graph elements. Return nodes, relationships, or paths (e.g. MATCH (n)-[r]->(m) RETURN n, r, m).',
    );
    return null;
  }
  return graph;
}

/**
 * Collect unique nodes and relationships from a tx/commit `graph`-format
 * result (the same entity appears once per row it occurs in).
 *
 * @param {object[]} results  the `results` array from runCypher
 * @returns {{nodes: object[], relationships: object[]}}
 */
function collectGraph(results) {
  const nodes = new Map();
  const relationships = new Map();
  for (const result of results) {
    for (const entry of result.data ?? []) {
      for (const node of entry.graph?.nodes ?? []) nodes.set(node.id, node);
      for (const rel of entry.graph?.relationships ?? []) relationships.set(rel.id, rel);
    }
  }
  return { nodes: [...nodes.values()], relationships: [...relationships.values()] };
}

/**
 * Coerce a Neo4j property value into something the filter UI can handle.
 * Primitive arrays join with ' | ' — the app splits pipe-separated strings
 * into multi-value categoricals, so list properties stay filterable per value.
 */
function coerceValue(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  // Booleans become categorical 'true'/'false' strings. Raw booleans would be
  // classified as numeric by the importer (isNaN(true) === false) and end up
  // as degenerate [1,1] sliders whose BETWEEN condition never validates
  // (the query AST requires typeof 'number'), hiding every carrier under OR.
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return sanitizeForAST(value);
  if (Array.isArray(value) && value.every((v) => typeof v !== 'object' || v === null)) {
    return value.map((v) => sanitizeForAST(String(v))).join(' | ');
  }
  return sanitizeForAST(JSON.stringify(value));
}

/** @returns {string|null} a display type for a property value, null for empty values */
function describeType(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return 'list';
  const t = typeof value;
  if (t === 'number' || t === 'boolean') return t;
  if (t === 'object') return 'object';
  return 'text';
}

/**
 * Union of property keys per element kind, with display metadata for the
 * exclusion checklist: value type ('mixed' when inconsistent), up to two
 * distinct truncated example values, and large-array detection.
 *
 * @returns {Array<{kind: 'node'|'edge', key: string, type: string, examples: string[], largeArray: boolean}>}
 */
function collectPropertyKeys(nodes, relationships) {
  const collect = (elements, kind) => {
    const byKey = new Map();
    for (const element of elements) {
      for (const [key, value] of Object.entries(element.properties ?? {})) {
        const type = describeType(value);
        if (type === null) continue; // null-valued: coerceValue drops these anyway
        let entry = byKey.get(key);
        if (!entry) {
          entry = { kind, key, types: new Set(), examples: [], largeArray: false };
          byKey.set(key, entry);
        }
        entry.types.add(type);
        if (Array.isArray(value) && value.length > LARGE_ARRAY_THRESHOLD) {
          entry.largeArray = true;
        }
        if (entry.examples.length < 2) {
          const short = StaticUtilities.truncate(coerceValue(value), EXAMPLE_MAX_LENGTH);
          if (short !== '' && !entry.examples.includes(short)) entry.examples.push(short);
        }
      }
    }
    return [...byKey.values()]
      .map(({ types, ...rest }) => ({
        ...rest,
        type: types.size === 1 ? [...types][0] : 'mixed',
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  };
  return [...collect(nodes, 'node'), ...collect(relationships, 'edge')];
}

/**
 * Most specific label of a node. Class-hierarchy tooling (neomodel-style)
 * stores the full ancestor chain as labels with the leaf class last
 * (e.g. Entity:AddOnCat:Cell → Cell), so the last entry is the primary one.
 * The complete label set stays filterable via the `Neo4j > Labels` category.
 */
function primaryLabel(node) {
  const labels = node.labels ?? [];
  return labels.length ? labels[labels.length - 1] : 'Node';
}

/** Pick a display label for a node from conventional name properties. */
function nodeDisplayLabel(node) {
  const props = node.properties ?? {};
  const candidate = props.name ?? props.title ?? props.label ?? props.id;
  if (candidate !== undefined && candidate !== null && candidate !== '') {
    return String(candidate);
  }
  return `${primaryLabel(node)} ${node.id}`;
}

/**
 * Deterministic categorical color: the app's brand palette first, then a
 * golden-angle hue walk so any number of categories stays distinguishable.
 */
function categoryColor(index) {
  const palette = DEFAULTS.NODE.PIE.SLICE_PALETTE;
  if (index < palette.length) return palette[index];
  return hslToHex((index * GOLDEN_ANGLE_DEG) % 360, 0.55, 0.55);
}

/**
 * Edge palette: the node palette contains pale tones (#EFB0AA, #8CA6D9) that
 * vanish at EDGE_COLOR_ALPHA against a light background. Edges instead walk
 * the golden-angle hue wheel at mid lightness, which stays legible over both
 * light and dark themes (stored styles are static hexes — they cannot adapt
 * to a theme switch). Offset from blue so index 0 differs from the node red.
 */
function edgeCategoryColor(index) {
  return hslToHex((210 + index * GOLDEN_ANGLE_DEG) % 360, 0.55, 0.45);
}

/**
 * Map each category to a color, or null when there are fewer than two
 * categories (a single category carries no visual information — keep the
 * app defaults). Categories are sorted so colors are deterministic.
 *
 * @param {string[]} categories
 * @param {(index: number) => string} [colorFn]
 * @returns {Map<string, string>|null}
 */
function buildCategoryColors(categories, colorFn = categoryColor) {
  const unique = [...new Set(categories)].sort();
  if (unique.length < 2) return null;
  return new Map(unique.map((category, index) => [category, colorFn(index)]));
}

/**
 * Convert collected Neo4j entities into the app's native payload.
 * Properties are grouped by the element's primary label / relationship type;
 * a `Neo4j` group carries `Labels` / `Type` so they stay filterable.
 *
 * @param {object[]} nodes
 * @param {object[]} relationships
 * @param {{excludedNodeProps?: Set<string>, excludedEdgeProps?: Set<string>}} [options]
 * @returns {{nodes: object[], edges: object[], nodeDataHeaders: object[], edgeDataHeaders: object[]}}
 */
function toAppFormat(nodes, relationships, options = {}) {
  const excludedNodeProps = options.excludedNodeProps ?? new Set();
  const excludedEdgeProps = options.excludedEdgeProps ?? new Set();
  const nodeHeaders = new Map();
  const edgeHeaders = new Map();

  const addHeader = (headers, subGroup, key) => {
    headers.set(`${subGroup}::${key}`, { subGroup, key });
  };

  const buildFilters = (properties, subGroup, excluded, headers) => {
    const filters = {};
    for (const [rawKey, raw] of Object.entries(properties ?? {})) {
      if (excluded.has(rawKey)) continue;
      const value = coerceValue(raw);
      if (value === undefined) continue;
      const key = sanitizeForAST(rawKey);
      filters[key] = value;
      addHeader(headers, subGroup, key);
    }
    return filters;
  };

  const nodeColors = buildCategoryColors(nodes.map((n) => sanitizeForAST(primaryLabel(n))));
  const edgeColors = buildCategoryColors(
    relationships.map((r) => sanitizeForAST(r.type || 'Relationship')),
    edgeCategoryColor,
  );

  const appNodes = nodes.map((node) => {
    const subGroup = sanitizeForAST(primaryLabel(node));
    // No synthetic type property — the per-label property groups and the
    // auto-coloring already carry the entity type.
    const filters = {
      [subGroup]: buildFilters(node.properties, subGroup, excludedNodeProps, nodeHeaders),
    };
    return {
      id: node.id,
      label: nodeDisplayLabel(node),
      ...(nodeColors ? { style: { fill: nodeColors.get(subGroup) } } : {}),
      D4Data: { 'Node filters': filters },
    };
  });

  const appEdges = relationships.map((rel) => {
    const subGroup = sanitizeForAST(rel.type || 'Relationship');
    const filters = {
      [subGroup]: buildFilters(rel.properties, subGroup, excludedEdgeProps, edgeHeaders),
    };
    return {
      id: rel.id,
      source: rel.startNode,
      target: rel.endNode,
      label: rel.type,
      ...(edgeColors
        ? { style: { stroke: `${edgeColors.get(subGroup)}${EDGE_COLOR_ALPHA}` } }
        : {}),
      D4Data: { 'Edge filters': filters },
    };
  });

  return {
    nodes: appNodes,
    edges: appEdges,
    nodeDataHeaders: [...nodeHeaders.values()],
    edgeDataHeaders: [...edgeHeaders.values()],
  };
}

/**
 * Active Neo4j session — set after a successful import, replaced by the next
 * one. Enables the expand/join-query features (see neo4j_session.js). Raw
 * Neo4j entities (not app format) are accumulated so toAppFormat re-computes
 * auto-colors over the full category set on every merge, keeping colors
 * stable across fetches. The password lives in memory only — never persisted
 * (saveSettings strips it).
 *
 * The session is never proactively cleared when another loader replaces the
 * graph; the buttons are simply hidden because the data-source label no
 * longer starts with `Neo4j:` (see neo4jSessionActive). A stale session is
 * inert — it is only reachable again through a fresh Neo4j import.
 */
let neo4jSession = null;

/** Value the Neo4j flows stamp on the data-source label (see neo4jSessionActive). */
const NEO4J_DATA_SOURCE = 'neo4j';

/**
 * @param {{url: string, username: string, password: string, database: string}} config
 * @param {object[]} nodes  raw Neo4j nodes from collectGraph
 * @param {object[]} relationships  raw Neo4j relationships from collectGraph
 * @param {{excludedNodeProps: Set<string>, excludedEdgeProps: Set<string>}} exclusions
 */
function startNeo4jSession(config, nodes, relationships, exclusions) {
  neo4jSession = {
    config,
    // Neo4j 4.x HTTP results carry no elementId, and expand/stitch match on
    // elementId(n). Recorded once here so both can say "needs Neo4j 5+"
    // instead of running a query that silently matches nothing.
    hasElementIds: nodes.length === 0 || nodes.some((node) => node.elementId != null),
    rawNodes: new Map(nodes.map((node) => [node.id, node])),
    rawRels: new Map(relationships.map((rel) => [rel.id, rel])),
    exclusions,
    // Element ids a stitch pass has already covered. Until every loaded node is
    // in here, a stitch has to sweep the full set rather than just the newest
    // batch (see appendStitch).
    stitchedIds: null,
  };
  refreshNeo4jSessionUI();
}

function getNeo4jSession() {
  return neo4jSession;
}

function clearNeo4jSession() {
  neo4jSession = null;
  refreshNeo4jSessionUI();
}

/**
 * True while the rendered graph belongs to the Neo4j session. Every loader
 * stamps the data-source label, so that one seam detects "another source
 * replaced the graph" without any lifecycle events — but it is read from the
 * machine-readable `data-source` the setter writes, not from the words on
 * screen, which used to mean rewording the label silently killed expand/join.
 */
function neo4jSessionActive() {
  const label = document.getElementById('dataSourceLabel');
  return neo4jSession !== null && label?.dataset.source === NEO4J_DATA_SOURCE;
}

/**
 * Show/hide the expand and join-query buttons. Called after a Neo4j import, and
 * on every `gll:datasourcechange` — ui.setDataSourceLabel announces that event
 * from the single choke point every import flow goes through, so this connector
 * subscribes instead of ui.js importing it.
 */
function refreshNeo4jSessionUI() {
  const active = neo4jSessionActive();
  for (const id of ['neo4jExpandBtn', 'neo4jJoinBtn']) {
    const btn = document.getElementById(id);
    if (btn) btn.style.display = active ? '' : 'none';
  }
}

// Module load is the subscription point: this module is only in the bundle
// because something imports the connector, and the listener is idempotent.
document.addEventListener('gll:datasourcechange', refreshNeo4jSessionUI);

/** Persisted connection settings — everything except the password. */
function readSavedSettings() {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Drop the remembered connection. The saved query often carries literal
 * identifiers from the user's data, and it persisted indefinitely with no way
 * to get rid of it short of clearing site data.
 */
function forgetSavedSettings() {
  try {
    globalThis.localStorage?.removeItem(SETTINGS_STORAGE_KEY);
  } catch {
    /* storage unavailable — nothing was remembered anyway */
  }
}

function saveSettings(settings) {
  try {
    const { url, username, database, query } = settings;
    globalThis.localStorage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ url, username, database, query }));
  } catch {
    // Storage unavailable (private mode, file://) — settings just aren't remembered.
  }
}

/**
 * Property-exclusion checklist. Resolves with the excluded key sets, or null
 * when the user cancels. Large arrays (embeddings) start deselected.
 *
 * @param {ReturnType<typeof collectPropertyKeys>} propertyKeys
 * @returns {Promise<{excludedNodeProps: Set<string>, excludedEdgeProps: Set<string>}|null>}
 */
function showPropertyChecklist(propertyKeys) {
  if (propertyKeys.length === 0) {
    return Promise.resolve({ excludedNodeProps: new Set(), excludedEdgeProps: new Set() });
  }

  const content = document.createElement('div');
  const intro = document.createElement('p');
  intro.className = 'neo4j-hint';
  intro.textContent =
    'Select the properties to import. Deselected properties are dropped before the graph is built.';
  content.appendChild(intro);

  const allRows = [];
  for (const [title, kind] of [
    ['Node properties', 'node'],
    ['Relationship properties', 'edge'],
  ]) {
    const entries = propertyKeys.filter((entry) => entry.kind === kind);
    if (entries.length === 0) continue;
    const { elements, rows } = buildChecklistSection({
      title,
      rows: entries.map((entry) => ({
        label: entry.key,
        meta: entry.largeArray ? 'large list' : entry.type,
        metaTitle: entry.largeArray ? 'Long array (e.g. an embedding) — deselected by default' : '',
        note: entry.examples.length ? `e.g. ${entry.examples.join('  ·  ')}` : '',
        checked: !entry.largeArray,
        data: entry,
      })),
    });
    content.append(...elements);
    allRows.push(...rows);
  }

  return openChecklistPopup({
    title: 'Neo4j Properties',
    content,
    confirmLabel: 'Import',
    onConfirm: () => {
      const excludedNodeProps = new Set();
      const excludedEdgeProps = new Set();
      for (const { input, data } of allRows) {
        if (input.checked) continue;
        (data.kind === 'node' ? excludedNodeProps : excludedEdgeProps).add(data.key);
      }
      return { excludedNodeProps, excludedEdgeProps };
    },
  });
}

/** @returns {HTMLElement} the connection form body (inputs carry ids for lookup) */
function buildConnectionForm(saved) {
  const form = document.createElement('div');
  form.innerHTML = `
    <div class="neo4j-field">
      <label for="neo4j-url">Server URL <span class="neo4j-hint">(required)</span></label>
      <input type="text" id="neo4j-url" class="p-prompt" placeholder="http://localhost:7474">
    </div>
    <div class="neo4j-field-row">
      <div class="neo4j-field">
        <label for="neo4j-username">Username</label>
        <input type="text" id="neo4j-username" class="p-prompt" placeholder="neo4j">
      </div>
      <div class="neo4j-field">
        <label for="neo4j-password">Password</label>
        <input type="password" id="neo4j-password" class="p-prompt">
      </div>
    </div>
    <div class="neo4j-field">
      <label for="neo4j-database">Database <span class="neo4j-hint">(optional)</span></label>
      <input type="text" id="neo4j-database" class="p-prompt" placeholder="${DEFAULT_DATABASE}">
    </div>
    <div class="neo4j-field">
      <label for="neo4j-query">Cypher query <span class="neo4j-hint">(required)</span></label>
      <textarea id="neo4j-query" rows="4" class="p-prompt neo4j-query">MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 500</textarea>
      <span class="neo4j-hint">Must return nodes, relationships, or paths. The prefilled query
        matches every node in the database — its LIMIT is what keeps it small, so add a label
        (<code>MATCH (n:Gene)…</code>) before raising it.</span>
    </div>
    <div id="neo4j-replace-note" class="neo4j-warning" hidden>
      Importing replaces the loaded graph — its positions, filters, groups and undo history go with it.
    </div>
    <div id="neo4j-error" class="neo4j-error" role="alert" hidden></div>
    <div class="neo4j-info">
      No server at hand? <a href="#" id="neo4j-demo-link">Fill in the Stack Overflow demo</a> —
      <a href="https://github.com/neo4j-graph-examples" target="_blank" rel="noopener">Neo4j Labs'</a>
      public read-only server; content from
      <a href="https://stackoverflow.com" target="_blank" rel="noopener">Stack Overflow</a>
      contributors, licensed under
      <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA</a>.
    </div>
    <div class="neo4j-info">
      Uses the Neo4j HTTP API (port 7474/7473). Credentials are sent only to the
      server above and are not stored; the URL, username, database, and query
      are remembered locally. Prefer https:// for remote servers — Basic auth
      over http:// is unencrypted. Neo4j Aura (Bolt-only) is not supported.
    </div>
    <div class="p-footer">
      <button id="neo4j-forget-btn" class="p-button p-button-secondary" hidden
              title="Remove the remembered URL, username, database and query from this browser">Forget saved connection</button>
      <button id="neo4j-cancel-btn" class="p-button p-button-secondary">Cancel</button>
      <button id="neo4j-load-btn" class="p-button p-button-primary">Fetch</button>
    </div>
  `;
  form.querySelector('#neo4j-url').value = saved.url ?? '';
  form.querySelector('#neo4j-username').value = saved.username ?? '';
  form.querySelector('#neo4j-database').value = saved.database ?? '';
  if (saved.query) form.querySelector('#neo4j-query').value = saved.query;
  // Only offered when there is something to forget.
  const forgetBtn = form.querySelector('#neo4j-forget-btn');
  forgetBtn.hidden = Object.keys(saved).length === 0;
  forgetBtn.addEventListener('click', () => {
    forgetSavedSettings();
    for (const field of ['url', 'username', 'database']) {
      form.querySelector(`#neo4j-${field}`).value = '';
    }
    forgetBtn.hidden = true;
  });
  form.querySelector('#neo4j-demo-link').addEventListener('click', (event) => {
    event.preventDefault();
    for (const [field, value] of Object.entries(DEMO_SETTINGS)) {
      form.querySelector(`#neo4j-${field}`).value = value;
    }
  });
  return form;
}

/**
 * Non-form part of the import: count preflight (warn when huge) → fetch →
 * property checklist → render. Collaborators are injectable for tests.
 *
 * @param {object} cache  the app cache
 * @param {{url: string, username: string, password: string, database: string, query: string}} config
 * @param {{fetchImpl?: Function, confirm?: Function, checklist?: Function, apply?: Function}} [deps]
 * @returns {Promise<boolean>} true when a graph was rendered
 */
async function executeNeo4jImport(cache, config, deps = {}) {
  const confirm = deps.confirm ?? Popup.confirm;
  const checklist = deps.checklist ?? showPropertyChecklist;
  const apply = deps.apply ?? applyGraph;
  const onError = deps.onError ?? ((message) => cache.ui.error(message));
  // progress(message) starts/updates a busy indicator, progress(null) clears
  // it. Defaults to the global loading overlay; the connection popup injects
  // an in-button spinner instead so the modal stays interactive underneath.
  const progress =
    deps.progress ??
    (async (message) => {
      if (message) await cache.ui.showLoading('Neo4j', message);
      else await cache.ui.hideLoading();
    });
  const opts = {};
  if (deps.fetchImpl) opts.fetchImpl = deps.fetchImpl;
  if (deps.signal) opts.signal = deps.signal;

  try {
    const graph = await fetchGraphWithPreflight({
      config,
      query: config.query,
      opts,
      confirm,
      busy: progress,
      onError,
    });
    if (!graph) return false;
    const { nodes, relationships } = graph;

    const exclusions = await checklist(collectPropertyKeys(nodes, relationships));
    // Only now is the connection form done with: cancelling the checklist used
    // to leave the user with a closed popup and a password to retype.
    if (!exclusions) return false;
    deps.onFetched?.();

    let rendered = false;
    try {
      rendered = await apply(cache, toAppFormat(nodes, relationships, exclusions));
    } finally {
      // applyGraph stamps its own "Live (API)" label before it starts, so a
      // failed apply used to leave THAT describing a Neo4j graph — and by then
      // the old graph is already destroyed. Stamp either way; the expand/join
      // buttons stay hidden because no session was started.
      cache.ui.setDataSourceLabel(`Neo4j: ${config.database}`, NEO4J_DATA_SOURCE);
    }
    if (rendered) startNeo4jSession(config, nodes, relationships, exclusions);
    return rendered;
  } catch (err) {
    await progress(null);
    // The user aborted (closed the dialog) — they know; reporting it back would
    // be telling them off for cancelling.
    if (err?.name === 'AbortError') return false;
    // The user gets the sentence; the console keeps the object. Stringifying and
    // dropping the Error left a misdiagnosed failure with nothing to debug.
    console.error('[neo4j] import failed', err);
    onError(`Neo4j: ${connectionHint(err)}`);
    return false;
  }
}

/** Hosts where plain http: keeps the credentials on this machine. */
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * @param {URL} parsed  the server URL
 * @returns {boolean} true when the credentials would leave this machine in the clear
 */
function needsPlaintextConfirm(parsed) {
  return parsed.protocol === 'http:' && !LOCAL_HOSTNAMES.has(parsed.hostname.toLowerCase());
}

/** @param {URL} parsed */
function plaintextWarning(parsed) {
  return (
    `The connection to ${parsed.host} is unencrypted (http://), so the username and ` +
    'password are sent in a form anything on the network path can read. ' +
    'Use https:// if the server offers it. Connect anyway?'
  );
}

/**
 * Full interactive flow: connection form, then executeNeo4jImport.
 *
 * @param {object} cache  the app cache
 * @returns {Promise<boolean>} true when a graph was rendered
 */
function openNeo4jPopup(cache) {
  const form = buildConnectionForm(readSavedSettings());
  // Grab element references before constructing the Popup — it relocates the
  // .p-footer out of the content element, so querying the form afterwards
  // would come up empty. The references stay valid across the move.
  const loadBtn = form.querySelector('#neo4j-load-btn');
  const cancelBtn = form.querySelector('#neo4j-cancel-btn');
  const errorBox = form.querySelector('#neo4j-error');
  // Only say it when there is something to lose — on a fresh app the warning
  // would be describing a graph that does not exist.
  if (cache.initialized) form.querySelector('#neo4j-replace-note').hidden = false;

  return new Promise((resolve) => {
    // Popup.close() always fires onClose, so guard against double-settling
    // and against the deliberate close after a successful fetch.
    let settled = false;
    let dataFetched = false;
    // Live only while a fetch is in flight. Cancel and × both abort it: the
    // query has a five-minute timeout, and a flow left running after dismissal
    // used to surface later as a surprise property checklist.
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
      title: 'Load from Neo4j',
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

    // The flow drops the spinner between the count and its gates (size confirm,
    // property checklist), and those are separate modals with no focus trap —
    // so the submit behind them has to stay dead for the WHOLE flow, not just
    // while a label is showing. Otherwise a second concurrent fetch is one
    // click away.
    let submitLocked = false;
    const setBusy = (message) => {
      loadBtn.disabled = submitLocked || !!message;
      loadBtn.innerHTML = message
        ? `<span class="neo4j-btn-spinner"></span>${message}`
        : 'Fetch';
    };
    const showError = (message) => {
      // Failures after onFetched closed the popup would write into detached
      // DOM — and those are the worst ones, because applyGraph has already
      // destroyed the old graph. Route them to the toast layer instead.
      if (!errorBox.isConnected) {
        cache.ui.error(message);
        return;
      }
      errorBox.textContent = message;
      errorBox.hidden = false;
    };

    const readConfig = () => ({
      url: form.querySelector('#neo4j-url').value.trim(),
      username: form.querySelector('#neo4j-username').value.trim(),
      password: form.querySelector('#neo4j-password').value,
      database: form.querySelector('#neo4j-database').value.trim() || DEFAULT_DATABASE,
      query: form.querySelector('#neo4j-query').value.trim(),
    });

    const handleLoad = async () => {
      errorBox.hidden = true;
      const config = readConfig();
      if (!config.url || !config.query) {
        showError('Server URL and Cypher query are required.');
        return;
      }
      // "localhost:7474" parses cleanly — as scheme "localhost:" — so URL alone
      // waves through the most common mistake, which then resurfaces minutes
      // later as a generic network error.
      let parsed;
      try {
        parsed = new URL(config.url);
      } catch {
        showError(`Invalid server URL: ${config.url}`);
        return;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        showError('The server URL must start with http:// or https:// (e.g. http://localhost:7474).');
        return;
      }
      // Credentials travel as base64 Basic auth, which is encoding, not
      // encryption: over plain http: to anything but the local machine they
      // are readable by everything on the path. A line of disclaimer text in
      // the form is not consent.
      if (needsPlaintextConfirm(parsed) && (await Popup.confirm(plaintextWarning(parsed), 'Connect anyway')) !== true) {
        return;
      }

      saveSettings(config);
      submitLocked = true;
      controller = new AbortController();
      const rendered = await executeNeo4jImport(cache, config, {
        signal: controller.signal,
        progress: (message) => setBusy(message),
        onError: showError,
        // Close the connection popup once data has arrived — the property
        // checklist takes over from here. Failures before this point keep
        // the popup open with an inline error so inputs are preserved.
        onFetched: () => {
          dataFetched = true;
          popup.close();
        },
      });

      controller = null;
      submitLocked = false;
      if (dataFetched) settle(rendered);
      else if (!settled) setBusy(null);
    };

    loadBtn.addEventListener('click', handleLoad);
    // Enter submits from the single-line fields. Not from the query box: a
    // Cypher query is multi-line and Enter belongs to the textarea.
    for (const id of ['#neo4j-url', '#neo4j-username', '#neo4j-password', '#neo4j-database']) {
      form.querySelector(id)?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !loadBtn.disabled) {
          e.preventDefault();
          handleLoad();
        }
      });
    }
    cancelBtn.addEventListener('click', dismiss);
    setTimeout(() => form.querySelector('#neo4j-url').focus(), 100);
  });
}

export {
  openNeo4jPopup,
  executeNeo4jImport,
  buildConnectionForm,
  runCypher,
  connectionHint,
  countQueryRows,
  fetchGraphWithPreflight,
  collectGraph,
  collectPropertyKeys,
  toAppFormat,
  coerceValue,
  buildTxUrl,
  basicAuth,
  nodeDisplayLabel,
  primaryLabel,
  categoryColor,
  edgeCategoryColor,
  buildCategoryColors,
  readSavedSettings,
  saveSettings,
  showPropertyChecklist,
  startNeo4jSession,
  getNeo4jSession,
  clearNeo4jSession,
  forgetSavedSettings,
  refreshNeo4jSessionUI,
  DEFAULT_DATABASE,
  DEMO_SETTINGS,
  LARGE_RESULT_ROW_THRESHOLD,
  LARGE_ARRAY_THRESHOLD,
  SETTINGS_STORAGE_KEY,
  NEO4J_DATA_SOURCE,
};
