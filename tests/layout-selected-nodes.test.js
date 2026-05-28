import { describe, it, expect, beforeEach, vi } from "vitest";

// ==========================================================================
// Regression: Arrange Selection actions must push the mutated node positions
// to the G6 graph via updateNodeData(). Without that call the layout only
// becomes visible once the selection state changes — see layout.js comment
// above the updateNodeData() call in layoutSelectedNodes().
// ==========================================================================

// Stub Popup before importing layout.js (layout.js imports it eagerly).
vi.mock("../src/utilities/popup.js", () => ({ Popup: {} }));

const { GraphLayoutManager } = await import("../src/graph/layout.js").then(m => ({
  GraphLayoutManager: m.default || m.GraphLayoutManager || Object.values(m)[0],
}));

function makeNode(id, x, y) {
  return { id, style: { x, y } };
}

function createMockCache(nodes, edges = []) {
  const nodeRef = new Map(nodes.map(n => [n.id, n]));
  const positions = new Map();

  const cache = {
    nodeRef,
    selectedNodes: nodes.map(n => n.id),
    selectedEdges: [],
    layoutChanged: false,
    data: {
      selectedLayout: "default",
      layouts: {
        default: { positions },
      },
    },
    sm: {
      getSelectedNodes: async () => nodes,
    },
    graph: {
      updateNodeData: vi.fn(),
      getEdgeData: async () => edges,
      getNodeData: async () => nodes,
    },
    ui: {
      showLoading: vi.fn(async () => {}),
      debug: vi.fn(),
    },
    gcm: {
      decideToRenderOrDraw: vi.fn(async () => {}),
    },
  };
  return cache;
}

describe("layoutSelectedNodes — syncs positions to the graph", () => {
  let cache, lm;

  beforeEach(() => {
    cache = createMockCache([
      makeNode("a", 0, 0),
      makeNode("b", 100, 0),
      makeNode("c", 0, 100),
    ]);
    lm = new GraphLayoutManager(cache);
  });

  for (const action of ["shrink", "expand", "circle", "force", "grid", "random"]) {
    it(`calls graph.updateNodeData with the post-${action} positions`, async () => {
      await lm.layoutSelectedNodes(action);

      expect(cache.graph.updateNodeData).toHaveBeenCalledTimes(1);

      const payload = cache.graph.updateNodeData.mock.calls[0][0];
      expect(payload).toHaveLength(3);

      // Every payload entry must carry the live x/y from the cached node ref.
      // This is what the bug guards: if updateNodeData is skipped, G6 never
      // sees these coordinates until the selection changes.
      for (const entry of payload) {
        const node = cache.nodeRef.get(entry.id);
        expect(entry.style.x).toBe(node.style.x);
        expect(entry.style.y).toBe(node.style.y);
        expect(Number.isFinite(entry.style.x)).toBe(true);
        expect(Number.isFinite(entry.style.y)).toBe(true);
      }
    });
  }

  it("persists the new positions to the active layout's position map", async () => {
    await lm.layoutSelectedNodes("grid");

    const stored = cache.data.layouts.default.positions;
    expect(stored.size).toBe(3);
    for (const id of ["a", "b", "c"]) {
      const node = cache.nodeRef.get(id);
      expect(stored.get(id).style.x).toBe(node.style.x);
      expect(stored.get(id).style.y).toBe(node.style.y);
    }
  });

  it("triggers a redraw via gcm.decideToRenderOrDraw", async () => {
    await lm.layoutSelectedNodes("circle");
    expect(cache.gcm.decideToRenderOrDraw).toHaveBeenCalledTimes(1);
    expect(cache.layoutChanged).toBe(true);
  });

  it("is a no-op when nothing is selected", async () => {
    cache.selectedNodes = [];
    cache.sm.getSelectedNodes = async () => [];

    await lm.layoutSelectedNodes("force");

    expect(cache.graph.updateNodeData).not.toHaveBeenCalled();
    expect(cache.gcm.decideToRenderOrDraw).not.toHaveBeenCalled();
  });
});
