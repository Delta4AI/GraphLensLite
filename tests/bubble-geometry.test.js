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

  describe("scale option (zoom-invariant influence field)", () => {
    // The avoid-member scenario shrunk by the scale factor must keep its
    // shape: members enclosed, avoid node excluded. Without scaling the
    // influence constants, the fixed 50 px negative disc of the avoid node
    // would swallow the shrunken members' field.
    it.each([0.25, 0.1])("preserves member/avoid geometry rescaled by %f", (s) => {
      const members = [rectAt(50 * s, 100 * s, 10 * s), rectAt(250 * s, 100 * s, 10 * s)];
      const avoid = [rectAt(150 * s, 100 * s, 10 * s)];
      const outline = computeOutlinePoints(members, avoid, { scale: s });
      expect(outline.length).toBeGreaterThan(3);
      expect(pointInPolygon({ x: 50 * s, y: 100 * s }, outline)).toBe(true);
      expect(pointInPolygon({ x: 250 * s, y: 100 * s }, outline)).toBe(true);
      expect(pointInPolygon({ x: 150 * s, y: 100 * s }, outline)).toBe(false);
    });

    it("keeps a dense zoomed-out group intact where unscaled constants lose it", () => {
      // Zoomed-out screen geometry: two 1 px members 6 px apart inside two
      // rings of 32 avoid nodes (the dense-graph repro for the vanishing
      // outline). Unscaled, the avoid nodes' negative field corrupts the
      // outline (a member ends up outside); scaled it hugs both members
      // and excludes the ring.
      const members = [rectAt(0, 0, 1), rectAt(6, 0, 1)];
      const avoid = [];
      for (const radius of [14, 22]) {
        for (let i = 0; i < 16; i++) {
          const ang = (i / 16) * 2 * Math.PI;
          avoid.push(rectAt(3 + radius * Math.cos(ang), radius * Math.sin(ang), 1));
        }
      }

      const unscaled = computeOutlinePoints(members, avoid);
      const coversBoth = (outline) =>
        outline.length > 0 &&
        pointInPolygon({ x: 0, y: 0 }, outline) &&
        pointInPolygon({ x: 6, y: 0 }, outline);
      expect(coversBoth(unscaled)).toBe(false);

      const scaled = computeOutlinePoints(members, avoid, { scale: 0.1 });
      expect(coversBoth(scaled)).toBe(true);
      expect(pointInPolygon({ x: 17, y: 0 }, scaled)).toBe(false);
    });
  });
});

describe("outlineLabelAnchor", () => {
  // Axis-aligned diamond-cornered square ring (clockwise in y-down viewport
  // space) with a unique extreme vertex per side and centroid (5, 5); each
  // extreme's ring neighbors form an axis-aligned tangent.
  const ring = [
    { x: 0, y: 0 },
    { x: 5, y: -1 }, // top apex
    { x: 10, y: 0 },
    { x: 11, y: 5 }, // right apex
    { x: 10, y: 10 },
    { x: 5, y: 11 }, // bottom apex
    { x: 0, y: 10 },
    { x: -1, y: 5 }, // left apex
  ];

  it("defaults to the topmost point (smallest y — viewport space is y-down)", () => {
    const points = [
      { x: 5, y: 9 },
      { x: 7, y: 2 },
      { x: 1, y: 6 },
    ];
    expect(outlineLabelAnchor(points)).toMatchObject({ x: 7, y: 2 });
  });

  it("returns null for empty or missing outlines", () => {
    expect(outlineLabelAnchor([])).toBeNull();
    expect(outlineLabelAnchor(null)).toBeNull();
  });

  it.each([
    ["top", { x: 5, y: -1 }],
    ["bottom", { x: 5, y: 11 }],
    ["left", { x: -1, y: 5 }],
    ["right", { x: 11, y: 5 }],
  ])("picks the %s extreme vertex", (placement, expected) => {
    expect(outlineLabelAnchor(ring, placement)).toMatchObject(expected);
  });

  it("returns a horizontal tangent angle on horizontal edges", () => {
    // Top apex neighbors (0,0)/(10,0) and bottom apex neighbors
    // (10,10)/(0,10) are horizontal; bottom's reversed tangent (PI) must
    // normalize back to 0 so text stays upright.
    expect(outlineLabelAnchor(ring, "top").angle).toBeCloseTo(0);
    expect(outlineLabelAnchor(ring, "bottom").angle).toBeCloseTo(0);
  });

  it("returns a vertical tangent angle within [-PI/2, PI/2] on vertical edges", () => {
    expect(Math.abs(outlineLabelAnchor(ring, "left").angle)).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(outlineLabelAnchor(ring, "right").angle)).toBeCloseTo(Math.PI / 2);
  });

  it.each([
    ["top", { nx: 0, ny: -1 }],
    ["bottom", { nx: 0, ny: 1 }],
    ["left", { nx: -1, ny: 0 }],
    ["right", { nx: 1, ny: 0 }],
  ])("normal at the %s extreme points away from the centroid", (placement, normal) => {
    const anchor = outlineLabelAnchor(ring, placement);
    expect(anchor.nx).toBeCloseTo(normal.nx);
    expect(anchor.ny).toBeCloseTo(normal.ny);
  });

  it("center placement returns the vertex centroid with no rotation or normal", () => {
    expect(outlineLabelAnchor(ring, "center")).toEqual({ x: 5, y: 5, angle: 0, nx: 0, ny: 0 });
  });

  it("falls back to top for unknown placements", () => {
    expect(outlineLabelAnchor(ring, "diagonal")).toMatchObject({ x: 5, y: -1 });
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
    expect(styleKey({ ...style, members: ["a"] })).toBe(styleKey({ ...style, members: ["b"] }));
  });

  it("changes when a painted field changes", () => {
    expect(styleKey({ fill: "#000" })).not.toBe(styleKey({ fill: "#fff" }));
    expect(styleKey({ label: true, labelText: "a" })).not.toBe(
      styleKey({ label: true, labelText: "b" }),
    );
    expect(styleKey({ fillOpacity: 0 })).not.toBe(styleKey({ fillOpacity: 0.25 }));
  });

  it("changes when a label placement knob changes (paint signature must invalidate)", () => {
    expect(styleKey({ labelPlacement: "top" })).not.toBe(styleKey({ labelPlacement: "bottom" }));
    expect(styleKey({ labelCloseToPath: true })).not.toBe(styleKey({ labelCloseToPath: false }));
    expect(styleKey({ labelAutoRotate: true })).not.toBe(styleKey({ labelAutoRotate: false }));
  });

  it("distinguishes the literal string \"undefined\" from a missing field", () => {
    expect(styleKey({ fill: "undefined" })).not.toBe(styleKey({}));
  });

  it("treats null and missing as equal (both paint via group defaults)", () => {
    expect(styleKey({ fill: null })).toBe(styleKey({}));
  });
});
