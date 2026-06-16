// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --------------------------------------------------------------------------
// Regression: "hide disconnected nodes" must survive filter changes.
//
// Bug: preRenderEvent rebuilt nodeIDsToBeShown purely from filters while the
// dangling set was a separate, stale layer. A previously-hidden dangling node
// that still passed the filter landed in BOTH idsToShow and idsToHide, and
// updateElementVisibility's show-then-hide diff resurfaced it on every filter
// change. Newly-dangling nodes (whose only edge got filtered out) were never
// detected either. Fix: recompute the dangling set against the fresh filtered
// view inside preRenderEvent and exclude it from idsToShow.
// --------------------------------------------------------------------------

const { GraphCoreManager } = await import('../src/graph/core.js');

// A node/edge the AST "passes" — no real features, so testNode is never
// consulted (features.size === 0 short-circuits to always-visible). We drive
// connectivity purely through the adjacency maps below.
function makeNode(id) {
  return { id, features: new Set(), featureIsWithinThreshold: new Map() };
}
// Edges carry a feature so the AST's testEdge actually gates them — a
// featureless edge is unconditionally visible (preRenderEvent short-circuit).
function makeEdge(id, source, target) {
  return {
    id,
    source,
    target,
    features: new Set(['weight']),
    featureIsWithinThreshold: new Map(),
  };
}

// Build a cache whose visible edge set is dictated by `visibleEdgeIds`, so a
// "filter change" is modelled as flipping which edges pass.
function makeCache({ nodes, edges, hideDisconnected, visibleEdgeIds }) {
  const nodeRef = new Map(nodes.map((n) => [n.id, n]));
  const edgeRef = new Map(edges.map((e) => [e.id, e]));

  const nodeIDToEdgeIDs = new Map(nodes.map((n) => [n.id, new Set()]));
  const edgeIDToNodeIDs = new Map();
  for (const e of edges) {
    edgeIDToNodeIDs.set(e.id, new Set([e.source, e.target]));
    nodeIDToEdgeIDs.get(e.source).add(e.id);
    nodeIDToEdgeIDs.get(e.target).add(e.id);
  }

  const captured = {};
  return {
    cache: {
      styleChanged: false,
      bubbleSetChanged: false,
      EVENT_LOCKS: {
        QUERY_UPDATE_EVENT: false,
        FILTERS_LOCKED_BY_MANUAL_QUERY: false,
      },
      data: {
        selectedLayout: 'Default',
        layouts: { Default: { hideDisconnectedNodes: hideDisconnected } },
      },
      nodeRef,
      edgeRef,
      nodeIDToEdgeIDs,
      edgeIDToNodeIDs,
      nodeIDsToBeShown: new Set(),
      edgeIDsToBeShown: new Set(),
      propIDsToNodeIDsToBeShown: new Map(),
      propIDsToEdgeIDsToBeShown: new Map(),
      remainingEdgeRelatedNodes: new Set(),
      hiddenDanglingNodeIDs: new Set(),
      hiddenDanglingEdgeIDs: new Set(),
      qm: {
        resetQuery: vi.fn(),
        decodeQueryAndBuildAST: vi.fn(),
        storeQuery: vi.fn(),
      },
      // No node features -> testNode never runs; edges pass only if listed.
      query: {
        ast: {
          testNode: () => true,
          testEdge: (edge) => visibleEdgeIds.has(edge.id),
        },
      },
      fm: {
        resetFeatureIsWithinThresholdMaps: vi.fn(),
        updateElementVisibility: vi.fn(async (idsToShow, idsToHide) => {
          captured.idsToShow = idsToShow;
          captured.idsToHide = idsToHide;
        }),
      },
      bs: { updateBubbleSetIfChanged: vi.fn(async () => {}) },
    },
    captured,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('hide disconnected nodes survives filter changes', () => {
  // n1-n2 connected via e1; n3 has no edges (always dangling).
  const baseGraph = () => ({
    nodes: [makeNode('n1'), makeNode('n2'), makeNode('n3')],
    edges: [makeEdge('e1', 'n1', 'n2')],
  });

  it('hides the disconnected node and excludes it from idsToShow', async () => {
    const { cache, captured } = makeCache({
      ...baseGraph(),
      hideDisconnected: true,
      visibleEdgeIds: new Set(['e1']),
    });
    const gcm = new GraphCoreManager(cache);

    await gcm.preRenderEvent();

    expect(cache.hiddenDanglingNodeIDs.has('n3')).toBe(true);
    expect(captured.idsToShow).not.toContain('n3');
    expect(captured.idsToShow).toEqual(expect.arrayContaining(['n1', 'n2', 'e1']));
    expect(captured.idsToHide).toContain('n3');
  });

  it('never lists the same id in both idsToShow and idsToHide', async () => {
    const { cache, captured } = makeCache({
      ...baseGraph(),
      hideDisconnected: true,
      visibleEdgeIds: new Set(['e1']),
    });
    const gcm = new GraphCoreManager(cache);

    // First pass hides n3. Second pass models a subsequent filter change.
    await gcm.preRenderEvent();
    await gcm.preRenderEvent();

    const overlap = captured.idsToShow.filter((id) => captured.idsToHide.includes(id));
    expect(overlap).toEqual([]);
    expect(captured.idsToShow).not.toContain('n3');
  });

  it('re-detects nodes that become dangling after a filter removes their edge', async () => {
    // Start with e1 visible: n1, n2 connected, only n3 dangling.
    const graph = baseGraph();
    const { cache, captured } = makeCache({
      ...graph,
      hideDisconnected: true,
      visibleEdgeIds: new Set(['e1']),
    });
    const gcm = new GraphCoreManager(cache);
    await gcm.preRenderEvent();
    expect(cache.hiddenDanglingNodeIDs).toEqual(new Set(['n3']));

    // Filter change: e1 no longer passes -> n1 and n2 are now dangling too.
    cache.query.ast.testEdge = () => false;
    await gcm.preRenderEvent();

    expect(cache.hiddenDanglingNodeIDs).toEqual(new Set(['n1', 'n2', 'n3']));
    expect(captured.idsToShow).toEqual([]);
  });

  it('shows everything again once the flag is turned off', async () => {
    const { cache, captured } = makeCache({
      ...baseGraph(),
      hideDisconnected: true,
      visibleEdgeIds: new Set(['e1']),
    });
    const gcm = new GraphCoreManager(cache);
    await gcm.preRenderEvent();
    expect(cache.hiddenDanglingNodeIDs.has('n3')).toBe(true);

    // User clears the toggle, then changes a filter.
    cache.data.layouts.Default.hideDisconnectedNodes = false;
    await gcm.preRenderEvent();

    expect(cache.hiddenDanglingNodeIDs.size).toBe(0);
    expect(captured.idsToShow).toContain('n3');
    expect(captured.idsToHide).not.toContain('n3');
  });
});
