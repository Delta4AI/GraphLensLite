/**
 * Live ingest client.
 *
 * When the app is served over http(s) by the standalone service
 * (see server/), this connects to that service to (1) load the latest pushed
 * graph on startup and (2) receive live graph pushes over Server-Sent Events.
 *
 * In the Electron desktop build the page is loaded from file://, so this
 * module is inert there — `initApiClient` returns null without opening any
 * connection. `window.renderGraphData` is still exposed so a graph can be
 * applied programmatically in any context.
 */

const DATA_SOURCE_LABEL = "Live (API)";

/**
 * Accepted session-id shape. Mirrors SESSION_ID_PATTERN in server/validate.js;
 * duplicated rather than shared because that module is CommonJS/Node and this
 * is a browser bundle with no shared build step.
 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** @returns {boolean} true when running over http/https (i.e. served by the service) */
function isHttpContext() {
  return typeof location !== "undefined" && /^https?:$/.test(location.protocol);
}

/**
 * Read the `session` id from the viewer's own URL. Returns it only when it
 * matches the service's accepted format; a malformed id is dropped (the viewer
 * falls back to the default session) rather than forwarded — the SSE endpoint
 * would reject a bad id with 400 and EventSource would not reconnect.
 *
 * @param {string} [search]  Defaults to `location.search`.
 * @returns {string|null}
 */
function readSessionId(search) {
  const raw = new URLSearchParams(
    search ?? (typeof location !== "undefined" ? location.search : ""),
  ).get("session");
  return raw && SESSION_ID_PATTERN.test(raw) ? raw : null;
}

/**
 * Build the relative SSE URL, carrying the viewer's session id when present so
 * the stream is scoped to the same session the producer pushed to. Stays
 * relative (no leading slash) for reverse-proxy sub-path support.
 *
 * @param {string} [search]  Defaults to `location.search`.
 * @returns {string}
 */
function sseEventsUrl(search) {
  const id = readSessionId(search);
  return id ? `api/events?session=${encodeURIComponent(id)}` : "api/events";
}

/**
 * Normalize an incoming payload into the shape the render pipeline requires.
 * Callers may POST a bare `{ nodes, edges }`:
 *  - The data table builder (DataTable.loadTabData) maps over
 *    `nodeDataHeaders`/`edgeDataHeaders`, so those must exist.
 *  - Edge visibility is tracked by `edge.id`; id-less edges all collapse to a
 *    single `null` key and only one renders, so every edge needs a unique id.
 * A full export already carries these, in which case the provided values win.
 *
 * @param {object} data
 * @returns {object} a new object — the input is not mutated.
 */
function normalizeGraph(data) {
  const seen = new Set();
  const edges = data.edges.map((edge, index) => {
    let id = edge?.id;
    if (id == null || seen.has(id)) {
      id = `${edge?.source}-${edge?.target}`;
      if (seen.has(id)) id = `${id}-${index}`;
    }
    seen.add(id);
    return edge?.id === id ? edge : { ...edge, id };
  });

  return {
    nodeDataHeaders: [],
    edgeDataHeaders: [],
    ...data,
    edges,
  };
}

/**
 * Apply a native graph payload (same shape as a File→Open JSON / export) to the
 * running app, replacing the current graph. Mirrors IOManager.loadFileWrapper.
 *
 * @param {object} cache  The app cache (window.cache).
 * @param {object} data   Parsed graph: { nodes, edges, ...optional }.
 * @returns {Promise<boolean>} true when a graph was rendered.
 */
