import { describe, it, expect } from "vitest";
import {
  buildGraphologyGraph,
  nodeAttributesFromStyle,
  edgeAttributesFromStyle,
  sigmaEdgeType,
  edgeMarkerCode,
  EDGE_MARKERS,
  flipY,
  hoverNeighborhood,
  makeNodeReducer,
  makeEdgeReducer,
  STATE_ACCENT_COLOR,
  STATE_DIM_COLOR,
} from "../src/graph/graph_model.js";
import { HALO_EXTRA_PX } from "../src/graph/shape_textures.js";
import { DEFAULTS } from "../src/config.js";

// ==========================================================================
// Graph model (sigma migration Phases 1-2) — graphology population from the
// app cache, the G6→sigma attribute mapping (shapes, borders, labels,
// y-axis flip) and the node/edge reducer factories. Node-safe: must never
// import the sigma bundle.
//
// Phase-2 conventions under test:
//   - app model is y-down (G6 heritage), graphology/sigma y-up → flipY once
//   - G6 `size` is a diameter, sigma `size` a radius → halved
//   - states render as halo textures (selected/highlight), not flat fills
// ==========================================================================

const ACCENT_URI = encodeURIComponent(STATE_ACCENT_COLOR); // "%23C33D35"

function makeNode(id, style = {}, type = undefined) {
  const node = { id, style: { size: 20, fill: "#403C53", ...style } };
  if (type !== undefined) node.type = type;
  return node;
}

