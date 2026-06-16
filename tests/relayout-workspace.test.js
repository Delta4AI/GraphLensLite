// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

// ==========================================================================
// relayoutWorkspace() re-runs a layout algorithm across the ENTIRE current
// workspace, recomputing every node's position. It mirrors the addLayout
// template branch (setLayout → layout → persist → animated transition) but
// stays on the current workspace and only touches positions. The picker
// defaults to the workspace's original layout type (falling back to
// DEFAULTS.LAYOUT). Declining the dialog cancels cleanly with nothing applied.
// ==========================================================================

// Controllable Popup stub (layout.js imports it eagerly at module load).
const popup = vi.hoisted(() => ({ select: null }));
vi.mock("../src/utilities/popup.js", () => ({
  Popup: {
    layoutSelectDialog: vi.fn(async () => popup.select),
    layoutCreationDialog: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
  },
}));

import { Popup } from "../src/utilities/popup.js";
import { GraphLayoutManager } from "../src/graph/layout.js";
import { DEFAULTS } from "../src/config.js";

function createCache({ layoutType, positions, nodes = [] } = {}) {
  const noop = () => {};
  const asyncNoop = async () => {};

  const positionsMap = new Map(positions || []);

  // Minimal graphology-ish model: forEachNode + hasNode + order.
  const nodeMap = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const graphData = {
    order: nodeMap.size,
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
    Popup.layoutSelectDialog.mockClear();
    popup.select = null;
  });

  it("cancels cleanly when the dialog is dismissed", async () => {
    // Arrange
    popup.select = null;
    const cache = createCache({ layoutType: "force" });
    const lm = new GraphLayoutManager(cache);

    // Act
    await lm.relayoutWorkspace();

    // Assert: no layout work, explicit cancel message.
    expect(cache.graph.setLayout).not.toHaveBeenCalled();
    expect(cache.graph.layout).not.toHaveBeenCalled();
    expect(cache.ui.info).toHaveBeenCalledWith("Re-layout canceled");
  });

  it("applies the chosen layout and remembers the type", async () => {
    // Arrange
    popup.select = { templateType: "grid" };
    const cache = createCache({ layoutType: "force" });
    const lm = new GraphLayoutManager(cache);

    // Act
    await lm.relayoutWorkspace();

    // Assert
    expect(cache.graph.setLayout).toHaveBeenCalledTimes(1);
    expect(cache.graph.setLayout.mock.calls[0][0]).toMatchObject({ type: "grid" });
    expect(cache.graph.layout).toHaveBeenCalledTimes(1);
    expect(cache.data.layouts.Default.layoutType).toBe("grid");
    expect(cache.ui.info).toHaveBeenCalledWith("Re-layouted workspace: Default (grid)");
  });

  it("merges the layout internals into the setLayout spec", async () => {
    // Arrange: dagre carries non-empty internals.
    popup.select = { templateType: "dagre" };
    const cache = createCache({ layoutType: "force" });
    const lm = new GraphLayoutManager(cache);

    // Act
    await lm.relayoutWorkspace();

    // Assert
    expect(cache.graph.setLayout.mock.calls[0][0]).toMatchObject({
      type: "dagre",
      ...DEFAULTS.LAYOUT_INTERNALS.dagre,
    });
  });

  it("defaults the picker to the workspace's stored layout type", async () => {
    // Arrange
    popup.select = { templateType: "force" };
    const cache = createCache({ layoutType: "radial" });
    const lm = new GraphLayoutManager(cache);

    // Act
    await lm.relayoutWorkspace();

    // Assert
    const opts = Popup.layoutSelectDialog.mock.calls[0][1];
    expect(opts.defaultType).toBe("radial");
  });

  it("falls back to DEFAULTS.LAYOUT when the workspace has no stored type", async () => {
    // Arrange
    popup.select = { templateType: "grid" };
    const cache = createCache({ layoutType: undefined });
    const lm = new GraphLayoutManager(cache);

    // Act
    await lm.relayoutWorkspace();

    // Assert
    const opts = Popup.layoutSelectDialog.mock.calls[0][1];
    expect(opts.defaultType).toBe(DEFAULTS.LAYOUT);
  });

  it("flags hasPositions when the workspace carries persisted positions", async () => {
    // Arrange
    popup.select = { templateType: "grid" };
    const cache = createCache({
      layoutType: "force",
      positions: [["a", { style: { x: 1, y: 2 } }]],
    });
    const lm = new GraphLayoutManager(cache);

    // Act
    await lm.relayoutWorkspace();

    // Assert
    const opts = Popup.layoutSelectDialog.mock.calls[0][1];
    expect(opts.hasPositions).toBe(true);
  });

  it("reports hasPositions false for an empty workspace", async () => {
    // Arrange
    popup.select = { templateType: "grid" };
    const cache = createCache({ layoutType: "force", positions: [] });
    const lm = new GraphLayoutManager(cache);

    // Act
    await lm.relayoutWorkspace();

    // Assert
    const opts = Popup.layoutSelectDialog.mock.calls[0][1];
    expect(opts.hasPositions).toBe(false);
  });

  it("animates from on-screen positions when nodes are present", async () => {
    // Arrange
    popup.select = { templateType: "grid" };
    const cache = createCache({
      layoutType: "force",
      nodes: [{ id: "a", x: 10, y: 20 }, { id: "b", x: 30, y: 40 }],
    });
    const lm = new GraphLayoutManager(cache);

    // Act
    await lm.relayoutWorkspace();

    // Assert: tween invoked with the persisted target map.
    expect(cache.graph.runLayoutTransition).toHaveBeenCalledTimes(1);
    expect(cache.graph.runLayoutTransition.mock.calls[0][0]).toBe(
      cache.data.layouts.Default.positions,
    );
    // Tween flag cleared in finally so later renders don't freeze.
    expect(cache.graph.pendingLayoutTransition).toBe(false);
  });

  it("skips the transition when there is nothing on screen to animate from", async () => {
    // Arrange
    popup.select = { templateType: "grid" };
    const cache = createCache({ layoutType: "force", nodes: [] });
    const lm = new GraphLayoutManager(cache);

    // Act
    await lm.relayoutWorkspace();

    // Assert
    expect(cache.graph.runLayoutTransition).not.toHaveBeenCalled();
  });

  it("is a no-op when the selected workspace is missing", async () => {
    // Arrange
    popup.select = { templateType: "grid" };
    const cache = createCache({ layoutType: "force" });
    cache.data.selectedLayout = "ghost"; // not in layouts
    const lm = new GraphLayoutManager(cache);

    // Act
    await lm.relayoutWorkspace();

    // Assert
    expect(Popup.layoutSelectDialog).not.toHaveBeenCalled();
    expect(cache.graph.setLayout).not.toHaveBeenCalled();
  });
});
