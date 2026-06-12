import { describe, it, expect } from "vitest";
import { clampPopoverLeft } from "../src/utilities/popover_position.js";

// ==========================================================================
// Popover left-edge placement. The bug: when the anchor sits near the right
// edge (e.g. selection panel snapped top-right), a popover left-aligned to
// the anchor overflowed and truncated on the right. clampPopoverLeft pulls
// it back inside the viewport using the real measured width + an 8px margin.
// ==========================================================================

const VIEWPORT = 1000;
const WIDTH = 266; // 240 content + 12*2 padding + 1*2 border

describe("clampPopoverLeft", () => {
  it("keeps the anchor's left edge when the popover fits", () => {
    expect(clampPopoverLeft(100, WIDTH, VIEWPORT)).toBe(100);
  });

  it("pulls left so the right edge stays inside the viewport margin", () => {
    // Anchor near the right edge: left-aligning would overflow.
    const left = clampPopoverLeft(900, WIDTH, VIEWPORT);
    expect(left).toBe(VIEWPORT - WIDTH - 8); // 726
    expect(left + WIDTH).toBeLessThanOrEqual(VIEWPORT - 8); // no right truncation
  });

  it("never lets the right edge exceed the viewport (regression: was +6px over)", () => {
    // Reproduce the old magic-number path: anchor flush-right.
    const left = clampPopoverLeft(VIEWPORT - 10, WIDTH, VIEWPORT);
    expect(left + WIDTH).toBeLessThanOrEqual(VIEWPORT);
  });

  it("clamps to the left margin on a viewport narrower than the popover", () => {
    expect(clampPopoverLeft(50, WIDTH, 200)).toBe(8);
  });

  it("honours a custom margin", () => {
    expect(clampPopoverLeft(900, WIDTH, VIEWPORT, 20)).toBe(VIEWPORT - WIDTH - 20);
  });

  it("does not pull left when the anchor already sits at the left margin", () => {
    expect(clampPopoverLeft(8, WIDTH, VIEWPORT)).toBe(8);
  });
});
