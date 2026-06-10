import { describe, it, expect } from "vitest";
import { Graph } from "../src/lib/graphology.bundle.mjs";
import { executeLayout } from "../src/graph/layout_algorithms.js";
import { DEFAULTS } from "../src/config.js";

// ==========================================================================
// Layout algorithms (sigma migration Phase 5) — node-safe layout execution
// for the app's full layout vocabulary (LAYOUT_INTERNALS): graphology
// circular/forceAtlas2, geometric grid, and headless @antv/layout v2 for
// radial/concentric/mds. Specs under test are the real config entries.
// ==========================================================================

const LAYOUT_TYPES = Object.keys(DEFAULTS.LAYOUT_INTERNALS); // force, circular, radial, concentric, grid, mds

function specFor(type) {
  return { type, ...DEFAULTS.LAYOUT_INTERNALS[type] };
}

/**
 * Star: hub connected to n satellites, plus a path along the satellites.
 * Nodes carry initial x/y like the real app (graph_model always assigns
 * positions before layouts run; FA2 requires them).
 */
function starGraph(satellites = 11) {
  const graph = new Graph();
  graph.addNode("hub", { x: 0, y: 0 });
  for (let i = 0; i < satellites; i++) {
    const id = `n${i}`;
    graph.addNode(id, { x: i + 1, y: -i });
    graph.addEdge("hub", id);
    if (i > 0) graph.addEdge(`n${i - 1}`, id);
  }
  return graph;
}

/** Two components: a 3-node path and a 2-node pair. */
function disconnectedGraph() {
  const graph = new Graph();
  ["x1", "x2", "x3", "y1", "y2"].forEach((id, i) => graph.addNode(id, { x: i, y: i }));
  graph.addEdge("x1", "x2");
  graph.addEdge("x2", "x3");
  graph.addEdge("y1", "y2");
  return graph;
}

function positions(graph) {
  return graph.mapNodes((id, attrs) => ({ id, x: attrs.x, y: attrs.y }));
}

