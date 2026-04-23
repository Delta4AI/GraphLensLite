import { describe, it, expect } from "vitest";
import { buildContextSnapshot, serializeSnapshot } from "../src/managers/assistant/context.js";

function makeCache(overrides = {}) {
  const base = {
    initialized: true,
    VERSION: "1.12.0",
    CFG: { ASSISTANT: { MAX_CONTEXT_NODES: 3, MAX_STATUS_LOG_LINES: 5 } },
    data: {
      selectedLayout: "main",
      layouts: {
        main: {
          filters: new Map([
            ["Node filters::G::a", { active: true }],
            ["Node filters::G::b", { active: false }],
          ]),
          hideDisconnectedNodes: true,
          query: null,
        },
      },
    },
    nodeRef: new Map([
      ["n1", { label: "Alpha" }],
      ["n2", { label: "Beta" }],
    ]),
    edgeRef: new Map([
      ["e1", { label: "link", source: "n1", target: "n2" }],
    ]),
    nodeIDsToBeShown: new Set(["n1", "n2"]),
    edgeIDsToBeShown: new Set(["e1"]),
    selectedNodes: new Set(["n1", "n2", "n3", "n4"]),
    selectedEdges: new Set(["e1"]),
    hiddenDanglingNodeIDs: new Set(),
    lastBubbleSetMembers: new Map([["groupOne", new Set(["n1"])]]),
    uniquePropHierarchy: {
      "Node filters": { G: new Set(["a", "b"]) },
    },
    query: { text: "Node filters::G::a IN [x]", valid: true },
    metrics: { selected: "degree", metricValueCache: new Map([["degree", {}]]) },
  };
  return { ...base, ...overrides };
}

describe("buildContextSnapshot", () => {
  it("returns a lightweight placeholder when no graph is loaded", () => {
    const snap = buildContextSnapshot({ initialized: false }, { readActions: () => [] });
    expect(snap).toEqual({ state: "no graph loaded" });
  });

  it("caps selection samples at MAX_CONTEXT_NODES", () => {
    const snap = buildContextSnapshot(makeCache(), { readActions: () => [] });
    expect(snap.selection.nodes).toHaveLength(3);
    expect(snap.counts.selectedNodes).toBe(4);
  });

  it("includes only active filters in activeFilterProps", () => {
    const snap = buildContextSnapshot(makeCache(), { readActions: () => [] });
    expect(snap.filters.activeFilterProps).toEqual(["Node filters::G::a"]);
  });

  it("serializes property hierarchy as plain arrays", () => {
    const snap = buildContextSnapshot(makeCache(), { readActions: () => [] });
    expect(snap.properties.hierarchy["Node filters"].G).toEqual(["a", "b"]);
  });

  it("injects recentActions from the read-actions callback", () => {
    const snap = buildContextSnapshot(makeCache(), { readActions: () => ["loaded graph", "selected 2"] });
    expect(snap.recentActions).toEqual(["loaded graph", "selected 2"]);
  });
});

describe("serializeSnapshot", () => {
  it("returns the full JSON when under the cap", () => {
    const out = serializeSnapshot({ a: 1 }, 1000);
    expect(JSON.parse(out)).toEqual({ a: 1 });
  });

  it("truncates oversize payloads with a marker", () => {
    const big = { data: "x".repeat(2000) };
    const out = serializeSnapshot(big, 200);
    expect(out.length).toBeLessThan(300);
    expect(out).toMatch(/truncated: snapshot exceeded 200 chars/);
  });
});
