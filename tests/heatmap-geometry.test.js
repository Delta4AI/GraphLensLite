import { describe, it, expect } from "vitest";
import {
  graphBBox,
  splatTransform,
  heatBandwidth,
  parseHexColor,
  buildRampLut,
  applyRampToAlpha,
} from "../src/graph/heatmap_geometry.js";
import { DEFAULTS } from "../src/config.js";

// ==========================================================================
// Density-heatmap geometry — pure math feeding the atmospheric canvas layer
// (heatmap_layer.js). Node-safe: no DOM/canvas/sigma.
// ==========================================================================

describe("graphBBox", () => {
  it("returns the axis-aligned bounds over all positions", () => {
    // Arrange
    const positions = [
      { x: -5, y: 10 },
      { x: 20, y: -3 },
      { x: 7, y: 7 },
    ];

    // Act
    const bbox = graphBBox(positions);

    // Assert
    expect(bbox).toEqual({ minX: -5, minY: -3, maxX: 20, maxY: 10 });
  });

  it("returns null for an empty input", () => {
    expect(graphBBox([])).toBeNull();
  });

  it("collapses to a point bbox for a single node", () => {
    expect(graphBBox([{ x: 3, y: 4 }])).toEqual({ minX: 3, minY: 4, maxX: 3, maxY: 4 });
  });

  it("ignores entries with non-finite coordinates", () => {
    // Arrange
    const positions = [
      { x: NaN, y: 0 },
      { x: 0, y: Infinity },
      { x: 1, y: 2 },
      { x: -Infinity, y: 5 },
    ];

    // Act / Assert
    expect(graphBBox(positions)).toEqual({ minX: 1, minY: 2, maxX: 1, maxY: 2 });
  });

  it("returns null when every entry is non-finite", () => {
    expect(graphBBox([{ x: NaN, y: 1 }, { x: 2, y: NaN }])).toBeNull();
  });
});

