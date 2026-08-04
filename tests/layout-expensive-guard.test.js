// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

// ==========================================================================
// Workspace creation warns before kicking off a super-linear layout
// (EXPENSIVE_LAYOUTS: dagre/mds) on a large graph (> LAYOUT_NODE_WARNING_
// THRESHOLD nodes), since even off the main thread it can run for minutes and
// blocks the UI for the whole time. Declining cancels cleanly before any
// workspace state is created.
// ==========================================================================

// Controllable Popup stub (layout.js imports it eagerly at module load).
const popup = vi.hoisted(() => ({ dialog: null, confirm: true }));
vi.mock("../src/utilities/popup.js", () => ({
  Popup: {
    layoutCreationDialog: vi.fn(async () => popup.dialog),
    confirm: vi.fn(async () => popup.confirm),
  },
}));

import { Popup } from "../src/utilities/popup.js";
import { GraphLayoutManager } from "../src/graph/layout.js";
import { DEFAULTS } from "../src/config.js";

const THRESHOLD = DEFAULTS.LAYOUT_NODE_WARNING_THRESHOLD;

function createCache(nodeCount) {
  // Every downstream collaborator stubbed so addLayout runs to completion on
  // the "proceed"/"no-warning" paths; the guard decision is what we assert.
  const noop = () => {};
  const asyncNoop = async () => {};
  const cache = {
    nodeRef: new Map(),
    lastBubbleSetMembers: new Map(),
    graphData: { order: nodeCount, forEachNode: noop, hasNode: () => false },
    EVENT_LOCKS: {},
    DEFAULTS,
    data: { selectedLayout: "Default", layouts: { Default: {} }, filterDefaults: {} },
    ui: {
      showLoading: asyncNoop, hideLoading: asyncNoop, holdLoading: noop,
      releaseLoading: noop, buildFilterUI: noop, updateFilterLockState: noop,
      clearActivePropsCacheOnLayoutChange: noop, info: vi.fn(), error: vi.fn(),
      debug: noop,
    },
    uiComponents: { buildDropdownOptions: noop },
    qm: { updateQueryTextArea: noop },
    sm: { toggleSelectionForAllNodes: asyncNoop, toggleSelectionForAllEdges: asyncNoop },
    bs: {
      traverseBubbleSets: () => [],
      clearBubbleSetInstanceMembers: asyncNoop,
      updateBubbleSetIfChanged: asyncNoop,
      renderGroupList: noop,
      syncGroupRows: noop,
      refreshBubbleStyleElements: noop,
    },
    gcm: {
      preRenderEvent: asyncNoop,
      decideToRenderOrDraw: asyncNoop,
      applyHideDisconnectedState: asyncNoop,
    },
    metrics: { updateMetricUI: asyncNoop },
    graph: { setLayout: asyncNoop, layout: asyncNoop, runLayoutTransition: asyncNoop },
    lm: { persistNodePositions: asyncNoop },
  };
  return cache;
}

function mountSelect() {
  const select = document.createElement("select");
  select.id = "selectView";
  const opt = document.createElement("option");
  opt.value = "Default";
  select.appendChild(opt);
  document.body.appendChild(select);
}

describe("addLayout — expensive-layout size guard", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    mountSelect();
    Popup.confirm.mockClear();
    Popup.layoutCreationDialog.mockClear();
    popup.confirm = true;
  });

  it("warns and cancels when dagre is chosen on a large graph and the user declines", async () => {
    // Arrange
    popup.dialog = { name: "ws1", mode: "template", templateType: "dagre" };
    popup.confirm = false;
    const cache = createCache(THRESHOLD + 1);
    const lm = new GraphLayoutManager(cache);

    // Act
    await lm.addLayout();

    // Assert: warned, then aborted before creating the workspace.
    expect(Popup.confirm).toHaveBeenCalledTimes(1);
    expect(cache.data.layouts.ws1).toBeUndefined();
    expect(cache.ui.info).toHaveBeenCalledWith("Creating workspace canceled");
  });

  it("warns then proceeds to create the workspace when the user confirms", async () => {
    // Arrange
    popup.dialog = { name: "ws2", mode: "template", templateType: "dagre" };
    popup.confirm = true;
    const cache = createCache(THRESHOLD + 1);
    const lm = new GraphLayoutManager(cache);

    // Act
    await lm.addLayout();

    // Assert
    expect(Popup.confirm).toHaveBeenCalledTimes(1);
    expect(cache.data.layouts.ws2).toBeDefined();
  });

  it("does NOT warn for a cheap layout (grid) even on a large graph", async () => {
    // Arrange
    popup.dialog = { name: "ws3", mode: "template", templateType: "grid" };
    const cache = createCache(THRESHOLD + 5000);
    const lm = new GraphLayoutManager(cache);

    // Act
    await lm.addLayout();

    // Assert
    expect(Popup.confirm).not.toHaveBeenCalled();
    expect(cache.data.layouts.ws3).toBeDefined();
  });

  it("does NOT warn for dagre on a small graph (at/under threshold)", async () => {
    // Arrange
    popup.dialog = { name: "ws4", mode: "template", templateType: "dagre" };
    const cache = createCache(THRESHOLD); // not strictly greater
    const lm = new GraphLayoutManager(cache);

    // Act
    await lm.addLayout();

    // Assert
    expect(Popup.confirm).not.toHaveBeenCalled();
    expect(cache.data.layouts.ws4).toBeDefined();
  });
});
