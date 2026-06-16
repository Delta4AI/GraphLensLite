import { describe, it, expect } from "vitest";
import { DEFAULTS, CFG } from "../src/config.js";
import { StaticUtilities } from "../src/utilities/static.js";
import { GraphStyleManager } from "../src/graph/style.js";

// ---------------------------------------------------------------------------
// Minimal mock cache that mirrors the real Cache for style-related operations
// ---------------------------------------------------------------------------
function createMockCache(nodes = [], edges = []) {
  const nodeRef = new Map();
  const edgeRef = new Map();
  const selectedNodes = [];
  const selectedEdges = [];

  const layout = {
    nodeStyles: new Map(),
    edgeStyles: new Map(),
    positions: new Map(),
  };

  const cache = {
    DEFAULTS,
    CFG,
    nodeRef,
    edgeRef,
    selectedNodes,
    selectedEdges,
    data: {
      nodes,
      edges,
      selectedLayout: "default",
      layouts: { default: layout },
    },
    styleChanged: false,
  };

  cache.style = new GraphStyleManager(cache);
  return cache;
}

// ---------------------------------------------------------------------------
// Mirrors the core of updateNodes (core.js) — deepMerge overrides into
// nodeRef, then persist into the layout's nodeStyles map.
// ---------------------------------------------------------------------------
function simulateUpdateNodes(cache, overrides) {
  for (const nodeID of cache.selectedNodes) {
    const node = cache.nodeRef.get(nodeID);
    const overridesCopy = structuredClone(overrides);
    StaticUtilities.deepMerge(node, overridesCopy);
    cache.nodeRef.set(nodeID, node);

    const currentLayout = cache.data.layouts[cache.data.selectedLayout];
    currentLayout.nodeStyles.set(nodeID, {
      type: node.type,
      style: structuredClone(node.style),
    });
  }
}

// ---------------------------------------------------------------------------
// Mirrors the core of updateEdges (core.js)
// ---------------------------------------------------------------------------
function simulateUpdateEdges(cache, overrides) {
  for (const edgeID of cache.selectedEdges) {
    const edge = cache.edgeRef.get(edgeID);
    const overridesCopy = structuredClone(overrides);
    StaticUtilities.deepMerge(edge, overridesCopy);
    cache.edgeRef.set(edgeID, edge);

    const currentLayout = cache.data.layouts[cache.data.selectedLayout];
    currentLayout.edgeStyles.set(edgeID, {
      type: edge.type,
      style: structuredClone(edge.style),
    });
  }
}

// ---------------------------------------------------------------------------
// Mirrors the node-processing part of createSimplifiedDataForGraphObject
// ---------------------------------------------------------------------------
function buildRenderedNodeData(cache) {
  return cache.data.nodes.map((node) => {
    const {
      features,
      featureValues,
      featureIsWithinThreshold,
      originalStyle,
      originalType,
      D4Data,
      ...filteredNode
    } = node;

    const currentLayout = cache.data.layouts[cache.data.selectedLayout];
    const layoutData = currentLayout.nodeStyles.get(node.id);

    if (layoutData) {
      Object.assign(filteredNode, cache.style.getNodeStyleOrDefaults(node));
      if (layoutData.type !== undefined) filteredNode.type = layoutData.type;
      if (layoutData.style)
        filteredNode.style = structuredClone(layoutData.style);
    } else {
      Object.assign(filteredNode, cache.style.getNodeStyleOrDefaults(node));
    }

    const position = currentLayout.positions.get(node.id);
    if (position && position.style) {
      filteredNode.style.x = position.style.x;
      filteredNode.style.y = position.style.y;
    }

    return filteredNode;
  });
}

// ---------------------------------------------------------------------------
// Mirrors the edge-processing part of createSimplifiedDataForGraphObject
// ---------------------------------------------------------------------------
function buildRenderedEdgeData(cache) {
  return cache.data.edges.map((edge) => {
    const {
      features,
      featureValues,
      featureIsWithinThreshold,
      originalStyle,
      originalType,
      D4Data,
      ...filteredEdge
    } = edge;

    const currentLayout = cache.data.layouts[cache.data.selectedLayout];
    const layoutData = currentLayout.edgeStyles.get(edge.id);

    if (layoutData) {
      Object.assign(filteredEdge, cache.style.getEdgeStyleOrDefaults(edge));
      if (layoutData.type !== undefined) filteredEdge.type = layoutData.type;
      if (layoutData.style)
        filteredEdge.style = structuredClone(layoutData.style);
    } else {
      Object.assign(filteredEdge, cache.style.getEdgeStyleOrDefaults(edge));
    }

    return filteredEdge;
  });
}

// ---------------------------------------------------------------------------
// Helper: set up a cache with one node, mimicking the full iterNodes flow
// ---------------------------------------------------------------------------
function setupNodeInCache(cache, nodeData) {
  const nodeWithDefaults = cache.style.getNodeStyleOrDefaults(nodeData);
  const nodeClone = structuredClone(nodeData);
  nodeClone.type = nodeWithDefaults.type;
  nodeClone.style = structuredClone(nodeWithDefaults.style);
  nodeClone.originalStyle = structuredClone(nodeWithDefaults.style);
  nodeClone.originalType = nodeWithDefaults.type;
  cache.nodeRef.set(nodeData.id, nodeClone);
}

