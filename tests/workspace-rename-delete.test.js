// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

// ==========================================================================
// The two workspace lifecycle dialogs. Both used to under-inform: rename
// opened an EMPTY box (retype the name you are editing, and an empty submit
// returned silently), and delete asked "are you sure" without naming that the
// workspace's positions, styles, groups and notes go with it — or that its
// undo entries become unusable (history.js drops entries whose workspace is
// gone).
// ==========================================================================

const popup = vi.hoisted(() => ({ promptValue: null, confirmValue: true, calls: [] }));
vi.mock("../src/utilities/popup.js", () => ({
  Popup: {
    prompt: vi.fn(async (message, initial) => {
      popup.calls.push({ kind: "prompt", message, initial });
      return popup.promptValue;
    }),
    confirm: vi.fn(async (message, label) => {
      popup.calls.push({ kind: "confirm", message, label });
      return popup.confirmValue;
    }),
  },
}));

import { GraphLayoutManager } from "../src/graph/layout.js";

function createCache() {
  const asyncNoop = async () => {};
  return {
    data: {
      selectedLayout: "Analysis",
      layouts: { Default: {}, Analysis: {} },
    },
    ui: { error: vi.fn(), info: vi.fn() },
    uiComponents: { buildDropdownOptions: vi.fn() },
    rail: { refresh: vi.fn() },
    // removeSelectedLayout switches back to Default through changeLayout.
    graph: { runLayoutTransition: asyncNoop },
  };
}

describe("renameSelectedLayout", () => {
  let cache;
  let lm;

  beforeEach(() => {
    popup.calls.length = 0;
    popup.promptValue = null;
    cache = createCache();
    lm = new GraphLayoutManager(cache);
  });

  it("pre-fills the box with the current name", async () => {
    popup.promptValue = "Renamed";
    await lm.renameSelectedLayout();

    expect(popup.calls[0].initial).toBe("Analysis");
    expect(Object.keys(cache.data.layouts)).toEqual(["Default", "Renamed"]);
    expect(cache.data.selectedLayout).toBe("Renamed");
  });

  it("says why an empty name did nothing instead of returning silently", async () => {
    popup.promptValue = "";
    await lm.renameSelectedLayout();

    expect(cache.ui.error).toHaveBeenCalledWith("A workspace name cannot be empty.");
    expect(Object.keys(cache.data.layouts)).toEqual(["Default", "Analysis"]);
  });

  it("stays silent when the dialog was dismissed", async () => {
    popup.promptValue = null;
    await lm.renameSelectedLayout();

    expect(cache.ui.error).not.toHaveBeenCalled();
    expect(Object.keys(cache.data.layouts)).toEqual(["Default", "Analysis"]);
  });
});

describe("removeSelectedLayout", () => {
  let cache;
  let lm;

  beforeEach(() => {
    popup.calls.length = 0;
    popup.confirmValue = false;
    cache = createCache();
    lm = new GraphLayoutManager(cache);
  });

  it("names what is lost, that it is permanent, and labels the action", async () => {
    await lm.removeSelectedLayout();

    const { message, label } = popup.calls[0];
    expect(message).toContain("Analysis");
    expect(message).toContain("permanently");
    expect(message).toContain("bubble groups");
    expect(message).toContain("undo history");
    expect(label).toBe("Delete workspace");
  });

  it("keeps the workspace when the user cancels", async () => {
    expect(await lm.removeSelectedLayout()).toBe(false);
    expect(Object.keys(cache.data.layouts)).toEqual(["Default", "Analysis"]);
  });

  it("refuses to delete Default without asking anything", async () => {
    cache.data.selectedLayout = "Default";
    await lm.removeSelectedLayout();

    expect(popup.calls).toHaveLength(0);
    expect(cache.ui.error).toHaveBeenCalledWith("Cannot delete the Default workspace.");
  });
});
