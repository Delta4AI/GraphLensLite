// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { initApiClient, applyGraph, isHttpContext, DATA_SOURCE_LABEL } from "../src/managers/api_client.js";

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
    expect(cache.io.restoreSetsFromJSON).toHaveBeenCalledWith(VALID);
    expect(cache.io.preProcessData).toHaveBeenCalledWith(VALID);
    expect(cache.buildDataTable).toHaveBeenCalledWith(VALID);
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

describe("initApiClient", () => {
  it("always exposes window.renderGraphData", () => {
    vi.stubGlobal("location", { protocol: "file:" });
    const cache = makeCache();
    initApiClient(cache, { fetchImpl: undefined, EventSourceImpl: undefined });
    expect(typeof window.renderGraphData).toBe("function");
  });

  it("stays inert (no SSE) under file://", () => {
    vi.stubGlobal("location", { protocol: "file:" });
    const cache = makeCache();
    const fetchImpl = vi.fn();
    const result = initApiClient(cache, { fetchImpl, EventSourceImpl: FakeEventSource });
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches the initial graph and opens an SSE connection under http", async () => {
    vi.stubGlobal("location", { protocol: "http:" });
    const cache = makeCache();
    const fetchImpl = vi.fn().mockResolvedValue({ status: 200, json: () => Promise.resolve(VALID) });
    const source = initApiClient(cache, { fetchImpl, EventSourceImpl: FakeEventSource });

    expect(fetchImpl).toHaveBeenCalledWith("/api/graph");
    expect(source).toBeInstanceOf(FakeEventSource);
    expect(source.url).toBe("/api/events");

    await new Promise((r) => setTimeout(r, 0));
    expect(cache.io.preProcessData).toHaveBeenCalledWith(VALID);
  });

  it("renders a graph pushed over SSE", async () => {
    vi.stubGlobal("location", { protocol: "http:" });
    const cache = makeCache();
    const fetchImpl = vi.fn().mockResolvedValue({ status: 204, json: () => Promise.resolve(null) });
    const source = initApiClient(cache, { fetchImpl, EventSourceImpl: FakeEventSource });

    source.emit("graph", { data: JSON.stringify(VALID) });
    await Promise.resolve();
    expect(cache.io.preProcessData).toHaveBeenCalledWith(VALID);
  });

  it("reports an error for malformed SSE data", async () => {
    vi.stubGlobal("location", { protocol: "http:" });
    const cache = makeCache();
    const fetchImpl = vi.fn().mockResolvedValue({ status: 204, json: () => Promise.resolve(null) });
    const source = initApiClient(cache, { fetchImpl, EventSourceImpl: FakeEventSource });

    source.emit("graph", { data: "{broken" });
    await Promise.resolve();
    expect(cache.ui.error).toHaveBeenCalled();
  });
});
