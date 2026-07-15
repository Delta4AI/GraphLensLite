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
import { StaticUtilities } from './static.js';
import { applyGraph } from '../managers/api_client.js';

const sanitizeForAST = StaticUtilities.sanitizeForAST;

const DEFAULT_DATABASE = 'neo4j';
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

/**
 * POST one or more Cypher statements to the tx/commit endpoint.
 *
 * @param {{url: string, database?: string, username: string, password: string}} config
 * @param {Array<{statement: string, resultDataContents?: string[]}>} statements
 * @param {{timeoutMs?: number, fetchImpl?: Function}} [opts]
 * @returns {Promise<object[]>} the `results` array
 * @throws {Error} on network failure, non-2xx status, or Cypher errors
 */
async function runCypher(config, statements, opts = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const response = await fetchImpl(buildTxUrl(config.url, config.database), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: basicAuth(config.username, config.password),
    },
    body: JSON.stringify({ statements }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? QUERY_TIMEOUT_MS),
  });

  if (response.status === 401) {
    throw new Error('Authentication failed — check username and password.');
  }
  if (!response.ok) {
    throw new Error(`Neo4j returned HTTP ${response.status}.`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    const first = payload.errors[0];
    throw new Error(`${first.code}: ${first.message}`);
  }
  return payload.results ?? [];
}

/**
 * Preflight row count by wrapping the query in a CALL subquery (Neo4j 4.1+).
 * Returns null when the count cannot be determined (older server, query shape
 * the wrapper cannot handle) — callers then proceed without a size warning.
 *
 * @returns {Promise<number|null>}
 */
