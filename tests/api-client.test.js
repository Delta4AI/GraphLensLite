// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  initApiClient,
  applyGraph,
  normalizeGraph,
  isHttpContext,
  readSessionId,
  sseEventsUrl,
  DATA_SOURCE_LABEL,
} from "../src/managers/api_client.js";

function makeCache({ layouts = {}, selectedLayout = "default" } = {}) {
  const cache = {
    graph: null,
    data: { layouts, selectedLayout },
    EVENT_LOCKS: {},
    io: {
      restoreSetsFromJSON: vi.fn(),
      preProcessData: vi.fn(),
    },
    gcm: {
      destroyGraphAndRollBackUI: vi.fn().mockResolvedValue(undefined),
      resetEventLocks: vi.fn().mockResolvedValue(undefined),
      createGraphInstance: vi.fn().mockImplementation(async () => {
        cache.graph = { render: vi.fn().mockResolvedValue(undefined) };
      }),
      fitViewToVisibleNodes: vi.fn().mockResolvedValue(undefined),
    },
    ui: {
      updateHoverToggleButton: vi.fn(),
      buildUI: vi.fn(),
      setDataSourceLabel: vi.fn(),
      updateFilterLockState: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      showLoading: vi.fn().mockResolvedValue(undefined),
      hideLoading: vi.fn().mockResolvedValue(undefined),
    },
    qm: {
      updateQueryTextArea: vi.fn(),
      updateUIFromQueryInstructions: vi.fn(),
    },
    buildDataTable: vi.fn(),
  };
  return cache;
}

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = {};
  }
  addEventListener(type, cb) {
    (this.listeners[type] ||= []).push(cb);
  }
  emit(type, event) {
    (this.listeners[type] || []).forEach((cb) => cb(event));
  }
}

const VALID = { nodes: [{ id: "A" }], edges: [] };

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.renderGraphData;
});

describe("applyGraph", () => {
  it("renders a valid graph and reports success", async () => {
    const cache = makeCache();
    const ok = await applyGraph(cache, VALID);
    expect(ok).toBe(true);
    const normalized = expect.objectContaining({
      nodes: VALID.nodes,
      edges: VALID.edges,
      nodeDataHeaders: [],
      edgeDataHeaders: [],
    });
    expect(cache.io.restoreSetsFromJSON).toHaveBeenCalledWith(normalized);
    expect(cache.io.preProcessData).toHaveBeenCalledWith(normalized);
    expect(cache.buildDataTable).toHaveBeenCalledWith(normalized);
    expect(cache.ui.buildUI).toHaveBeenCalled();
    expect(cache.gcm.createGraphInstance).toHaveBeenCalled();
    expect(cache.graph.render).toHaveBeenCalled();
    expect(cache.gcm.fitViewToVisibleNodes).toHaveBeenCalled();
    expect(cache.ui.setDataSourceLabel).toHaveBeenCalledWith(DATA_SOURCE_LABEL);
  });

  it("tears down an existing graph before rendering a new one", async () => {
    const cache = makeCache();
    cache.graph = { render: vi.fn() };
    await applyGraph(cache, VALID);
    expect(cache.gcm.destroyGraphAndRollBackUI).toHaveBeenCalled();
    expect(cache.gcm.resetEventLocks).toHaveBeenCalled();
  });

  it("returns false and reports an error for a payload without nodes/edges", async () => {
    const cache = makeCache();
    const ok = await applyGraph(cache, { foo: 1 });
    expect(ok).toBe(false);
    expect(cache.ui.error).toHaveBeenCalled();
    expect(cache.gcm.createGraphInstance).not.toHaveBeenCalled();
  });

  it("returns false for null", async () => {
    const cache = makeCache();
    expect(await applyGraph(cache, null)).toBe(false);
  });

  it("hides the loading overlay even when rendering fails", async () => {
    const cache = makeCache();
    cache.gcm.createGraphInstance = vi.fn().mockResolvedValue(undefined); // leaves cache.graph null
    const ok = await applyGraph(cache, VALID);
    expect(ok).toBe(false);
    expect(cache.ui.showLoading).toHaveBeenCalled();
    expect(cache.ui.hideLoading).toHaveBeenCalled();
  });

  it("applies the saved-query lock path when the layout carries a query", async () => {
    const cache = makeCache({ layouts: { default: { query: "Size > 5" } }, selectedLayout: "default" });
    await applyGraph(cache, VALID);
    expect(cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY).toBe(true);
    expect(cache.qm.updateQueryTextArea).toHaveBeenCalled();
    expect(cache.ui.updateFilterLockState).toHaveBeenCalled();
  });

  it("skips the query path when no saved query exists", async () => {
    const cache = makeCache();
    await applyGraph(cache, VALID);
    expect(cache.qm.updateQueryTextArea).not.toHaveBeenCalled();
  });
});