function setupEdgeInCache(cache, edgeData) {
  const edgeWithDefaults = cache.style.getEdgeStyleOrDefaults(edgeData);
  const edgeClone = structuredClone(edgeData);
  edgeClone.type = edgeWithDefaults.type;
  edgeClone.style = structuredClone(edgeWithDefaults.style);
  edgeClone.originalStyle = structuredClone(edgeWithDefaults.style);
  edgeClone.originalType = edgeWithDefaults.type;
  cache.edgeRef.set(edgeData.id, edgeClone);
}

// NOTE(sigma-migration): the former source-pinning regressions ("Graph
// constructor must not set spec-level node/edge type or style" and "State
// styles must not override user-customizable properties") guarded a G6 v5
// hazard — spec-level options and state styles silently overriding per-node
// data styles. The sigma renderer has no spec-level node/edge config and its
// reducers (src/graph/graph_model.js) only adjust render-time display data,
// so the hazard is structurally impossible; reducer behavior is covered by
// tests/graph-model.test.js.

// ==========================================================================
// REGRESSION: Node style overrides survive the full update → render pipeline
// ==========================================================================

describe("Node style overrides through updateNodes → render data", () => {
  it("fill color override reaches rendered output", () => {
    const nodeData = { id: "n1", label: "Node 1" };
    const cache = createMockCache([nodeData]);
    setupNodeInCache(cache, nodeData);
    cache.selectedNodes.push("n1");

    // Simulate: user changes fill color via styling panel
    simulateUpdateNodes(cache, { style: { fill: "#800080" } });

    const rendered = buildRenderedNodeData(cache);
    expect(rendered[0].style.fill).toBe("#800080");
  });

  it("size override reaches rendered output", () => {
    const nodeData = { id: "n1" };
    const cache = createMockCache([nodeData]);
    setupNodeInCache(cache, nodeData);
    cache.selectedNodes.push("n1");

    simulateUpdateNodes(cache, { style: { size: 42 } });

    const rendered = buildRenderedNodeData(cache);
    expect(rendered[0].style.size).toBe(42);
  });

  it("type (shape) override reaches rendered output", () => {
    const nodeData = { id: "n1" };
    const cache = createMockCache([nodeData]);
    setupNodeInCache(cache, nodeData);
    cache.selectedNodes.push("n1");

    simulateUpdateNodes(cache, { type: "circle" });

    const rendered = buildRenderedNodeData(cache);
    expect(rendered[0].type).toBe("circle");
  });

  it("border color override reaches rendered output", () => {
    const nodeData = { id: "n1" };
    const cache = createMockCache([nodeData]);
    setupNodeInCache(cache, nodeData);
    cache.selectedNodes.push("n1");

    simulateUpdateNodes(cache, { style: { stroke: "#00FF00" } });

    const rendered = buildRenderedNodeData(cache);
    expect(rendered[0].style.stroke).toBe("#00FF00");
  });

  it("multiple overrides are preserved together", () => {
    const nodeData = { id: "n1" };
    const cache = createMockCache([nodeData]);
    setupNodeInCache(cache, nodeData);
    cache.selectedNodes.push("n1");

    simulateUpdateNodes(cache, {
      type: "star",
      style: { fill: "#0000FF", size: 35 },
    });

    const rendered = buildRenderedNodeData(cache);
    expect(rendered[0].type).toBe("star");
    expect(rendered[0].style.fill).toBe("#0000FF");
    expect(rendered[0].style.size).toBe(35);
    // Unchanged properties should retain defaults
    expect(rendered[0].style.lineWidth).toBe(DEFAULTS.NODE.LINE_WIDTH);
  });

  it("overrides only affect selected nodes", () => {
    const n1 = { id: "n1" };
    const n2 = { id: "n2" };
    const cache = createMockCache([n1, n2]);
    setupNodeInCache(cache, n1);
    setupNodeInCache(cache, n2);
    cache.selectedNodes.push("n1"); // only n1 selected

    simulateUpdateNodes(cache, { style: { fill: "#FF00FF" } });

    const rendered = buildRenderedNodeData(cache);
    const rn1 = rendered.find((n) => n.id === "n1");
    const rn2 = rendered.find((n) => n.id === "n2");

    expect(rn1.style.fill).toBe("#FF00FF");
    expect(rn2.style.fill).toBe(DEFAULTS.NODE.FILL_COLOR);
  });

  it("sequential overrides accumulate correctly", () => {
    const nodeData = { id: "n1" };
    const cache = createMockCache([nodeData]);
    setupNodeInCache(cache, nodeData);
    cache.selectedNodes.push("n1");

    // First override: change fill
    simulateUpdateNodes(cache, { style: { fill: "#111111" } });
    // Second override: change size (fill should persist)
    simulateUpdateNodes(cache, { style: { size: 50 } });

    const rendered = buildRenderedNodeData(cache);
    expect(rendered[0].style.fill).toBe("#111111");
    expect(rendered[0].style.size).toBe(50);
  });

  it("label style overrides reach rendered output", () => {
    const nodeData = { id: "n1" };
    const cache = createMockCache([nodeData]);
    setupNodeInCache(cache, nodeData);
    cache.selectedNodes.push("n1");

    simulateUpdateNodes(cache, {
      style: { labelFill: "#FF0000", labelFontSize: 20 },
    });

    const rendered = buildRenderedNodeData(cache);
    expect(rendered[0].style.labelFill).toBe("#FF0000");
    expect(rendered[0].style.labelFontSize).toBe(20);
  });
});

