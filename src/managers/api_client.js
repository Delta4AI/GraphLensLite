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

/** @returns {boolean} true when running over http/https (i.e. served by the service) */
function isHttpContext() {
  return typeof location !== "undefined" && /^https?:$/.test(location.protocol);
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

  cache.ui.setDataSourceLabel(DATA_SOURCE_LABEL);
  await cache.ui.showLoading("Loading", `Rendering graph (${data.nodes.length} nodes, ${data.edges.length} edges)`);

  try {
    // Restore Sets/Maps for native JSON parity (no-op for minimal payloads).
    cache.io.restoreSetsFromJSON(data);

    if (cache.graph) {
      await cache.gcm.destroyGraphAndRollBackUI();
      await cache.gcm.resetEventLocks();
    }

    cache.io.preProcessData(data);
    cache.ui.updateHoverToggleButton();
    cache.buildDataTable(data);
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
    await cache.ui.hideLoading();
  }
}

/**
 * Wire up the live ingest client. Always exposes `window.renderGraphData`.
 * Opens the SSE connection only in an http(s) context.
 *
 * @param {object} cache
 * @param {object} [deps]  Injectable for tests.
 * @param {Function} [deps.fetchImpl]
 * @param {Function} [deps.EventSourceImpl]
 * @returns {EventSource|null} the live connection, or null when inert.
 */
function initApiClient(cache, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : null);
  const EventSourceImpl =
    deps.EventSourceImpl ?? (typeof EventSource !== "undefined" ? EventSource : null);

  if (typeof window !== "undefined") {
    window.renderGraphData = (data) => applyGraph(cache, data);
  }

  if (!isHttpContext()) return null;

  // Initial state: render whatever graph the service already holds.
  if (fetchImpl) {
    fetchImpl("/api/graph")
      .then((res) => (res.status === 200 ? res.json() : null))
      .then((data) => {
        if (data) return applyGraph(cache, data);
      })
      .catch(() => {
        /* no service or no graph yet — stay on the landing screen */
      });
  }

  if (!EventSourceImpl) return null;

  const source = new EventSourceImpl("/api/events");
  source.addEventListener("graph", (event) => {
    try {
      applyGraph(cache, JSON.parse(event.data));
    } catch (err) {
      cache?.ui?.error?.(`Failed to apply pushed graph: ${err.message}`);
    }
  });
  // EventSource reconnects automatically on error; nothing to do here.
  return source;
}

export { initApiClient, applyGraph, isHttpContext, DATA_SOURCE_LABEL };
