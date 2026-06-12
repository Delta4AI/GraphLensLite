import { describe, it, expect } from "vitest";
import {
  buildCategoricalSlices,
  buildNumericSlices,
  pieAttributesFromSlices,
} from "../src/graph/pie_slices.js";

// ==========================================================================
// Pie-slice model (feature #1) — node-safe core that turns chosen properties
// into the @sigma/node-piechart fixed-slot pieValueK/pieColorK attributes.
// ==========================================================================

const TRANSPARENT = "#00000000";

describe("buildCategoricalSlices", () => {
  it("emits one equal-weight slice per value, colored from the map", () => {
    const colors = new Map([
      ["Eng", "#111111"],
      ["Ops", "#222222"],
    ]);

    const slices = buildCategoricalSlices(["Eng", "Ops"], colors, "#999999");

    expect(slices).toEqual([
      { value: 1, color: "#111111" },
      { value: 1, color: "#222222" },
    ]);
  });

  it("falls back to the missing color for unmapped values", () => {
    const slices = buildCategoricalSlices(["Eng", "QA"], new Map([["Eng", "#111111"]]), "#999999");

    expect(slices).toEqual([
      { value: 1, color: "#111111" },
      { value: 1, color: "#999999" },
    ]);
  });

  it("skips null, undefined and blank values", () => {
    const slices = buildCategoricalSlices(["Eng", "", null, undefined, "  "], new Map(), "#999999");

    expect(slices).toHaveLength(1);
    expect(slices[0]).toEqual({ value: 1, color: "#999999" });
  });

  it("accepts a plain object color map and trims value keys", () => {
    const slices = buildCategoricalSlices([" Eng "], { Eng: "#abcabc" }, "#999999");

    expect(slices).toEqual([{ value: 1, color: "#abcabc" }]);
  });

  it("returns an empty array for empty/nullish input", () => {
    expect(buildCategoricalSlices([], new Map(), "#999")).toEqual([]);
    expect(buildCategoricalSlices(null, new Map(), "#999")).toEqual([]);
  });
});

describe("buildNumericSlices", () => {
  it("weights each property by its value, preserving property order", () => {
    const values = new Map([
      ["cost", 50],
      ["risk", 30],
      ["effort", 20],
    ]);
    const colors = new Map([
      ["cost", "#c00000"],
      ["risk", "#00c000"],
      ["effort", "#0000c0"],
    ]);

    const slices = buildNumericSlices(["cost", "risk", "effort"], values, colors, "#999999");

    expect(slices).toEqual([
      { value: 50, color: "#c00000" },
      { value: 30, color: "#00c000" },
      { value: 20, color: "#0000c0" },
    ]);
  });

  it("clamps non-finite and negative values to 0 (invisible slice) without dropping it", () => {
    const values = new Map([
      ["a", -5],
      ["b", NaN],
      ["c", 10],
    ]);

    const slices = buildNumericSlices(["a", "b", "c"], values, new Map(), "#999999");

    // All three slices are kept so order stays aligned with the legend.
    expect(slices.map((s) => s.value)).toEqual([0, 0, 10]);
    expect(slices).toHaveLength(3);
  });

  it("falls back to the missing color when a property has no assigned color", () => {
    const slices = buildNumericSlices(["x"], new Map([["x", 4]]), new Map(), "#777777");

    expect(slices).toEqual([{ value: 4, color: "#777777" }]);
  });
});

describe("pieAttributesFromSlices", () => {
  it("maps slices onto fixed slots and pads the unused tail transparently", () => {
    const slices = [
      { value: 2, color: "#aa0000" },
      { value: 1, color: "#00aa00" },
    ];

    const attrs = pieAttributesFromSlices(slices, 4, "#999999");

    expect(attrs).toEqual({
      type: "pie",
      pieValue0: 2,
      pieColor0: "#aa0000",
      pieValue1: 1,
      pieColor1: "#00aa00",
      pieValue2: 0,
      pieColor2: TRANSPARENT,
      pieValue3: 0,
      pieColor3: TRANSPARENT,
    });
  });

  it("drops slices beyond maxSlices (overflow handled/warned upstream)", () => {
    const slices = [
      { value: 1, color: "#1" },
      { value: 1, color: "#2" },
      { value: 1, color: "#3" },
    ];

    const attrs = pieAttributesFromSlices(slices, 2, "#999999");

    expect(Object.keys(attrs).filter((k) => k.startsWith("pieValue"))).toEqual([
      "pieValue0",
      "pieValue1",
    ]);
    expect(attrs.pieColor0).toBe("#1");
    expect(attrs.pieColor1).toBe("#2");
  });

  it("uses the default color for a present slice missing its color", () => {
    const attrs = pieAttributesFromSlices([{ value: 5 }], 1, "#abcdef");

    expect(attrs.pieColor0).toBe("#abcdef");
    expect(attrs.pieValue0).toBe(5);
  });

  it("clamps a present slice's non-positive value to 0", () => {
    const attrs = pieAttributesFromSlices([{ value: -3, color: "#111" }], 1, "#999");

    expect(attrs.pieValue0).toBe(0);
    expect(attrs.pieColor0).toBe("#111");
  });

  it("returns an all-empty slot set for no slices", () => {
    const attrs = pieAttributesFromSlices([], 2, "#999");

    expect(attrs).toEqual({
      type: "pie",
      pieValue0: 0,
      pieColor0: TRANSPARENT,
      pieValue1: 0,
      pieColor1: TRANSPARENT,
    });
  });
});
