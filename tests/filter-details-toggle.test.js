// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { UIManager } from "../src/managers/ui.js";

// ==========================================================================
// Filter panel compact-by-default disclosure (Details toggle) + collapsible
// groups. These keep dense property sets (30-50 properties) scannable: exact
// numeric inputs and per-row group/selection actions hide behind one panel
// toggle, and each section/sub-group folds independently.
// ==========================================================================

function makeUI() {
  // Only debug() touches this.cache, and only on a storage error (not hit here).
  return new UIManager({}, false);
}

describe("UIManager.createFilterDetailsToggle", () => {
  let ui, container;

  beforeEach(() => {
    window.localStorage.clear();
    ui = makeUI();
    container = document.createElement("div");
  });

  it("renders a labeled Details toggle button", () => {
    const btn = ui.createFilterDetailsToggle(container);

    expect(btn).not.toBeNull();
    expect(btn.classList.contains("filter-details-toggle")).toBe(true);
    expect(btn.textContent).toContain("Details");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("defaults to compact (no show-details) when nothing is stored", () => {
    ui.createFilterDetailsToggle(container);

    expect(container.classList.contains("show-details")).toBe(false);
  });

  it("restores the on state from localStorage", () => {
    window.localStorage.setItem("gll.filterDetails", "1");

    const btn = ui.createFilterDetailsToggle(container);

    expect(container.classList.contains("show-details")).toBe(true);
    expect(btn.classList.contains("active")).toBe(true);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("toggles details on click and persists the choice", () => {
    const btn = ui.createFilterDetailsToggle(container);

    btn.click();
    expect(container.classList.contains("show-details")).toBe(true);
    expect(btn.classList.contains("active")).toBe(true);
    expect(window.localStorage.getItem("gll.filterDetails")).toBe("1");

    btn.click();
    expect(container.classList.contains("show-details")).toBe(false);
    expect(btn.classList.contains("active")).toBe(false);
    expect(window.localStorage.getItem("gll.filterDetails")).toBe("0");
  });
});

describe("UIManager.makeFilterGroupCollapsible", () => {
  let ui, wrapper, header, badge;

  beforeEach(() => {
    ui = makeUI();
    wrapper = document.createElement("div");
    header = document.createElement("div");
    badge = document.createElement("button");
    badge.textContent = "✔";
    header.appendChild(badge);
    wrapper.appendChild(header);
  });

  it("prepends an expanded chevron and marks the header clickable", () => {
    ui.makeFilterGroupCollapsible(wrapper, header);
    const chevron = header.querySelector(".filter-group-chevron");

    expect(chevron).not.toBeNull();
    expect(chevron.textContent).toBe("▾");
    expect(header.classList.contains("collapsible-filter-header")).toBe(true);
    // chevron is prepended before the existing action badge
    expect(header.firstChild).toBe(chevron);
  });

  it("folds and unfolds the group when the header is clicked", () => {
    ui.makeFilterGroupCollapsible(wrapper, header);
    const chevron = header.querySelector(".filter-group-chevron");

    chevron.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(wrapper.classList.contains("collapsed")).toBe(true);
    expect(chevron.textContent).toBe("▸");

    chevron.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(wrapper.classList.contains("collapsed")).toBe(false);
    expect(chevron.textContent).toBe("▾");
  });

  it("does not fold when an action badge in the header is clicked", () => {
    ui.makeFilterGroupCollapsible(wrapper, header);

    badge.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    expect(wrapper.classList.contains("collapsed")).toBe(false);
  });
});
