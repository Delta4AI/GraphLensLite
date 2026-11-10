/**
 * Neo4j connector: the interactive import flow and the session it leaves
 * behind. The HTTP transport lives in neo4j_cypher.js and the entity → app
 * payload conversion in neo4j_convert.js; both are re-exported here.
 *
 * The interactive flow lives in `openNeo4jPopup` (gll.js wires the buttons):
 * connection form → row-count preflight (warn when huge) → fetch →
 * property-exclusion checklist → render via the shared applyGraph pipeline.
 */

import { Popup } from './popup.js';
import { openFetchPopup } from './fetch_popup.js';
import { buildChecklistSection, openChecklistPopup } from './checklist_popup.js';
import { applyGraph } from '../managers/api_client.js';
import {
  runCypher,
  connectionHint,
  countQueryRows,
  fetchGraphWithPreflight,
  collectGraph,
  buildTxUrl,
  basicAuth,
  DEFAULT_DATABASE,
  LARGE_RESULT_ROW_THRESHOLD,
} from './neo4j_cypher.js';
import {
  collectPropertyKeys,
  toAppFormat,
  coerceValue,
  nodeDisplayLabel,
  primaryLabel,
  categoryColor,
  edgeCategoryColor,
  buildCategoryColors,
  LARGE_ARRAY_THRESHOLD,
} from './neo4j_convert.js';

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
const SETTINGS_STORAGE_KEY = 'gllNeo4jConnection';

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
    // Asked here, before the connection form closes and not only inside
    // applyGraph: a refusal there would still get the Neo4j label stamped over
    // the graph that stays.
    if (!(await (cache.dataTable?.confirmDiscard() ?? true))) return false;
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

  const readConfig = () => ({
    url: form.querySelector('#neo4j-url').value.trim(),
    username: form.querySelector('#neo4j-username').value.trim(),
    password: form.querySelector('#neo4j-password').value,
    database: form.querySelector('#neo4j-database').value.trim() || DEFAULT_DATABASE,
    query: form.querySelector('#neo4j-query').value.trim(),
  });

  // Enter submits from the single-line fields. Not from the query box: a Cypher
  // query is multi-line and Enter belongs to the textarea. Routed through the
  // button so it takes the same disabled check and the same handler.
  for (const id of ['#neo4j-url', '#neo4j-username', '#neo4j-password', '#neo4j-database']) {
    form.querySelector(id)?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !loadBtn.disabled) {
        e.preventDefault();
        loadBtn.click();
      }
    });
  }

  return openFetchPopup({
    cache,
    form,
    title: 'Load from Neo4j',
    submitBtn: loadBtn,
    cancelBtn,
    errorBox,
    idleLabel: 'Fetch',
    focusEl: form.querySelector('#neo4j-url'),
    formatError: (err) => `Neo4j: ${connectionHint(err)}`,
    onFetch: async ({ signal, setBusy, showError, close }) => {
      const config = readConfig();
      if (!config.url || !config.query) {
        showError('Server URL and Cypher query are required.');
        return false;
      }
      // "localhost:7474" parses cleanly — as scheme "localhost:" — so URL alone
      // waves through the most common mistake, which then resurfaces minutes
      // later as a generic network error.
      let parsed;
      try {
        parsed = new URL(config.url);
      } catch {
        showError(`Invalid server URL: ${config.url}`);
        return false;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        showError('The server URL must start with http:// or https:// (e.g. http://localhost:7474).');
        return false;
      }
      // Credentials travel as base64 Basic auth, which is encoding, not
      // encryption: over plain http: to anything but the local machine they are
      // readable by everything on the path. A line of disclaimer text in the
      // form is not consent.
      if (
        needsPlaintextConfirm(parsed) &&
        (await Popup.confirm(plaintextWarning(parsed), 'Connect anyway')) !== true
      ) {
        return false;
      }

      saveSettings(config);
      return executeNeo4jImport(cache, config, {
        signal,
        progress: (message) => setBusy(message),
        onError: showError,
        // Close the connection popup once data has arrived — the property
        // checklist takes over from here. Failures before this point keep the
        // popup open with an inline error so the inputs are preserved.
        onFetched: close,
      });
    },
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
