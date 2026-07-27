// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { UIManager } from "../src/managers/ui.js";

// ==========================================================================
// Keyboard cheat sheet ("?" hotkey): a Popup listing every global shortcut.
// The list must mirror the hotkey switch in graph/core.js.
// ==========================================================================

function makeUI() {
  return new UIManager({}, false);
}

describe("UIManager.toggleKeyboardSheet", () => {
  let ui;

  beforeEach(() => {
    document.body.innerHTML = "";
    ui = makeUI();
  });

  it("opens a popup listing every registered hotkey", () => {
    ui.toggleKeyboardSheet();

    const keys = [...document.querySelectorAll(".keyboard-sheet kbd")].map(
      (el) => el.textContent
    );
    // One row per hotkey in graph/core.js registerHotkeyEvents, plus Esc and ?.
    for (const key of ["P", "S", "F", "D", "Q", "M", "Y", "L", "H", "A", "Esc", "?"]) {
      expect(keys).toContain(key);
    }
    // Every row pairs the key with a non-empty action label.
    document.querySelectorAll(".keyboard-sheet-row").forEach((row) => {
      expect(row.querySelector("span").textContent.length).toBeGreaterThan(0);
    });
  });

  it("acts as a toggle: a second ? closes the sheet", () => {
    ui.toggleKeyboardSheet();
    expect(document.querySelector(".keyboard-sheet")).not.toBeNull();

    ui.toggleKeyboardSheet();
    expect(document.querySelector(".keyboard-sheet")).toBeNull();
  });

  it("reopens cleanly after the popup is closed by its own close button", () => {
    ui.toggleKeyboardSheet();
    document.querySelector('.p-icon[title="Close popup"]').click();

    ui.toggleKeyboardSheet();
    expect(document.querySelector(".keyboard-sheet")).not.toBeNull();
  });
});
