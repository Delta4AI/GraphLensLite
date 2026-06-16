import { describe, it, expect } from "vitest";
import { pointInPolygon, polygonBBox, idsInsidePolygon } from "../src/graph/lasso_geometry.js";

// ==========================================================================
// Lasso geometry (sigma migration Phase 3) — pure point-in-polygon math for
// the freehand lasso overlay. Node-safe: no DOM/canvas.
// ==========================================================================

const SQUARE = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

// Concave "C" shape opening to the right.
const C_SHAPE = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 2 },
  { x: 2, y: 2 },
  { x: 2, y: 8 },
  { x: 10, y: 8 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe("polygonBBox", () => {
  it("returns the axis-aligned bounds", () => {
    expect(polygonBBox(SQUARE)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it("handles negative coordinates", () => {
    const polygon = [
      { x: -5, y: -3 },
      { x: 4, y: -7 },
      { x: 2, y: 6 },
    ];
    expect(polygonBBox(polygon)).toEqual({ minX: -5, minY: -7, maxX: 4, maxY: 6 });
  });

  it("returns null for empty or missing input", () => {
    expect(polygonBBox([])).toBeNull();
    expect(polygonBBox(null)).toBeNull();
  });

  it("degenerates to a point for a single vertex", () => {
    expect(polygonBBox([{ x: 3, y: 4 }])).toEqual({ minX: 3, minY: 4, maxX: 3, maxY: 4 });
  });
});

describe("pointInPolygon", () => {
  it("detects points inside a convex polygon", () => {
    expect(pointInPolygon({ x: 5, y: 5 }, SQUARE)).toBe(true);
    expect(pointInPolygon({ x: 0.001, y: 9.999 }, SQUARE)).toBe(true);
  });

  it("rejects points outside a convex polygon", () => {
    expect(pointInPolygon({ x: 15, y: 5 }, SQUARE)).toBe(false);
    expect(pointInPolygon({ x: -1, y: 5 }, SQUARE)).toBe(false);
    expect(pointInPolygon({ x: 5, y: -0.5 }, SQUARE)).toBe(false);
  });

  it("handles concave polygons (point in the notch is outside)", () => {
    expect(pointInPolygon({ x: 1, y: 5 }, C_SHAPE)).toBe(true); // spine of the C
    expect(pointInPolygon({ x: 6, y: 5 }, C_SHAPE)).toBe(false); // inside the notch
    expect(pointInPolygon({ x: 6, y: 1 }, C_SHAPE)).toBe(true); // upper arm
  });

  it("returns false for degenerate polygons (< 3 vertices)", () => {
    expect(pointInPolygon({ x: 0, y: 0 }, [])).toBe(false);
    expect(pointInPolygon({ x: 0, y: 0 }, null)).toBe(false);
    expect(
      pointInPolygon({ x: 5, y: 5 }, [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]),
    ).toBe(false);
  });

  it("documents half-open boundary semantics (ray-cast, not strict)", () => {
    // Boundary membership is ambiguous for freehand lassos; the ray-cast
    // yields half-open behavior — left boundary counts inside, right outside.
    // Pinned here so a future algorithm swap surfaces the change explicitly.
    expect(pointInPolygon({ x: 0, y: 5 }, SQUARE)).toBe(true); // left edge
    expect(pointInPolygon({ x: 10, y: 5 }, SQUARE)).toBe(false); // right edge
  });

  it("tolerates a duplicate closing vertex (pen lifted at the start point)", () => {
    const closed = [...SQUARE, { x: 0, y: 0 }];
    expect(pointInPolygon({ x: 5, y: 5 }, closed)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, closed)).toBe(false);
  });

  it("applies the even-odd rule to self-intersecting strokes", () => {
    // Bowtie: (0,0)→(10,10)→(10,0)→(0,10). The crossing creates two lobes;
    // the center sits on the intersection seam region counted outside.
    const bowtie = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 2, y: 5 }, bowtie)).toBe(true); // left lobe
    expect(pointInPolygon({ x: 8, y: 5 }, bowtie)).toBe(true); // right lobe
    expect(pointInPolygon({ x: 5, y: 1 }, bowtie)).toBe(false); // above seam, between lobes
  });

  it("works for an unclosed freehand stroke (implicit closing edge)", () => {
    // Open triangle stroke: (0,0) → (10,0) → (5,10); closing edge implied.
    const stroke = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 },
    ];
    expect(pointInPolygon({ x: 5, y: 3 }, stroke)).toBe(true);
    expect(pointInPolygon({ x: 0, y: 9 }, stroke)).toBe(false);
  });
});

describe("idsInsidePolygon", () => {
  const points = [
    { id: "in-center", x: 5, y: 5 },
    { id: "in-corner", x: 1, y: 1 },
    { id: "out-near", x: 11, y: 5 }, // outside bbox on x
    { id: "out-far", x: 100, y: 100 },
    { id: "in-bbox-out-poly", x: 6, y: 5 }, // inside bbox, inside the C notch
  ];

  it("selects only points inside the polygon", () => {
    expect(idsInsidePolygon(points, SQUARE)).toEqual([
      "in-center",
      "in-corner",
      "in-bbox-out-poly",
    ]);
  });

  it("bbox prefilter and full test agree on concave polygons", () => {
    expect(idsInsidePolygon(points, C_SHAPE)).toEqual(["in-corner"]);
  });

  it("returns empty for degenerate polygons and empty point lists", () => {
    expect(idsInsidePolygon(points, [])).toEqual([]);
    expect(idsInsidePolygon(points, [{ x: 0, y: 0 }])).toEqual([]);
    expect(idsInsidePolygon([], SQUARE)).toEqual([]);
  });
});
