// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// --------------------------------------------------------------------------
// Seam fixes for bubble grouping (fix-the-seams rework):
//   1. ONE membership computation (getEffectiveGroupMembers) feeds the
//      rendered outline AND the status badge, so the displayed count can
//      never diverge from what is highlighted (the "shows 4, highlights 1" bug).
//   2. 🧩 Auto (Louvain) ADDS groups rather than overwriting a fixed four, so
//      it destroys nothing and needs no confirmation.
//   3. Clearing a group clears BOTH sources (manual + filter/prop), so the
//      badge — which now spans both — can actually reach zero.
// --------------------------------------------------------------------------

// Control Louvain output without running the real algorithm.
const detectCommunitiesMock = vi.fn();
vi.mock("../src/graph/communities.js", () => ({
  detectCommunities: (...args) => detectCommunitiesMock(...args),
  LOUVAIN_RNG_SEED: 1,
}));

const { GraphBubbleSetManager } = await import("../src/graph/bubble_sets.js");

// A legacy four-group workspace: the group list is per-layout now, so these
// are just the keys this fixture happens to carry.
const GROUPS = ["groupOne", "groupTwo", "groupThree", "groupFour"];

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
    DEFAULTS: { BUBBLE_GROUP_STYLE_TEMPLATE: {} },
    propIDsToNodeIDsToBeShown: new Map(),
    hiddenDanglingNodeIDs: new Set(),
    nodeRef: new Map(),
    selectedNodes: new Set(),
    lastBubbleSetMembers: new Map(),
    bubbleSetChanged: false,
    INSTANCES: { BUBBLE_GROUPS: {} },
    graph: { draw: vi.fn(async () => {}) },
    uiComponents: { refreshGroupChips: vi.fn() },
    ui: { info: vi.fn(), warning: vi.fn(), debug: vi.fn(), buildFilterUI: vi.fn(),
          expandStylingCard: vi.fn(), syncOverlays: vi.fn() },
  };
}

// Minimal DOM the group list touches.
function mountGroupListDom() {
  document.body.innerHTML = `
    <div id="groupList"></div>
    <div id="groupStylePanel"></div>
    <button id="clearManualGroupsBtn"></button>
  `;
}

