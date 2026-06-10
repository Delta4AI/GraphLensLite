import { describe, it, expect } from "vitest";
import {
  buildGraphologyGraph,
  nodeAttributesFromStyle,
  edgeAttributesFromStyle,
  makeNodeReducer,
  makeEdgeReducer,
  STATE_ACCENT_COLOR,
  STATE_DIM_COLOR,
} from "../src/graph/graph_model.js";

// ==========================================================================
// Graph model (sigma migration Phase 1) — graphology population from the
// app cache and the node/edge reducer factories. Node-safe: must never
// import the sigma bundle.
// ==========================================================================

function makeNode(id, style = {}) {
  return { id, style: { size: 20, fill: "#403C53", ...style } };
}

function makeEdge(id, source, target, style = {}) {
  return { id, source, target, style: { lineWidth: 0.75, stroke: "#403C5390", ...style } };
}

function createMockCache({ nodes = [], edges = [], positions = new Map() } = {}) {
  return {
    nodeRef: new Map(nodes.map((n) => [n.id, n])),
    edgeRef: new Map(edges.map((e) => [e.id, e])),
    data: {
      selectedLayout: "Default",
      layouts: { Default: { positions } },
    },
    ui: { debug: () => {} },
  };
}

describe("buildGraphologyGraph — population", () => {
  it("adds every node and edge with stable keys", () => {
    const cache = createMockCache({
      nodes: [makeNode("a"), makeNode("b")],
      edges: [makeEdge("e1", "a", "b")],
    });

    const graph = buildGraphologyGraph(cache);

    expect(graph.order).toBe(2);
    expect(graph.size).toBe(1);
    expect(graph.hasNode("a")).toBe(true);
    expect(graph.hasEdge("e1")).toBe(true);
  });

  it("uses persisted layout positions when present", () => {
    const positions = new Map([["a", { style: { x: 42, y: -7 } }]]);
    const cache = createMockCache({
      nodes: [makeNode("a", { x: 1, y: 1 })],
      positions,
    });

    const graph = buildGraphologyGraph(cache);

    expect(graph.getNodeAttribute("a", "x")).toBe(42);
    expect(graph.getNodeAttribute("a", "y")).toBe(-7);
  });

  it("falls back to style x/y when no persisted position exists", () => {
    const cache = createMockCache({ nodes: [makeNode("a", { x: 5, y: 6 })] });

    const graph = buildGraphologyGraph(cache);

    expect(graph.getNodeAttribute("a", "x")).toBe(5);
    expect(graph.getNodeAttribute("a", "y")).toBe(6);
  });

  it("assigns deterministic numeric placeholder coordinates otherwise", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
    const cache = createMockCache({ nodes });

    const first = buildGraphologyGraph(cache);
    const second = buildGraphologyGraph(cache);

    for (const id of ["a", "b", "c"]) {
      expect(Number.isFinite(first.getNodeAttribute(id, "x"))).toBe(true);
      expect(Number.isFinite(first.getNodeAttribute(id, "y"))).toBe(true);
      expect(first.getNodeAttribute(id, "x")).toBe(second.getNodeAttribute(id, "x"));
      expect(first.getNodeAttribute(id, "y")).toBe(second.getNodeAttribute(id, "y"));
    }
    // Spread: distinct nodes get distinct placeholder coordinates.
    expect(first.getNodeAttribute("a", "x")).not.toBe(first.getNodeAttribute("b", "x"));
  });

  it("ignores non-numeric persisted positions and uses the fallback", () => {
    const positions = new Map([["a", { style: { x: null, y: undefined } }]]);
    const cache = createMockCache({ nodes: [makeNode("a", { x: 3, y: 4 })], positions });

    const graph = buildGraphologyGraph(cache);

    expect(graph.getNodeAttribute("a", "x")).toBe(3);
    expect(graph.getNodeAttribute("a", "y")).toBe(4);
  });

  it("maps labels only when style.label is truthy", () => {
    const cache = createMockCache({
      nodes: [
        makeNode("labeled", { label: true, labelText: "Gene A" }),
        makeNode("unlabeled", { label: false, labelText: "ignored" }),
        makeNode("bare"),
      ],
    });

    const graph = buildGraphologyGraph(cache);

    expect(graph.getNodeAttribute("labeled", "label")).toBe("Gene A");
    expect(graph.getNodeAttribute("unlabeled", "label")).toBe(null);
    expect(graph.getNodeAttribute("bare", "label")).toBe(null);
  });

  it("defaults hidden to false and honours style visibility", () => {
    const cache = createMockCache({
      nodes: [makeNode("shown"), makeNode("gone", { visibility: "hidden" })],
    });

    const graph = buildGraphologyGraph(cache);

    expect(graph.getNodeAttribute("shown", "hidden")).toBe(false);
    expect(graph.getNodeAttribute("gone", "hidden")).toBe(true);
  });

  it("takes the first dimension of an array size (G6 [w, h])", () => {
    const cache = createMockCache({ nodes: [makeNode("a", { size: [30, 12] })] });

    const graph = buildGraphologyGraph(cache);

    expect(graph.getNodeAttribute("a", "size")).toBe(30);
  });

  it("supports parallel (multi) edges and self loops with their own ids", () => {
    const cache = createMockCache({
      nodes: [makeNode("a"), makeNode("b")],
      edges: [
        makeEdge("e1", "a", "b"),
        makeEdge("e2", "a", "b"),
        makeEdge("loop", "a", "a"),
      ],
    });

    const graph = buildGraphologyGraph(cache);

    expect(graph.size).toBe(3);
    expect(graph.hasEdge("e1")).toBe(true);
    expect(graph.hasEdge("e2")).toBe(true);
    expect(graph.hasEdge("loop")).toBe(true);
  });

  it("skips edges whose endpoints are missing instead of throwing", () => {
    const cache = createMockCache({
      nodes: [makeNode("a")],
      edges: [makeEdge("dangling", "a", "ghost")],
    });

    const graph = buildGraphologyGraph(cache);

    expect(graph.size).toBe(0);
  });

  it("builds an empty graph from an empty cache without throwing", () => {
    const cache = createMockCache();

    const graph = buildGraphologyGraph(cache);

    expect(graph.order).toBe(0);
    expect(graph.size).toBe(0);
  });

  it("maps edge lineWidth/stroke to size/color", () => {
    const cache = createMockCache({
      nodes: [makeNode("a"), makeNode("b")],
      edges: [makeEdge("e1", "a", "b", { lineWidth: 2, stroke: "#112233" })],
    });

    const graph = buildGraphologyGraph(cache);

    expect(graph.getEdgeAttribute("e1", "size")).toBe(2);
    expect(graph.getEdgeAttribute("e1", "color")).toBe("#112233");
  });
});

