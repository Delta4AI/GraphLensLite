// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

// ==========================================================================
// relayoutWorkspace(layoutType) re-runs a layout algorithm across the ENTIRE
// current workspace, recomputing every node's position. It mirrors the
// addLayout template branch (setLayout → layout → persist → animated
// transition) but stays on the current workspace and only touches positions.
// The algorithm comes from the rail's Layout menu; expensive layouts on large
// graphs ask for confirmation first.
// ==========================================================================

// Controllable Popup stub (layout.js imports it eagerly at module load).
const popup = vi.hoisted(() => ({ confirm: true }));
vi.mock("../src/utilities/popup.js", () => ({
  Popup: {
    confirm: vi.fn(async () => popup.confirm),
  },
}));

import { Popup } from "../src/utilities/popup.js";
import { GraphLayoutManager } from "../src/graph/layout.js";
import { DEFAULTS } from "../src/config.js";

function createCache({ layoutType, positions, nodes = [], order } = {}) {
  const noop = () => {};
  const asyncNoop = async () => {};

  const positionsMap = new Map(positions || []);

  // Minimal graphology-ish model: forEachNode + hasNode + order.
  const nodeMap = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const graphData = {
    order: order ?? nodeMap.size,
    forEachNode: (cb) => {
      for (const [id, attrs] of nodeMap) cb(id, attrs);
    },
    hasNode: (id) => nodeMap.has(id),
    mergeNodeAttributes: (id, attrs) => {
      nodeMap.set(id, { ...nodeMap.get(id), ...attrs });
    },
  };

  const currentLayout = {
    layoutType,
    positions: positionsMap,
  };

  return {
    nodeRef: new Map(),
    graphData,
    EVENT_LOCKS: {},
    DEFAULTS,
    data: { selectedLayout: "Default", layouts: { Default: currentLayout } },
    ui: {
      showLoading: asyncNoop, hideLoading: asyncNoop, holdLoading: noop,
      releaseLoading: noop, info: vi.fn(), error: vi.fn(), debug: noop,
    },
    bs: {
      updateBubbleSetIfChanged: asyncNoop,
      refreshBubbleStyleElements: noop,
    },
    gcm: { decideToRenderOrDraw: asyncNoop },
    graph: {
      setLayout: vi.fn(asyncNoop),
      layout: vi.fn(asyncNoop),
      runLayoutTransition: vi.fn(asyncNoop),
      // persistNodePositions reads positions back through the adapter facade.
      getNodeData: async () =>
        [...nodeMap].map(([id, attrs]) => ({ id, style: { x: attrs.x, y: attrs.y } })),
      pendingLayoutTransition: false,
    },
  };
}

describe("relayoutWorkspace", () => {
  beforeEach(() => {
    Popup.confirm.mockClear();
    popup.confirm = true;
  });

  it("is a no-op without a layout type", async () => {
    const cache = createCache({ layoutType: "force" });
    const lm = new GraphLayoutManager(cache);

    await lm.relayoutWorkspace();

    expect(cache.graph.setLayout).not.toHaveBeenCalled();
    expect(cache.graph.layout).not.toHaveBeenCalled();
  });

  it("applies the chosen layout and remembers the type", async () => {
    const cache = createCache({ layoutType: "force" });
    const lm = new GraphLayoutManager(cache);

    await lm.relayoutWorkspace("grid");

    expect(cache.graph.setLayout).toHaveBeenCalledTimes(1);
    expect(cache.graph.setLayout.mock.calls[0][0]).toMatchObject({ type: "grid" });
    expect(cache.graph.layout).toHaveBeenCalledTimes(1);
    expect(cache.data.layouts.Default.layoutType).toBe("grid");
    expect(cache.ui.info).toHaveBeenCalledWith("Re-layouted workspace: Default (grid)");
  });

  it("merges the layout internals into the setLayout spec", async () => {
    // dagre carries non-empty internals (and is expensive — small graph, no confirm).
    const cache = createCache({ layoutType: "force" });
    const lm = new GraphLayoutManager(cache);

    await lm.relayoutWorkspace("dagre");

    expect(Popup.confirm).not.toHaveBeenCalled();
    expect(cache.graph.setLayout.mock.calls[0][0]).toMatchObject({
      type: "dagre",
      ...DEFAULTS.LAYOUT_INTERNALS.dagre,
    });
  });

  it("asks before an expensive layout on a large graph and cancels on decline", async () => {
    popup.confirm = false;
    const cache = createCache({
      layoutType: "force",
      order: DEFAULTS.LAYOUT_NODE_WARNING_THRESHOLD + 1,
    });
    const lm = new GraphLayoutManager(cache);

    await lm.relayoutWorkspace("dagre");

    expect(Popup.confirm).toHaveBeenCalledTimes(1);
    expect(cache.graph.setLayout).not.toHaveBeenCalled();
    expect(cache.ui.info).toHaveBeenCalledWith("Re-layout canceled");
  });

  it("proceeds with an expensive layout when the warning is accepted", async () => {
    popup.confirm = true;
    const cache = createCache({
      layoutType: "force",
      order: DEFAULTS.LAYOUT_NODE_WARNING_THRESHOLD + 1,
    });
    const lm = new GraphLayoutManager(cache);

    await lm.relayoutWorkspace("dagre");

    expect(Popup.confirm).toHaveBeenCalledTimes(1);
    expect(cache.graph.setLayout).toHaveBeenCalledTimes(1);
  });

  it("never warns for cheap layouts, regardless of size", async () => {
    const cache = createCache({
      layoutType: "force",
      order: DEFAULTS.LAYOUT_NODE_WARNING_THRESHOLD + 1,
    });
    const lm = new GraphLayoutManager(cache);

    await lm.relayoutWorkspace("grid");

    expect(Popup.confirm).not.toHaveBeenCalled();
    expect(cache.graph.setLayout).toHaveBeenCalledTimes(1);
  });

  it("animates from on-screen positions when nodes are present", async () => {
    const cache = createCache({
      layoutType: "force",
      nodes: [{ id: "a", x: 10, y: 20 }, { id: "b", x: 30, y: 40 }],
    });
    const lm = new GraphLayoutManager(cache);

    await lm.relayoutWorkspace("grid");

    // Tween invoked with the persisted target map.
    expect(cache.graph.runLayoutTransition).toHaveBeenCalledTimes(1);
    expect(cache.graph.runLayoutTransition.mock.calls[0][0]).toBe(
      cache.data.layouts.Default.positions,
    );
    // Tween flag cleared in finally so later renders don't freeze.
    expect(cache.graph.pendingLayoutTransition).toBe(false);
  });

  it("skips the transition when there is nothing on screen to animate from", async () => {
    const cache = createCache({ layoutType: "force", nodes: [] });
    const lm = new GraphLayoutManager(cache);

    await lm.relayoutWorkspace("grid");

    expect(cache.graph.runLayoutTransition).not.toHaveBeenCalled();
  });

  it("is a no-op when the selected workspace is missing", async () => {
    const cache = createCache({ layoutType: "force" });
    cache.data.selectedLayout = "ghost"; // not in layouts
    const lm = new GraphLayoutManager(cache);

    await lm.relayoutWorkspace("grid");

    expect(cache.graph.setLayout).not.toHaveBeenCalled();
  });
});
