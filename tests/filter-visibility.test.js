import { describe, it, expect, beforeEach, vi } from "vitest";
import { GraphFilterManager } from "../src/graph/filter.js";

// ==========================================================================
// updateElementVisibility (sigma migration Phase 1) — diffs requested
// show/hide ids against the renderer's current visibility (style.visibility,
// backed by graphology `hidden` attrs) and only pushes actual changes.
// ==========================================================================

function item(id, visibility) {
  return { id, style: { visibility } };
}

function createMockCache({ nodes = [], edges = [] } = {}) {
  return {
    visibleElementsChanged: false,
    graph: {
      // Sync like the real SigmaAdapter.getData (callers await it, a no-op).
      getData: vi.fn(() => ({ nodes, edges })),
      showElement: vi.fn(async () => {}),
      hideElement: vi.fn(async () => {}),
    },
    metrics: {
      invalidateMetricValues: vi.fn(),
    },
  };
}

describe("GraphFilterManager.updateElementVisibility", () => {
  let cache, fm;

  beforeEach(() => {
    cache = createMockCache({
      nodes: [item("n1", "visible"), item("n2", "hidden"), item("n3", "visible")],
      edges: [item("e1", "hidden"), item("e2", "visible")],
    });
    fm = new GraphFilterManager(cache);
  });

  it("shows only ids that are currently hidden", async () => {
    await fm.updateElementVisibility(["n1", "n2", "e1"], []);

    expect(cache.graph.showElement).toHaveBeenCalledTimes(1);
    expect(cache.graph.showElement).toHaveBeenCalledWith(["n2", "e1"]);
    expect(cache.graph.hideElement).not.toHaveBeenCalled();
    expect(cache.visibleElementsChanged).toBe(true);
  });

  it("hides only ids that are currently visible", async () => {
    await fm.updateElementVisibility([], ["n2", "n3", "e2"]);

    expect(cache.graph.hideElement).toHaveBeenCalledTimes(1);
    expect(cache.graph.hideElement).toHaveBeenCalledWith(["n3", "e2"]);
    expect(cache.graph.showElement).not.toHaveBeenCalled();
    expect(cache.visibleElementsChanged).toBe(true);
  });

  it("applies show and hide diffs in the same pass", async () => {
    await fm.updateElementVisibility(["n2"], ["n1"]);

    expect(cache.graph.showElement).toHaveBeenCalledWith(["n2"]);
    expect(cache.graph.hideElement).toHaveBeenCalledWith(["n1"]);
    expect(cache.metrics.invalidateMetricValues).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when requested state matches current state", async () => {
    await fm.updateElementVisibility(["n1", "n3", "e2"], ["n2", "e1"]);

    expect(cache.graph.showElement).not.toHaveBeenCalled();
    expect(cache.graph.hideElement).not.toHaveBeenCalled();
    expect(cache.visibleElementsChanged).toBe(false);
    expect(cache.metrics.invalidateMetricValues).not.toHaveBeenCalled();
  });

  it("ignores ids unknown to the renderer", async () => {
    await fm.updateElementVisibility(["ghost1"], ["ghost2"]);

    expect(cache.graph.showElement).not.toHaveBeenCalled();
    expect(cache.graph.hideElement).not.toHaveBeenCalled();
    expect(cache.visibleElementsChanged).toBe(false);
  });

  it("handles empty inputs without touching the renderer", async () => {
    await fm.updateElementVisibility([], []);

    expect(cache.graph.showElement).not.toHaveBeenCalled();
    expect(cache.graph.hideElement).not.toHaveBeenCalled();
    expect(cache.visibleElementsChanged).toBe(false);
  });

  it("invalidates metrics exactly once when anything changed", async () => {
    await fm.updateElementVisibility(["n2", "e1"], ["n1", "e2"]);

    expect(cache.metrics.invalidateMetricValues).toHaveBeenCalledTimes(1);
  });

  it("is a silent no-op when the renderer is unavailable (cache.graph null)", async () => {
    // Same state as "no data loaded yet" — must not crash or invalidate.
    cache.graph = null;

    await expect(fm.updateElementVisibility(["n1"], ["n2"])).resolves.toBeUndefined();
    expect(cache.metrics.invalidateMetricValues).not.toHaveBeenCalled();
    expect(cache.visibleElementsChanged).toBe(false);
  });
});