async function countQueryRows(config, query, opts = {}) {
  try {
    const results = await runCypher(
      config,
      [{ statement: `CALL { ${query} } RETURN count(*) AS rowCount` }],
      { ...opts, timeoutMs: opts.timeoutMs ?? COUNT_TIMEOUT_MS },
    );
    const value = results[0]?.data?.[0]?.row?.[0];
    return typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
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
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return sanitizeForAST(value);
  if (Array.isArray(value) && value.every((v) => typeof v !== 'object' || v === null)) {
    return value.map((v) => sanitizeForAST(String(v))).join(' | ');
  }
  return sanitizeForAST(JSON.stringify(value));
}

/**
 * Union of property keys per element kind, with hints for the exclusion
 * checklist (sample value, large-array detection).
 *
 * @returns {Array<{kind: 'node'|'edge', key: string, largeArray: boolean, sample: *}>}
 */
function collectPropertyKeys(nodes, relationships) {
  const collect = (elements, kind) => {
    const byKey = new Map();
    for (const element of elements) {
      for (const [key, value] of Object.entries(element.properties ?? {})) {
        const existing = byKey.get(key);
        const largeArray = Array.isArray(value) && value.length > LARGE_ARRAY_THRESHOLD;
        if (!existing) {
          byKey.set(key, { kind, key, largeArray, sample: value });
        } else if (largeArray) {
          existing.largeArray = true;
        }
      }
    }
    return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  };
  return [...collect(nodes, 'node'), ...collect(relationships, 'edge')];
}

/** Pick a display label for a node from conventional name properties. */
function nodeDisplayLabel(node) {
  const props = node.properties ?? {};
  const candidate = props.name ?? props.title ?? props.label ?? props.id;
  if (candidate !== undefined && candidate !== null && candidate !== '') {
    return String(candidate);
  }
  return `${node.labels?.[0] ?? 'Node'} ${node.id}`;
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

  const appNodes = nodes.map((node) => {
    const subGroup = sanitizeForAST(node.labels?.[0] ?? 'Node');
    const filters = {
      [subGroup]: buildFilters(node.properties, subGroup, excludedNodeProps, nodeHeaders),
      // Multi-label nodes join with ' | ' so each label is its own category.
      Neo4j: { Labels: (node.labels ?? []).map(sanitizeForAST).join(' | ') || 'none' },
    };
    addHeader(nodeHeaders, 'Neo4j', 'Labels');
    return {
      id: node.id,
      label: nodeDisplayLabel(node),
      D4Data: { 'Node filters': filters },
    };
  });

  const appEdges = relationships.map((rel) => {
    const subGroup = sanitizeForAST(rel.type || 'Relationship');
    const filters = {
      [subGroup]: buildFilters(rel.properties, subGroup, excludedEdgeProps, edgeHeaders),
      Neo4j: { Type: sanitizeForAST(rel.type) || 'none' },
    };
    addHeader(edgeHeaders, 'Neo4j', 'Type');
    return {
      id: rel.id,
      source: rel.startNode,
      target: rel.endNode,
      label: rel.type,
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

/** Persisted connection settings — everything except the password. */
function readSavedSettings(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(SETTINGS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveSettings(settings, storage = globalThis.localStorage) {
  try {
    const { url, username, database, query } = settings;
    storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ url, username, database, query }));
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

  return new Promise((resolve) => {
    const content = document.createElement('div');
    const intro = document.createElement('p');
    intro.textContent =
      'Select the properties to import. Deselected properties are dropped before the graph is built.';
    content.appendChild(intro);

    const buildSection = (title, entries) => {
      if (entries.length === 0) return;
      const heading = document.createElement('h4');
      heading.textContent = title;
      content.appendChild(heading);
      for (const entry of entries) {
        const row = document.createElement('label');
        row.style.display = 'block';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = !entry.largeArray;
        checkbox.dataset.kind = entry.kind;
        checkbox.dataset.key = entry.key;
        row.appendChild(checkbox);
        row.appendChild(
          document.createTextNode(
            ` ${entry.key}${entry.largeArray ? ' (large array — e.g. embedding)' : ''}`,
          ),
        );
        content.appendChild(row);
      }
    };
    buildSection('Node properties', propertyKeys.filter((p) => p.kind === 'node'));
    buildSection('Relationship properties', propertyKeys.filter((p) => p.kind === 'edge'));

    const footer = document.createElement('div');
    footer.className = 'p-footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'p-button p-button-secondary';
    const importBtn = document.createElement('button');
    importBtn.textContent = 'Import';
    importBtn.className = 'p-button p-button-primary';
    footer.appendChild(cancelBtn);
    footer.appendChild(importBtn);
    content.appendChild(footer);

    let resolved = false;
    const popup = new Popup(content, {
      title: 'Neo4j Properties',
      width: '420px',
      showFullscreenButton: false,
      closeOnClickOutside: false,
      onClose: () => {
        if (!resolved) resolve(null);
      },
    });

    importBtn.addEventListener('click', () => {
      const excludedNodeProps = new Set();
      const excludedEdgeProps = new Set();
      for (const checkbox of content.querySelectorAll('input[type="checkbox"]')) {
        if (checkbox.checked) continue;
        (checkbox.dataset.kind === 'node' ? excludedNodeProps : excludedEdgeProps).add(
          checkbox.dataset.key,
        );
      }
      resolved = true;
      popup.close();
      resolve({ excludedNodeProps, excludedEdgeProps });
    });
    cancelBtn.addEventListener('click', () => {
      resolved = true;
      popup.close();
      resolve(null);
    });
  });
}

/** @returns {HTMLElement} the connection form body (inputs carry ids for lookup) */
function buildConnectionForm(saved) {
  const form = document.createElement('div');
  form.innerHTML = `
    <div style="margin-bottom: 12px;">
      <label for="neo4j-url" style="display: block; margin-bottom: 4px;">Server URL:</label>
      <input type="text" id="neo4j-url" placeholder="http://localhost:7474" style="width: 100%; padding: 5px; border: 1px solid #ccc; border-radius: 3px;">
    </div>
    <div style="display: flex; gap: 8px; margin-bottom: 12px;">
      <div style="flex: 1;">
        <label for="neo4j-username" style="display: block; margin-bottom: 4px;">Username:</label>
        <input type="text" id="neo4j-username" placeholder="neo4j" style="width: 100%; padding: 5px; border: 1px solid #ccc; border-radius: 3px;">
      </div>
      <div style="flex: 1;">
        <label for="neo4j-password" style="display: block; margin-bottom: 4px;">Password:</label>
        <input type="password" id="neo4j-password" style="width: 100%; padding: 5px; border: 1px solid #ccc; border-radius: 3px;">
      </div>
    </div>
    <div style="margin-bottom: 12px;">
      <label for="neo4j-database" style="display: block; margin-bottom: 4px;">Database (optional):</label>
      <input type="text" id="neo4j-database" placeholder="${DEFAULT_DATABASE}" style="width: 100%; padding: 5px; border: 1px solid #ccc; border-radius: 3px;">
    </div>
    <div style="margin-bottom: 12px;">
      <label for="neo4j-query" style="display: block; margin-bottom: 4px;">Cypher query (must return nodes, relationships, or paths):</label>
      <textarea id="neo4j-query" rows="4" style="width: 100%; padding: 5px; border: 1px solid #ccc; border-radius: 3px; font-family: monospace;">MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 500</textarea>
    </div>
    <div style="background-color: #f5f5f5; padding: 10px; border-radius: 5px; margin-bottom: 12px; font-size: 12px; color: #666;">
      Uses the Neo4j HTTP API (port 7474/7473). Credentials are sent only to the
      server above and are not stored; the URL, username, database, and query
      are remembered locally. Prefer https:// for remote servers — Basic auth
      over http:// is unencrypted. Neo4j Aura (Bolt-only) is not supported.
    </div>
    <div class="p-footer">
      <button id="neo4j-cancel-btn" class="p-button p-button-secondary">Cancel</button>
      <button id="neo4j-load-btn" class="p-button p-button-primary">Fetch</button>
    </div>
  `;
  form.querySelector('#neo4j-url').value = saved.url ?? '';
  form.querySelector('#neo4j-username').value = saved.username ?? '';
  form.querySelector('#neo4j-database').value = saved.database ?? '';
  if (saved.query) form.querySelector('#neo4j-query').value = saved.query;
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
  const opts = deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {};

  try {
    await cache.ui.showLoading('Neo4j', `Counting query results on ${config.url} …`);
    const rowCount = await countQueryRows(config, config.query, opts);
    await cache.ui.hideLoading();

    if (rowCount !== null && rowCount > LARGE_RESULT_ROW_THRESHOLD) {
      const proceed = await confirm(
        `The query matches ${rowCount.toLocaleString()} rows, which may be slow to fetch and render. Continue anyway? (Tip: add a LIMIT clause.)`,
      );
      if (proceed !== true) return false;
    }

    await cache.ui.showLoading('Neo4j', `Fetching graph from ${config.url} …`);
    const results = await runCypher(
      config,
      [{ statement: config.query, resultDataContents: ['graph'] }],
      opts,
    );
    const { nodes, relationships } = collectGraph(results);
    await cache.ui.hideLoading();

    if (nodes.length === 0) {
      cache.ui.error(
        'The query returned no graph elements. Return nodes, relationships, or paths (e.g. MATCH (n)-[r]->(m) RETURN n, r, m).',
      );
      return false;
    }

    const exclusions = await checklist(collectPropertyKeys(nodes, relationships));
    if (!exclusions) return false;

    const rendered = await apply(cache, toAppFormat(nodes, relationships, exclusions));
    if (rendered) {
      cache.ui.setDataSourceLabel(`Neo4j: ${config.database}`);
    }
    return rendered;
  } catch (err) {
    await cache.ui.hideLoading();
    const hint =
      err.name === 'TimeoutError'
        ? 'The request timed out.'
        : err.message === 'Failed to fetch'
          ? 'Could not reach the server — check the URL, that the HTTP connector is enabled, and CORS settings.'
          : err.message;
    cache.ui.error(`Neo4j: ${hint}`);
    return false;
  }
}

/**
 * Full interactive flow: connection form, then executeNeo4jImport.
 *
 * @param {object} cache  the app cache
 * @returns {Promise<boolean>} true when a graph was rendered
 */
function openNeo4jPopup(cache) {
  const form = buildConnectionForm(readSavedSettings());
  // Grab button references before constructing the Popup — it relocates the
  // .p-footer out of the content element, so querying the form afterwards
  // would come up empty. The references stay valid across the move.
  const loadBtn = form.querySelector('#neo4j-load-btn');
  const cancelBtn = form.querySelector('#neo4j-cancel-btn');

  return new Promise((resolve) => {
    const popup = new Popup(form, {
      title: 'Load from Neo4j',
      width: '480px',
      showFullscreenButton: false,
      closeOnClickOutside: false,
      onClose: () => resolve(false),
    });

    const readConfig = () => ({
      url: form.querySelector('#neo4j-url').value.trim(),
      username: form.querySelector('#neo4j-username').value.trim(),
      password: form.querySelector('#neo4j-password').value,
      database: form.querySelector('#neo4j-database').value.trim() || DEFAULT_DATABASE,
      query: form.querySelector('#neo4j-query').value.trim(),
    });

    const handleLoad = async () => {
      const config = readConfig();
      if (!config.url || !config.query) {
        cache.ui.error('Server URL and Cypher query are required.');
        return;
      }
      try {
        new URL(config.url);
      } catch {
        cache.ui.error(`Invalid server URL: ${config.url}`);
        return;
      }

      popup.close();
      saveSettings(config);
      resolve(await executeNeo4jImport(cache, config));
    };

    loadBtn.addEventListener('click', handleLoad);
    cancelBtn.addEventListener('click', () => {
      popup.close();
      resolve(false);
    });
    setTimeout(() => form.querySelector('#neo4j-url').focus(), 100);
  });
}

export {
  openNeo4jPopup,
  executeNeo4jImport,
  buildConnectionForm,
  sanitizeForAST,
  runCypher,
  countQueryRows,
  collectGraph,
  collectPropertyKeys,
  toAppFormat,
  coerceValue,
  buildTxUrl,
  basicAuth,
  nodeDisplayLabel,
  readSavedSettings,
  saveSettings,
  showPropertyChecklist,
  DEFAULT_DATABASE,
  LARGE_RESULT_ROW_THRESHOLD,
  LARGE_ARRAY_THRESHOLD,
  SETTINGS_STORAGE_KEY,
};