function makeEdge(id, source, target, style = {}, type = undefined) {
  const edge = { id, source, target, style: { lineWidth: 0.75, stroke: "#403C5390", ...style } };
  if (type !== undefined) edge.type = type;
  return edge;
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

  it("uses persisted layout positions when present, flipping y into sigma space", () => {
    const positions = new Map([["a", { style: { x: 42, y: -7 } }]]);
    const cache = createMockCache({
      nodes: [makeNode("a", { x: 1, y: 1 })],
      positions,
    });

    const graph = buildGraphologyGraph(cache);

    expect(graph.getNodeAttribute("a", "x")).toBe(42);
    expect(graph.getNodeAttribute("a", "y")).toBe(7);
  });

  it("falls back to style x/y when no persisted position exists (y flipped)", () => {
    const cache = createMockCache({ nodes: [makeNode("a", { x: 5, y: 6 })] });

    const graph = buildGraphologyGraph(cache);

    expect(graph.getNodeAttribute("a", "x")).toBe(5);
    expect(graph.getNodeAttribute("a", "y")).toBe(-6);
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
    expect(graph.getNodeAttribute("a", "y")).toBe(-4);
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

  it("maps G6 diameter size to sigma radius (first dimension of [w, h] arrays)", () => {
    const cache = createMockCache({ nodes: [makeNode("a", { size: [30, 12] })] });

    const graph = buildGraphologyGraph(cache);

    expect(graph.getNodeAttribute("a", "size")).toBe(15);
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

  it("assigns node shape programs and textures from the G6 type", () => {
    const cache = createMockCache({
      nodes: [
        makeNode("c", {}, "circle"),
        makeNode("r", {}, "rect"),
        makeNode("h", {}, "hexagon"),
      ],
    });

    const graph = buildGraphologyGraph(cache);

    expect(graph.getNodeAttribute("c", "type")).toBe("circle");
    expect(graph.getNodeAttribute("r", "type")).toBe("square");
    expect(graph.getNodeAttribute("h", "type")).toBe("shape");
    expect(graph.getNodeAttribute("h", "image")).toMatch(/^data:image\/svg\+xml,/);
    expect(graph.getNodeAttribute("h", "shape")).toBe("hexagon");
  });

  it("propagates node-border attrs for bordered circles into the built graph", () => {
    const cache = createMockCache({
      nodes: [makeNode("bc", { stroke: "#C33D35", lineWidth: 2 }, "circle")],
    });

    const graph = buildGraphologyGraph(cache);

    expect(graph.getNodeAttribute("bc", "type")).toBe("borderCircle");
    expect(graph.getNodeAttribute("bc", "borderColor")).toBe("#C33D35");
    expect(graph.getNodeAttribute("bc", "borderRatio")).toBe(0.2);
    expect(graph.getNodeAttribute("bc", "image")).toBeNull();
  });

  it("assigns edge programs from the G6 type", () => {
    const cache = createMockCache({
      nodes: [makeNode("a"), makeNode("b")],
      edges: [
        makeEdge("straight", "a", "b", {}, "line"),
        makeEdge("curved", "a", "b", {}, "cubic"),
        makeEdge("arrowed", "a", "b", { endArrow: true }, "line"),
      ],
    });

    const graph = buildGraphologyGraph(cache);

    expect(graph.getEdgeAttribute("straight", "type")).toBe("line");
    expect(graph.getEdgeAttribute("curved", "type")).toBe("curve");
    expect(graph.getEdgeAttribute("arrowed", "type")).toBe("styledLine");
    expect(graph.getEdgeAttribute("arrowed", "endMarker")).toBe(EDGE_MARKERS.arrow);
  });
});

describe("y-axis orientation (Phase 2 decision #5)", () => {
  it("flipY is its own inverse (single boundary flip)", () => {
    expect(flipY(20)).toBe(-20);
    expect(flipY(flipY(20))).toBe(20);
    expect(flipY(0)).toBe(-0);
  });

  it("a G6-era persisted position round-trips to the same on-screen orientation", () => {
    // Legacy file: node persisted below-right of origin in G6 space (y-down).
    const legacyPersisted = { x: 100, y: 50 };
    const positions = new Map([["a", { style: { ...legacyPersisted } }]]);
    const cache = createMockCache({ nodes: [makeNode("a")], positions });

    // Load: on screen the node must sit BELOW the origin → sigma y negative.
    const graph = buildGraphologyGraph(cache);
    const sigmaY = graph.getNodeAttribute("a", "y");
    expect(sigmaY).toBe(-50);

    // Save: the adapter reads positions back through flipY into the app
    // model (SigmaAdapter.getNodeData), which is what persistNodePositions
    // and the JSON/Excel exports serialize.
    const persistedAgain = { x: graph.getNodeAttribute("a", "x"), y: flipY(sigmaY) };
    expect(persistedAgain).toEqual(legacyPersisted);

    // Reload of the re-exported file lands on the same screen position.
    const cache2 = createMockCache({
      nodes: [makeNode("a")],
      positions: new Map([["a", { style: persistedAgain }]]),
    });
    expect(buildGraphologyGraph(cache2).getNodeAttribute("a", "y")).toBe(sigmaY);
  });
});

describe("attribute mapping helpers", () => {
  it("nodeAttributesFromStyle only emits present keys", () => {
    expect(nodeAttributesFromStyle({})).toEqual({});
    expect(nodeAttributesFromStyle({ fill: "#fff" })).toEqual({ color: "#fff" });
    expect(nodeAttributesFromStyle({ visibility: "visible" })).toEqual({ hidden: false });
  });

  it("nodeAttributesFromStyle flips y into sigma space, x unchanged", () => {
    expect(nodeAttributesFromStyle({ x: 10, y: 20 })).toEqual({ x: 10, y: -20 });
  });

  it("nodeAttributesFromStyle ignores non-finite coordinates", () => {
    expect(nodeAttributesFromStyle({ x: NaN, y: "5" })).toEqual({});
  });

  it("nodeAttributesFromStyle halves G6 diameter sizes (0 stays 0)", () => {
    expect(nodeAttributesFromStyle({ size: 0 })).toEqual({ size: 0 });
    expect(nodeAttributesFromStyle({ size: 20 })).toEqual({ size: 10 });
  });

  it("nodeAttributesFromStyle maps border fields", () => {
    expect(nodeAttributesFromStyle({ stroke: "#123456", lineWidth: 2 })).toEqual({
      borderColor: "#123456",
      borderSize: 2,
    });
  });

  it("nodeAttributesFromStyle maps label styling fields", () => {
    const attrs = nodeAttributesFromStyle({
      labelFontSize: 16,
      labelFill: "#654321",
      labelBackground: true,
      labelBackgroundFill: "#FEDCBA",
      labelPlacement: "top-right",
      labelOffsetX: 5,
      labelOffsetY: -3,
      labelPadding: 4,
    });

    expect(attrs).toEqual({
      labelSize: 16,
      labelColor: "#654321",
      labelBackground: true,
      labelBackgroundColor: "#FEDCBA",
      labelPlacement: "top-right",
      labelOffsetX: 5,
      labelOffsetY: -3,
      labelPadding: 4,
    });
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

  it("texture-only shapes get the shape program, a texture and a transparent color", () => {
    for (const shape of ["diamond", "hexagon", "triangle", "star"]) {
      const attrs = nodeAttributesFromStyle({ fill: "#403C53", size: 20 }, shape);
      expect(attrs.type).toBe("shape");
      expect(attrs.shape).toBe(shape);
      expect(attrs.fillColor).toBe("#403C53");
      expect(attrs.color).toBe("#00000000");
      expect(attrs.image).toMatch(/^data:image\/svg\+xml,/);
    }
  });

  it("plain circle and rect stay on native programs with their fill color", () => {
    const circle = nodeAttributesFromStyle({ fill: "#403C53" }, "circle");
    const rect = nodeAttributesFromStyle({ fill: "#403C53" }, "rect");

    expect(circle.type).toBe("circle");
    expect(circle.image).toBeNull();
    expect(circle.color).toBe("#403C53");
    expect(rect.type).toBe("square");
    expect(rect.image).toBeNull();
  });

  it("native programs clear texture-only attrs so shape→native merges don't go stale", () => {
    // The adapter applies updates via mergeNodeAttributes: a node leaving the
    // texture program (e.g. border removed) must null out image/fillColor or
    // hover would later read a stale fillColor into its state textures.
    const attrs = nodeAttributesFromStyle({ fill: "#403C53" }, "circle");

    expect(attrs.image).toBeNull();
    expect(attrs.fillColor).toBeNull();
    expect(attrs.color).toBe("#403C53"); // never left at the texture TRANSPARENT
  });

  it("native programs restore the default fill when the style has none", () => {
    const attrs = nodeAttributesFromStyle({}, "circle");

    expect(attrs.color).toBe(DEFAULTS.NODE.FILL_COLOR);
  });

  it("bordered circle routes through the node-border program with clean texture attrs", () => {
    const attrs = nodeAttributesFromStyle(
      { fill: "#403C53", stroke: "#C33D35", lineWidth: 2, size: 20 },
      "circle",
    );

    expect(attrs.type).toBe("borderCircle");
    expect(attrs.borderColor).toBe("#C33D35");
    expect(attrs.borderSize).toBe(2);
    expect(attrs.borderRatio).toBe(2 / 10); // lineWidth / radius (size 20 diameter → 10)
    expect(attrs.color).toBe("#403C53"); // fill layer reads `color`
    expect(attrs.fillColor).toBeNull();
    expect(attrs.image).toBeNull();
  });

  it("bordered circle uses the default node size for the border ratio when size is absent", () => {
    const attrs = nodeAttributesFromStyle({ stroke: "#C33D35", lineWidth: 1 }, "circle");

    expect(attrs.type).toBe("borderCircle");
    expect(attrs.borderRatio).toBe(1 / (DEFAULTS.NODE.SIZE / 2));
  });

  it("clamps the border ratio to 1 when the border is wider than the radius", () => {
    const attrs = nodeAttributesFromStyle(
      { stroke: "#C33D35", lineWidth: 50, size: 20 },
      "circle",
    );

    expect(attrs.borderRatio).toBe(1);
    expect(nodeAttributesFromStyle({ stroke: "#C33D35", lineWidth: 2, size: 0 }, "circle").borderRatio).toBe(1);
  });

  it("bordered rect (and texture-only shapes with borders) stay on the texture program", () => {
    const style = { fill: "#403C53", stroke: "#C33D35", lineWidth: 2, size: 20 };
    for (const shape of ["rect", "diamond", "hexagon", "triangle", "star"]) {
      const attrs = nodeAttributesFromStyle(style, shape);
      expect(attrs.type).toBe("shape");
      expect(attrs.image).toContain(ACCENT_URI);
      expect(attrs.borderRatio).toBe(0);
    }
  });

  it("zero lineWidth or missing stroke keeps circles on the native program", () => {
    expect(nodeAttributesFromStyle({ stroke: "#C33D35", lineWidth: 0 }, "circle").type).toBe("circle");
    expect(nodeAttributesFromStyle({ lineWidth: 2 }, "circle").type).toBe("circle");
    expect(nodeAttributesFromStyle({ stroke: null, lineWidth: 2 }, "circle").type).toBe("circle");
  });

  // The adapter applies style updates via mergeNodeAttributes, so every
  // program transition must overwrite/clear exactly what the previous branch
  // set. Simulated here as a literal merge of the two attribute sets.
  describe("program-transition attribute hygiene (merge matrix)", () => {
    const BORDER = { stroke: "#C33D35", lineWidth: 2 };
    const BASE = { fill: "#403C53", size: 20 };
    const attrsFor = (style, type) => nodeAttributesFromStyle(style, type);
    const merge = (from, to) => ({ ...from, ...to });

    it("native circle → borderCircle (border added)", () => {
      const res = merge(attrsFor(BASE, "circle"), attrsFor({ ...BASE, ...BORDER }, "circle"));

      expect(res.type).toBe("borderCircle");
      expect(res.color).toBe("#403C53");
      expect(res.fillColor).toBeNull();
      expect(res.image).toBeNull();
      expect(res.borderColor).toBe("#C33D35");
      expect(res.borderSize).toBe(2);
      expect(res.borderRatio).toBe(0.2);
    });

    it("borderCircle → native circle (border removed) clears border attrs", () => {
      const res = merge(
        attrsFor({ ...BASE, ...BORDER }, "circle"),
        attrsFor({ ...BASE, stroke: null, lineWidth: 0 }, "circle"),
      );

      expect(res.type).toBe("circle");
      expect(res.color).toBe("#403C53"); // never left at the texture TRANSPARENT
      expect(res.fillColor).toBeNull();
      expect(res.image).toBeNull();
      expect(res.borderColor).toBeNull();
      expect(res.borderSize).toBe(0);
      expect(res.borderRatio).toBe(0);
    });

    it("borderCircle → native circle via lineWidth-only delta clears stale borderColor", () => {
      // No-nodeRef fallback path: the style delta drops the border without an
      // explicit stroke key, so nodeAttributesFromStyle never emits
      // borderColor — the program branch must clear it unconditionally or
      // applyNodeState bakes the phantom stroke into halo textures.
      const res = merge(
        attrsFor({ ...BASE, ...BORDER }, "circle"),
        attrsFor({ ...BASE, lineWidth: 0 }, "circle"),
      );

      expect(res.type).toBe("circle");
      expect(res.borderColor).toBeNull();
      expect(res.borderSize).toBe(0);
      expect(res.borderRatio).toBe(0);
    });

    it("texture → borderCircle (bordered hexagon becomes bordered circle)", () => {
      const res = merge(
        attrsFor({ ...BASE, ...BORDER }, "hexagon"),
        attrsFor({ ...BASE, ...BORDER }, "circle"),
      );

      expect(res.type).toBe("borderCircle");
      expect(res.shape).toBe("circle");
      expect(res.color).toBe("#403C53"); // stale TRANSPARENT would blank the fill ring
      expect(res.fillColor).toBeNull(); // stale fillColor corrupts state textures
      expect(res.image).toBeNull(); // stale texture cleared
      expect(res.borderRatio).toBe(0.2);
    });

    it("borderCircle → texture (bordered circle becomes bordered hexagon)", () => {
      const res = merge(
        attrsFor({ ...BASE, ...BORDER }, "circle"),
        attrsFor({ ...BASE, ...BORDER }, "hexagon"),
      );

      expect(res.type).toBe("shape");
      expect(res.shape).toBe("hexagon");
      expect(res.color).toBe("#00000000");
      expect(res.fillColor).toBe("#403C53");
      expect(res.image).toMatch(/^data:image\/svg\+xml,/);
      expect(res.borderRatio).toBe(0);
    });

    it("borderCircle → borderCircle (restyle) recomputes the ratio", () => {
      const res = merge(
        attrsFor({ ...BASE, ...BORDER }, "circle"),
        attrsFor({ ...BASE, ...BORDER, lineWidth: 4, size: 40 }, "circle"),
      );

      expect(res.borderRatio).toBe(4 / 20);
      expect(res.borderSize).toBe(4);
    });
  });

  it("sigmaEdgeType routes plain edges to the fast paths", () => {
    expect(sigmaEdgeType("line")).toBe("line");
    expect(sigmaEdgeType("line", { startArrow: false, endArrow: false, halo: false })).toBe("line");
    for (const curved of ["cubic", "quadratic", "polyline"]) {
      expect(sigmaEdgeType(curved)).toBe("curve");
    }
  });

  it("sigmaEdgeType routes any marker or halo to the styled compound programs", () => {
    for (const style of [
      { endArrow: true },
      { startArrow: true },
      { startArrow: true, endArrow: true },
      { halo: true },
      { halo: true, haloLineWidth: 5 },
    ]) {
      expect(sigmaEdgeType("line", style)).toBe("styledLine");
      for (const curved of ["cubic", "quadratic", "polyline"]) {
        expect(sigmaEdgeType(curved, style)).toBe("styledCurve");
      }
    }
  });

  it("sigmaEdgeType ignores a halo with zero width or disabled flag", () => {
    expect(sigmaEdgeType("line", { halo: true, haloLineWidth: 0 })).toBe("line");
    expect(sigmaEdgeType("line", { halo: false, haloLineWidth: 5 })).toBe("line");
    expect(sigmaEdgeType("cubic", { halo: true, haloLineWidth: 0 })).toBe("curve");
  });

  it("edgeMarkerCode maps the new vocabulary and legacy G6 aliases", () => {
    expect(edgeMarkerCode("arrow")).toBe(EDGE_MARKERS.arrow);
    expect(edgeMarkerCode("rect")).toBe(EDGE_MARKERS.rect);
    expect(edgeMarkerCode("diamond")).toBe(EDGE_MARKERS.diamond);
    expect(edgeMarkerCode("circle")).toBe(EDGE_MARKERS.circle);
    expect(edgeMarkerCode("tee")).toBe(EDGE_MARKERS.tee);
    // Legacy G6 arrow types degrade to the nearest marker, never to "none".
    expect(edgeMarkerCode("triangle")).toBe(EDGE_MARKERS.arrow);
    expect(edgeMarkerCode("vee")).toBe(EDGE_MARKERS.arrow);
    expect(edgeMarkerCode("simple")).toBe(EDGE_MARKERS.arrow);
    expect(edgeMarkerCode("triangleRect")).toBe(EDGE_MARKERS.rect);
    expect(edgeMarkerCode("square")).toBe(EDGE_MARKERS.rect);
    expect(edgeMarkerCode("unknown-future-type")).toBe(EDGE_MARKERS.arrow);
    expect(edgeMarkerCode(undefined)).toBe(EDGE_MARKERS.arrow);
  });
});

describe("edge marker + halo attribute mapping", () => {
  // The adapter applies updates via mergeEdgeAttributes, so the full
  // marker/halo set must be emitted on every type-bearing mapping — off
  // states as 0/null, never omitted.
  const FULL_OFF = {
    startMarker: 0,
    startMarkerSize: 0,
    startMarkerColor: null,
    startMarkerBorderColor: null,
    startMarkerBorderSize: 0,
    endMarker: 0,
    endMarkerSize: 0,
    endMarkerColor: null,
    endMarkerBorderColor: null,
    endMarkerBorderSize: 0,
    haloWidth: 0,
    haloColor: null,
  };

  it("emits the full marker/halo set (all off) for a bare typed edge", () => {
    const attrs = edgeAttributesFromStyle({}, "line");

    expect(attrs).toEqual({ type: "line", ...FULL_OFF });
  });

  it("omits marker/halo attrs when no type is given (delta-only mapping)", () => {
    const attrs = edgeAttributesFromStyle({ stroke: "#112233" });

    expect(attrs).toEqual({ color: "#112233" });
  });

  it("maps enabled arrows to marker enums with per-end sizes", () => {
    const attrs = edgeAttributesFromStyle(
      {
        startArrow: true,
        startArrowType: "tee",
        startArrowSize: 12,
        endArrow: true,
        endArrowType: "circle",
        endArrowSize: 10,
      },
      "line",
    );

    expect(attrs.type).toBe("styledLine");
    expect(attrs.startMarker).toBe(EDGE_MARKERS.tee);
    expect(attrs.startMarkerSize).toBe(12);
    expect(attrs.endMarker).toBe(EDGE_MARKERS.circle);
    expect(attrs.endMarkerSize).toBe(10);
  });

  it("emits explicit arrow fill + border colors when markers are enabled", () => {
    const attrs = edgeAttributesFromStyle(
      {
        startArrow: true,
        startArrowColor: "#C33D35",
        startArrowBorderColor: "#000000",
        endArrow: true,
        endArrowColor: "#8CA6D9",
      },
      "line",
    );

    expect(attrs.startMarkerColor).toBe("#C33D35");
    expect(attrs.startMarkerBorderColor).toBe("#000000");
    expect(attrs.endMarkerColor).toBe("#8CA6D9");
    // Border left unset -> null (no border) even with the marker enabled.
    expect(attrs.endMarkerBorderColor).toBe(null);
  });

  it("maps an explicit arrow border size and zeroes it when the arrow is off", () => {
    const on = edgeAttributesFromStyle({ startArrow: true, startArrowBorderSize: 6 }, "line");
    expect(on.startMarkerBorderSize).toBe(6);

    // Off arrow or non-positive size -> 0 (auto / proportional).
    const off = edgeAttributesFromStyle({ startArrow: false, startArrowBorderSize: 6 }, "line");
    expect(off.startMarkerBorderSize).toBe(0);
    const zero = edgeAttributesFromStyle({ endArrow: true, endArrowBorderSize: -2 }, "line");
    expect(zero.endMarkerBorderSize).toBe(0);
  });

  it("inherits the edge color (null marker color) when no arrow color is set", () => {
    const attrs = edgeAttributesFromStyle({ startArrow: true, endArrow: true }, "line");

    expect(attrs.startMarkerColor).toBe(null);
    expect(attrs.endMarkerColor).toBe(null);
    expect(attrs.startMarkerBorderColor).toBe(null);
    expect(attrs.endMarkerBorderColor).toBe(null);
  });

  it("nulls arrow colors when the arrow flag is off (overwrites stale style)", () => {
    const attrs = edgeAttributesFromStyle(
      { startArrow: false, startArrowColor: "#C33D35", startArrowBorderColor: "#000000" },
      "line",
    );

    expect(attrs.startMarkerColor).toBe(null);
    expect(attrs.startMarkerBorderColor).toBe(null);
  });

  it("disabled arrow flag zeroes the marker even when a type string is set", () => {
    const attrs = edgeAttributesFromStyle(
      { startArrow: false, startArrowType: "diamond", endArrow: true, endArrowType: "diamond" },
      "line",
    );

    expect(attrs.startMarker).toBe(0);
    expect(attrs.endMarker).toBe(EDGE_MARKERS.diamond);
  });

  it("non-finite or non-positive arrow sizes fall back to 0 (proportional sizing)", () => {
    const attrs = edgeAttributesFromStyle(
      { endArrow: true, endArrowSize: -3, startArrow: true, startArrowSize: "big" },
      "line",
    );

    expect(attrs.startMarkerSize).toBe(0);
    expect(attrs.endMarkerSize).toBe(0);
  });

  it("maps an enabled halo to haloWidth/haloColor", () => {
    const attrs = edgeAttributesFromStyle(
      { halo: true, haloLineWidth: 4, haloStroke: "#8CA6D9" },
      "line",
    );

    expect(attrs.type).toBe("styledLine");
    expect(attrs.haloWidth).toBe(4);
    expect(attrs.haloColor).toBe("#8CA6D9");
  });

  it("halo without explicit width uses the config default width", () => {
    const attrs = edgeAttributesFromStyle({ halo: true }, "line");

    expect(attrs.haloWidth).toBe(DEFAULTS.EDGE.HALO.WIDTH);
    expect(attrs.haloColor).toBe(DEFAULTS.EDGE.HALO.COLOR);
  });

  it("disabled halo clears width and color regardless of the other halo keys", () => {
    const attrs = edgeAttributesFromStyle(
      { halo: false, haloLineWidth: 9, haloStroke: "#8CA6D9" },
      "line",
    );

    expect(attrs.haloWidth).toBe(0);
    expect(attrs.haloColor).toBeNull();
  });

  describe("merge hygiene matrix (mergeEdgeAttributes semantics)", () => {
    const merge = (from, to) => ({ ...from, ...to });
    const ARROWS_ON = {
      startArrow: true,
      startArrowType: "rect",
      startArrowSize: 12,
      endArrow: true,
      endArrowType: "tee",
      endArrowSize: 10,
    };
    const HALO_ON = { halo: true, haloLineWidth: 5, haloStroke: "#C33D35" };

    it("markers on → off clears both enums and routes back to the fast path", () => {
      const res = merge(
        edgeAttributesFromStyle(ARROWS_ON, "line"),
        edgeAttributesFromStyle({ ...ARROWS_ON, startArrow: false, endArrow: false }, "line"),
      );

      expect(res.type).toBe("line");
      expect(res.startMarker).toBe(0);
      expect(res.endMarker).toBe(0);
    });

    it("halo on → off clears width/color and routes back to the fast path", () => {
      const res = merge(
        edgeAttributesFromStyle(HALO_ON, "line"),
        edgeAttributesFromStyle({ ...HALO_ON, halo: false }, "line"),
      );

      expect(res.type).toBe("line");
      expect(res.haloWidth).toBe(0);
      expect(res.haloColor).toBeNull();
    });

    it("halo toggles never disturb marker attrs (and vice versa)", () => {
      const both = edgeAttributesFromStyle({ ...ARROWS_ON, ...HALO_ON }, "line");
      const haloOff = merge(
        both,
        edgeAttributesFromStyle({ ...ARROWS_ON, ...HALO_ON, halo: false }, "line"),
      );

      expect(haloOff.type).toBe("styledLine"); // markers still active
      expect(haloOff.startMarker).toBe(EDGE_MARKERS.rect);
      expect(haloOff.endMarker).toBe(EDGE_MARKERS.tee);
      expect(haloOff.haloWidth).toBe(0);

      const markersOff = merge(
        both,
        edgeAttributesFromStyle(
          { ...ARROWS_ON, ...HALO_ON, startArrow: false, endArrow: false },
          "line",
        ),
      );
      expect(markersOff.type).toBe("styledLine"); // halo still active
      expect(markersOff.haloWidth).toBe(5);
      expect(markersOff.startMarker).toBe(0);
      expect(markersOff.endMarker).toBe(0);
    });

    it("marker type change overwrites the enum in place", () => {
      const res = merge(
        edgeAttributesFromStyle(ARROWS_ON, "line"),
        edgeAttributesFromStyle({ ...ARROWS_ON, endArrowType: "circle" }, "line"),
      );

      expect(res.endMarker).toBe(EDGE_MARKERS.circle);
      expect(res.startMarker).toBe(EDGE_MARKERS.rect);
    });

    it("straight ↔ curved type changes keep the marker/halo set coherent", () => {
      const straight = edgeAttributesFromStyle({ ...ARROWS_ON, ...HALO_ON }, "line");
      const curved = merge(
        straight,
        edgeAttributesFromStyle({ ...ARROWS_ON, ...HALO_ON }, "cubic"),
      );

      expect(curved.type).toBe("styledCurve");
      expect(curved.startMarker).toBe(EDGE_MARKERS.rect);
      expect(curved.haloWidth).toBe(5);
    });
  });

  it("propagates marker/halo attrs into the built graph", () => {
    const cache = createMockCache({
      nodes: [makeNode("a"), makeNode("b")],
      edges: [
        makeEdge(
          "e1",
          "a",
          "b",
          { endArrow: true, endArrowType: "tee", endArrowSize: 14, halo: true, haloLineWidth: 2 },
          "line",
        ),
      ],
    });

    const graph = buildGraphologyGraph(cache);

    expect(graph.getEdgeAttribute("e1", "type")).toBe("styledLine");
    expect(graph.getEdgeAttribute("e1", "endMarker")).toBe(EDGE_MARKERS.tee);
    expect(graph.getEdgeAttribute("e1", "endMarkerSize")).toBe(14);
    expect(graph.getEdgeAttribute("e1", "startMarker")).toBe(0);
    expect(graph.getEdgeAttribute("e1", "haloWidth")).toBe(2);
    expect(graph.getEdgeAttribute("e1", "haloColor")).toBe(DEFAULTS.EDGE.HALO.COLOR);
  });
});

describe("badge attribute mapping", () => {
  const BADGES = [
    { text: "A", placement: "right-top" },
    { text: "B", placement: "left" },
  ];

  it("maps badge attrs when badges are set", () => {
    const attrs = nodeAttributesFromStyle({
      badge: true,
      badges: BADGES,
      badgePalette: ["#112233", "#445566"],
      badgeFontSize: 10,
    });

    expect(attrs).toEqual({
      badge: true,
      badges: BADGES,
      badgePalette: ["#112233", "#445566"],
      badgeFontSize: 10,
      badgeScaleFactor: 1,
    });
  });

  it("omits badge keys entirely when the style carries no badge fields", () => {
    expect(nodeAttributesFromStyle({ fill: "#fff" })).toEqual({ color: "#fff" });
  });

  it("emits badge:false and empty arrays on badge_clear results (not omitted)", () => {
    // The adapter merges attributes — omitting the keys would leave stale
    // badges in graphology after a badge_clear command.
    const attrs = nodeAttributesFromStyle({ badge: false, badges: [], badgePalette: [] });

    expect(attrs).toEqual({ badge: false, badges: [], badgePalette: [] });
  });

  it("treats badge:true with no badges as cleared", () => {
    expect(nodeAttributesFromStyle({ badge: true, badges: [] })).toEqual({
      badge: false,
      badges: [],
      badgePalette: [],
    });
  });

  it("bakes the default badge color into missing palette entries", () => {
    const attrs = nodeAttributesFromStyle({
      badge: true,
      badges: BADGES,
      badgePalette: ["#112233"],
    });

    expect(attrs.badgePalette).toEqual(["#112233", DEFAULTS.NODE.BADGE.COLOR]);
    expect(attrs.badgeFontSize).toBe(DEFAULTS.NODE.BADGE.FONT_SIZE);
    expect(attrs.badgeScaleFactor).toBe(1); // scale-with-node defaults off
  });

  it("emits badgeScaleFactor from the node's model size when badgeScaleWithNode is on", () => {
    const attrs = nodeAttributesFromStyle({
      badge: true,
      badges: [BADGES[0]],
      badgeScaleWithNode: true,
      size: DEFAULTS.NODE.SIZE * 2,
    });

    expect(attrs.badgeScaleFactor).toBe(2);
  });

  it("supports [w, h] array sizes for badgeScaleFactor", () => {
    const attrs = nodeAttributesFromStyle({
      badge: true,
      badges: [BADGES[0]],
      badgeScaleWithNode: true,
      size: [DEFAULTS.NODE.SIZE / 2, DEFAULTS.NODE.SIZE / 2],
    });

    expect(attrs.badgeScaleFactor).toBe(0.5);
  });

  it("keeps badgeScaleFactor at 1 when badgeScaleWithNode is on but size is missing or invalid", () => {
    const base = { badge: true, badges: [BADGES[0]], badgeScaleWithNode: true };

    expect(nodeAttributesFromStyle(base).badgeScaleFactor).toBe(1);
    expect(nodeAttributesFromStyle({ ...base, size: NaN }).badgeScaleFactor).toBe(1);
    expect(nodeAttributesFromStyle({ ...base, size: 0 }).badgeScaleFactor).toBe(1);
  });

  it("keeps badgeScaleFactor at 1 when badgeScaleWithNode is explicitly off (toggle-off path)", () => {
    const attrs = nodeAttributesFromStyle({
      badge: true,
      badges: [BADGES[0]],
      badgeScaleWithNode: false,
      size: DEFAULTS.NODE.SIZE * 3,
    });

    expect(attrs.badgeScaleFactor).toBe(1);
  });

  it("propagates badge attrs into the built graph", () => {
    const cache = createMockCache({
      nodes: [makeNode("a", { badge: true, badges: [BADGES[0]] })],
    });

    const graph = buildGraphologyGraph(cache);

    expect(graph.getNodeAttribute("a", "badge")).toBe(true);
    expect(graph.getNodeAttribute("a", "badges")).toEqual([BADGES[0]]);
    expect(graph.getNodeAttribute("a", "badgePalette")).toEqual([DEFAULTS.NODE.BADGE.COLOR]);
  });

});

describe("reducers — states and hidden handling", () => {
  function reducerFixture({ nodeType, nodeStyle = {} } = {}) {
    const nodes = [makeNode("a", nodeStyle, nodeType), makeNode("b", nodeStyle, nodeType)];
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

  it("node: selected gets an accent halo texture, grown size and raised zIndex", () => {
    const { nodeReducer, elementStates } = reducerFixture();
    elementStates.set("a", ["selected"]);

    const res = nodeReducer("a", { color: "#403C53", size: 10, hidden: false, zIndex: 0 });

    expect(res.type).toBe("shape");
    expect(res.image).toContain(ACCENT_URI); // halo ring in the app accent
    expect(res.image).toContain(encodeURIComponent("#403C53")); // own fill kept
    expect(res.size).toBe(10 + HALO_EXTRA_PX);
    expect(res.zIndex).toBe(1);
    expect(res.color).toBe("#00000000");
  });

  it("node: highlight gets an accent-filled halo texture without zIndex bump", () => {
    const { nodeReducer, elementStates } = reducerFixture();
    elementStates.set("a", ["highlight"]);

    const res = nodeReducer("a", { color: "#403C53", size: 10, hidden: false, zIndex: 0 });

    expect(res.type).toBe("shape");
    expect(res.image).toContain(ACCENT_URI);
    expect(res.size).toBe(10 + HALO_EXTRA_PX);
    expect(res.zIndex).toBe(0);
  });

  it("node: dim on a native-program node swaps the fill color only", () => {
    const { nodeReducer, elementStates } = reducerFixture();
    elementStates.set("a", ["dim"]);

    const res = nodeReducer("a", { color: "#403C53", size: 10, hidden: false });

    expect(res.color).toBe(STATE_DIM_COLOR);
    expect(res.image).toBeUndefined();
    expect(res.size).toBe(10);
  });

  it("node: dim on a texture node swaps the texture to the dim fill, size unchanged", () => {
    const { cache, nodeReducer, elementStates } = reducerFixture({ nodeType: "hexagon" });
    const base = { ...cache.graphData.getNodeAttributes("a") };
    elementStates.set("a", ["dim"]);

    const res = nodeReducer("a", { ...base });

    expect(res.type).toBe("shape");
    expect(res.image).not.toBe(base.image);
    expect(res.image).toContain(encodeURIComponent(STATE_DIM_COLOR));
    expect(res.size).toBe(base.size);
  });

  // Halos stay on the texture path for ALL shapes (single halo
  // implementation): borderCircle nodes switch to a halo texture transiently
  // in the reducer output, with their own fill and border baked in.
  it("node: selected borderCircle renders a halo texture keeping fill and border", () => {
    const { cache, nodeReducer, elementStates } = reducerFixture({
      nodeType: "circle",
      nodeStyle: { stroke: "#112233", lineWidth: 2 },
    });
    const base = { ...cache.graphData.getNodeAttributes("a") };
    expect(base.type).toBe("borderCircle");
    elementStates.set("a", ["selected"]);

    const res = nodeReducer("a", { ...base, zIndex: 0 });

    expect(res.type).toBe("shape");
    expect(res.image).toContain(ACCENT_URI); // accent halo ring
    expect(res.image).toContain(encodeURIComponent("#403C53")); // own fill kept
    expect(res.image).toContain(encodeURIComponent("#112233")); // own border kept
    expect(res.size).toBe(base.size + HALO_EXTRA_PX);
    expect(res.color).toBe("#00000000");
    expect(res.zIndex).toBe(1);
  });

  it("node: dim borderCircle swaps the fill color only, border attrs untouched", () => {
    const { cache, nodeReducer, elementStates } = reducerFixture({
      nodeType: "circle",
      nodeStyle: { stroke: "#112233", lineWidth: 2 },
    });
    const base = { ...cache.graphData.getNodeAttributes("a") };
    elementStates.set("a", ["dim"]);

    const res = nodeReducer("a", { ...base });

    expect(res.type).toBe("borderCircle"); // no texture round-trip for dim
    expect(res.color).toBe(STATE_DIM_COLOR);
    expect(res.borderColor).toBe("#112233"); // old G6 spec: dim keeps the border
    expect(res.borderRatio).toBe(base.borderRatio);
    expect(res.image).toBeNull();
    expect(res.size).toBe(base.size);
  });

  it("node: selected takes precedence over dim", () => {
    const { nodeReducer, elementStates } = reducerFixture();
    elementStates.set("a", ["dim", "selected"]);

    const res = nodeReducer("a", { color: "#403C53", size: 10, hidden: false });

    expect(res.image).toContain(ACCENT_URI);
    expect(res.zIndex).toBe(1);
  });

  it("node: does not mutate the input data", () => {
    const { nodeReducer, elementStates } = reducerFixture();
    elementStates.set("a", ["selected"]);
    const data = { color: "#403C53", size: 10, hidden: false, zIndex: 0 };

    nodeReducer("a", data);

    expect(data.color).toBe("#403C53");
    expect(data.size).toBe(10);
    expect(data.zIndex).toBe(0);
    expect(data.image).toBeUndefined();
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

  it("edge: selected widens by the halo budget; highlight/dim recolor", () => {
    const { edgeReducer, elementStates } = reducerFixture();

    elementStates.set("e1", ["selected"]);
    const selected = edgeReducer("e1", { color: "#403C5390", size: 1, hidden: false, zIndex: 0 });
    expect(selected.color).toBe(STATE_ACCENT_COLOR);
    expect(selected.size).toBe(1 + DEFAULTS.STATE.EDGE_HALO_WIDTH / 2);
    expect(selected.zIndex).toBe(1);

    elementStates.set("e1", ["highlight"]);
    expect(edgeReducer("e1", { color: "#403C5390", hidden: false }).color).toBe(STATE_ACCENT_COLOR);

    elementStates.set("e1", ["dim"]);
    expect(edgeReducer("e1", { color: "#403C5390", hidden: false }).color).toBe(STATE_DIM_COLOR);
  });
});

describe("hover layer (Phase 3) — hoverNeighborhood + reducer composition", () => {
  // a—b—c chain plus isolated d: hovering b highlights {a, b, c, e1, e2}
  // and dims {d, e3?}. The hover layer (a Set) is separate from the
  // selection-bearing elementStates Map by design.
  function hoverFixture() {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c"), makeNode("d")];
    const edges = [makeEdge("e1", "a", "b"), makeEdge("e2", "b", "c")];
    const cache = createMockCache({ nodes, edges });
    cache.graphData = buildGraphologyGraph(cache);
    const elementStates = new Map();
    const hoverIds = new Set();
    return {
      cache,
      elementStates,
      hoverIds,
      nodeReducer: makeNodeReducer(cache, elementStates, hoverIds),
      edgeReducer: makeEdgeReducer(cache, elementStates, hoverIds),
    };
  }

  it("node neighborhood includes the node, its neighbors and incident edges", () => {
    const { cache } = hoverFixture();

    const ids = hoverNeighborhood(cache.graphData, "b", false);

    expect(ids).toEqual(new Set(["a", "b", "c", "e1", "e2"]));
  });

  it("leaf node neighborhood excludes unconnected elements", () => {
    const { cache } = hoverFixture();

    const ids = hoverNeighborhood(cache.graphData, "a", false);

    expect(ids).toEqual(new Set(["a", "b", "e1"]));
    expect(ids.has("d")).toBe(false);
  });

  it("edge neighborhood is the edge plus its two endpoints", () => {
    const { cache } = hoverFixture();

    expect(hoverNeighborhood(cache.graphData, "e1", true)).toEqual(new Set(["e1", "a", "b"]));
  });

  it("unknown ids yield only themselves (no throw)", () => {
    const { cache } = hoverFixture();

    expect(hoverNeighborhood(cache.graphData, "nope", false)).toEqual(new Set(["nope"]));
    expect(hoverNeighborhood(cache.graphData, "nope", true)).toEqual(new Set(["nope"]));
  });

  it("empty hover layer leaves nodes and edges untouched", () => {
    const { nodeReducer, edgeReducer } = hoverFixture();
    const nodeData = { color: "#403C53", hidden: false };
    const edgeData = { color: "#403C5390", hidden: false };

    expect(nodeReducer("a", nodeData)).toBe(nodeData);
    expect(edgeReducer("e1", edgeData)).toBe(edgeData);
  });

  it("hover members highlight, everything else dims", () => {
    const { nodeReducer, edgeReducer, hoverIds } = hoverFixture();
    for (const id of ["a", "b", "e1"]) hoverIds.add(id);

    const member = nodeReducer("a", { color: "#403C53", size: 10, hidden: false });
    expect(member.type).toBe("shape");
    expect(member.image).toContain(ACCENT_URI);

    const outsider = nodeReducer("d", { color: "#403C53", size: 10, hidden: false });
    expect(outsider.color).toBe(STATE_DIM_COLOR);

    expect(edgeReducer("e1", { color: "#403C5390", hidden: false }).color).toBe(STATE_ACCENT_COLOR);
    expect(edgeReducer("e2", { color: "#403C5390", hidden: false }).color).toBe(STATE_DIM_COLOR);
  });

  it("selection wins over hover dim — selected elements stay selected-looking", () => {
    const { nodeReducer, edgeReducer, hoverIds, elementStates } = hoverFixture();
    elementStates.set("d", ["selected"]);
    elementStates.set("e2", ["selected"]);
    for (const id of ["a", "b", "e1"]) hoverIds.add(id);

    const node = nodeReducer("d", { color: "#403C53", size: 10, hidden: false, zIndex: 0 });
    expect(node.image).toContain(ACCENT_URI);
    expect(node.zIndex).toBe(1);

    const edge = edgeReducer("e2", { color: "#403C5390", size: 1, hidden: false, zIndex: 0 });
    expect(edge.color).toBe(STATE_ACCENT_COLOR);
    expect(edge.zIndex).toBe(1);
  });

  it("hover never touches elementStates — clearing hover restores selection exactly", () => {
    const { nodeReducer, hoverIds, elementStates } = hoverFixture();
    elementStates.set("a", ["selected"]);
    for (const id of ["b", "c", "e2"]) hoverIds.add(id);

    nodeReducer("a", { color: "#403C53", size: 10, hidden: false });
    hoverIds.clear();

    expect(elementStates.get("a")).toEqual(["selected"]);
    const res = nodeReducer("a", { color: "#403C53", size: 10, hidden: false, zIndex: 0 });
    expect(res.image).toContain(ACCENT_URI);
    expect(res.zIndex).toBe(1);
  });

  it("hidden elements stay untouched by the hover layer", () => {
    const { nodeReducer, hoverIds } = hoverFixture();
    hoverIds.add("a");
    const data = { color: "#403C53", hidden: true };

    expect(nodeReducer("d", data)).toBe(data);
  });
});