async function applyGraph(cache, data) {
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    cache?.ui?.error?.("Received graph payload without nodes/edges; ignoring.");
    return false;
  }

  const graph = normalizeGraph(data);

  cache.ui.setDataSourceLabel(DATA_SOURCE_LABEL);
  await cache.ui.showLoading("Loading", `Rendering graph (${graph.nodes.length} nodes, ${graph.edges.length} edges)`);

  try {
    // Restore Sets/Maps for native JSON parity (no-op for minimal payloads).
    cache.io.restoreSetsFromJSON(graph);

    if (cache.graph) {
      await cache.gcm.destroyGraphAndRollBackUI();
      await cache.gcm.resetEventLocks();
    }

    cache.io.preProcessData(graph);
    cache.ui.updateHoverToggleButton();
    cache.buildDataTable(graph);
    cache.ui.buildUI();

    const savedQuery = cache.data.layouts?.[cache.data.selectedLayout]?.query;
    if (savedQuery) {
      cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY = true;
      cache.qm.updateQueryTextArea();
      cache.qm.updateUIFromQueryInstructions();
    }

    await cache.gcm.createGraphInstance();
    if (!cache.graph) {
      cache.ui.error("Graph not initialized, aborting.");
      return false;
    }
    await cache.graph.render();
    await cache.gcm.fitViewToVisibleNodes();

    if (savedQuery) {
      cache.ui.updateFilterLockState();
    }
    return true;
  } finally {
    // Guard overlay cleanup so a hideLoading error can never mask a real
    // render failure (refreshUI touches DOM that may be absent on failure).
    try {
      await cache.ui.hideLoading();
    } catch (err) {
      cache?.ui?.debug?.(`hideLoading failed after graph apply: ${err.message}`);
    }
  }
}

/**
 * Build a serializing scheduler for graph application. Renderer teardown and
 * re-render must never overlap (the destroy/create choreography spans several
 * awaits), so applications run strictly one at a time. Under replace semantics
 * only the latest
 * payload matters, so intermediate payloads that arrive mid-render are
 * coalesced away.
 *
 * @param {object} cache
 * @returns {(data: object) => void}
 */
function createGraphScheduler(cache) {
  let rendering = false;
  let queued = null;

  return function schedule(data) {
    queued = data;
    if (rendering) return;
    rendering = true;
    (async () => {
      try {
        while (queued !== null) {
          const next = queued;
          queued = null;
          await applyGraph(cache, next);
        }
      } finally {
        rendering = false;
      }
    })();
  };
}

/**
 * Wire up the live ingest client. Always exposes `window.renderGraphData`.
 * Opens the SSE connection only in an http(s) context.
 *
 * The service streams the current graph on connect and on every push, so a
 * single SSE subscription covers both initial state and live updates — there
 * is deliberately no separate initial fetch, which would race the on-connect
 * frame and tear down a half-rendered graph.
 *
 * @param {object} cache
 * @param {object} [deps]  Injectable for tests.
 * @param {Function} [deps.EventSourceImpl]
 * @returns {EventSource|null} the live connection, or null when inert.
 */
function initApiClient(cache, deps = {}) {
  const EventSourceImpl =
    deps.EventSourceImpl ?? (typeof EventSource !== "undefined" ? EventSource : null);

  const schedule = createGraphScheduler(cache);

  if (typeof window !== "undefined") {
    window.renderGraphData = (data) => applyGraph(cache, data);
  }

  if (!isHttpContext() || !EventSourceImpl) return null;

  // Relative URL (no leading slash), like the page's other assets (gll.js,
  // lib/*, style.css). Resolved against the document URL, so it works both when
  // served at the service root (/api/events) and when mounted under a reverse-
  // proxy sub-path (e.g. /graph-lens-lite/ -> /graph-lens-lite/api/events). A
  // root-absolute "/api/events" would drop the prefix and 404 behind a proxy.
  // Carries ?session=<id> from the viewer's own URL so the stream is scoped to
  // the session the producer pushed to (omitted → shared default session).
  const source = new EventSourceImpl(sseEventsUrl());
  source.addEventListener("graph", (event) => {
    try {
      schedule(JSON.parse(event.data));
    } catch (err) {
      cache?.ui?.error?.(`Failed to apply pushed graph: ${err.message}`);
    }
  });
  // EventSource reconnects automatically on error; nothing to do here.
  return source;
}

export {
  initApiClient,
  applyGraph,
  normalizeGraph,
  isHttpContext,
  readSessionId,
  sseEventsUrl,
  DATA_SOURCE_LABEL,
};
