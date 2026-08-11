import { describe, it, expect, beforeEach, vi } from "vitest";
import { GraphSelectionManager } from "../src/graph/selection.js";

// ==========================================================================
// syncSelectionCacheAndElementStates — the body behind selection undo/redo.
// It republishes the snapshot at selectedMemoryIndex into cache.selectedNodes/
// Edges, adds or removes the 'selected' state on every live element to match,
// and resyncs the group rows. Only the null-graph guard was covered before.
// ==========================================================================

function makeCache() {
  return {
    graph: {
      getNodeData: () => [
        { id: "n1", states: [] },
        { id: "n2", states: ["selected", "hovered"] },
      ],
      getEdgeData: () => [{ id: "e1", states: ["selected"] }],
      // The manager reads states through the adapter, not off the view objects.
      getElementState: vi.fn((id) => ({ n1: [], n2: ["selected", "hovered"], e1: ["selected"] })[id]),
      setElementState: vi.fn(async () => {}),
    },
    selectedMemoryIndex: 1,
    selectionMemory: [
      { nodes: [], edges: [] },
      { nodes: ["n1"], edges: [] },
      { nodes: ["n1", "n2"], edges: ["e1"] },
    ],
    selectedNodes: ["stale"],
    selectedEdges: ["stale"],
    bs: { syncGroupRows: vi.fn() },
    ui: { warning: vi.fn() },
  };
}

describe("syncSelectionCacheAndElementStates", () => {
  let cache, sm;

  beforeEach(() => {
    cache = makeCache();
    sm = new GraphSelectionManager(cache);
  });

  it("republishes the snapshot and reconciles states in both directions", async () => {
    await sm.syncSelectionCacheAndElementStates();

    expect(cache.selectedNodes).toEqual(["n1"]);
    expect(cache.selectedEdges).toEqual([]);

    const stateMap = cache.graph.setElementState.mock.calls[0][0];
    expect(stateMap.n1).toEqual(["selected"]); // in the snapshot, gains the state
    expect(stateMap.n2).toEqual(["hovered"]); // out of it, loses only 'selected'
    expect(stateMap.e1).toEqual([]); // edges reconcile the same way
    expect(cache.bs.syncGroupRows).toHaveBeenCalledOnce();
  });

  it("is what undo and redo move through", async () => {
    sm.undoSelection();
    expect(cache.selectedMemoryIndex).toBe(0);
    expect(cache.selectedNodes).toEqual([]);

    cache.graph.getElementState = vi.fn(() => []);
    sm.redoSelection();
    expect(cache.selectedMemoryIndex).toBe(1);
    expect(cache.selectedNodes).toEqual(["n1"]);
  });

  it("warns at the ends of the memory instead of moving past them", () => {
    cache.selectedMemoryIndex = 0;
    sm.undoSelection();
    expect(cache.ui.warning).toHaveBeenCalledWith("Cannot undo!");

    cache.selectedMemoryIndex = cache.selectionMemory.length - 1;
    sm.redoSelection();
    expect(cache.ui.warning).toHaveBeenCalledWith("Cannot redo!");
    expect(cache.selectedMemoryIndex).toBe(cache.selectionMemory.length - 1);
  });
});