// ==========================================================================
// REGRESSION: Edge style overrides survive the full update → render pipeline
// ==========================================================================

describe("Edge style overrides through updateEdges → render data", () => {
  it("stroke color override reaches rendered output", () => {
    const edgeData = { id: "e1", source: "n1", target: "n2" };
    const cache = createMockCache([], [edgeData]);
    setupEdgeInCache(cache, edgeData);
    cache.selectedEdges.push("e1");

    simulateUpdateEdges(cache, { style: { stroke: "#00FF00" } });

    const rendered = buildRenderedEdgeData(cache);
    expect(rendered[0].style.stroke).toBe("#00FF00");
  });

  it("lineWidth override reaches rendered output", () => {
    const edgeData = { id: "e1", source: "n1", target: "n2" };
    const cache = createMockCache([], [edgeData]);
    setupEdgeInCache(cache, edgeData);
    cache.selectedEdges.push("e1");

    simulateUpdateEdges(cache, { style: { lineWidth: 3.5 } });

    const rendered = buildRenderedEdgeData(cache);
    expect(rendered[0].style.lineWidth).toBe(3.5);
  });

  it("type override reaches rendered output", () => {
    const edgeData = { id: "e1", source: "n1", target: "n2" };
    const cache = createMockCache([], [edgeData]);
    setupEdgeInCache(cache, edgeData);
    cache.selectedEdges.push("e1");

    simulateUpdateEdges(cache, { type: "cubic" });

    const rendered = buildRenderedEdgeData(cache);
    expect(rendered[0].type).toBe("cubic");
  });

  it("arrow overrides reach rendered output", () => {
    const edgeData = { id: "e1", source: "n1", target: "n2" };
    const cache = createMockCache([], [edgeData]);
    setupEdgeInCache(cache, edgeData);
    cache.selectedEdges.push("e1");

    simulateUpdateEdges(cache, {
      style: { startArrow: true, startArrowType: "vee", endArrow: true },
    });

    const rendered = buildRenderedEdgeData(cache);
    expect(rendered[0].style.startArrow).toBe(true);
    expect(rendered[0].style.startArrowType).toBe("vee");
    expect(rendered[0].style.endArrow).toBe(true);
  });

  it("overrides only affect selected edges", () => {
    const e1 = { id: "e1", source: "n1", target: "n2" };
    const e2 = { id: "e2", source: "n2", target: "n3" };
    const cache = createMockCache([], [e1, e2]);
    setupEdgeInCache(cache, e1);
    setupEdgeInCache(cache, e2);
    cache.selectedEdges.push("e1"); // only e1 selected

    simulateUpdateEdges(cache, { style: { stroke: "#FF0000" } });

    const rendered = buildRenderedEdgeData(cache);
    const re1 = rendered.find((e) => e.id === "e1");
    const re2 = rendered.find((e) => e.id === "e2");

    expect(re1.style.stroke).toBe("#FF0000");
    expect(re2.style.stroke).toBe(DEFAULTS.EDGE.COLOR);
  });
});

// ==========================================================================
// REGRESSION: Defaults are used for nodes/edges without layout overrides
// ==========================================================================

describe("Nodes/edges without layout overrides use defaults", () => {
  it("node without layout style uses default fill", () => {
    const nodeData = { id: "n1" };
    const cache = createMockCache([nodeData]);
    setupNodeInCache(cache, nodeData);

    const rendered = buildRenderedNodeData(cache);
    expect(rendered[0].style.fill).toBe(DEFAULTS.NODE.FILL_COLOR);
    expect(rendered[0].type).toBe(DEFAULTS.NODE.TYPE);
    expect(rendered[0].style.size).toBe(DEFAULTS.NODE.SIZE);
  });

  it("edge without layout style uses default stroke", () => {
    const edgeData = { id: "e1", source: "n1", target: "n2" };
    const cache = createMockCache([], [edgeData]);
    setupEdgeInCache(cache, edgeData);

    const rendered = buildRenderedEdgeData(cache);
    expect(rendered[0].style.stroke).toBe(DEFAULTS.EDGE.COLOR);
    expect(rendered[0].type).toBe(DEFAULTS.EDGE.TYPE);
    expect(rendered[0].style.lineWidth).toBe(DEFAULTS.EDGE.LINE_WIDTH);
  });
});
