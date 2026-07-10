import { describe, it, expect } from "vitest";
import { NumericScalePicker } from "../src/utilities/numeric_scale_picker.js";
import { DEFAULTS } from "../src/config.js";

// setDefaultOutputRange is pure logic: it maps the (elementType, propertyName)
// pair to the picker's default output range. The render layer (applyHexOpacity)
// clamps opacity to [0, 1] regardless, so these ranges are UI defaults only.
function rangeFor(elementType, propertyName) {
  const picker = new NumericScalePicker({ DEFAULTS });
  picker.elementType = elementType;
  picker.propertyName = propertyName;
  picker.setDefaultOutputRange();
  return { min: picker.minOutput, max: picker.maxOutput };
}

describe("NumericScalePicker.setDefaultOutputRange", () => {
  it("maps Node Opacity to a visible-to-opaque range", () => {
    expect(rangeFor("nodes", "Node Opacity")).toEqual({ min: 0.2, max: DEFAULTS.NODE.OPACITY });
  });

  it("maps Edge Opacity to a visible-to-opaque range", () => {
    expect(rangeFor("edges", "Edge Opacity")).toEqual({ min: 0.2, max: DEFAULTS.EDGE.OPACITY });
  });

  it("keeps the existing size ranges intact", () => {
    expect(rangeFor("nodes", "Node Size")).toEqual({ min: DEFAULTS.NODE.SIZE, max: 50 });
    expect(rangeFor("edges", "Edge Width")).toEqual({ min: DEFAULTS.EDGE.LINE_WIDTH, max: 10 });
  });

  it("falls back to the 0–100 default for unknown properties", () => {
    expect(rangeFor("nodes", "Unknown")).toEqual({ min: 0, max: 100 });
    expect(rangeFor("edges", "Unknown")).toEqual({ min: 0, max: 100 });
  });
});
