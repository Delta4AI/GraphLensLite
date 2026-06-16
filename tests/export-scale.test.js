import { describe, it, expect } from "vitest";
import {
  EXPORT_SCALES,
  WEBGL_SAFE_SIDE_FRACTION,
  clampExportScale,
  wasScaleClamped,
} from "../src/utilities/export_scale.js";

// ==========================================================================
// High-resolution export scale clamping (pure, node-safe). The renderer
// re-draws at cssWidth * scale * devicePixelRatio; this math keeps that under
// the canvas size ceilings so 8x never crashes the export.
// ==========================================================================

const SMALL = { width: 800, height: 600 };

describe("EXPORT_SCALES", () => {
  it("offers the 1/2/4 ladder", () => {
    expect(EXPORT_SCALES).toEqual([1, 2, 4]);
  });

  it("no longer offers 8x (silently blank/partial render on real GPUs)", () => {
    expect(EXPORT_SCALES).not.toContain(8);
  });
});

describe("WEBGL_SAFE_SIDE_FRACTION", () => {
  it("keeps exports a margin back from the probed GPU ceiling", () => {
    expect(WEBGL_SAFE_SIDE_FRACTION).toBeGreaterThan(0);
    expect(WEBGL_SAFE_SIDE_FRACTION).toBeLessThan(1);
  });
});

describe("clampExportScale", () => {
  it("returns the requested scale when it fits comfortably", () => {
    expect(clampExportScale(4, SMALL, 1)).toBe(4);
    expect(clampExportScale(8, SMALL, 1)).toBe(8);
  });

  it("honors 1x as a no-op", () => {
    expect(clampExportScale(1, SMALL, 2)).toBe(1);
  });

  it("clamps when the side limit would be exceeded", () => {
    // 4000 * 8 = 32000 > 16384 side cap → must shrink below 8.
    const applied = clampExportScale(8, { width: 4000, height: 100 }, 1);
    expect(applied).toBeLessThan(8);
    expect(4000 * applied).toBeLessThanOrEqual(16384 + 1e-6);
  });

  it("clamps when the area limit would be exceeded", () => {
    // 8000x8000 * 4 = 1.02e9 px² >> 268e6 area cap.
    const applied = clampExportScale(4, { width: 8000, height: 8000 }, 1);
    expect(applied).toBeLessThan(4);
    expect(8000 * applied * (8000 * applied)).toBeLessThanOrEqual(268_000_000 + 1);
  });

  it("accounts for device pixel ratio in the budget", () => {
    const atDpr1 = clampExportScale(8, { width: 2000, height: 2000 }, 1);
    const atDpr2 = clampExportScale(8, { width: 2000, height: 2000 }, 2);
    expect(atDpr2).toBeLessThan(atDpr1);
  });

  it("treats a non-positive dpr as 1", () => {
    expect(clampExportScale(2, SMALL, 0)).toBe(clampExportScale(2, SMALL, 1));
  });

  it("falls back to the requested scale for degenerate dimensions", () => {
    expect(clampExportScale(4, { width: 0, height: 0 }, 1)).toBe(4);
  });

  it("coerces invalid scales to 1", () => {
    expect(clampExportScale(NaN, SMALL, 1)).toBe(1);
    expect(clampExportScale(-3, SMALL, 1)).toBe(1);
    expect(clampExportScale(undefined, SMALL, 1)).toBe(1);
  });
});

describe("wasScaleClamped", () => {
  it("is true when the applied scale fell short", () => {
    expect(wasScaleClamped(8, 5.2)).toBe(true);
  });

  it("is false when the request was honored", () => {
    expect(wasScaleClamped(4, 4)).toBe(false);
  });

  it("ignores float noise within epsilon", () => {
    expect(wasScaleClamped(4, 4 - 1e-9)).toBe(false);
  });
});
