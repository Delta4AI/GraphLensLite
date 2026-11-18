import { describe, it, expect } from "vitest";
import { idsKey, positionsChecksum, geometryKey } from "../src/graph/overlay_keys.js";

// ==========================================================================
// Overlay cache keys: "has the cached fit gone stale?" for the bubble, heatmap
// and note layers. Node-safe and geometry-free — they moved out of
// bubble_geometry.js with the functions they cover.
// ==========================================================================

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

describe("geometryKey", () => {
  it("invalidates on padding/corridor/avoidance changes", () => {
    expect(geometryKey({ padding: 1 })).not.toBe(geometryKey({ padding: 1.5 }));
    expect(geometryKey({ corridor: 1 })).not.toBe(geometryKey({ corridor: 2 }));
    expect(geometryKey({ avoidance: 1 })).not.toBe(geometryKey({ avoidance: 0 }));
  });

  it("ignores everything that only changes the paint, so it never forces a re-fit", () => {
    const base = { padding: 1, corridor: 1, avoidance: 1 };
    expect(geometryKey({ ...base, fill: "#000", labelText: "a", labelShiftX: 3 })).toBe(
      geometryKey({ ...base, fill: "#fff", labelText: "b", labelShiftX: 40 }),
    );
  });

  it("distinguishes the literal string \"undefined\" from a missing field", () => {
    expect(geometryKey({ padding: "undefined" })).not.toBe(geometryKey({}));
  });

  it("treats null and missing as equal (both fit via group defaults)", () => {
    expect(geometryKey({ padding: null })).toBe(geometryKey({}));
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
