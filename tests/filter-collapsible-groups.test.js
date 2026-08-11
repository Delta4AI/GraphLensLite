// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { UIManager } from "../src/managers/ui.js";

// ==========================================================================
// Collapsible filter groups: each section/sub-group folds independently so
// dense property sets (30-50 properties) stay scannable. (The former panel
// ⚙ Details toggle was deleted — exact inputs and per-row actions are
// always rendered now.)
// ==========================================================================

function makeUI() {
  // Only debug() touches this.cache, and only on a storage error (not hit here).
  return new UIManager({}, false);
}

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
