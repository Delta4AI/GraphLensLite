// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Popup } from "../src/utilities/popup.js";

// ==========================================================================
// Popup.layoutSelectDialog renders the re-layout picker: an algorithm select
// (pre-selected to the workspace's default), a static overwrite warning when
// the workspace has positions to lose, and a dynamic performance warning that
// appears only for super-linear layouts on large graphs and updates as the
// chosen type changes. Apply resolves { templateType }; Cancel/close resolve
// null.
// ==========================================================================

const LAYOUT_INTERNALS = {
  force: {},
  circular: {},
  grid: {},
  dagre: { rankdir: "TB" },
  mds: {},
};

const $select = () => document.getElementById("relayout-type-select");
const $perf = () => document.getElementById("relayout-perf-warning");
const $apply = () => document.querySelector(".p-button-primary");
const $cancel = () => document.querySelector(".p-button-secondary");

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Popup.layoutSelectDialog — rendering", () => {
  it("renders one option per layout type with capitalized labels", () => {
    // Arrange / Act
    Popup.layoutSelectDialog(LAYOUT_INTERNALS, { defaultType: "force" });

    // Assert
    const options = [...$select().options];
    expect(options.map((o) => o.value)).toEqual(Object.keys(LAYOUT_INTERNALS));
    expect(options.map((o) => o.textContent)).toContain("Dagre");
  });

  it("pre-selects the provided default type", () => {
    // Arrange / Act
    Popup.layoutSelectDialog(LAYOUT_INTERNALS, { defaultType: "grid" });

    // Assert
    expect($select().value).toBe("grid");
  });

  it("shows the overwrite warning only when hasPositions is true", () => {
    // Arrange / Act
    Popup.layoutSelectDialog(LAYOUT_INTERNALS, { defaultType: "force", hasPositions: true });

    // Assert
    expect(document.body.textContent).toContain("overwriting the current");
  });

  it("omits the overwrite warning for an empty workspace", () => {
    // Arrange / Act
    Popup.layoutSelectDialog(LAYOUT_INTERNALS, { defaultType: "force", hasPositions: false });

    // Assert
    expect(document.body.textContent).not.toContain("overwriting the current");
  });

  it("shows the perf warning for an expensive layout on a large graph", () => {
    // Arrange / Act
    Popup.layoutSelectDialog(LAYOUT_INTERNALS, {
      defaultType: "dagre",
      nodeCount: 5000,
      expensiveLayouts: ["dagre", "mds"],
      warningThreshold: 2000,
    });

    // Assert
    expect($perf().textContent).toContain("computationally intensive");
    expect($perf().textContent).toContain("5,000");
    expect($perf().style.display).not.toBe("none");
  });

  it("hides the perf warning for a cheap layout on a large graph", () => {
    // Arrange / Act
    Popup.layoutSelectDialog(LAYOUT_INTERNALS, {
      defaultType: "grid",
      nodeCount: 5000,
      expensiveLayouts: ["dagre", "mds"],
      warningThreshold: 2000,
    });

    // Assert
    expect($perf().textContent).toBe("");
    expect($perf().style.display).toBe("none");
  });

  it("hides the perf warning for an expensive layout on a small graph", () => {
    // Arrange / Act
    Popup.layoutSelectDialog(LAYOUT_INTERNALS, {
      defaultType: "dagre",
      nodeCount: 100,
      expensiveLayouts: ["dagre", "mds"],
      warningThreshold: 2000,
    });

    // Assert
    expect($perf().style.display).toBe("none");
  });

  it("updates the perf warning when the chosen type changes", () => {
    // Arrange
    Popup.layoutSelectDialog(LAYOUT_INTERNALS, {
      defaultType: "grid",
      nodeCount: 5000,
      expensiveLayouts: ["dagre", "mds"],
      warningThreshold: 2000,
    });
    expect($perf().style.display).toBe("none");

    // Act: switch to an expensive layout.
    const select = $select();
    select.value = "mds";
    select.dispatchEvent(new Event("change"));

    // Assert
    expect($perf().textContent).toContain("computationally intensive");
    expect($perf().style.display).not.toBe("none");
  });
});

describe("Popup.layoutSelectDialog — resolution", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("resolves with the selected type on Apply", async () => {
    // Arrange
    const promise = Popup.layoutSelectDialog(LAYOUT_INTERNALS, { defaultType: "force" });
    const select = $select();
    select.value = "circular";
    select.dispatchEvent(new Event("change"));

    // Act
    $apply().click();
    const result = await promise;

    // Assert
    expect(result).toEqual({ templateType: "circular" });
  });

  it("resolves null on Cancel", async () => {
    // Arrange
    const promise = Popup.layoutSelectDialog(LAYOUT_INTERNALS, { defaultType: "force" });

    // Act
    $cancel().click();
    const result = await promise;

    // Assert
    expect(result).toBeNull();
  });

  it("resolves null when closed via the header button", async () => {
    // Arrange
    const promise = Popup.layoutSelectDialog(LAYOUT_INTERNALS, { defaultType: "force" });

    // Act: the × close button lives in the popup header actions.
    document.querySelector(".p-icon").click();
    const result = await promise;

    // Assert
    expect(result).toBeNull();
  });
});
