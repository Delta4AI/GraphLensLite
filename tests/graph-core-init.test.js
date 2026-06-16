// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { GraphCoreManager } from "../src/graph/core.js";

// ==========================================================================
// createGraphInstance re-entrancy (WebGL2-probe rework). The init body has
// await points (lazy sigma_adapter import, layout passes), so two rapid
// calls used to race past the `cache.graph === null` check and construct
// two SigmaAdapters — the first one orphaned, leaking a WebGL context.
// The in-flight promise is memoized on `graphInitPromise` and cleared in
// finally so a failed init (cache.graph stays null) remains retryable.
// ==========================================================================

// Hoisted, mutable adapter-construction state shared with the module mock.
const adapter = vi.hoisted(() => ({ constructions: 0, failuresLeft: 0 }));

vi.mock("../src/graph/sigma_adapter.js", () => ({
  SigmaAdapter: class SigmaAdapter {
    constructor() {
      adapter.constructions++;
      if (adapter.failuresLeft > 0) {
        adapter.failuresLeft--;
        throw new Error("context limit reached");
      }
    }
  },
}));

vi.mock("../src/graph/graph_model.js", () => ({
  buildGraphologyGraph: vi.fn(() => ({})),
  makeNodeReducer: vi.fn(() => () => ({})),
  makeEdgeReducer: vi.fn(() => () => ({})),
}));

vi.mock("../src/graph/webgl_support.js", () => ({
  isWebGL2Available: vi.fn(() => true),
  renderWebGLUnavailableMessage: vi.fn(),
  WEBGL2_ERROR_MESSAGE: "no webgl2",
}));

function createMockCache() {
  return {
    graph: null,
    graphData: null,
    data: {
      selectedLayout: "default",
      // Non-empty positions + no custom styles: skips applyLayoutStyles and
      // setLayout, so the test exercises exactly the construction race.
      layouts: { default: { positions: new Map([["n1", { x: 0, y: 0 }]]) } },
    },
    ui: { error: vi.fn() },
  };
}

describe("GraphCoreManager.createGraphInstance re-entrancy", () => {
  let cache, gcm;

  beforeEach(() => {
    adapter.constructions = 0;
    adapter.failuresLeft = 0;
    cache = createMockCache();
    gcm = new GraphCoreManager(cache);
  });

  it("constructs a single SigmaAdapter for two overlapping calls", async () => {
    await Promise.all([gcm.createGraphInstance(), gcm.createGraphInstance()]);

    expect(adapter.constructions).toBe(1);
    expect(cache.graph).not.toBeNull();
  });

  it("returns immediately once a graph instance exists", async () => {
    await gcm.createGraphInstance();
    await gcm.createGraphInstance();

    expect(adapter.constructions).toBe(1);
  });

  it("clears the in-flight memo so a failed init can be retried", async () => {
    adapter.failuresLeft = 1;

    await gcm.createGraphInstance();
    expect(cache.graph).toBeNull();
    expect(cache.ui.error).toHaveBeenCalledTimes(1);
    expect(gcm.graphInitPromise).toBeNull();

    await gcm.createGraphInstance();
    expect(adapter.constructions).toBe(2);
    expect(cache.graph).not.toBeNull();
  });

  it("shares one failing init between overlapping calls without throwing", async () => {
    adapter.failuresLeft = 1;

    await expect(
      Promise.all([gcm.createGraphInstance(), gcm.createGraphInstance()]),
    ).resolves.toBeDefined();

    expect(adapter.constructions).toBe(1);
    expect(cache.graph).toBeNull();
  });
});