describe("normalizeGraph", () => {
  it("defaults missing header arrays so the data table can render", () => {
    const result = normalizeGraph({ nodes: [{ id: "A" }], edges: [] });
    expect(result.nodeDataHeaders).toEqual([]);
    expect(result.edgeDataHeaders).toEqual([]);
  });

  it("preserves provided headers from a full export", () => {
    const headers = [{ subGroup: "Classification", key: "Type" }];
    const result = normalizeGraph({ nodes: [], edges: [], nodeDataHeaders: headers });
    expect(result.nodeDataHeaders).toBe(headers);
  });

  it("does not mutate the input", () => {
    const input = { nodes: [], edges: [{ source: "A", target: "B" }] };
    normalizeGraph(input);
    expect(input.nodeDataHeaders).toBeUndefined();
    expect(input.edges[0].id).toBeUndefined();
  });

  it("assigns a stable id to id-less edges", () => {
    const result = normalizeGraph({ nodes: [], edges: [{ source: "A", target: "B" }] });
    expect(result.edges[0].id).toBe("A-B");
  });

  it("preserves an existing edge id", () => {
    const result = normalizeGraph({ nodes: [], edges: [{ id: "custom", source: "A", target: "B" }] });
    expect(result.edges[0].id).toBe("custom");
  });

  it("disambiguates duplicate/parallel edges into unique ids", () => {
    const result = normalizeGraph({
      nodes: [],
      edges: [
        { source: "A", target: "B" },
        { source: "A", target: "B" },
      ],
    });
    const ids = result.edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("isHttpContext", () => {
  it("is true under http", () => {
    vi.stubGlobal("location", { protocol: "http:" });
    expect(isHttpContext()).toBe(true);
  });

  it("is false under file://", () => {
    vi.stubGlobal("location", { protocol: "file:" });
    expect(isHttpContext()).toBe(false);
  });
});

describe("readSessionId", () => {
  it("returns null when no session param is present", () => {
    expect(readSessionId("")).toBeNull();
    expect(readSessionId("?foo=bar")).toBeNull();
  });

  it("returns a well-formed session id", () => {
    expect(readSessionId("?session=abc-123_X")).toBe("abc-123_X");
  });

  it("drops a malformed session id rather than forwarding it", () => {
    expect(readSessionId("?session=" + encodeURIComponent("a/b"))).toBeNull();
    expect(readSessionId("?session=" + "x".repeat(65))).toBeNull();
  });
});

describe("sseEventsUrl", () => {
  it("is the bare relative path with no session", () => {
    expect(sseEventsUrl("")).toBe("api/events");
  });

  it("appends a valid session id", () => {
    expect(sseEventsUrl("?session=room42")).toBe("api/events?session=room42");
  });

  it("omits a malformed session id", () => {
    expect(sseEventsUrl("?session=bad id")).toBe("api/events");
  });
});

describe("initApiClient", () => {
  it("always exposes window.renderGraphData", () => {
    vi.stubGlobal("location", { protocol: "file:" });
    const cache = makeCache();
    initApiClient(cache, { EventSourceImpl: undefined });
    expect(typeof window.renderGraphData).toBe("function");
  });

  it("stays inert (no SSE) under file://", () => {
    vi.stubGlobal("location", { protocol: "file:" });
    const cache = makeCache();
    const result = initApiClient(cache, { EventSourceImpl: FakeEventSource });
    expect(result).toBeNull();
  });

  it("subscribes only to the SSE events endpoint (no racing initial fetch)", () => {
    vi.stubGlobal("location", { protocol: "http:" });
    const cache = makeCache();
    const source = initApiClient(cache, { EventSourceImpl: FakeEventSource });
    expect(source).toBeInstanceOf(FakeEventSource);
    expect(source.url).toBe("api/events");
  });

  it("scopes the SSE subscription to the viewer's session param", () => {
    vi.stubGlobal("location", { protocol: "http:", search: "?session=room42" });
    const cache = makeCache();
    const source = initApiClient(cache, { EventSourceImpl: FakeEventSource });
    expect(source.url).toBe("api/events?session=room42");
  });

  it("renders a graph delivered over SSE (on-connect or push)", async () => {
    vi.stubGlobal("location", { protocol: "http:" });
    const cache = makeCache();
    const source = initApiClient(cache, { EventSourceImpl: FakeEventSource });

    source.emit("graph", { data: JSON.stringify(VALID) });
    await new Promise((r) => setTimeout(r, 0));
    expect(cache.io.preProcessData).toHaveBeenCalledWith(
      expect.objectContaining({ nodes: VALID.nodes, edges: VALID.edges }),
    );
  });

  it("coalesces overlapping pushes so applications never run concurrently", async () => {
    vi.stubGlobal("location", { protocol: "http:" });
    const cache = makeCache();
    // Make each apply observably slow so a second push arrives mid-render.
    let active = 0;
    let maxConcurrent = 0;
    cache.gcm.createGraphInstance = vi.fn().mockImplementation(async () => {
      active += 1;
      maxConcurrent = Math.max(maxConcurrent, active);
      await new Promise((r) => setTimeout(r, 5));
      cache.graph = { render: vi.fn().mockResolvedValue(undefined) };
      active -= 1;
    });
    const source = initApiClient(cache, { EventSourceImpl: FakeEventSource });

    const g2 = { nodes: [{ id: "X" }], edges: [] };
    source.emit("graph", { data: JSON.stringify(VALID) });
    source.emit("graph", { data: JSON.stringify(g2) }); // arrives mid-render
    await new Promise((r) => setTimeout(r, 40));

    expect(maxConcurrent).toBe(1); // never overlapped
    // Latest payload wins (coalesced).
    expect(cache.io.preProcessData).toHaveBeenLastCalledWith(
      expect.objectContaining({ nodes: g2.nodes }),
    );
  });

  it("reports an error for malformed SSE data", async () => {
    vi.stubGlobal("location", { protocol: "http:" });
    const cache = makeCache();
    const source = initApiClient(cache, { EventSourceImpl: FakeEventSource });

    source.emit("graph", { data: "{broken" });
    await Promise.resolve();
    expect(cache.ui.error).toHaveBeenCalled();
  });
});