describe("attribute mapping helpers", () => {
  it("nodeAttributesFromStyle only emits present keys", () => {
    expect(nodeAttributesFromStyle({})).toEqual({});
    expect(nodeAttributesFromStyle({ fill: "#fff" })).toEqual({ color: "#fff" });
    expect(nodeAttributesFromStyle({ visibility: "visible" })).toEqual({ hidden: false });
  });

  it("nodeAttributesFromStyle ignores non-finite coordinates", () => {
    expect(nodeAttributesFromStyle({ x: NaN, y: "5" })).toEqual({});
  });

  it("nodeAttributesFromStyle keeps a size of 0 (presence check, not truthiness)", () => {
    expect(nodeAttributesFromStyle({ size: 0 })).toEqual({ size: 0 });
  });

  it("nodeAttributesFromStyle emits no label when label is truthy but labelText is absent", () => {
    // Absent or undefined labelText → no label attr at all (sigma keeps its
    // default); an explicit null labelText → label: null (label cleared).
    expect(nodeAttributesFromStyle({ label: true })).toEqual({});
    expect(nodeAttributesFromStyle({ label: true, labelText: undefined })).toEqual({});
    expect(nodeAttributesFromStyle({ label: true, labelText: null })).toEqual({ label: null });
  });

  it("edgeAttributesFromStyle maps label and visibility like nodes", () => {
    expect(edgeAttributesFromStyle({ label: true, labelText: "ppi" })).toEqual({ label: "ppi" });
    expect(edgeAttributesFromStyle({ label: false })).toEqual({ label: null });
    expect(edgeAttributesFromStyle({ visibility: "hidden" })).toEqual({ hidden: true });
  });
});

