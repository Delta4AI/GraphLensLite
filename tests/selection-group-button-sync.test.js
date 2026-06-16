// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { GraphSelectionManager } from "../src/graph/selection.js";

// --------------------------------------------------------------------------
// Regression: the "Add to group" four-way quadrant button must reflect the
// CURRENT selection. cache.selectedNodes is only recomputed inside
// updateSelectedNodesAndEdges (the after-draw refresh), so the button resync
// must happen there — not in updateSelectedState, which runs before the
// refresh and would read a stale selection.
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
    bs: { updateManualGroupButtonState: vi.fn() },
    ui: {
      syncStylingCardsToSelection: vi.fn(),
      toggleStyleElementsThatRequireAtLeastOneSelectedNode: vi.fn(),
      toggleStyleElementsThatRequireAtLeastOneSelectedEdge: vi.fn(),
      toggleStyleElementsThatRequireAtLeastOneSelectedNodeOrEdge: vi.fn(),
      toggleStyleElementsThatRequireMoreThanOneSelectedNode: vi.fn(),
    },
  };
}

describe("updateSelectedNodesAndEdges — quadrant button resync", () => {
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
    cache.bs.updateManualGroupButtonState.mockImplementation(() => {
      selectionSeenByButton = [...cache.selectedNodes];
    });

    await sm.updateSelectedNodesAndEdges();

    expect(cache.bs.updateManualGroupButtonState).toHaveBeenCalledTimes(1);
    // The button must see the fresh selection, not the stale pre-call value.
    expect(selectionSeenByButton).toEqual(["n1"]);
  });

  it("does not resync from updateSelectedState (stale-read path removed)", async () => {
    cache.graph.getElementState = vi.fn(async () => []);
    cache.graph.setElementState = vi.fn(async () => {});
    cache.ui.showLoading = vi.fn(async () => {});
    cache.ui.hideLoading = vi.fn(async () => {});

    await sm.updateSelectedState([{ id: "n1" }], true);

    expect(cache.bs.updateManualGroupButtonState).not.toHaveBeenCalled();
  });
});
