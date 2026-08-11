// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { UIManager } from "../src/managers/ui.js";
import { GraphBubbleSetManager } from "../src/graph/bubble_sets.js";

// ==========================================================================
// UX rework: selection-driven styling-card expansion + per-group bubble clear.
// These cover the wiring added when "Detect" became "Auto-group" and group
// clearing went from all-or-nothing to per-group badges.
// ==========================================================================

// --- helpers ---------------------------------------------------------------

// Build the styling panel DOM the way createStyleDiv/makeCollapsible leaves it:
// each card is [data-label] with a collapse header (chevron + aria-expanded).
function mountCard(parent, label, collapsed) {
  const card = document.createElement("div");
  card.className = "card-labeled card-collapsible" + (collapsed ? " collapsed" : "");
  card.setAttribute("data-label", label);
  const header = document.createElement("button");
  header.className = "card-collapse-header";
  header.setAttribute("aria-expanded", collapsed ? "false" : "true");
  const chevron = document.createElement("span");
  chevron.className = "card-collapse-chevron";
  chevron.textContent = collapsed ? "▸" : "▾";
  header.append(chevron);
  card.append(header);
  parent.append(card);
  return card;
}

function mountStylingPanel({ node = true, edge = false, bubble = false } = {}) {
  document.body.innerHTML = "";
  const content = document.createElement("div");
  content.id = "stylingPanelContent";
  document.body.append(content);
  return {
    node: mountCard(content, "Node Configuration", !node),
    edge: mountCard(content, "Edge Configuration", !edge),
    bubble: mountCard(content, "Bubble Sets", !bubble),
  };
}

function uiInstance() {
  // Methods under test only touch document + this.expandStylingCard, so a
  // prototype-only instance avoids the heavy UIManager constructor.
  return Object.create(UIManager.prototype);
}

const isOpen = (card) => !card.classList.contains("collapsed");

// --- expandStylingCard -----------------------------------------------------

describe("UIManager.expandStylingCard", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("opens a collapsed card and syncs chevron + aria", () => {
    const cards = mountStylingPanel({ node: false }); // node starts collapsed
    uiInstance().expandStylingCard("Node Configuration");
    expect(isOpen(cards.node)).toBe(true);
    expect(cards.node.querySelector(".card-collapse-chevron").textContent).toBe("▾");
    expect(cards.node.querySelector(".card-collapse-header").getAttribute("aria-expanded")).toBe("true");
  });

  it("is additive: leaves an already-open card untouched (never closes)", () => {
    const cards = mountStylingPanel({ node: true });
    const chevron = cards.node.querySelector(".card-collapse-chevron");
    chevron.textContent = "CUSTOM"; // prove the method doesn't rewrite open cards
    uiInstance().expandStylingCard("Node Configuration");
    expect(isOpen(cards.node)).toBe(true);
    expect(chevron.textContent).toBe("CUSTOM");
  });

  it("ignores an unknown label without throwing", () => {
    mountStylingPanel();
    expect(() => uiInstance().expandStylingCard("Nope")).not.toThrow();
  });

  it("no-ops when the styling panel is absent", () => {
    document.body.innerHTML = "";
    expect(() => uiInstance().expandStylingCard("Node Configuration")).not.toThrow();
  });
});

// --- syncStylingCardsToSelection -------------------------------------------

describe("UIManager.syncStylingCardsToSelection", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("opens only the Edge card when edges are selected and nodes are not", () => {
    const cards = mountStylingPanel({ node: false, edge: false });
    uiInstance().syncStylingCardsToSelection(false, true);
    expect(isOpen(cards.edge)).toBe(true);
    expect(isOpen(cards.node)).toBe(false);
  });

  it("opens only the Node card when nodes are selected and edges are not", () => {
    const cards = mountStylingPanel({ node: false, edge: false });
    uiInstance().syncStylingCardsToSelection(true, false);
    expect(isOpen(cards.node)).toBe(true);
    expect(isOpen(cards.edge)).toBe(false);
  });

  it("opens both cards when nodes and edges are selected", () => {
    const cards = mountStylingPanel({ node: false, edge: false });
    uiInstance().syncStylingCardsToSelection(true, true);
    expect(isOpen(cards.node)).toBe(true);
    expect(isOpen(cards.edge)).toBe(true);
  });

  it("opens nothing when neither is selected", () => {
    const cards = mountStylingPanel({ node: false, edge: false });
    uiInstance().syncStylingCardsToSelection(false, false);
    expect(isOpen(cards.node)).toBe(false);
    expect(isOpen(cards.edge)).toBe(false);
  });
});

// --- bubble group: clearing one group --------------------------------------

function bsInstance(layout) {
  const bs = Object.create(GraphBubbleSetManager.prototype);
  bs.cache = {
    data: { selectedLayout: "L1", layouts: { L1: layout } },
    graph: { draw: vi.fn().mockResolvedValue(undefined) },
    bubbleSetChanged: false,
  };
  // Stop the redraw pipeline at the manager boundary.
  bs.updateBubbleSetIfChanged = vi.fn().mockResolvedValue(undefined);
  bs.redrawBubbleSets = vi.fn().mockResolvedValue(undefined);
  bs.refreshBubbleStyleElements = vi.fn();
  bs.syncGroupRows = vi.fn();
  bs.renderGroupList = vi.fn();
  return bs;
}

describe("GraphBubbleSetManager.clearManualGroup", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("empties the targeted group and leaves the others intact", async () => {
    const layout = {
      groupAManualMembers: new Set(["n1", "n2"]),
      groupBManualMembers: new Set(["n3"]),
    };
    const bs = bsInstance(layout);

    await bs.clearManualGroup("groupA");

    expect(layout.groupAManualMembers.size).toBe(0);
    expect(layout.groupBManualMembers.size).toBe(1);
  });

  it("marks bubble sets changed and redraws", async () => {
    const layout = { groupAManualMembers: new Set(["n1"]) };
    const bs = bsInstance(layout);

    await bs.clearManualGroup("groupA");

    expect(bs.cache.bubbleSetChanged).toBe(true);
    expect(bs.updateBubbleSetIfChanged).toHaveBeenCalled();
    expect(bs.cache.graph.draw).toHaveBeenCalled();
  });

  it("tolerates a group that has no member set", async () => {
    const bs = bsInstance({});
    await expect(bs.clearManualGroup("ghost")).resolves.toBeUndefined();
    expect(bs.cache.graph.draw).toHaveBeenCalled();
  });
});
