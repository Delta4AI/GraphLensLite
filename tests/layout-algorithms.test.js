import { describe, it, expect, vi, afterEach } from "vitest";
import { Graph, forceAtlas2 } from "../src/lib/graphology.bundle.mjs";
import { applyNoverlap, executeLayout } from "../src/graph/layout_algorithms.js";
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

describe("executeLayout — dagre (layered/hierarchical)", () => {
  /** Linear chain a→b→c→d: four distinct ranks. */
  function chainGraph() {
    const graph = new Graph();
    ["a", "b", "c", "d"].forEach((id) => graph.addNode(id, { x: 0, y: 0 }));
    [["a", "b"], ["b", "c"], ["c", "d"]].forEach(([s, t]) => graph.addEdge(s, t));
    return graph;
  }

  it("orders ranks top-to-bottom for rankdir TB (graphology y-up: source above target)", async () => {
    // Arrange
    const graph = chainGraph();

    // Act
    await executeLayout(graph, specFor("dagre"));

    // Assert: each edge's source sits strictly higher (greater y) than its
    // target — the negateY flip makes a TB tree read root-at-top on screen.
    const y = (id) => graph.getNodeAttribute(id, "y");
    expect(y("a")).toBeGreaterThan(y("b"));
    expect(y("b")).toBeGreaterThan(y("c"));
    expect(y("c")).toBeGreaterThan(y("d"));
  });

  it("separates ranks by roughly ranksep (distinct y per rank)", async () => {
    // Arrange
    const graph = chainGraph();

    // Act
    await executeLayout(graph, specFor("dagre"));

    // Assert: four chain nodes land on four distinct y levels.
    const levels = new Set(["a", "b", "c", "d"].map((id) => graph.getNodeAttribute(id, "y")));
    expect(levels.size).toBe(4);
  });
});

