// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { PieChartPicker } from "../src/utilities/pie_chart_picker.js";

// ==========================================================================
// Collision-aware labels in the pie picker (PLAN_FIX_PIE_MODAL.md): propIds
// are `mainGroup::subGroup::propName` hashes, and same-named properties on
// different subGroups (Cell::score vs Document::score) used to both render
// as a bare "score". Colliding names now get a "(subGroup)" suffix in the
// property list and the numeric slice-color rows, plus a title tooltip.
// ==========================================================================

/** Minimal cache: nodes is Map<id, {features, featureValues}>, filters Map<propId, {isCategory}>. */
function makeCache(nodes, filters) {
  return {
    DEFAULTS: {
      NODE: {
        PIE: { SLICE_PALETTE: ["#111111", "#222222"], DEFAULT_COLOR: "#999999", MAX_SLICES: 6 },
      },
    },
    selectedNodes: Array.from(nodes.keys()),
    nodeRef: nodes,
    data: { selectedLayout: "L", layouts: { L: { filters } } },
    ui: { warning: vi.fn() },
  };
}

function makeNumericPicker(propIds) {
  const filters = new Map(propIds.map((id) => [id, { isCategory: false }]));
  const nodes = new Map([
    ["n1", { features: propIds, featureValues: new Map(propIds.map((id) => [id, 1])) }],
  ]);
  const picker = new PieChartPicker(makeCache(nodes, filters));
  picker.mode = "numeric";
  picker.buildContent(); // wires this.dom without opening a Popup
  return picker;
}

describe("PieChartPicker.labelsFor", () => {
  const picker = new PieChartPicker({});

  it("disambiguates colliding names with the subGroup, leaves unique names bare", () => {
    const labels = picker.labelsFor(["A::Cell::score", "A::Document::score", "A::Cell::size"]);
    expect(labels.get("A::Cell::score")).toBe("score (Cell)");
    expect(labels.get("A::Document::score")).toBe("score (Document)");
    expect(labels.get("A::Cell::size")).toBe("size");
  });

  it("keeps a bare propId bare when it collides with a hashed one", () => {
    const labels = picker.labelsFor(["score", "A::Cell::score"]);
    expect(labels.get("score")).toBe("score");
    expect(labels.get("A::Cell::score")).toBe("score (Cell)");
  });
});

describe("PieChartPicker.renderProperties", () => {
  it("renders disambiguated labels adjacent, with subGroup > propName titles", () => {
    const picker = makeNumericPicker(["A::Document::score", "A::Cell::size", "A::Cell::score"]);
    picker.renderProperties();

    const rows = Array.from(picker.dom.propList.querySelectorAll(".pie-prop-row"));
    expect(rows.map((r) => r.textContent)).toEqual([
      "score (Cell)",
      "score (Document)",
      "size",
    ]);
    expect(rows[0].title).toBe("Cell > score");
    expect(rows[1].title).toBe("Document > score");
    expect(rows[2].title).toBe("Cell > size");
  });
});

describe("PieChartPicker.renderColors (numeric)", () => {
  it("uses disambiguated labels on slice-color rows", () => {
    const picker = makeNumericPicker(["A::Cell::score", "A::Document::score"]);
    picker.selected = new Set(["A::Cell::score", "A::Document::score"]);
    picker.renderColors();

    const labels = Array.from(
      picker.dom.colorSection.querySelectorAll(".pie-color-row span"),
      (el) => el.textContent,
    );
    expect(labels).toEqual(["score (Cell)", "score (Document)"]);
  });

  it("still marks rows past the slice cap as not shown", () => {
    const propIds = Array.from({ length: 8 }, (_, i) => `A::Cell::p${i}`);
    const picker = makeNumericPicker(propIds);
    picker.selected = new Set(propIds);
    picker.renderColors();

    const labels = Array.from(
      picker.dom.colorSection.querySelectorAll(".pie-color-row span"),
      (el) => el.textContent,
    );
    expect(labels[5]).toBe("p5");
    expect(labels[6]).toBe("p6 — not shown");
    expect(labels[7]).toBe("p7 — not shown");
    const dropped = picker.dom.colorSection.querySelectorAll(".pie-color-row--dropped");
    expect(dropped).toHaveLength(2);
  });
});
