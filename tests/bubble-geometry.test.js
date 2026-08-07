import { describe, it, expect } from "vitest";
import {
  nodeViewportRect,
  computeOutlineGeometry,
  polygonSelfIntersects,
  outlineLabelAnchor,
  idsKey,
  positionsChecksum,
  styleKey,
} from "../src/graph/bubble_geometry.js";
import { smoothClosedPath, sampleSmoothedRing } from "../src/graph/bubble_smoothing.js";
import { pointInPolygon } from "../src/graph/lasso_geometry.js";

// ==========================================================================
// Bubble-set geometry (sigma migration Phase 4) — pure outline math between
// the bubble groups and bubblesets-js. Node-safe: no DOM/canvas/sigma.
// ==========================================================================

const rectAt = (x, y, r = 10) => nodeViewportRect(x, y, r);
const outlinePoints = (members, avoid = [], opts = {}) =>
  computeOutlineGeometry(members, avoid, opts).outer;

describe("nodeViewportRect", () => {
  it("centers a square of side 2*radius on the node position", () => {
    expect(nodeViewportRect(50, 30, 10)).toEqual({ x: 40, y: 20, width: 20, height: 20 });
  });

  it("handles zero radius (degenerate rect at the position)", () => {
    expect(nodeViewportRect(5, 5, 0)).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });
});

describe("polygonSelfIntersects (phantom-outline detector)", () => {
  it("returns false for a simple convex quad", () => {
    expect(polygonSelfIntersects([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ])).toBe(false);
  });

  it("returns false for a simple concave polygon", () => {
    // arrow/chevron — concave but non-self-crossing
    expect(polygonSelfIntersects([
      { x: 0, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 10 }, { x: 3, y: 5 },
    ])).toBe(false);
  });

  it("detects a bow-tie (figure-eight) crossing", () => {
    // classic self-intersecting quad: edges (0→1) and (2→3) cross
    expect(polygonSelfIntersects([
      { x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 },
    ])).toBe(true);
  });

  it("ignores shared vertices of adjacent edges (no false positive)", () => {
    expect(polygonSelfIntersects([
      { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 },
    ])).toBe(false);
  });

  it("returns false for fewer than 4 points", () => {
    expect(polygonSelfIntersects([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }])).toBe(false);
  });
});

