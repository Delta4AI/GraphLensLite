import { describe, it, expect } from "vitest";
import { suggestGroupGeometry } from "../src/graph/bubble_tuning.js";
import { nodeViewportRect } from "../src/graph/bubble_geometry.js";

// ==========================================================================
// Layout-aware initial bubble-group settings — pure signal math. The exact
// values are calibration; these tests pin the DIRECTIONS the signals move
// the knobs in, and the invariants (quantization, clamps, null cases).
// ==========================================================================

const rectAt = (x, y, r = 10) => nodeViewportRect(x, y, r);

// A crowded core: members interleaved with bystanders about one radius away.
const hairballMembers = [
  [300, 300], [390, 320], [350, 410], [460, 380], [420, 470], [530, 440],
].map(([x, y]) => rectAt(x, y, 12));
const hairballAvoid = [
  [345, 270], [350, 355], [420, 350], [300, 430], [390, 455], [480, 430],
  [490, 330], [370, 520], [520, 390], [260, 350],
].map(([x, y]) => rectAt(x, y, 12));

// The same members with every bystander far away.
const distantAvoid = [[1900, 1900], [-1500, 1800]].map(([x, y]) => rectAt(x, y, 12));

describe("suggestGroupGeometry", () => {
  it("returns null when there is nothing to measure", () => {
    expect(suggestGroupGeometry([], [])).toBeNull();
    expect(suggestGroupGeometry([rectAt(0, 0)], [])).toBeNull();
    expect(suggestGroupGeometry(null, [])).toBeNull();
  });

  it("suggests less padding when bystanders crowd the members", () => {
    const crowded = suggestGroupGeometry(hairballMembers, hairballAvoid);
    const free = suggestGroupGeometry(hairballMembers, distantAvoid);
    expect(crowded.padding).toBeLessThan(free.padding);
  });

  it("suggests thinner corridors the longer the spans between members", () => {
    const tight = suggestGroupGeometry(
      [[100, 100], [140, 110], [120, 150], [160, 140]].map(([x, y]) => rectAt(x, y)),
      []
    );
    const spread = suggestGroupGeometry(
      [[100, 100], [500, 120], [80, 520], [520, 480]].map(([x, y]) => rectAt(x, y)),
      []
    );
    expect(spread.corridor).toBeLessThan(tight.corridor);
  });

  it("turns avoidance off when no bystander is anywhere near the group", () => {
    expect(suggestGroupGeometry(hairballMembers, distantAvoid).avoidance).toBe(0);
    expect(suggestGroupGeometry(hairballMembers, hairballAvoid).avoidance).toBe(1);
    // No bystanders at all: nothing to steer around.
    expect(suggestGroupGeometry(hairballMembers, []).avoidance).toBe(0);
  });

  it("quantizes every suggestion to clean 0.05 steps (stable persisted JSON)", () => {
    for (const avoid of [hairballAvoid, distantAvoid, []]) {
      const s = suggestGroupGeometry(hairballMembers, avoid);
      for (const v of [s.padding, s.corridor]) {
        expect(Math.round(v * 100) % 5).toBe(0);
        expect(String(v).length).toBeLessThanOrEqual(4); // e.g. "0.35", never float noise
      }
    }
  });

  it("scale-invariant: the same layout at 10× zoom suggests the same knobs", () => {
    const scale = (rects) =>
      rects.map((r) => ({ x: r.x * 10, y: r.y * 10, width: r.width * 10, height: r.height * 10 }));
    expect(suggestGroupGeometry(scale(hairballMembers), scale(hairballAvoid))).toEqual(
      suggestGroupGeometry(hairballMembers, hairballAvoid)
    );
  });

  it("ignores degenerate zero-size rects gracefully (null, not NaN)", () => {
    const degenerate = [rectAt(0, 0, 0), rectAt(50, 50, 0)];
    expect(suggestGroupGeometry(degenerate, [])).toBeNull();
  });
});
