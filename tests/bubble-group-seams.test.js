// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// --------------------------------------------------------------------------
// Seam fixes for bubble grouping (fix-the-seams rework):
//   1. ONE membership computation (getEffectiveGroupMembers) feeds the
//      rendered outline AND the status badge, so the displayed count can
//      never diverge from what is highlighted (the "shows 4, highlights 1" bug).
//   2. 🧩 Auto (Louvain) confirms before discarding existing manual groups.
//   3. Clearing a group clears BOTH sources (manual + filter/prop), so the
//      badge — which now spans both — can actually reach zero.
// --------------------------------------------------------------------------

// Control Louvain output without running the real algorithm.
const detectCommunitiesMock = vi.fn();
vi.mock("../src/graph/communities.js", () => ({
  detectCommunities: (...args) => detectCommunitiesMock(...args),
  LOUVAIN_RNG_SEED: 1,
}));

// Control the confirm dialog.
const confirmMock = vi.fn();
vi.mock("../src/utilities/popup.js", () => ({
  Popup: { confirm: (...args) => confirmMock(...args) },
}));

const { GraphBubbleSetManager } = await import("../src/graph/bubble_sets.js");

const GROUPS = ["groupOne", "groupTwo", "groupThree", "groupFour"];
const QUADRANTS = {
  groupOne: "top-left",
  groupTwo: "top-right",
  groupThree: "bottom-left",
  groupFour: "bottom-right",
};

function makeLayout() {
  const layout = { filters: new Map(), bubbleSetStyle: {} };
  for (const g of GROUPS) {
    layout[`${g}Props`] = new Set();
    layout[`${g}ManualMembers`] = new Set();
    layout.bubbleSetStyle[g] = { fill: "#123456", label: true };
  }
  return layout;
}

function makeCache(layout = makeLayout()) {
  return {
    data: { selectedLayout: "Default", layouts: { Default: layout } },
    DEFAULTS: {
      BUBBLE_GROUP_STYLE: Object.fromEntries(GROUPS.map((g) => [g, {}])),
      BUBBLE_GROUP_QUADRANT_POSITIONS: QUADRANTS,
    },
    propIDsToNodeIDsToBeShown: new Map(),
    hiddenDanglingNodeIDs: new Set(),
    nodeRef: new Map(),
    selectedNodes: new Set(),
    lastBubbleSetMembers: new Map(),
    bubbleSetChanged: false,
    INSTANCES: { BUBBLE_GROUPS: {} },
    graph: { draw: vi.fn(async () => {}) },
    ui: { info: vi.fn(), warning: vi.fn(), debug: vi.fn(), buildFilterUI: vi.fn(), expandStylingCard: vi.fn() },
  };
}

// Minimal DOM the status panel touches.
function mountStatusDom() {
  document.body.innerHTML = `
    <span id="manualBubbleGroupStatus" style="display:none;"></span>
    <button id="clearManualGroupsBtn" style="display:none;"></button>
    <span id="manualGroupSeparator" style="display:none;"></span>
  `;
}

beforeEach(() => {
  detectCommunitiesMock.mockReset();
  confirmMock.mockReset();
  document.body.innerHTML = "";
});

describe("getEffectiveGroupMembers", () => {
  it("unions filter/prop members with manual members", () => {
    const layout = makeLayout();
    layout.groupOneProps = new Set(["propA"]);
    layout.groupOneManualMembers = new Set(["n3"]);
    const cache = makeCache(layout);
    cache.propIDsToNodeIDsToBeShown.set("propA", ["n1", "n2"]);
    cache.nodeRef = new Map([["n1", {}], ["n2", {}], ["n3", {}]]);

    const bs = new GraphBubbleSetManager(cache);
    expect(bs.getEffectiveGroupMembers("groupOne")).toEqual(new Set(["n1", "n2", "n3"]));
  });

  it("excludes hidden dangling nodes from both sources", () => {
    const layout = makeLayout();
    layout.groupOneProps = new Set(["propA"]);
    layout.groupOneManualMembers = new Set(["n3"]);
    const cache = makeCache(layout);
    cache.propIDsToNodeIDsToBeShown.set("propA", ["n1", "n2"]);
    cache.nodeRef = new Map([["n1", {}], ["n2", {}], ["n3", {}]]);
    cache.hiddenDanglingNodeIDs = new Set(["n2", "n3"]);

    const bs = new GraphBubbleSetManager(cache);
    expect(bs.getEffectiveGroupMembers("groupOne")).toEqual(new Set(["n1"]));
  });

  it("drops manual members no longer present in nodeRef", () => {
    const layout = makeLayout();
    layout.groupOneManualMembers = new Set(["gone", "here"]);
    const cache = makeCache(layout);
    cache.nodeRef = new Map([["here", {}]]);

    const bs = new GraphBubbleSetManager(cache);
    expect(bs.getEffectiveGroupMembers("groupOne")).toEqual(new Set(["here"]));
  });
});

describe("updateManualGroupStatus — badge count matches the rendered union", () => {
  it("counts prop ∪ manual (not manual alone)", () => {
    mountStatusDom();
    const layout = makeLayout();
    layout.groupOneProps = new Set(["propA"]);
    layout.groupOneManualMembers = new Set(["n3"]);
    const cache = makeCache(layout);
    cache.propIDsToNodeIDsToBeShown.set("propA", ["n1", "n2"]);
    cache.nodeRef = new Map([["n1", {}], ["n2", {}], ["n3", {}]]);

    const bs = new GraphBubbleSetManager(cache);
    bs.updateManualGroupStatus();

    const badges = document.querySelectorAll("#manualBubbleGroupStatus .manual-group-badge");
    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toContain("●3");
  });

  it("renders no badge when a group has neither source", () => {
    mountStatusDom();
    const bs = new GraphBubbleSetManager(makeCache());
    bs.updateManualGroupStatus();
    expect(document.querySelectorAll("#manualBubbleGroupStatus .manual-group-badge").length).toBe(0);
    expect(document.getElementById("manualBubbleGroupStatus").style.display).toBe("none");
  });
});