function centroid(points) {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("executeLayout — all layout types assign positions", () => {
  it.each(LAYOUT_TYPES)("%s: finite, non-degenerate x/y on every node", async (type) => {
    // Arrange
    const graph = starGraph();

    // Act
    await executeLayout(graph, specFor(type));

    // Assert
    const pts = positions(graph);
    expect(pts).toHaveLength(12);
    for (const p of pts) {
      expect(Number.isFinite(p.x), `${type}: ${p.id}.x finite`).toBe(true);
      expect(Number.isFinite(p.y), `${type}: ${p.id}.y finite`).toBe(true);
    }
    const unique = new Set(pts.map((p) => `${p.x},${p.y}`));
    expect(unique.size, `${type}: not all positions identical`).toBeGreaterThan(1);
  });
});

describe("executeLayout — circular", () => {
  it("places all nodes equidistant from the centroid", async () => {
    // Arrange
    const graph = starGraph();

    // Act
    await executeLayout(graph, specFor("circular"));

    // Assert
    const pts = positions(graph);
    const center = centroid(pts);
    const radii = pts.map((p) => distance(p, center));
    const expectedRadius = Math.max(100, 12 * Math.sqrt(graph.order));
    for (const r of radii) expect(r).toBeCloseTo(expectedRadius, 6);
  });
});

describe("executeLayout — grid", () => {
  it("places nodes on the 100-px lattice with unique cells", async () => {
    // Arrange
    const graph = starGraph();

    // Act
    await executeLayout(graph, specFor("grid"));

    // Assert
    const pts = positions(graph);
    for (const p of pts) {
      expect(p.x % 100).toBe(0);
      expect(p.y % 100).toBe(0);
    }
    const cells = new Set(pts.map((p) => `${p.x},${p.y}`));
    expect(cells.size).toBe(graph.order);
  });
});

describe("executeLayout — radial", () => {
  it("orders rings by hop distance from the root", async () => {
    // Arrange: 2-level tree — root, 3 children (hop 1), 3 grandchildren (hop 2)
    const graph = new Graph();
    ["r", "a", "b", "c", "a1", "a2", "b1"].forEach((id) => graph.addNode(id));
    [["r", "a"], ["r", "b"], ["r", "c"], ["a", "a1"], ["a", "a2"], ["b", "b1"]].forEach(
      ([s, t]) => graph.addEdge(s, t),
    );

    // Act
    await executeLayout(graph, specFor("radial"));

    // Assert: every hop-1 node sits strictly closer to the root than every hop-2 node
    const root = { x: graph.getNodeAttribute("r", "x"), y: graph.getNodeAttribute("r", "y") };
    const ring = (id) =>
      distance(root, { x: graph.getNodeAttribute(id, "x"), y: graph.getNodeAttribute(id, "y") });
    const hop1 = ["a", "b", "c"].map(ring);
    const hop2 = ["a1", "a2", "b1"].map(ring);
    expect(Math.max(...hop1)).toBeLessThan(Math.min(...hop2));
  });
});

describe("executeLayout — concentric", () => {
  it("puts the highest-degree node closest to the layout centroid", async () => {
    // Arrange: pure star — hub degree 8, satellites degree 1
    const graph = new Graph();
    graph.addNode("hub");
    for (let i = 0; i < 8; i++) {
      graph.addNode(`n${i}`);
      graph.addEdge("hub", `n${i}`);
    }

    // Act
    await executeLayout(graph, specFor("concentric"));

    // Assert
    const pts = positions(graph);
    const center = centroid(pts);
    const byDistance = pts
      .map((p) => ({ id: p.id, d: distance(p, center) }))
      .sort((a, b) => a.d - b.d);
    expect(byDistance[0].id).toBe("hub");
  });
});

describe("executeLayout — edge cases", () => {
  it.each(LAYOUT_TYPES)("%s: empty graph is a no-op", async (type) => {
    // Arrange
    const graph = new Graph();

    // Act + Assert
    await expect(executeLayout(graph, specFor(type))).resolves.toBeUndefined();
    expect(graph.order).toBe(0);
  });

  it.each(LAYOUT_TYPES)("%s: single-node graph does not throw", async (type) => {
    // Arrange
    const graph = new Graph();
    graph.addNode("only", { x: 7, y: 9 });

    // Act + Assert
    await expect(executeLayout(graph, specFor(type))).resolves.toBeUndefined();
    expect(graph.order).toBe(1);
    const attrs = graph.getNodeAttributes("only");
    // Position is either untouched or replaced with finite coordinates.
    expect(Number.isFinite(attrs.x)).toBe(true);
    expect(Number.isFinite(attrs.y)).toBe(true);
  });

  it("unknown type falls back to forceAtlas2", async () => {
    // Arrange: FA2 needs initial positions
    const graph = new Graph();
    graph.addNode("a", { x: 0, y: 0 });
    graph.addNode("b", { x: 1, y: 1 });
    graph.addEdge("a", "b");

    // Act
    await executeLayout(graph, { type: "does-not-exist" });

    // Assert
    const pts = positions(graph);
    for (const p of pts) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    expect(distance(pts[0], pts[1])).toBeGreaterThan(0);
  });

  it("missing type falls back to forceAtlas2", async () => {
    // Arrange
    const graph = new Graph();
    graph.addNode("a", { x: 0, y: 0 });
    graph.addNode("b", { x: 1, y: 1 });
    graph.addEdge("a", "b");

    // Act
    await executeLayout(graph, {});

    // Assert
    graph.forEachNode((_id, attrs) => {
      expect(Number.isFinite(attrs.x)).toBe(true);
      expect(Number.isFinite(attrs.y)).toBe(true);
    });
  });

  it.each(["radial", "concentric", "mds"])(
    "%s: disconnected graph yields finite positions",
    async (type) => {
      // Arrange
      const graph = disconnectedGraph();

      // Act
      await executeLayout(graph, specFor(type));

      // Assert
      const pts = positions(graph);
      expect(pts).toHaveLength(5);
      for (const p of pts) {
        expect(Number.isFinite(p.x), `${type}: ${p.id}.x finite`).toBe(true);
        expect(Number.isFinite(p.y), `${type}: ${p.id}.y finite`).toBe(true);
      }
    },
  );
});