describe("reducers — states and hidden handling", () => {
  function reducerFixture() {
    const nodes = [makeNode("a"), makeNode("b")];
    const edges = [makeEdge("e1", "a", "b")];
    const cache = createMockCache({ nodes, edges });
    cache.graphData = buildGraphologyGraph(cache);
    const elementStates = new Map();
    return {
      cache,
      elementStates,
      nodeReducer: makeNodeReducer(cache, elementStates),
      edgeReducer: makeEdgeReducer(cache, elementStates),
    };
  }

  it("node: passes data through untouched without states", () => {
    const { nodeReducer } = reducerFixture();
    const data = { x: 0, y: 0, color: "#403C53", hidden: false };

    expect(nodeReducer("a", data)).toBe(data);
  });

  it("node: hidden data wins over any state", () => {
    const { nodeReducer, elementStates } = reducerFixture();
    elementStates.set("a", ["selected"]);
    const data = { color: "#403C53", hidden: true };

    const res = nodeReducer("a", data);

    expect(res.hidden).toBe(true);
    expect(res.color).toBe("#403C53");
  });

  it("node: selected gets the accent color and raised zIndex", () => {
    const { nodeReducer, elementStates } = reducerFixture();
    elementStates.set("a", ["selected"]);

    const res = nodeReducer("a", { color: "#403C53", hidden: false, zIndex: 0 });

    expect(res.color).toBe(STATE_ACCENT_COLOR);
    expect(res.zIndex).toBe(1);
  });

  it("node: highlight and dim apply their state colors", () => {
    const { nodeReducer, elementStates } = reducerFixture();

    elementStates.set("a", ["highlight"]);
    expect(nodeReducer("a", { color: "#403C53", hidden: false }).color).toBe(STATE_ACCENT_COLOR);

    elementStates.set("a", ["dim"]);
    expect(nodeReducer("a", { color: "#403C53", hidden: false }).color).toBe(STATE_DIM_COLOR);
  });

  it("node: selected takes precedence over dim", () => {
    const { nodeReducer, elementStates } = reducerFixture();
    elementStates.set("a", ["dim", "selected"]);

    const res = nodeReducer("a", { color: "#403C53", hidden: false });

    expect(res.color).toBe(STATE_ACCENT_COLOR);
    expect(res.zIndex).toBe(1);
  });

  it("node: does not mutate the input data", () => {
    const { nodeReducer, elementStates } = reducerFixture();
    elementStates.set("a", ["selected"]);
    const data = { color: "#403C53", hidden: false, zIndex: 0 };

    nodeReducer("a", data);

    expect(data.color).toBe("#403C53");
    expect(data.zIndex).toBe(0);
  });

  it("edge: hidden when its own hidden attr is set", () => {
    const { edgeReducer } = reducerFixture();

    const res = edgeReducer("e1", { color: "#403C5390", hidden: true });

    expect(res.hidden).toBe(true);
  });

  it("edge: hidden when either endpoint is hidden", () => {
    const { cache, edgeReducer } = reducerFixture();
    cache.graphData.setNodeAttribute("b", "hidden", true);

    const res = edgeReducer("e1", { color: "#403C5390", hidden: false });

    expect(res.hidden).toBe(true);
  });

  it("edge: visible with visible endpoints and no states", () => {
    const { edgeReducer } = reducerFixture();
    const data = { color: "#403C5390", hidden: false };

    expect(edgeReducer("e1", data)).toBe(data);
  });

  it("edge: selected/highlight/dim state colors", () => {
    const { edgeReducer, elementStates } = reducerFixture();

    elementStates.set("e1", ["selected"]);
    const selected = edgeReducer("e1", { color: "#403C5390", hidden: false, zIndex: 0 });
    expect(selected.color).toBe(STATE_ACCENT_COLOR);
    expect(selected.zIndex).toBe(1);

    elementStates.set("e1", ["highlight"]);
    expect(edgeReducer("e1", { color: "#403C5390", hidden: false }).color).toBe(STATE_ACCENT_COLOR);

    elementStates.set("e1", ["dim"]);
    expect(edgeReducer("e1", { color: "#403C5390", hidden: false }).color).toBe(STATE_DIM_COLOR);
  });
});