describe("detectCommunities — confirm before clobbering manual groups", () => {
  function wireDetect(cache) {
    const bs = new GraphBubbleSetManager(cache);
    // Isolate the confirm/assignment logic from DOM-heavy choreography.
    bs.updateManualGroupButtonState = vi.fn();
    bs.updateManualGroupStatus = vi.fn();
    bs.refreshBubbleStyleElements = vi.fn();
    bs.updateBubbleSetIfChanged = vi.fn(async () => {});
    bs.redrawBubbleSets = vi.fn(async () => {});
    bs.getNumericEdgeProperties = vi.fn(() => []);
    return bs;
  }

  it("does not prompt when no manual groups exist, and applies assignments", async () => {
    const cache = makeCache();
    detectCommunitiesMock.mockReturnValue({
      assignments: new Map([["groupOne", new Set(["a", "b"])]]),
      communityCount: 1,
      modularity: 0.4,
    });
    const bs = wireDetect(cache);

    await bs.detectCommunities();

    expect(confirmMock).not.toHaveBeenCalled();
    expect(cache.data.layouts.Default.groupOneManualMembers).toEqual(new Set(["a", "b"]));
  });

  it("prompts and ABORTS when the user cancels — members untouched", async () => {
    const cache = makeCache();
    cache.data.layouts.Default.groupTwoManualMembers = new Set(["existing"]);
    detectCommunitiesMock.mockReturnValue({
      assignments: new Map([["groupOne", new Set(["a", "b"])]]),
      communityCount: 1,
      modularity: 0.4,
    });
    confirmMock.mockResolvedValue(false);
    const bs = wireDetect(cache);

    await bs.detectCommunities();

    expect(confirmMock).toHaveBeenCalledTimes(1);
    // unchanged: cancel must not assign
    expect(cache.data.layouts.Default.groupTwoManualMembers).toEqual(new Set(["existing"]));
    expect(cache.data.layouts.Default.groupOneManualMembers).toEqual(new Set());
  });

  it("prompts and PROCEEDS when the user confirms", async () => {
    const cache = makeCache();
    cache.data.layouts.Default.groupTwoManualMembers = new Set(["existing"]);
    detectCommunitiesMock.mockReturnValue({
      assignments: new Map([["groupOne", new Set(["a", "b"])]]),
      communityCount: 1,
      modularity: 0.4,
    });
    confirmMock.mockResolvedValue(true);
    const bs = wireDetect(cache);

    await bs.detectCommunities();

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(cache.data.layouts.Default.groupOneManualMembers).toEqual(new Set(["a", "b"]));
    // group two was not assigned a community → cleared by the overwrite
    expect(cache.data.layouts.Default.groupTwoManualMembers).toEqual(new Set());
  });

  it("warns and returns without prompting when detection yields no result", async () => {
    const cache = makeCache();
    cache.data.layouts.Default.groupOneManualMembers = new Set(["existing"]);
    detectCommunitiesMock.mockReturnValue(null);
    const bs = wireDetect(cache);

    await bs.detectCommunities();

    expect(cache.ui.warning).toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(cache.data.layouts.Default.groupOneManualMembers).toEqual(new Set(["existing"]));
  });
});

describe("clear actions span both membership sources", () => {
  function wireClear(cache) {
    const bs = new GraphBubbleSetManager(cache);
    bs.updateManualGroupButtonState = vi.fn();
    bs.updateManualGroupStatus = vi.fn();
    bs.updateBubbleSetIfChanged = vi.fn(async () => {});
    bs.redrawBubbleSets = vi.fn(async () => {});
    return bs;
  }

  it("clearManualGroup clears manual + prop and rebuilds the filter UI", async () => {
    const layout = makeLayout();
    layout.groupOneProps = new Set(["propA"]);
    layout.groupOneManualMembers = new Set(["n3"]);
    const cache = makeCache(layout);
    const bs = wireClear(cache);

    await bs.clearManualGroup("groupOne");

    expect(layout.groupOneManualMembers.size).toBe(0);
    expect(layout.groupOneProps.size).toBe(0);
    expect(cache.ui.buildFilterUI).toHaveBeenCalledTimes(1);
  });

  it("clearManualGroup skips the filter rebuild when no props were assigned", async () => {
    const layout = makeLayout();
    layout.groupOneManualMembers = new Set(["n3"]);
    const cache = makeCache(layout);
    const bs = wireClear(cache);

    await bs.clearManualGroup("groupOne");

    expect(layout.groupOneManualMembers.size).toBe(0);
    expect(cache.ui.buildFilterUI).not.toHaveBeenCalled();
  });

  it("clearAllManualGroups clears prop assignments across all groups", async () => {
    const layout = makeLayout();
    layout.groupOneProps = new Set(["propA"]);
    layout.groupTwoManualMembers = new Set(["x"]);
    const cache = makeCache(layout);
    const bs = wireClear(cache);

    await bs.clearAllManualGroups();

    expect(layout.groupOneProps.size).toBe(0);
    expect(layout.groupTwoManualMembers.size).toBe(0);
    expect(cache.ui.buildFilterUI).toHaveBeenCalledTimes(1);
  });
});
