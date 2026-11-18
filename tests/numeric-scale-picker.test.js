// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { NumericScalePicker } from "../src/utilities/numeric_scale_picker.js";
import { DEFAULTS } from "../src/config.js";

vi.mock("../src/graph/sigma_adapter.js", () => ({ SigmaAdapter: class {} }));
const { GraphCoreManager } = await import("../src/graph/core.js");

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

// ---------------------------------------------------------------------------
// Map by data → node size, through the real picker popup and updateNodes.
const P = "Data::g::P";

function cacheWith(values) {
  const nodeRef = new Map();
  for (const [id, v] of Object.entries(values)) {
    const featureValues = new Map(v === undefined ? [] : [[P, v]]);
    nodeRef.set(id, { id, type: "circle", style: { size: DEFAULTS.NODE.SIZE }, features: new Set(featureValues.keys()), featureValues });
  }
  const cache = {
    DEFAULTS,
    nodeRef,
    selectedNodes: [],
    data: { selectedLayout: "L", layouts: { L: { nodeStyles: new Map(), filters: new Map([[P, { isCategory: false }]]) } } },
    style: { handleStyleChangeLoadingEvent: async () => {} },
    history: { commit() {} },
    ui: { warning: vi.fn(), info: vi.fn() },
    metrics: { getMetricScaleOptions: () => [], getMetricScaleValues: () => null },
  };
  cache.numericPicker = new NumericScalePicker(cache);
  cache.gcm = new GraphCoreManager(cache);
  return cache;
}

/** Select `ids`, open the picker on P, Apply with the default output range. */
async function mapSize(cache, ids, { missing } = {}) {
  cache.selectedNodes = ids;
  cache.numericPicker.currentProperty = "Node Size";
  const open = cache.numericPicker.pickNumericScale.bind(cache.numericPicker);
  cache.numericPicker.pickNumericScale = async (...args) => {
    const result = open(...args);
    cache.numericPicker.dom.dropdown.value = P;
    await cache.numericPicker.selectProperty(P);
    if (missing !== undefined) {
      const input = cache.numericPicker.dom.missingOutputInput;
      input.value = String(missing);
      input.oninput();
    }
    cache.numericPicker.apply();
    return result;
  };
  await cache.gcm.updateNodes({ style: { size: "set_numeric_scale" } }, ["set_numeric_scale"]);
}

const sizeOf = (cache, id) => cache.nodeRef.get(id).style.size;

describe("Map by data: elements without a value", () => {
  it("overwrites an earlier manual size with the scale minimum", async () => {
    const cache = cacheWith({ A: undefined, B: 10, C: 20 });
    cache.selectedNodes = ["A"];
    await cache.gcm.updateNodes({ style: { size: 30 } }, []);

    await mapSize(cache, ["A", "B", "C"]);

    expect(sizeOf(cache, "A")).toBe(DEFAULTS.NODE.SIZE);
    expect(sizeOf(cache, "B")).toBe(DEFAULTS.NODE.SIZE);
    expect(sizeOf(cache, "C")).toBe(50);
  });

  it("uses the value the user sets for them", async () => {
    const cache = cacheWith({ A: undefined, B: 10, C: 20 });
    await mapSize(cache, ["A", "B", "C"], { missing: 5 });
    expect(sizeOf(cache, "A")).toBe(5);
  });

  it("treats null and blank as no value, not as 0", async () => {
    const cache = cacheWith({ A: null, D: "", B: 10, C: 20 });
    await mapSize(cache, ["A", "D", "B", "C"]);
    // B is the data minimum; a 0 would have pulled it up the scale.
    expect(sizeOf(cache, "B")).toBe(DEFAULTS.NODE.SIZE);
    expect(sizeOf(cache, "A")).toBe(DEFAULTS.NODE.SIZE);
  });

  it("gives a single shared value the maximum instead of NaN", async () => {
    const cache = cacheWith({ A: undefined, B: 10 });
    await mapSize(cache, ["A", "B"]);
    expect(sizeOf(cache, "B")).toBe(50);
    expect(sizeOf(cache, "A")).toBe(DEFAULTS.NODE.SIZE);
  });
});

describe("Map by data: what counts as a value", () => {
  it("reads numbers and numeric text, and nothing else", async () => {
    const { StaticUtilities } = await import("../src/utilities/static.js");
    expect(StaticUtilities.numericValue("12")).toBe(12);
    for (const none of [" ", "abc", null, undefined, Infinity, NaN]) {
      expect(StaticUtilities.numericValue(none)).toBeUndefined();
    }
  });

  it("the value for missing follows the minimum output until it is edited", async () => {
    const cache = cacheWith({ A: undefined, B: 10, C: 20 });
    cache.selectedNodes = ["A", "B", "C"];
    const picker = cache.numericPicker;
    const pending = picker.pickNumericScale("nodes", "Node Size");
    picker.dom.minOutputInput.value = "7";
    picker.dom.minOutputInput.oninput();
    expect(picker.missingOutput).toBe(7);
    picker.dom.missingOutputInput.value = "3";
    picker.dom.missingOutputInput.oninput();
    picker.dom.minOutputInput.value = "9";
    picker.dom.minOutputInput.oninput();
    expect(picker.missingOutput).toBe(3);
    picker.cancel();
    await pending;
  });

  it("keeps the last good value when the field is not a number", async () => {
    const cache = cacheWith({ A: undefined, B: 10 });
    cache.selectedNodes = ["A", "B"];
    const picker = cache.numericPicker;
    const pending = picker.pickNumericScale("nodes", "Node Size");
    const input = picker.dom.missingOutputInput;
    input.value = "4";
    input.oninput();
    input.value = "";
    input.oninput();
    expect(picker.missingOutput).toBe(4);
    expect(input.validationMessage).toBe("Enter a number");
    picker.cancel();
    await pending;
  });
});

// The appearance editor's "In selection" row recolours one colour's nodes out
// of a larger selection: `ids` must limit the write to exactly those.
describe("updateNodes with ids", () => {
  it("styles only the given nodes, leaving the rest of the selection alone", async () => {
    const cache = cacheWith({ A: 1, B: 2, C: 3 });
    cache.selectedNodes = ["A", "B", "C"];
    await cache.gcm.updateNodes({ style: { fill: "#123456" } }, [], { ids: ["A", "C"] });
    expect(cache.nodeRef.get("A").style.fill).toBe("#123456");
    expect(cache.nodeRef.get("C").style.fill).toBe("#123456");
    expect(cache.nodeRef.get("B").style.fill).toBeUndefined();
  });
});
