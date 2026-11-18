/**
 * Neo4j HTTP transport: POSTs Cypher to the transactional endpoint
 * (`POST {url}/db/{database}/tx/commit`) with plain `fetch` — no driver
 * dependency — and turns its failures into messages the user can act on.
 * Also owns the row-count preflight and the decoding of `graph`-format
 * results into unique raw nodes/relationships.
 *
 * Requires the server's HTTP connector (default port 7474/7473); Neo4j ships
 * with `server.http_access_control_allow_origin=*`, so browser and Electron
 * contexts both work. Neo4j Aura exposes only Bolt and is not supported.
 */

import { StaticUtilities } from './static.js';

const DEFAULT_DATABASE = 'neo4j';
const LARGE_RESULT_ROW_THRESHOLD = 2000;
const COUNT_TIMEOUT_MS = 30_000;
const QUERY_TIMEOUT_MS = 300_000;

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
    // Inferring it from the JS type in connectionHint would not work: the
    // callers' try blocks wrap the whole import, so an ordinary TypeError in
    // the merge path would be reported to the user as a network problem.
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

export {
  runCypher,
  connectionHint,
  countQueryRows,
  fetchGraphWithPreflight,
  collectGraph,
  buildTxUrl,
  basicAuth,
  DEFAULT_DATABASE,
  LARGE_RESULT_ROW_THRESHOLD,
};