describe("splatTransform", () => {
  it("fits the bbox plus a bandwidth margin on every side", () => {
    // Arrange: 100x50 bbox, bandwidth 10 → padded spans 120x70
    const bbox = { minX: 0, minY: 0, maxX: 100, maxY: 50 };

    // Act
    const t = splatTransform(bbox, 10, 1024);

    // Assert: origin sits one bandwidth outside the bbox; the padded
    // corners land exactly on the canvas borders.
    expect(t.offsetX).toBe(-10);
    expect(t.offsetY).toBe(-10);
    expect((bbox.minX - 10 - t.offsetX) * t.scale).toBe(0);
    expect((bbox.maxX + 10 - t.offsetX) * t.scale).toBeCloseTo(t.width, 0);
    expect((bbox.maxY + 10 - t.offsetY) * t.scale).toBeCloseTo(t.height, 0);
  });

  it("caps the long side at maxResolution and keeps the aspect ratio", () => {
    // Arrange: padded spans 120x70, long side X
    const t = splatTransform({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 10, 1024);

    // Assert
    expect(t.width).toBe(1024);
    expect(t.height).toBe(Math.round((70 / 120) * 1024));
    expect(Math.max(t.width, t.height)).toBeLessThanOrEqual(1024);
  });

  it("honours a custom maxResolution", () => {
    const t = splatTransform({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 0, 256);
    expect(t.width).toBe(256);
    expect(t.height).toBe(256);
  });

  it("returns a sane small canvas for a degenerate bbox (single node, zero bandwidth)", () => {
    // Arrange: zero-area bbox and no margin → no drawable span
    const t = splatTransform({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, 0, 1024);

    // Assert: small finite canvas centered on the point, positive scale
    expect(t.width).toBeGreaterThan(0);
    expect(t.width).toBeLessThanOrEqual(64);
    expect(t.height).toBe(t.width);
    expect(t.scale).toBeGreaterThan(0);
    const centerPx = (5 - t.offsetX) * t.scale;
    expect(centerPx).toBeCloseTo(t.width / 2, 5);
  });

  it("a zero-area bbox with positive bandwidth still fits the margin", () => {
    // Arrange: single node, bandwidth 10 → padded span 20x20
    const t = splatTransform({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, 10, 100);

    // Assert
    expect(t.width).toBe(100);
    expect(t.height).toBe(100);
    expect((0 - t.offsetX) * t.scale).toBeCloseTo(50, 5);
  });

  it("round-trips a known graph point into offscreen px", () => {
    // Arrange: bbox [0,100]^2, bandwidth 0, resolution 1000 → scale 10
    const t = splatTransform({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 0, 1000);

    // Act
    const px = (25 - t.offsetX) * t.scale;
    const py = (75 - t.offsetY) * t.scale;

    // Assert
    expect(px).toBeCloseTo(250, 5);
    expect(py).toBeCloseTo(750, 5);
  });
});

describe("heatBandwidth", () => {
  const bbox = { minX: 0, minY: 0, maxX: 300, maxY: 400 }; // diagonal 500

  it("an explicit positive config bandwidth wins over the derived default", () => {
    expect(heatBandwidth(bbox, 1000, 42)).toBe(42);
  });

  it("derives diagonal/sqrt(nodeCount) inside the clamp window", () => {
    // Arrange: n = 100 → 500/10 = 50, between 2% (10) and 12% (60)
    expect(heatBandwidth(bbox, 100, 0)).toBeCloseTo(50, 5);
  });

  it("the derived value shrinks as the node count grows", () => {
    const sparse = heatBandwidth(bbox, 100, 0);
    const dense = heatBandwidth(bbox, 400, 0);
    expect(dense).toBeLessThan(sparse);
  });

  it("clamps the lower end to 2% of the diagonal for dense graphs", () => {
    // Arrange: n = 1e6 → 500/1000 = 0.5, below 2% (10)
    expect(heatBandwidth(bbox, 1_000_000, 0)).toBeCloseTo(0.02 * 500, 5);
  });

  it("clamps the upper end to 12% of the diagonal for tiny graphs", () => {
    // Arrange: n = 4 → 500/2 = 250, above 12% (60)
    expect(heatBandwidth(bbox, 4, 0)).toBeCloseTo(0.12 * 500, 5);
  });

  it("returns 0 for a null or zero-extent bbox (nothing drawable)", () => {
    expect(heatBandwidth(null, 10, 0)).toBe(0);
    expect(heatBandwidth({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, 1, 0)).toBe(0);
  });
});

describe("buildRampLut", () => {
  it("interpolates channels linearly at the midpoint between two stops", () => {
    // Arrange: black → white over the full range
    const lut = buildRampLut([
      { t: 0, color: "#000000" },
      { t: 1, color: "#ffffff" },
    ]);

    // Assert: ends exact, midpoint ~127.5 (Uint8Clamped rounds)
    expect([lut[0], lut[1], lut[2], lut[3]]).toEqual([0, 0, 0, 255]);
    expect([lut[255 * 4], lut[255 * 4 + 1], lut[255 * 4 + 2]]).toEqual([255, 255, 255]);
    const midIndex = 128 * 4; // t = 128/255 ≈ 0.502
    expect(lut[midIndex]).toBeGreaterThanOrEqual(127);
    expect(lut[midIndex]).toBeLessThanOrEqual(129);
  });

  it("interpolates alpha from #rrggbbaa stops (transparent low end)", () => {
    // Arrange: fully transparent red → opaque red
    const lut = buildRampLut([
      { t: 0, color: "#ff000000" },
      { t: 1, color: "#ff0000ff" },
    ]);

    // Assert
    expect(lut[3]).toBe(0);
    expect(lut[255 * 4 + 3]).toBe(255);
    expect(lut[128 * 4 + 3]).toBeGreaterThan(120);
    expect(lut[128 * 4 + 3]).toBeLessThan(135);
    // Hue is constant across the ramp
    expect(lut[128 * 4]).toBe(255);
  });

  it("holds the boundary colors outside the first/last stop's t", () => {
    // Arrange: stops only covering [0.4, 0.6]
    const lut = buildRampLut([
      { t: 0.4, color: "#102030" },
      { t: 0.6, color: "#405060" },
    ]);

    // Assert: below 0.4 → first color, above 0.6 → last color
    expect([lut[0], lut[1], lut[2]]).toEqual([0x10, 0x20, 0x30]);
    expect([lut[255 * 4], lut[255 * 4 + 1], lut[255 * 4 + 2]]).toEqual([0x40, 0x50, 0x60]);
  });

  it("throws on fewer than 2 stops or a non-array", () => {
    expect(() => buildRampLut([{ t: 0, color: "#000000" }])).toThrow(/at least 2/);
    expect(() => buildRampLut(null)).toThrow(/at least 2/);
  });

  it("throws on t out of range, non-finite t, or unsorted stops", () => {
    expect(() =>
      buildRampLut([{ t: -0.1, color: "#000000" }, { t: 1, color: "#ffffff" }]),
    ).toThrow(/t in \[0, 1\]/);
    expect(() =>
      buildRampLut([{ t: NaN, color: "#000000" }, { t: 1, color: "#ffffff" }]),
    ).toThrow(/t in \[0, 1\]/);
    expect(() =>
      buildRampLut([{ t: 0.8, color: "#000000" }, { t: 0.2, color: "#ffffff" }]),
    ).toThrow(/sorted/);
  });

  it("throws on malformed colors", () => {
    expect(() =>
      buildRampLut([{ t: 0, color: "red" }, { t: 1, color: "#ffffff" }]),
    ).toThrow(/#rrggbb/);
    expect(() =>
      buildRampLut([{ t: 0, color: "#fff" }, { t: 1, color: "#ffffff" }]),
    ).toThrow(/#rrggbb/);
    expect(() => buildRampLut([{ t: 0 }, { t: 1, color: "#ffffff" }])).toThrow(/#rrggbb/);
  });

  it("resolves coincident stops (span 0) to the later stop", () => {
    const lut = buildRampLut([
      { t: 0, color: "#000000" },
      { t: 0, color: "#ff0000" },
      { t: 1, color: "#ffffff" },
    ]);

    // Density 0 sits on the coincident pair — the later stop (red) wins.
    expect([lut[0], lut[1], lut[2]]).toEqual([255, 0, 0]);
    expect([lut[255 * 4], lut[255 * 4 + 1], lut[255 * 4 + 2]]).toEqual([255, 255, 255]);
  });
});

describe("parseHexColor", () => {
  it("parses 6- and 8-digit hex, defaulting alpha to 255", () => {
    expect(parseHexColor("#C33D35")).toEqual([195, 61, 53, 255]);
    expect(parseHexColor("#40404080")).toEqual([64, 64, 64, 128]);
  });

  it("throws on anything else instead of producing NaN channels", () => {
    // Canvas2D silently ignores rgba(NaN,...) paint — a throw is debuggable.
    expect(() => parseHexColor("#fff")).toThrow(/parseHexColor/);
    expect(() => parseHexColor("red")).toThrow(/parseHexColor/);
    expect(() => parseHexColor(null)).toThrow(/parseHexColor/);
  });
});

describe("applyRampToAlpha", () => {
  // Identity-style LUT stand-in: r = index, g = 7, b = 9, a = index.
  const makeLut = () => {
    const lut = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i++) {
      lut[i * 4] = i;
      lut[i * 4 + 1] = 7;
      lut[i * 4 + 2] = 9;
      lut[i * 4 + 3] = i;
    }
    return lut;
  };
  // ImageData stand-in (node has no canvas); only `data` is read.
  const makeImage = (pixels) => ({ data: new Uint8ClampedArray(pixels.flat()) });

  it("maps accumulated alpha through the LUT in place", () => {
    // Arrange: one pixel with alpha 200
    const image = makeImage([[0, 0, 0, 200]]);

    // Act
    const out = applyRampToAlpha(image, makeLut());

    // Assert: same object, RGBA taken from lut[200]
    expect(out).toBe(image);
    expect([...image.data]).toEqual([200, 7, 9, 200]);
  });

  it("leaves zero-alpha pixels fully transparent", () => {
    // Arrange: lut[0] carries g=7/b=9 — a zero pixel must NOT pick those up
    const image = makeImage([[0, 0, 0, 0]]);

    // Act
    applyRampToAlpha(image, makeLut());

    // Assert
    expect([...image.data]).toEqual([0, 0, 0, 0]);
  });

  it("maps max alpha to the last LUT entry", () => {
    const image = makeImage([[1, 2, 3, 255]]);
    applyRampToAlpha(image, makeLut());
    expect([...image.data]).toEqual([255, 7, 9, 255]);
  });

  it("applies gamma before the lookup", () => {
    // Arrange: alpha 128 (~0.502); gamma 2 → 0.252 → index 64
    const image = makeImage([[0, 0, 0, 128]]);

    // Act
    applyRampToAlpha(image, makeLut(), 2);

    // Assert
    expect(image.data[0]).toBe(Math.round(255 * Math.pow(128 / 255, 2)));
  });

  it("processes every pixel of a multi-pixel buffer", () => {
    // Arrange
    const image = makeImage([
      [0, 0, 0, 10],
      [0, 0, 0, 0],
      [0, 0, 0, 250],
    ]);

    // Act
    applyRampToAlpha(image, makeLut());

    // Assert
    expect([...image.data.slice(0, 4)]).toEqual([10, 7, 9, 10]);
    expect([...image.data.slice(4, 8)]).toEqual([0, 0, 0, 0]);
    expect([...image.data.slice(8, 12)]).toEqual([250, 7, 9, 250]);
  });

  it("clears pixels below the density threshold", () => {
    // Arrange: alpha 51 → density 0.2, below a 0.25 floor
    const image = makeImage([[0, 0, 0, 51]]);

    // Act
    applyRampToAlpha(image, makeLut(), 1, 0.25);

    // Assert: fully transparent, not just dimmed
    expect([...image.data]).toEqual([0, 0, 0, 0]);
  });

  it("renormalizes surviving densities over the full ramp", () => {
    // Arrange: density just above the floor (alpha 64 → 0.251) → ramp start;
    // density 1 → ramp end
    const image = makeImage([
      [0, 0, 0, Math.round(0.25 * 255)],
      [0, 0, 0, 255],
    ]);

    // Act
    applyRampToAlpha(image, makeLut(), 1, 0.25);

    // Assert: (0.251-0.25)/0.75 → index ~0; (1-0.25)/0.75 → index 255
    expect(image.data[0]).toBeLessThanOrEqual(1);
    expect([...image.data.slice(4, 8)]).toEqual([255, 7, 9, 255]);
  });

  it("clears the exact 8-bit boundary just below the floor (threshold is exclusive)", () => {
    // Arrange: alpha 63 → density 0.247, the last quantization step under 0.25
    const image = makeImage([[0, 0, 0, Math.floor(0.25 * 255)]]);

    // Act
    applyRampToAlpha(image, makeLut(), 1, 0.25);

    // Assert
    expect([...image.data]).toEqual([0, 0, 0, 0]);
  });

  it("threshold 0 (default) leaves the mapping unchanged", () => {
    const a = makeImage([[0, 0, 0, 128]]);
    const b = makeImage([[0, 0, 0, 128]]);

    applyRampToAlpha(a, makeLut(), 0.7);
    applyRampToAlpha(b, makeLut(), 0.7, 0);

    expect([...a.data]).toEqual([...b.data]);
  });

  it("applies the threshold remap before gamma", () => {
    // Arrange: density 0.625 with floor 0.25 → renormalized 0.5, gamma 2 → 0.25
    const image = makeImage([[0, 0, 0, Math.round(0.625 * 255)]]);

    // Act
    applyRampToAlpha(image, makeLut(), 2, 0.25);

    // Assert: index ≈ 255 * 0.25 (±1 for the 8-bit density quantization)
    expect(Math.abs(image.data[0] - 255 * 0.25)).toBeLessThanOrEqual(1);
  });

  it("threshold >= 1 degenerates to a fully transparent field", () => {
    const image = makeImage([[0, 0, 0, 255]]);

    applyRampToAlpha(image, makeLut(), 1, 1);

    expect([...image.data]).toEqual([0, 0, 0, 0]);
  });
});

describe("config RAMPS presets", () => {
  // Every preset the styling-panel dropdown offers must survive buildRampLut
  // (it throws on malformed stops) — this pins typos in config.js at test
  // time instead of as a blank heatmap at runtime.
  it("every preset builds a valid LUT for both themes", () => {
    const presets = Object.entries(DEFAULTS.HEATMAP.RAMPS);
    expect(presets.length).toBeGreaterThanOrEqual(2);

    for (const [name, ramps] of presets) {
      for (const theme of ["light", "dark"]) {
        expect(ramps[theme], `${name}.${theme}`).toBeDefined();
        expect(() => buildRampLut(ramps[theme]), `${name}.${theme}`).not.toThrow();
        // First stop transparent so sparse regions fade out instead of graying.
        expect(parseHexColor(ramps[theme][0].color)[3], `${name}.${theme} first stop`).toBe(0);
      }
    }
  });

  it("the default RAMP key points at an existing preset", () => {
    expect(DEFAULTS.HEATMAP.RAMPS[DEFAULTS.HEATMAP.RAMP]).toBeDefined();
  });
});
