// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { GraphSelectionManager } from "../src/graph/selection.js";

// --------------------------------------------------------------------------
// Regression: each group row's ＋/－ button must reflect the CURRENT selection
// (it says how many nodes a click will add or remove). cache.selectedNodes is
// only recomputed inside updateSelectedNodesAndEdges (the after-draw refresh),
// so the resync must happen there — not in updateSelectedState, which runs
// before the refresh and would read a stale selection.
//
// The control changed shape (a 2×2 quadrant pie became one button per named
// group) but the ordering constraint is identical, so this test outlives it.
// --------------------------------------------------------------------------

function mountDom() {
  document.body.innerHTML = `
    <strong id="selectedNodes"></strong>
    <strong id="selectedEdges"></strong>
    <div id="selectedElementsContainer"></div>
    <div id="stylingSelectionStatus"></div>
  `;
}

function makeCache() {
  return {
    graph: {
      getNodeData: () => [
        { id: "n1", states: ["selected"] },
        { id: "n2", states: [] },
      ],
      getEdgeData: () => [],
    },
    nodeIDsToBeShown: new Set(["n1", "n2"]),
    edgeIDsToBeShown: new Set(),
    selectedNodes: ["stale"], // pre-existing stale value the button must NOT see
    selectedEdges: [],
    bs: { syncGroupRows: vi.fn() },
    ui: {
      syncStylingCardsToSelection: vi.fn(),
      toggleStyleElementsThatRequireAtLeastOneSelectedNode: vi.fn(),
      toggleStyleElementsThatRequireAtLeastOneSelectedEdge: vi.fn(),
      toggleStyleElementsThatRequireAtLeastOneSelectedNodeOrEdge: vi.fn(),
      toggleStyleElementsThatRequireMoreThanOneSelectedNode: vi.fn(),
      toggleStyleElementsThatRequireExactlyTwoSelectedNodes: vi.fn(),
    },
  };
}

describe("updateSelectedNodesAndEdges — group-row button resync", () => {
  let cache, sm;

  beforeEach(() => {
    mountDom();
    cache = makeCache();
    sm = new GraphSelectionManager(cache);
    // Sidestep the module-global `cache` reference and undo/redo button DOM.
    sm.updateSelectionCache = vi.fn();
    sm.updateEnabledStateUndoRedoSelectionButtons = vi.fn();
  });

  it("resyncs the button after refreshing cache.selectedNodes", async () => {
    let selectionSeenByButton;
    cache.bs.syncGroupRows.mockImplementation(() => {
      selectionSeenByButton = [...cache.selectedNodes];
    });

    await sm.updateSelectedNodesAndEdges();

    expect(cache.bs.syncGroupRows).toHaveBeenCalledTimes(1);
    // The button must see the fresh selection, not the stale pre-call value.
    expect(selectionSeenByButton).toEqual(["n1"]);
  });

  it("does not resync from updateSelectedState (stale-read path removed)", async () => {
    cache.graph.getElementState = vi.fn(async () => []);
    cache.graph.setElementState = vi.fn(async () => {});
    cache.ui.showLoading = vi.fn(async () => {});
    cache.ui.hideLoading = vi.fn(async () => {});

    await sm.updateSelectedState([{ id: "n1" }], true);

    expect(cache.bs.syncGroupRows).not.toHaveBeenCalled();
  });
});