beforeEach(() => {
  detectCommunitiesMock.mockReset();
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

describe("renderGroupList — the row count matches the rendered union", () => {
  it("counts prop ∪ manual (not manual alone)", () => {
    mountGroupListDom();
    const layout = makeLayout();
    layout.groupOneProps = new Set(["propA"]);
    layout.groupOneManualMembers = new Set(["n3"]);
    const cache = makeCache(layout);
    cache.propIDsToNodeIDsToBeShown.set("propA", ["n1", "n2"]);
    cache.nodeRef = new Map([["n1", {}], ["n2", {}], ["n3", {}]]);

    const bs = new GraphBubbleSetManager(cache);
    bs.renderGroupList();

    const rows = document.querySelectorAll("#groupList .group-row");
    expect(rows.length).toBe(GROUPS.length);
    const first = document.querySelector('.group-row[data-group="groupOne"] .group-count');
    expect(first.textContent).toBe("3 nodes");
  });

  it("shows a group's two sources on its own row", () => {
    mountGroupListDom();
    const layout = makeLayout();
    layout.groupOneProps = new Set(["Node::Topology::degree"]);
    layout.groupOneManualMembers = new Set(["n3"]);
    const cache = makeCache(layout);
    cache.propIDsToNodeIDsToBeShown.set("Node::Topology::degree", ["n1"]);
    cache.nodeRef = new Map([["n1", {}], ["n3", {}]]);

    new GraphBubbleSetManager(cache).renderGroupList();

    const parts = [...document.querySelectorAll(
      '.group-row[data-group="groupOne"] .group-row-source .group-source-part')].map((e) => e.textContent);
    expect(parts).toEqual(['⚙ follows Topology › degree', '＋ 1 added by hand']);
    // A group with no filter source says nothing rather than "+0 manual".
    expect(document.querySelector('.group-row[data-group="groupTwo"] .group-row-source')).toBeNull();
  });

  it("renders the empty state when the workspace has no groups", () => {
    mountGroupListDom();
    const cache = makeCache({ filters: new Map(), bubbleSetStyle: {} });
    new GraphBubbleSetManager(cache).renderGroupList();
    expect(document.querySelectorAll("#groupList .group-row").length).toBe(0);
    expect(document.querySelector("#groupList .group-empty").textContent).toContain("No groups yet");
  });
});

describe("detectCommunities — creates groups instead of overwriting them", () => {
  function wireDetect(cache) {
    const bs = new GraphBubbleSetManager(cache);
    // Isolate the assignment logic from DOM-heavy choreography.
    bs.syncGroupRows = vi.fn();
    bs.renderGroupList = vi.fn();
    bs.refreshBubbleStyleElements = vi.fn();
    bs.updateBubbleSetIfChanged = vi.fn(async () => {});
    bs.redrawBubbleSets = vi.fn(async () => {});
    bs.getNumericEdgeProperties = vi.fn(() => []);
    return bs;
  }

  /** Louvain fills whichever keys detectCommunities minted for it. */
  function assignFirst(members) {
    detectCommunitiesMock.mockImplementation((cache, groups) => ({
      assignments: new Map([[groups[0], new Set(members)]]),
      communityCount: 1,
      modularity: 0.4,
    }));
  }

  it("adds new groups and leaves existing ones untouched", async () => {
    const cache = makeCache();
    cache.data.layouts.Default.groupTwoManualMembers = new Set(["existing"]);
    assignFirst(["a", "b"]);
    const bs = wireDetect(cache);

    await bs.detectCommunities({ groupCount: 2 });

    const layout = cache.data.layouts.Default;
    // Nothing the user built was destroyed — the whole reason the old confirm
    // dialog existed, and why it is gone.
    expect(layout.groupTwoManualMembers).toEqual(new Set(["existing"]));
    // One community found → exactly one new group survives.
    const created = Object.keys(layout.bubbleSetStyle).filter((g) => /^g\d+$/.test(g));
    expect(created).toHaveLength(1);
    expect(layout[`${created[0]}ManualMembers`]).toEqual(new Set(["a", "b"]));
  });

  it("honours the requested group count", async () => {
    const cache = makeCache();
    detectCommunitiesMock.mockImplementation((c, groups) => ({
      assignments: new Map(groups.map((g, i) => [g, new Set([`n${i}`])])),
      communityCount: groups.length,
      modularity: 0.5,
    }));
    const bs = wireDetect(cache);

    await bs.detectCommunities({ groupCount: 6 });

    const created = Object.keys(cache.data.layouts.Default.bubbleSetStyle)
      .filter((g) => /^g\d+$/.test(g));
    expect(created).toHaveLength(6);
  });

  it("drops the groups no community landed in", async () => {
    const cache = makeCache();
    assignFirst(["a"]);
    const bs = wireDetect(cache);

    await bs.detectCommunities({ groupCount: 5 });

    // 5 minted, 1 filled — an empty group is clutter, not a result.
    const layout = cache.data.layouts.Default;
    const created = Object.keys(layout.bubbleSetStyle).filter((g) => /^g\d+$/.test(g));
    expect(created).toHaveLength(1);
    for (const g of created) expect(layout[`${g}ManualMembers`].size).toBeGreaterThan(0);
  });

  it("warns and leaves no debris when detection yields no result", async () => {
    const cache = makeCache();
    cache.data.layouts.Default.groupOneManualMembers = new Set(["existing"]);
    detectCommunitiesMock.mockReturnValue(null);
    const bs = wireDetect(cache);

    await bs.detectCommunities({ groupCount: 3 });

    expect(cache.ui.warning).toHaveBeenCalled();
    expect(cache.data.layouts.Default.groupOneManualMembers).toEqual(new Set(["existing"]));
    // The keys minted to compute against must not survive a failed run.
    expect(Object.keys(cache.data.layouts.Default.bubbleSetStyle).filter((g) => /^g\d+$/.test(g)))
      .toHaveLength(0);
  });
});

describe("clear actions span both membership sources", () => {
  function wireClear(cache) {
    const bs = new GraphBubbleSetManager(cache);
    bs.syncGroupRows = vi.fn();
    bs.renderGroupList = vi.fn();
    bs.refreshBubbleStyleElements = vi.fn();
    bs.updateBubbleSetIfChanged = vi.fn(async () => {});
    bs.redrawBubbleSets = vi.fn(async () => {});
    return bs;
  }

  it("clearManualGroup clears manual + prop and repaints the filter chips", async () => {
    const layout = makeLayout();
    layout.groupOneProps = new Set(["propA"]);
    layout.groupOneManualMembers = new Set(["n3"]);
    const cache = makeCache(layout);
    const bs = wireClear(cache);

    await bs.clearManualGroup("groupOne");

    expect(layout.groupOneManualMembers.size).toBe(0);
    expect(layout.groupOneProps.size).toBe(0);
    expect(cache.uiComponents.refreshGroupChips).toHaveBeenCalledTimes(1);
  });

  it("clearManualGroup leaves the other groups' prop assignments alone", async () => {
    const layout = makeLayout();
    layout.groupOneManualMembers = new Set(["n3"]);
    layout.groupTwoProps = new Set(["propB"]);
    const cache = makeCache(layout);
    const bs = wireClear(cache);

    await bs.clearManualGroup("groupOne");

    expect(layout.groupOneManualMembers.size).toBe(0);
    expect(layout.groupTwoProps).toEqual(new Set(["propB"]));
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
    expect(cache.uiComponents.refreshGroupChips).toHaveBeenCalledTimes(1);
  });
});

// --------------------------------------------------------------------------
// Groups are per-workspace, but the renderer's group state and the
// change-detection baseline are global. Switching to (or creating) a workspace
// that doesn't own a group must evict it, or the layer keeps painting outlines
// the Groups panel doesn't list.
// --------------------------------------------------------------------------
describe("updateBubbleSetIfChanged eviction", () => {
  it("drops layer + baseline state for groups the current workspace lacks", async () => {
    const layout = { filters: new Map(), bubbleSetStyle: {} };
    const cache = makeCache(layout);
    cache.graph.bubbleLayer = { groups: new Map([["groupOne", {}]]), removeGroup: vi.fn() };
    cache.INSTANCES.BUBBLE_GROUPS.groupOne = {};
    cache.lastBubbleSetMembers.set("groupOne", new Set(["n1"]));

    const bs = new GraphBubbleSetManager(cache);
    await bs.updateBubbleSetIfChanged();

    expect(cache.graph.bubbleLayer.removeGroup).toHaveBeenCalledWith("groupOne");
    expect(cache.INSTANCES.BUBBLE_GROUPS.groupOne).toBeUndefined();
    expect(cache.lastBubbleSetMembers.has("groupOne")).toBe(false);
  });

  it("keeps the groups the current workspace does own", async () => {
    const layout = makeLayout();
    const cache = makeCache(layout);
    cache.graph.bubbleLayer = { groups: new Map([["groupOne", {}]]), removeGroup: vi.fn() };
    cache.lastBubbleSetMembers.set("groupOne", new Set());

    const bs = new GraphBubbleSetManager(cache);
    await bs.updateBubbleSetIfChanged();

    expect(cache.graph.bubbleLayer.removeGroup).not.toHaveBeenCalled();
    expect(cache.lastBubbleSetMembers.has("groupOne")).toBe(true);
  });
});
