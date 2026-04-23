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
      filterDefaults: new Map([
        ["Node filters::G::a", {
          isCategory: true,
          categories: new Set(["x", "y"]),
          lowerThreshold: Infinity,
          upperThreshold: -Infinity,
          hasFloatValues: false,
        }],
        ["Node filters::G::b", {
          isCategory: false,
          categories: new Set(),
          lowerThreshold: 0,
          upperThreshold: 1.3,
          hasFloatValues: true,
        }],
      ]),
    },
    nodeRef: new Map([
      ["n1", {
        label: "Alpha",
        D4Data: {
          "Node filters": {
            G: { a: "x", b: 0.75 },
            Meta: { tag: null, note: "" },
          },
        },
      }],
      ["n2", {
        label: "Beta",
        D4Data: { "Node filters": { G: { a: "y", b: 0.2 } } },
      }],
    ]),
    edgeRef: new Map([
      ["e1", {
        label: "link",
        source: "n1",
        target: "n2",
        D4Data: { "Edge filters": { Interaction: { Score: 0.9 } } },
      }],
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

  it("annotates categorical properties with their values", () => {
    const snap = buildContextSnapshot(makeCache(), { readActions: () => [] });
    const a = snap.properties.hierarchy["Node filters"].G.a;
    expect(a.type).toBe("categorical");
    expect(a.values.sort()).toEqual(["x", "y"]);
    expect(a.truncated).toBeUndefined();
  });

  it("annotates numeric properties with min/max and integer flag", () => {
    const snap = buildContextSnapshot(makeCache(), { readActions: () => [] });
    const b = snap.properties.hierarchy["Node filters"].G.b;
    expect(b).toEqual({ type: "numeric", min: 0, max: 1.3, integer: false });
  });

  it("caps categorical values at 50 and marks truncation", () => {
    const big = Array.from({ length: 120 }, (_, i) => `v${i}`);
    const cache = makeCache({
      data: {
        selectedLayout: "main",
        layouts: { main: { filters: new Map(), hideDisconnectedNodes: false, query: null } },
        filterDefaults: new Map([
          ["Node filters::G::a", {
            isCategory: true,
            categories: new Set(big),
            lowerThreshold: Infinity,
            upperThreshold: -Infinity,
            hasFloatValues: false,
          }],
          ["Node filters::G::b", {
            isCategory: false,
            categories: new Set(),
            lowerThreshold: 0,
            upperThreshold: 1,
            hasFloatValues: false,
          }],
        ]),
      },
    });
    const snap = buildContextSnapshot(cache, { readActions: () => [] });
    const a = snap.properties.hierarchy["Node filters"].G.a;
    expect(a.values).toHaveLength(50);
    expect(a.truncated).toBe(true);
    expect(a.totalValues).toBe(120);
  });

  it("falls back to type:'unknown' when filterDefaults has no entry", () => {
    const cache = makeCache({
      data: {
        selectedLayout: "main",
        layouts: { main: { filters: new Map(), hideDisconnectedNodes: false, query: null } },
        filterDefaults: new Map(),
      },
    });
    const snap = buildContextSnapshot(cache, { readActions: () => [] });
    expect(snap.properties.hierarchy["Node filters"].G.a).toEqual({ type: "unknown" });
    expect(snap.properties.hierarchy["Node filters"].G.b).toEqual({ type: "unknown" });
  });

  it("tolerates a missing filterDefaults entirely", () => {
    const cache = makeCache({
      data: {
        selectedLayout: "main",
        layouts: { main: { filters: new Map(), hideDisconnectedNodes: false, query: null } },
      },
    });
    const snap = buildContextSnapshot(cache, { readActions: () => [] });
    expect(snap.properties.hierarchy["Node filters"].G.a).toEqual({ type: "unknown" });
  });

  it("flattens D4Data properties onto each selected node", () => {
    const snap = buildContextSnapshot(makeCache(), { readActions: () => [] });
    const alpha = snap.selection.nodes.find(n => n.id === "n1");
    expect(alpha.properties).toEqual({
      "Node filters::G::a": "x",
      "Node filters::G::b": 0.75,
    });
    // Null / empty-string props are dropped.
    expect(alpha.properties["Node filters::Meta::tag"]).toBeUndefined();
    expect(alpha.properties["Node filters::Meta::note"]).toBeUndefined();
  });

  it("attaches properties to selected edges when budget allows", () => {
    const snap = buildContextSnapshot(makeCache(), { readActions: () => [] });
    const link = snap.selection.edges.find(e => e.id === "e1");
    expect(link.properties).toEqual({
      "Edge filters::Interaction::Score": 0.9,
    });
  });

  it("marks oversize entries as truncated but still admits smaller ones that fit", () => {
    // n1 alone blows the 6000-char budget; n2 has tiny props and should
    // still land because the loop only consumes budget on successful attach.
    const bigBlob = "x".repeat(7000);
    const cache = makeCache({
      data: {
        selectedLayout: "main",
        layouts: { main: { filters: new Map(), hideDisconnectedNodes: false, query: null } },
        filterDefaults: new Map(),
      },
      nodeRef: new Map([
        ["n1", { label: "Big", D4Data: { "Node filters": { G: { a: bigBlob } } } }],
        ["n2", { label: "Next", D4Data: { "Node filters": { G: { a: "y" } } } }],
      ]),
      selectedNodes: new Set(["n1", "n2"]),
    });
    const snap = buildContextSnapshot(cache, { readActions: () => [] });
    const byId = Object.fromEntries(snap.selection.nodes.map(n => [n.id, n]));
    expect(byId.n1.truncated).toBe(true);
    expect(byId.n1.properties).toBeUndefined();
    expect(byId.n2.properties).toEqual({ "Node filters::G::a": "y" });
    expect(byId.n2.truncated).toBeUndefined();
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
