import { describe, it, expect } from "vitest";
import {
  nodeViewportRect,
  computeOutlinePoints,
  outlineLabelAnchor,
  idsKey,
  positionsChecksum,
  styleKey,
} from "../src/graph/bubble_geometry.js";
import { pointInPolygon } from "../src/graph/lasso_geometry.js";

// ==========================================================================
// Bubble-set geometry (sigma migration Phase 4) — pure outline math between
// the bubble groups and bubblesets-js. Node-safe: no DOM/canvas/sigma.
// ==========================================================================

const rectAt = (x, y, r = 10) => nodeViewportRect(x, y, r);

describe("nodeViewportRect", () => {
  it("centers a square of side 2*radius on the node position", () => {
    expect(nodeViewportRect(50, 30, 10)).toEqual({ x: 40, y: 20, width: 20, height: 20 });
  });

  it("handles zero radius (degenerate rect at the position)", () => {
    expect(nodeViewportRect(5, 5, 0)).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });
});

describe("computeOutlinePoints", () => {
  it("returns an empty array for no members", () => {
    expect(computeOutlinePoints([], [])).toEqual([]);
    expect(computeOutlinePoints(null, [])).toEqual([]);
  });

  it("encloses a single member", () => {
    const outline = computeOutlinePoints([rectAt(100, 100)], []);
    expect(outline.length).toBeGreaterThan(3);
    expect(pointInPolygon({ x: 100, y: 100 }, outline)).toBe(true);
  });

  it("encloses all members of a spread group (virtual edges connect them)", () => {
    const members = [rectAt(50, 50), rectAt(250, 80), rectAt(150, 220)];
    const outline = computeOutlinePoints(members, []);
    for (const m of members) {
      const center = { x: m.x + m.width / 2, y: m.y + m.height / 2 };
      expect(pointInPolygon(center, outline)).toBe(true);
    }
  });

  it("excludes avoid members from the outline", () => {
    const members = [rectAt(50, 100), rectAt(250, 100)];
    const avoid = [rectAt(150, 100)];
    const outline = computeOutlinePoints(members, avoid);
    expect(pointInPolygon({ x: 50, y: 100 }, outline)).toBe(true);
    expect(pointInPolygon({ x: 250, y: 100 }, outline)).toBe(true);
    expect(pointInPolygon({ x: 150, y: 100 }, outline)).toBe(false);
  });

  it("is deterministic for identical input", () => {
    const members = [rectAt(10, 10), rectAt(90, 60)];
    expect(computeOutlinePoints(members, [])).toEqual(computeOutlinePoints(members, []));
  });

  it("honors virtualEdges: false", () => {
    // Two adjacent members still produce an outline without routing edges.
    const members = [rectAt(50, 50), rectAt(75, 50)];
    const outline = computeOutlinePoints(members, [], { virtualEdges: false });
    expect(pointInPolygon({ x: 50, y: 50 }, outline)).toBe(true);
    expect(pointInPolygon({ x: 75, y: 50 }, outline)).toBe(true);
  });
});

describe("outlineLabelAnchor", () => {
  it("returns the topmost point (smallest y — viewport space is y-down)", () => {
    const points = [
      { x: 5, y: 9 },
      { x: 7, y: 2 },
      { x: 1, y: 6 },
    ];
    expect(outlineLabelAnchor(points)).toEqual({ x: 7, y: 2 });
  });

  it("returns null for empty or missing outlines", () => {
    expect(outlineLabelAnchor([])).toBeNull();
    expect(outlineLabelAnchor(null)).toBeNull();
  });
});

describe("idsKey", () => {
  it("is order-insensitive", () => {
    expect(idsKey(["b", "a", "c"])).toBe(idsKey(["c", "b", "a"]));
  });

  it("distinguishes different member sets", () => {
    expect(idsKey(["a", "b"])).not.toBe(idsKey(["a", "c"]));
  });

  it("accepts any iterable (Map keys)", () => {
    const members = new Map([
      ["n2", true],
      ["n1", true],
    ]);
    expect(idsKey(members.keys())).toBe(idsKey(["n1", "n2"]));
  });

  it("does not collide for ids containing spaces (NUL separator)", () => {
    expect(idsKey(["a b", "c"])).not.toBe(idsKey(["a", "b c"]));
  });
});

describe("positionsChecksum", () => {
  const base = [
    { x: 1, y: 2 },
    { x: 3, y: 4 },
  ];

  it("is stable for identical positions", () => {
    expect(positionsChecksum(base)).toBe(positionsChecksum([...base]));
  });

  it("changes when a node moves", () => {
    const moved = [
      { x: 1, y: 2 },
      { x: 3, y: 5 },
    ];
    expect(positionsChecksum(moved)).not.toBe(positionsChecksum(base));
  });

  it("changes when two positions swap (order-sensitive)", () => {
    const swapped = [base[1], base[0]];
    expect(positionsChecksum(swapped)).not.toBe(positionsChecksum(base));
  });

  it("yields distinct checksums for every permutation of 3 distinct positions", () => {
    const positions = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
    ];
    const orders = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    const checksums = orders.map((order) => positionsChecksum(order.map((i) => positions[i])));
    expect(new Set(checksums).size).toBe(orders.length);
  });

  it("changes with member count", () => {
    expect(positionsChecksum(base.slice(0, 1))).not.toBe(positionsChecksum(base));
  });

  it("detects a 0.5 px move in one of 1000 large-coordinate members (no float loss)", () => {
    // Regression: the old floating-point accumulation could lose a sub-pixel
    // move at coordinate magnitudes ~1e3 across many members.
    const makePositions = () =>
      Array.from({ length: 1000 }, (_, i) => ({
        x: (i % 100) * 100 - 5000,
        y: Math.floor(i / 100) * 1000 - 5000,
      }));
    const before = makePositions();
    const after = makePositions();
    after[500] = { x: after[500].x + 0.5, y: after[500].y };
    expect(positionsChecksum(after)).not.toBe(positionsChecksum(before));
  });
});

describe("styleKey", () => {
  it("is stable for equal styles and ignores irrelevant fields", () => {
    const style = { fill: "#403C53", fillOpacity: 0.25, stroke: "#C33D35", label: true };
    expect(styleKey({ ...style, labelCloseToPath: true })).toBe(
      styleKey({ ...style, labelCloseToPath: false }),
    );
  });

  it("changes when a painted field changes", () => {
    expect(styleKey({ fill: "#000" })).not.toBe(styleKey({ fill: "#fff" }));
    expect(styleKey({ label: true, labelText: "a" })).not.toBe(
      styleKey({ label: true, labelText: "b" }),
    );
    expect(styleKey({ fillOpacity: 0 })).not.toBe(styleKey({ fillOpacity: 0.25 }));
  });

  it("distinguishes the literal string \"undefined\" from a missing field", () => {
    expect(styleKey({ fill: "undefined" })).not.toBe(styleKey({}));
  });

  it("treats null and missing as equal (both paint via group defaults)", () => {
    expect(styleKey({ fill: null })).toBe(styleKey({}));
  });
});