describe("executeLayout — force worker supervisor (browser path)", () => {
  // Star graph order 12 → budget = min(5000, 500 + 12*2) = 524 ms.
  const STAR_BUDGET_MS = 524;

  /** Fake FA2Layout recording lifecycle calls; never touches Worker. */
  function makeFakeSupervisor(calls, { startThrows = false } = {}) {
    return class FakeSupervisor {
      constructor(_graph, params) {
        calls.push(["construct", params]);
      }
      start() {
        calls.push(["start"]);
        if (startThrows) throw new Error("start failed");
      }
      stop() {
        calls.push(["stop"]);
      }
      kill() {
        calls.push(["kill"]);
      }
    };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("node fallback: without Worker and without override, force runs synchronously", async () => {
    // Arrange: vitest runs under node — no Worker global.
    expect(typeof Worker).toBe("undefined");
    const graph = starGraph();
    const before = positions(graph);

    // Act: fake timers prove the sync path schedules no animation window.
    vi.useFakeTimers();
    await executeLayout(graph, specFor("force"));

    // Assert: positions moved without any timer ever firing.
    expect(vi.getTimerCount()).toBe(0);
    const after = positions(graph);
    const moved = after.filter((p, i) => distance(p, before[i]) > 0);
    expect(moved.length).toBeGreaterThan(0);
  });

  it("worker path: constructs supervisor with inferred settings, start→stop→kill, resolves after budget", async () => {
    // Arrange
    vi.useFakeTimers();
    const graph = starGraph();
    const calls = [];
    const FakeSupervisor = makeFakeSupervisor(calls);

    // Act
    const pending = executeLayout(graph, specFor("force"), { ForceSupervisor: FakeSupervisor });
    await vi.advanceTimersByTimeAsync(STAR_BUDGET_MS);
    await pending;

    // Assert: full lifecycle, in order, with FA2 settings passed through.
    expect(calls.map(([name]) => name)).toEqual(["construct", "start", "stop", "kill"]);
    expect(calls[0][1].settings).toEqual(forceAtlas2.inferSettings(graph));
  });

  it("worker path: stop and kill still run when start throws", async () => {
    // Arrange
    const graph = starGraph();
    const calls = [];
    const FakeSupervisor = makeFakeSupervisor(calls, { startThrows: true });

    // Act + Assert
    await expect(
      executeLayout(graph, specFor("force"), { ForceSupervisor: FakeSupervisor }),
    ).rejects.toThrow("start failed");
    expect(calls.map(([name]) => name)).toEqual(["construct", "start", "stop", "kill"]);
  });

  it("double-run guard: re-entrant force on the same graph is a no-op while animating", async () => {
    // Arrange
    vi.useFakeTimers();
    const graph = starGraph();
    const calls = [];
    const FakeSupervisor = makeFakeSupervisor(calls);

    // Act: second call lands while the first animation window is open.
    const first = executeLayout(graph, specFor("force"), { ForceSupervisor: FakeSupervisor });
    const second = executeLayout(graph, specFor("force"), { ForceSupervisor: FakeSupervisor });
    await second; // resolves immediately — no second supervisor
    await vi.advanceTimersByTimeAsync(STAR_BUDGET_MS);
    await first;

    // Assert: only one supervisor was ever constructed; guard released after.
    expect(calls.filter(([name]) => name === "construct")).toHaveLength(1);
    const rerun = executeLayout(graph, specFor("force"), { ForceSupervisor: FakeSupervisor });
    await vi.advanceTimersByTimeAsync(STAR_BUDGET_MS);
    await rerun;
    expect(calls.filter(([name]) => name === "construct")).toHaveLength(2);
  });

  it("guard is released when the supervisor constructor throws", async () => {
    // Arrange
    const graph = starGraph();
    class ThrowingSupervisor {
      constructor() {
        throw new Error("no worker");
      }
    }

    // Act + Assert: rejection does not leave the graph marked as animating.
    await expect(
      executeLayout(graph, specFor("force"), { ForceSupervisor: ThrowingSupervisor }),
    ).rejects.toThrow("no worker");
    vi.useFakeTimers();
    const calls = [];
    const pending = executeLayout(graph, specFor("force"), {
      ForceSupervisor: makeFakeSupervisor(calls),
    });
    await vi.advanceTimersByTimeAsync(STAR_BUDGET_MS);
    await pending;
    expect(calls.map(([name]) => name)).toEqual(["construct", "start", "stop", "kill"]);
  });
});

describe("noverlap post-pass (spec.noverlap)", () => {
  const NOVERLAP_MARGIN = 5; // mirrors layout_algorithms.js

  /** Two nodes whose grid cells (100 px apart) leave them visually overlapping. */
  function overlappingPairGraph(size = 80) {
    const graph = new Graph();
    graph.addNode("a", { x: 0, y: 0, size });
    graph.addNode("b", { x: 1, y: 1, size });
    graph.addEdge("a", "b");
    return graph;
  }

  function pairDistance(graph) {
    const a = graph.getNodeAttributes("a");
    const b = graph.getNodeAttributes("b");
    return distance(a, b);
  }

  it("separates two perfectly overlapping nodes by ≥ combined size + margin", () => {
    // Arrange: identical coordinates — the jitter branch of the algorithm.
    const graph = new Graph();
    graph.addNode("a", { x: 50, y: 50, size: 10 });
    graph.addNode("b", { x: 50, y: 50, size: 10 });

    // Act
    applyNoverlap(graph);

    // Assert
    expect(pairDistance(graph)).toBeGreaterThanOrEqual(10 + 10 + NOVERLAP_MARGIN);
  });

  it.each([false, undefined])("noverlap: %s leaves base-layout positions untouched", async (flag) => {
    // Arrange: oversized nodes on the 100-px grid lattice WOULD overlap.
    const graph = overlappingPairGraph();

    // Act
    await executeLayout(graph, { ...specFor("grid"), noverlap: flag });

    // Assert: exact lattice coordinates — no post-pass displacement.
    graph.forEachNode((_id, attrs) => {
      expect(attrs.x % 100).toBe(0);
      expect(attrs.y % 100).toBe(0);
    });
  });

  it.each(["grid", "circular"])("after %s: no node pair remains overlapping", async (type) => {
    // Arrange: 8 size-80 nodes — the 100-px grid lattice and the circular
    // ring gap (~76 px) both undercut the 80+80+margin clearance required.
    const graph = new Graph();
    for (let i = 0; i < 8; i++) graph.addNode(`n${i}`, { x: i, y: -i, size: 80 });

    // Act
    await executeLayout(graph, { ...specFor(type), noverlap: true });

    // Assert: every pair is clear of its combined radii + margin.
    const pts = positions(graph);
    const pairDistances = pts.flatMap((p, i) => pts.slice(i + 1).map((q) => distance(p, q)));
    expect(Math.min(...pairDistances)).toBeGreaterThanOrEqual(80 + 80 + NOVERLAP_MARGIN);
  });

  it("runs after the animated-force (worker supervisor) path", async () => {
    // Arrange: a supervisor that never moves nodes isolates the post-pass.
    vi.useFakeTimers();
    const graph = overlappingPairGraph(10);
    class InertSupervisor {
      start() {}
      stop() {}
      kill() {}
    }

    // Act: 2-node budget = min(5000, 500 + 2*2) = 504 ms.
    const pending = executeLayout(graph, { ...specFor("force"), noverlap: true }, {
      ForceSupervisor: InertSupervisor,
    });
    await vi.advanceTimersByTimeAsync(504);
    await pending;
    vi.useRealTimers();

    // Assert
    expect(pairDistance(graph)).toBeGreaterThanOrEqual(10 + 10 + NOVERLAP_MARGIN);
  });

  it("respects node size: bigger nodes are pushed further apart", () => {
    // Arrange: identical geometry, only the size attribute differs.
    const makePair = (size) => {
      const graph = new Graph();
      graph.addNode("a", { x: 0, y: 0, size });
      graph.addNode("b", { x: 1, y: 0, size });
      return graph;
    };
    const small = makePair(5);
    const big = makePair(20);

    // Act
    applyNoverlap(small);
    applyNoverlap(big);

    // Assert
    expect(pairDistance(small)).toBeGreaterThanOrEqual(5 + 5 + NOVERLAP_MARGIN);
    expect(pairDistance(big)).toBeGreaterThanOrEqual(20 + 20 + NOVERLAP_MARGIN);
    expect(pairDistance(big)).toBeGreaterThan(pairDistance(small));
  });

  it("empty and single-node graphs are no-ops", () => {
    // Arrange
    const empty = new Graph();
    const single = new Graph();
    single.addNode("only", { x: 7, y: 9, size: 12 });

    // Act
    applyNoverlap(empty);
    applyNoverlap(single);

    // Assert
    expect(empty.order).toBe(0);
    expect(single.getNodeAttributes("only")).toMatchObject({ x: 7, y: 9 });
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

  it.each(["radial", "concentric", "mds", "dagre"])(
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