describe("computeOutlineGeometry", () => {
  it("returns an empty array for no members", () => {
    expect(outlinePoints([], [])).toEqual([]);
    expect(outlinePoints(null, [])).toEqual([]);
  });

  it("encloses a single member", () => {
    const outline = outlinePoints([rectAt(100, 100)], []);
    expect(outline.length).toBeGreaterThan(3);
    expect(pointInPolygon({ x: 100, y: 100 }, outline)).toBe(true);
  });

  it("encloses all members of a spread group (virtual edges connect them)", () => {
    const members = [rectAt(50, 50), rectAt(250, 80), rectAt(150, 220)];
    const outline = outlinePoints(members, []);
    for (const m of members) {
      const center = { x: m.x + m.width / 2, y: m.y + m.height / 2 };
      expect(pointInPolygon(center, outline)).toBe(true);
    }
  });

  it("excludes avoid members from the outline", () => {
    const members = [rectAt(50, 100), rectAt(250, 100)];
    const avoid = [rectAt(150, 100)];
    const outline = outlinePoints(members, avoid);
    expect(pointInPolygon({ x: 50, y: 100 }, outline)).toBe(true);
    expect(pointInPolygon({ x: 250, y: 100 }, outline)).toBe(true);
    expect(pointInPolygon({ x: 150, y: 100 }, outline)).toBe(false);
  });

  it("is deterministic for identical input", () => {
    const members = [rectAt(10, 10), rectAt(90, 60)];
    expect(outlinePoints(members, [])).toEqual(outlinePoints(members, []));
  });

  // Regression (the "solid wedge"): bubblesets-js maps pixels to marching
  // cells with floor((x - originX) / pixelGroup) but maps cells back with
  // round(i * pixelGroup + originX), a round trip that only agrees when the
  // cell is a whole number of pixels. At a fractional cell the traced ring
  // short-circuits across its own interior and the empty space between two
  // corridors paints as one solid wedge. No downstream repair can see it:
  // the ring is simple and does not self-intersect.
  //
  // The cell size derives from the mean member radius, so whether a graph
  // wedges depended on its node size. Every radius below reproduced it before
  // pixelGroup was rounded; the avoid node is load-bearing (it bends the
  // corridor past the probe point, and with no avoid rects nothing wedges).
  describe("whole-pixel marching grid", () => {
    // Two members side by side, a third far below, one non-member beside the
    // long corridor — the reported layout, reduced.
    const members = (r) => [rectAt(170, 30, r), rectAt(322, 30, r), rectAt(176, 661, r)];
    const avoid = (r) => [rectAt(180, 497, r)];
    // The knobs a new group actually ships with (BUBBLE_GROUP_STYLE_TEMPLATE).
    // computeOutlinePoints' own fallback is 1/1, a far fatter hull than any
    // group is created with, so the reported case only reproduces at these.
    const SHIPPED = { padding: 0.1, corridor: 0.25 };
    const BETWEEN_THE_ARMS = { x: 240, y: 200 };
    const WEDGING_RADII = [7, 8, 9, 11, 11.5, 12.5, 13, 13.5, 14.5];

    it.each(WEDGING_RADII)("leaves the space between two corridors empty at radius %s", (r) => {
      const outline = outlinePoints(members(r), avoid(r), SHIPPED);
      expect(pointInPolygon(BETWEEN_THE_ARMS, outline)).toBe(false);
    });

    it("still encloses every member while doing so", () => {
      const outline = outlinePoints(members(12.5), avoid(12.5), SHIPPED);
      for (const [x, y] of [[170, 30], [322, 30], [176, 661]]) {
        expect(pointInPolygon({ x, y }, outline)).toBe(true);
      }
    });

    it("keeps the hull to corridor scale rather than wedge scale", () => {
      // Measured: ~7.6k px² for two thin arms, ~39k once the wedge fills —
      // the triangle those three members span is ~48k. Catches a fill the
      // single probe point above happens to miss.
      const outline = outlinePoints(members(12.5), avoid(12.5), SHIPPED);
      const area = Math.abs(
        outline.reduce((sum, p, i) => {
          const q = outline[(i + 1) % outline.length];
          return sum + (p.x * q.y - q.x * p.y);
        }, 0) / 2
      );
      expect(area).toBeLessThan(15000);
    });
  });

  // Regression (the "wedge at the group label"): the POLYGON is clean but the
  // curve the painters draw from it crossed itself, and with even-odd fill a
  // crossing paints the empty space between two corridor arms as a solid
  // wedge. Cause: the control offsets were capped at a fraction of the
  // segment's CHORD, and a corridor arm is a few px wide but hundreds long —
  // so at the sharp notch where two arms meet, the cap allowed an overshoot
  // many times the arm's own width, straight across the ribbon. Damping the
  // offset by how sharply the ring turns (SMOOTH_TURN_FALLOFF_POWER) fixes it.
  describe("painted curve on thin corridors", () => {
    // The reported workspace's group, in reference-space px: a chain of hubs
    // plus two nodes off in a corner whose arms meet at a sharp angle.
    const REPORTED = [
      [179, 127], [509, 259], [749, 345], [65, 481], [182, 702], [915, 605], [814, 760],
    ];
    const members = REPORTED.map(([x, y]) => rectAt(x, y, 10));

    // Every padding here crossed before the damping; the band the report
    // named ("0.01 up to about 0.3") is exactly where the arms stay thin.
    it.each([0.01, 0.1, 0.3])("does not cross itself at padding %s", (padding) => {
      const outline = outlinePoints(members, [], { padding, corridor: 0.25 });
      // The polygon was never the problem — only what was painted from it.
      expect(polygonSelfIntersects(outline)).toBe(false);
      expect(polygonSelfIntersects(sampleSmoothedRing(outline))).toBe(false);
    });

    it("still rounds a gently turning ring", () => {
      // A 24-gon turns 15° per vertex, so the damping is nearly inactive and
      // the curve must stay clear of the inscribed polygon's flat edges.
      const circle = Array.from({ length: 24 }, (_, i) => ({
        x: 100 * Math.cos((i / 24) * 2 * Math.PI),
        y: 100 * Math.sin((i / 24) * 2 * Math.PI),
      }));
      const painted = sampleSmoothedRing(circle);
      const radii = painted.map((p) => Math.hypot(p.x, p.y));
      // Polygon edge midpoints sit at 100·cos(7.5°) ≈ 99.14; a smoothed ring
      // bulges back out past that.
      expect(Math.min(...radii)).toBeGreaterThan(99.1);
      expect(Math.max(...radii)).toBeLessThan(100.5);
    });

    it("takes the corner off a hairpin instead of overshooting it", () => {
      // Two long parallel runs joined by a 180° reversal — the shape that
      // used to overshoot across the gap. The tip control points must not
      // travel back up the ribbon.
      const hairpin = [
        { x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 6 }, { x: 0, y: 6 },
      ];
      const tip = smoothClosedPath(hairpin).find((s) => s.x0 === 300 && s.y0 === 0);
      expect(Math.abs(tip.c1x - 300)).toBeLessThan(1);
    });
  });

  describe("node-size-aware influence field", () => {
    // The field derives from the group's MEAN MEMBER RADIUS (the rects carry
    // the size information), so the same scene rescaled — different node
    // sizes, or a zoomed-out reference viewport — keeps its shape with no
    // scale hint: members enclosed, avoid node excluded. Sub-pixel radii are
    // excluded here: the 1 px marching-grid floor cannot carve a 1 px avoid
    // node (production ratio-1 radii are ≥ 7.5 px).
    it.each([1, 0.25])("preserves member/avoid geometry rescaled by %f", (s) => {
      const members = [rectAt(50 * s, 100 * s, 10 * s), rectAt(250 * s, 100 * s, 10 * s)];
      const avoid = [rectAt(150 * s, 100 * s, 10 * s)];
      const outline = outlinePoints(members, avoid);
      expect(outline.length).toBeGreaterThan(3);
      expect(pointInPolygon({ x: 50 * s, y: 100 * s }, outline)).toBe(true);
      expect(pointInPolygon({ x: 250 * s, y: 100 * s }, outline)).toBe(true);
      expect(pointInPolygon({ x: 150 * s, y: 100 * s }, outline)).toBe(false);
    });

    // The legacy opts.scale hint is gone; passing it must not change the fit.
    it("ignores a legacy scale option (field self-scales from the rects)", () => {
      const members = [rectAt(10, 10, 5), rectAt(60, 30, 5)];
      expect(outlinePoints(members, [], { scale: 0.1 }))
        .toEqual(outlinePoints(members, []));
    });

    // Regression: bubblesets-js sample(step) uses `step` as an array index
    // stride — a fractional stride indexes between points and returns
    // undefined, crashing bSplines()/simplify(). The stride is a constant
    // integer now, but node sizes that used to produce fractional strides
    // must keep producing valid outlines at any radius, never throw.
    it.each([0.354, 0.2, 0.7, 1.58, 2.3, 5])(
      "does not throw and returns a hull with node radii scaled by %f",
      (s) => {
        const members = [rectAt(0, 0, 20 * s), rectAt(20 * s, 0, 20 * s), rectAt(10 * s, 20 * s, 20 * s)];
        let outline;
        expect(() => { outline = outlinePoints(members, []); }).not.toThrow();
        expect(outline.length).toBeGreaterThan(3);
        expect(outline.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
      },
    );

    // Regression (phantom chords / convex-hull artifact): a chain whose
    // virtualEdges corridors route around avoid-members produces a genuinely
    // SELF-INTERSECTING bubblesets ring at this zoomed-out scale (verified: the
    // raw and smoothed contours both self-cross). Drawn directly it paints
    // phantom straight chords; the old convex-hull fallback painted a blocky
    // triangle. computeOutlinePoints must now repair it (polygon self-union)
    // into a simple polygon that still encloses every member.
    it("repairs a self-intersecting avoid-member outline into a simple hull", () => {
      const s = 0.3;
      const members = [rectAt(0, 0, 12 * s), rectAt(300 * s, 0, 12 * s), rectAt(600 * s, 0, 12 * s)];
      const avoid = [rectAt(150 * s, 40 * s, 12 * s), rectAt(450 * s, -40 * s, 12 * s)];
      const outline = outlinePoints(members, avoid);
      expect(outline.length).toBeGreaterThan(3);
      expect(polygonSelfIntersects(outline)).toBe(false);
      for (const m of members) {
        expect(pointInPolygon({ x: m.x + m.width / 2, y: m.y + m.height / 2 }, outline)).toBe(true);
      }
    });

    it("keeps a dense zoomed-out group intact (vanishing-outline repro)", () => {
      // Zoomed-out screen geometry: two 1 px members 6 px apart inside two
      // rings of 32 avoid nodes (the dense-graph repro for the vanishing
      // outline). With the absolute-pixel constants this collapsed or leaked
      // the ring in; the size-aware field hugs both members AND excludes the
      // ring with no scale hint at all.
      const members = [rectAt(0, 0, 1), rectAt(6, 0, 1)];
      const avoid = [];
      for (const radius of [14, 22]) {
        for (let i = 0; i < 16; i++) {
          const ang = (i / 16) * 2 * Math.PI;
          avoid.push(rectAt(3 + radius * Math.cos(ang), radius * Math.sin(ang), 1));
        }
      }

      const outline = outlinePoints(members, avoid);
      expect(outline.length).toBeGreaterThan(3);
      expect(pointInPolygon({ x: 0, y: 0 }, outline)).toBe(true);
      expect(pointInPolygon({ x: 6, y: 0 }, outline)).toBe(true);
      expect(pointInPolygon({ x: 17, y: 0 }, outline)).toBe(false);
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

// ==========================================================================
// Geometry knobs (padding / corridor) — user-tunable influence-field
// multipliers, and node-size in the position checksum.
// ==========================================================================

const polygonArea = (points) => {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area / 2);
};

describe("computeOutlinePoints padding/corridor knobs", () => {
  const pair = [rectAt(100, 100), rectAt(140, 100)];

  it("padding < 1 shrinks the outline, > 1 grows it (still enclosing members)", () => {
    const tight = outlinePoints(pair, [], { padding: 0.5 });
    const base = outlinePoints(pair, [], {});
    const loose = outlinePoints(pair, [], { padding: 2 });
    expect(polygonArea(tight)).toBeLessThan(polygonArea(base));
    expect(polygonArea(base)).toBeLessThan(polygonArea(loose));
    for (const outline of [tight, base, loose]) {
      for (const m of pair) {
        expect(pointInPolygon({ x: m.x + m.width / 2, y: m.y + m.height / 2 }, outline)).toBe(true);
      }
    }
  });

  it("corridor width scales the arm to an outlying member", () => {
    const spread = [rectAt(50, 50), rectAt(400, 60)];
    const thin = outlinePoints(spread, [], { corridor: 0.5 });
    const thick = outlinePoints(spread, [], { corridor: 2.5 });
    expect(polygonArea(thin)).toBeLessThan(polygonArea(thick));
    for (const outline of [thin, thick]) {
      for (const m of spread) {
        expect(pointInPolygon({ x: m.x + m.width / 2, y: m.y + m.height / 2 }, outline)).toBe(true);
      }
    }
  });

  it("clamps out-of-range multipliers instead of collapsing the outline", () => {
    expect(outlinePoints(pair, [], { padding: 100 }))
      .toEqual(outlinePoints(pair, [], { padding: 4 }));
    expect(outlinePoints(pair, [], { padding: 0 }))
      .toEqual(outlinePoints(pair, [], {}));
    expect(outlinePoints(pair, [], { corridor: NaN }))
      .toEqual(outlinePoints(pair, [], {}));
  });

  it("styleKey invalidates on padding/corridor/avoidance changes", () => {
    expect(styleKey({ padding: 1 })).not.toBe(styleKey({ padding: 1.5 }));
    expect(styleKey({ corridor: 1 })).not.toBe(styleKey({ corridor: 2 }));
    expect(styleKey({ avoidance: 1 })).not.toBe(styleKey({ avoidance: 0 }));
  });
});

// Refit-time field-ring conditioning: uniform resample + Taubin smoothing.
// Douglas-Peucker keeps the extreme points of grid-scale field wobble, so
// unconditioned rings carry sharp turns and wildly uneven spacing that the
// painter's turn-damped Catmull-Rom renders as kinks and angular chords.
describe("field-ring conditioning (resample + Taubin)", () => {
  // Cluster with avoid-node pressure — the negative field makes the traced
  // contour wobble. Unconditioned, this ring measured 128° max turn and a
  // 53 px max spacing at a 5.9 px median.
  const members = [[430, 330], [520, 290], [390, 390], [470, 400], [340, 260]]
    .map(([x, y]) => rectAt(x, y, 15));
  const avoid = [[370, 200], [460, 210], [560, 210], [250, 300], [560, 480], [420, 520]]
    .map(([x, y]) => rectAt(x, y, 15));
  const ring = outlinePoints(members, avoid, { padding: 1, corridor: 1, avoidance: 1 });
  const n = ring.length;

  it("keeps vertex spacing near-uniform (no long angular chords)", () => {
    const spacings = [];
    for (let i = 0; i < n; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % n];
      spacings.push(Math.hypot(q.x - p.x, q.y - p.y));
    }
    spacings.sort((a, b) => a - b);
    expect(spacings[n - 1]).toBeLessThan(2 * spacings[n >> 1]);
  });

  it("keeps every turn gentle enough for the painter to round", () => {
    let maxTurn = 0;
    for (let i = 0; i < n; i++) {
      const p0 = ring[(i - 1 + n) % n];
      const p1 = ring[i];
      const p2 = ring[(i + 1) % n];
      const a = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      const b = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      let turn = Math.abs(b - a);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      maxTurn = Math.max(maxTurn, turn);
    }
    expect(maxTurn).toBeLessThan(Math.PI / 2);
  });

  it("still encloses every member and stays a simple ring", () => {
    expect(polygonSelfIntersects(ring)).toBe(false);
    for (const m of members) {
      expect(pointInPolygon({ x: m.x + m.width / 2, y: m.y + m.height / 2 }, ring)).toBe(true);
    }
  });
});

// Interior avoid holes: the field can only carve fjords from the boundary,
// so a non-member fully INSIDE the hull gets a disc hole punched via polygon
// difference (computeOutlineGeometry.holes; rendered even-odd).
describe("computeOutlineGeometry avoid holes", () => {
  // 8 members in a ring leave a covered pocket at (60,60); the avoid node
  // sits in that pocket, fully interior to the hull.
  const ringMembers = [
    [0, 0], [60, 0], [120, 0], [0, 60], [120, 60], [0, 120], [60, 120], [120, 120],
  ].map(([x, y]) => rectAt(x, y, 20));
  const interiorAvoid = [rectAt(60, 60, 15)];

  it("punches a hole around an interior non-member", () => {
    const { outer, holes } = computeOutlineGeometry(ringMembers, interiorAvoid, {});
    expect(pointInPolygon({ x: 60, y: 60 }, outer)).toBe(true); // interior of the OUTER ring
    expect(holes.length).toBeGreaterThanOrEqual(1);
    expect(holes.some((h) => pointInPolygon({ x: 60, y: 60 }, h))).toBe(true);
  });

  it("punches no holes at avoidance 0", () => {
    const { holes } = computeOutlineGeometry(ringMembers, interiorAvoid, { avoidance: 0 });
    expect(holes).toEqual([]);
  });

  it("wedged non-member gets a clearance-limited, body-hugging hole (no silent swallow)", () => {
    // The (85,60) node is squeezed between members: the full r+gap disc would
    // eat into a member's guaranteed clearance, so the hole falls back to the
    // largest clearance-respecting radius — smaller than r+gap but still a
    // visible carve (≥ 0.35 × its radius).
    const { holes } = computeOutlineGeometry(ringMembers, [rectAt(85, 60, 15)], {});
    expect(holes.length).toBe(1);
    const radii = holes[0].map((p) => Math.hypot(p.x - 85, p.y - 60));
    expect(Math.max(...radii)).toBeLessThan(15 + 20); // below the full r+gap disc
    expect(Math.min(...radii)).toBeGreaterThanOrEqual(15 * 0.35);
  });

  it("fully-fused non-member (inside a member's clearance zone) stays covered", () => {
    // At (100,60) even the minimum readable hole would violate the member
    // guarantee — the documented ceiling: it stays covered.
    const { holes } = computeOutlineGeometry(ringMembers, [rectAt(100, 60, 15)], {});
    expect(holes).toEqual([]);
  });

  it("drops only the corridor-severing hole, keeping the others (per-disc fallback)", () => {
    // A far member hangs off the ring by a thin arm; an avoid node ON the arm
    // would sever it (its disc is wider than the corridor), while the pocket
    // avoid node has a clean hole. The batch difference fails the one-ring
    // guarantee, so the discs retry one by one: pocket hole survives, arm
    // node stays covered, far member stays inside.
    const members = [...ringMembers, rectAt(320, 60, 20)];
    const pocket = rectAt(60, 60, 15);
    const onArm = rectAt(225, 60, 15);
    const { outer, holes } = computeOutlineGeometry(members, [pocket, onArm], {});
    expect(holes.some((h) => pointInPolygon({ x: 60, y: 60 }, h))).toBe(true);
    expect(holes.some((h) => pointInPolygon({ x: 225, y: 60 }, h))).toBe(false);
    expect(pointInPolygon({ x: 320, y: 60 }, outer)).toBe(true);
  });

  it("computeOutlinePoints returns the same outer ring (holes dropped)", () => {
    const geometry = computeOutlineGeometry(ringMembers, interiorAvoid, {});
    expect(outlinePoints(ringMembers, interiorAvoid, {})).toEqual(geometry.outer);
  });
});

describe("computeOutlinePoints avoidance switch", () => {
  // Two members with a non-member between them: avoidance ON routes the
  // corridor around it (excluded); OFF (0) drops the negative field and the
  // hull may cover it. Persisted numeric: any legacy value > 0 means ON.
  const members = [rectAt(50, 100), rectAt(250, 100)];
  const avoid = [rectAt(150, 100)];

  it("avoidance 0 disables the negative field (hull covers the non-member)", () => {
    const outline = outlinePoints(members, avoid, { avoidance: 0 });
    expect(pointInPolygon({ x: 50, y: 100 }, outline)).toBe(true);
    expect(pointInPolygon({ x: 250, y: 100 }, outline)).toBe(true);
    expect(pointInPolygon({ x: 150, y: 100 }, outline)).toBe(true);
    // With the field off, ignoring avoid rects entirely gives the same hull.
    expect(outline).toEqual(outlinePoints(members, [], { avoidance: 0 }));
  });

  it("avoidance ON (default or any legacy value > 0) keeps the non-member excluded", () => {
    for (const avoidance of [undefined, 1, 3]) {
      const outline = outlinePoints(members, avoid, { avoidance });
      expect(pointInPolygon({ x: 50, y: 100 }, outline)).toBe(true);
      expect(pointInPolygon({ x: 250, y: 100 }, outline)).toBe(true);
      expect(pointInPolygon({ x: 150, y: 100 }, outline)).toBe(false);
    }
  });

  it("normalizes every non-zero/invalid value to plain ON (boolean semantics)", () => {
    const on = outlinePoints(members, avoid, { avoidance: 1 });
    expect(outlinePoints(members, avoid, { avoidance: 3 })).toEqual(on);
    expect(outlinePoints(members, avoid, { avoidance: 100 })).toEqual(on);
    expect(outlinePoints(members, avoid, { avoidance: NaN })).toEqual(on);
    expect(outlinePoints(members, avoid, { avoidance: -5 }))
      .toEqual(outlinePoints(members, avoid, { avoidance: 0 }));
  });
});

// Enclosure guarantee: bubblesets-js validates only member CENTERS, so
// avoid-node pressure plus B-spline shrinkage could leave a member circle
// clipped by its own hull (measured -12 px on the ringed scenario below).
// computeOutlinePoints must union a padding disc for any grazed member so
// every member circle sits fully inside the outline.
describe("computeOutlinePoints member-enclosure guarantee", () => {
  /** Signed clearance between a member circle and the outline: distance from
   *  center to the nearest outline edge (negative when the center is outside)
   *  minus the radius. >= 0 means the full circle is inside. */
  const circleClearance = (x, y, r, outline) => {
    let min = Infinity;
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy;
      let t = lengthSq === 0 ? 0 : ((x - a.x) * dx + (y - a.y) * dy) / lengthSq;
      t = Math.max(0, Math.min(1, t));
      min = Math.min(min, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)));
    }
    return (pointInPolygon({ x, y }, outline) ? min : -min) - r;
  };

  it("fully encloses a member ringed by avoid nodes (regression: clipped hull)", () => {
    // Without the guarantee this exact layout clips the (380,110) member by
    // ~12 px: the avoid ring squeezes the contour through the node body while
    // its center stays inside (the only thing bubblesets-js checks).
    const members = [rectAt(100, 100, 25), rectAt(160, 120, 25), rectAt(380, 110, 25)];
    const avoid = [rectAt(430, 60, 25), rectAt(440, 160, 25), rectAt(330, 170, 25), rectAt(330, 50, 25)];
    const outline = outlinePoints(members, avoid);
    for (const [x, y] of [[100, 100], [160, 120], [380, 110]]) {
      expect(circleClearance(x, y, 25, outline)).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps every member circle inside across dense mixed fields", () => {
    const members = [rectAt(100, 100, 20), rectAt(150, 140, 20), rectAt(300, 120, 20), rectAt(420, 200, 20)];
    const avoid = [
      rectAt(200, 80, 20), rectAt(240, 140, 20), rectAt(360, 90, 20), rectAt(350, 180, 20),
      rectAt(460, 140, 20), rectAt(120, 180, 20), rectAt(470, 260, 20),
    ];
    const outline = outlinePoints(members, avoid);
    for (const m of members) {
      const r = m.width / 2;
      expect(circleClearance(m.x + r, m.y + r, r, outline)).toBeGreaterThanOrEqual(0);
    }
  });

  it("repaired outlines stay simple polygons (no self-intersections)", () => {
    const members = [rectAt(100, 100, 25), rectAt(160, 120, 25), rectAt(380, 110, 25)];
    const avoid = [rectAt(430, 60, 25), rectAt(440, 160, 25), rectAt(330, 170, 25), rectAt(330, 50, 25)];
    const outline = outlinePoints(members, avoid);
    expect(outline.length).toBeGreaterThan(3);
    expect(polygonSelfIntersects(outline)).toBe(false);
  });

  it("connects members the field lost entirely (ultra-low padding, one ring)", () => {
    // At padding 0.1 the influence field is near grid resolution: distant
    // members disconnect and their repair discs float beside the main hull.
    // The union must come back as ONE simple ring (capsule links) that still
    // encloses every member — this exact layout used to drop 5 of 10 members.
    // Clearance is measured against the SMOOTHED curve (what the painters
    // render): the polygon is math truth, the curve is visual truth.
    const spots = [
      [250, 200], [300, 180], [280, 250], [220, 270], [340, 230],
      [310, 300], [260, 340], [370, 170], [200, 210], [230, 620],
    ];
    const members = spots.map(([x, y]) => rectAt(x, y, 9));
    const outline = outlinePoints(members, [], { padding: 0.1, corridor: 0.25 });
    expect(outline.length).toBeGreaterThan(3);
    expect(polygonSelfIntersects(outline)).toBe(false);
    const curve = sampleSmoothedRing(outline);
    for (const [x, y] of spots) {
      expect(circleClearance(x, y, 9, curve)).toBeGreaterThanOrEqual(0);
    }
  });

  it("guarantee holds for small node radii (zoomed-out reference fit)", () => {
    const s = 0.25;
    const members = [rectAt(100 * s, 100 * s, 25 * s), rectAt(160 * s, 120 * s, 25 * s), rectAt(380 * s, 110 * s, 25 * s)];
    const avoid = [rectAt(430 * s, 60 * s, 25 * s), rectAt(440 * s, 160 * s, 25 * s), rectAt(330 * s, 170 * s, 25 * s), rectAt(330 * s, 50 * s, 25 * s)];
    const outline = outlinePoints(members, avoid);
    for (const m of members) {
      const r = m.width / 2;
      expect(circleClearance(m.x + r, m.y + r, r, outline)).toBeGreaterThanOrEqual(0);
    }
  });
});

// The painters render rings through smoothClosedPath (Catmull-Rom → cubic
// Bézier, tension 1/6); both the canvas layer and the SVG export consume the
// same control points, and the enclosure guarantee measures against the
// sampled curve.
describe("smoothClosedPath", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it("returns null for rings too small to smooth", () => {
    expect(smoothClosedPath([])).toBeNull();
    expect(smoothClosedPath([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
  });

  it("emits one segment per vertex, each starting where the previous ended", () => {
    const segments = smoothClosedPath(square);
    expect(segments).toHaveLength(4);
    for (let i = 0; i < segments.length; i++) {
      const next = segments[(i + 1) % segments.length];
      expect(segments[i].x).toBe(next.x0);
      expect(segments[i].y).toBe(next.y0);
    }
  });

  it("joins segments C1-continuously (tangent in equals tangent out at every vertex)", () => {
    const segments = smoothClosedPath(square);
    for (let i = 0; i < segments.length; i++) {
      const prev = segments[(i - 1 + segments.length) % segments.length];
      const s = segments[i];
      // Uniform Catmull-Rom: outgoing (c1 − p1) and incoming (p1 − c2_prev)
      // control offsets are both (p2 − p0)/6.
      expect(s.c1x - s.x0).toBeCloseTo(prev.x - prev.c2x, 10);
      expect(s.c1y - s.y0).toBeCloseTo(prev.y - prev.c2y, 10);
    }
  });

  it("is deterministic and tolerates a duplicated closing vertex", () => {
    const closed = [...square, { x: 0, y: 0 }];
    expect(smoothClosedPath(closed)).toEqual(smoothClosedPath(square));
    expect(smoothClosedPath(square)).toEqual(smoothClosedPath(square));
  });

  it("sampleSmoothedRing reproduces each vertex at t=0 and densifies between", () => {
    const sampled = sampleSmoothedRing(square);
    expect(sampled.length).toBe(square.length * 4);
    for (const v of square) {
      expect(sampled.some((p) => p.x === v.x && p.y === v.y)).toBe(true);
    }
  });

});

describe("positionsChecksum node-size fold", () => {
  it("changes when a member's on-screen radius changes (same positions)", () => {
    const small = [{ x: 1, y: 2, s: 5 }, { x: 3, y: 4, s: 5 }];
    const grown = [{ x: 1, y: 2, s: 5 }, { x: 3, y: 4, s: 9 }];
    expect(positionsChecksum(grown)).not.toBe(positionsChecksum(small));
  });

  it("treats missing size as stable (legacy point arrays keep working)", () => {
    const pts = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
    expect(positionsChecksum(pts)).toBe(positionsChecksum(pts.map((p) => ({ ...p }))));
  });
});
