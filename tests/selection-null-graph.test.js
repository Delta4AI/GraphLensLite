import { describe, it, expect, beforeEach, vi } from "vitest";
import { GraphSelectionManager } from "../src/graph/selection.js";

// ==========================================================================
// Null-graph guards on the UI-reachable GraphSelectionManager entry points.
// cache.graph === null covers both "no data loaded yet" and "WebGL init
// failed" (dead renderer, chrome stays interactive) — in both states the
// selection handlers must be silent no-ops: no crash, no toast, no loading
// overlay, no selection-memory mutation.
// ==========================================================================

function createMockCache() {
  return {
    graph: null,
    nodeRef: new Map([["n1", { id: "n1" }]]),
    edgeRef: new Map([["e1", { id: "e1" }]]),
    selectedMemoryIndex: 1,
    selectionMemory: [
      { nodes: [], edges: [] },
      { nodes: ["n1"], edges: [] },
      { nodes: ["n1"], edges: ["e1"] },
    ],
    ui: {
      showLoading: vi.fn(async () => {}),
      hideLoading: vi.fn(async () => {}),
      warning: vi.fn(),
      error: vi.fn(),
    },
  };
}

describe("GraphSelectionManager with cache.graph === null", () => {
  let cache, sm;

  beforeEach(() => {
    cache = createMockCache();
    sm = new GraphSelectionManager(cache);
  });

  it("selectElements is a silent no-op", async () => {
    await expect(sm.selectElements(["n1"], cache.nodeRef)).resolves.toBeUndefined();
    expect(cache.ui.error).not.toHaveBeenCalled();
  });

  it("selectNodes and selectEdges are silent no-ops", async () => {
    await expect(sm.selectNodes(["n1"])).resolves.toBeUndefined();
    await expect(sm.selectEdges(["e1"])).resolves.toBeUndefined();
    expect(cache.ui.error).not.toHaveBeenCalled();
  });

  it("updateSelectedState bails before showing the loading overlay", async () => {
    await expect(sm.updateSelectedState([{ id: "n1" }], true)).resolves.toBeUndefined();
    expect(cache.ui.showLoading).not.toHaveBeenCalled();
  });

  it("getSelectedNodes returns an empty array", async () => {
    await expect(sm.getSelectedNodes()).resolves.toEqual([]);
  });

  it("toggleSelectionForAllNodes/Edges are silent no-ops", async () => {
    await expect(sm.toggleSelectionForAllNodes(true)).resolves.toBeUndefined();
    await expect(sm.toggleSelectionForAllEdges(false)).resolves.toBeUndefined();
    expect(cache.ui.showLoading).not.toHaveBeenCalled();
  });

  it("undoSelection does not move the memory index or toast", () => {
    sm.undoSelection();

    expect(cache.selectedMemoryIndex).toBe(1);
    expect(cache.ui.warning).not.toHaveBeenCalled();
  });

  it("redoSelection does not move the memory index or toast", () => {
    sm.redoSelection();

    expect(cache.selectedMemoryIndex).toBe(1);
    expect(cache.ui.warning).not.toHaveBeenCalled();
  });
});
