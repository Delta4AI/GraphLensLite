import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Graph } from '../src/lib/graphology.bundle.mjs';

// ==========================================================================
// Regression: Arrange Selection actions must push the mutated node positions
// to the G6 graph via updateNodeData(). Without that call the layout only
// becomes visible once the selection state changes — see layout.js comment
// above the updateNodeData() call in layoutSelectedNodes().
// ==========================================================================

// Stub Popup before importing layout.js (layout.js imports it eagerly).
vi.mock('../src/utilities/popup.js', () => ({ Popup: {} }));

const { GraphLayoutManager } = await import('../src/graph/layout.js').then((m) => ({
  GraphLayoutManager: m.default || m.GraphLayoutManager || Object.values(m)[0],
}));

function makeNode(id, x, y) {
  return { id, style: { x, y }, states: ['selected'] };
}

// Faithful mock of the sigma adapter's destructive read: getNodeData() syncs
// each ref's style.x/y FROM the backing graphology store (mirroring
// sigma_adapter.getNodeData). updateNodeData() writes the payload back INTO the
// store. This is what makes the regression observable — the old layout.js
// persisted (via getNodeData) before pushing positions, so the read clobbered
// the freshly computed coordinates back to their pre-layout values. A mock that
// returns the mutated refs verbatim (no backing store) hides that bug entirely.
function createMockCache(nodes, edges = []) {
  const nodeRef = new Map(nodes.map((n) => [n.id, n]));
  const positions = new Map();
  const store = new Map(nodes.map((n) => [n.id, { x: n.style.x, y: n.style.y }]));

  const getNodeData = vi.fn(async () => {
    for (const node of nodeRef.values()) {
      const pos = store.get(node.id);
      if (pos) {
        node.style.x = pos.x;
        node.style.y = pos.y;
      }
    }
    return [...nodeRef.values()];
  });

  const cache = {
    nodeRef,
    store,
    selectedNodes: nodes.map((n) => n.id),
    selectedEdges: [],
    layoutChanged: false,
    data: {
      selectedLayout: 'default',
      layouts: {
        default: { positions },
      },
    },
    sm: {
      // Mirror selection.js: read live node data, filter to the selected set.
      getSelectedNodes: async () =>
        (await getNodeData()).filter((n) => n.states?.includes('selected')),
    },
    graph: {
      updateNodeData: vi.fn(async (payload) => {
        for (const item of payload ?? []) {
          const ref = nodeRef.get(item.id);
          if (ref && item.style) Object.assign(ref.style, item.style);
          if (item.style) store.set(item.id, { x: item.style.x, y: item.style.y });
        }
      }),
      getEdgeData: async () => edges,
      getNodeData,
    },
    ui: {
      showLoading: vi.fn(async () => {}),
      debug: vi.fn(),
    },
    gcm: {
      decideToRenderOrDraw: vi.fn(async () => {}),
    },
  };
  return cache;
}

describe('layoutSelectedNodes — syncs positions to the graph', () => {
  let cache, lm;

  const initial = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, c: { x: 0, y: 100 } };

  beforeEach(() => {
    cache = createMockCache([makeNode('a', 0, 0), makeNode('b', 100, 0), makeNode('c', 0, 100)]);
    lm = new GraphLayoutManager(cache);
  });

  for (const action of ['shrink', 'expand', 'circle', 'force', 'grid', 'random']) {
    it(`pushes the post-${action} positions through to the graph store`, async () => {
      await lm.layoutSelectedNodes(action);

      expect(cache.graph.updateNodeData).toHaveBeenCalled();

      // The backing store is the renderer's source of truth. Every node must
      // land at a finite coordinate, and at least one must have actually moved
      // off its pre-layout spot — the old persist-before-push order left the
      // store untouched (silent no-op), which this assertion catches.
      let moved = false;
      for (const id of ['a', 'b', 'c']) {
        const pos = cache.store.get(id);
        expect(Number.isFinite(pos.x)).toBe(true);
        expect(Number.isFinite(pos.y)).toBe(true);
        if (pos.x !== initial[id].x || pos.y !== initial[id].y) moved = true;
      }
      expect(moved).toBe(true);
    });
  }

  it('grid arranges the selection on a centroid-aligned lattice', async () => {
    await lm.layoutSelectedNodes('grid');

    // Centroid of (0,0),(100,0),(0,100) is (33.33, 33.33); 3 nodes → 2 cols,
    // 2 rows, 100px spacing, so the lattice spans 100×100 centered on it.
    const centroid = { x: 100 / 3, y: 100 / 3 };
    const expected = [
      { x: centroid.x - 50, y: centroid.y - 50 },
      { x: centroid.x + 50, y: centroid.y - 50 },
      { x: centroid.x - 50, y: centroid.y + 50 },
    ];
    const got = ['a', 'b', 'c'].map((id) => cache.store.get(id));
    for (let i = 0; i < expected.length; i++) {
      expect(got[i].x).toBeCloseTo(expected[i].x, 5);
      expect(got[i].y).toBeCloseTo(expected[i].y, 5);
    }
  });

  it('circle preserves the selection centroid', async () => {
    await lm.layoutSelectedNodes('circle');

    const avg = ['a', 'b', 'c']
      .map((id) => cache.store.get(id))
      .reduce((s, p) => ({ x: s.x + p.x / 3, y: s.y + p.y / 3 }), { x: 0, y: 0 });
    expect(avg.x).toBeCloseTo(100 / 3, 4);
    expect(avg.y).toBeCloseTo(100 / 3, 4);
  });

  it("persists the new positions to the active layout's position map", async () => {
    await lm.layoutSelectedNodes('grid');

    const stored = cache.data.layouts.default.positions;
    expect(stored.size).toBe(3);
    for (const id of ['a', 'b', 'c']) {
      const pos = cache.store.get(id);
      expect(stored.get(id).style.x).toBeCloseTo(pos.x, 5);
      expect(stored.get(id).style.y).toBeCloseTo(pos.y, 5);
    }
  });

  it('triggers a redraw via gcm.decideToRenderOrDraw', async () => {
    await lm.layoutSelectedNodes('circle');
    expect(cache.gcm.decideToRenderOrDraw).toHaveBeenCalledTimes(1);
    expect(cache.layoutChanged).toBe(true);
  });

  it('is a no-op when nothing is selected', async () => {
    cache.selectedNodes = [];
    cache.sm.getSelectedNodes = async () => [];

    await lm.layoutSelectedNodes('force');

    expect(cache.graph.updateNodeData).not.toHaveBeenCalled();
    expect(cache.gcm.decideToRenderOrDraw).not.toHaveBeenCalled();
  });
});

describe('removeNodeOverlaps — noverlap on the live graphology model', () => {
  let cache, lm;

  /** Mirror the adapter: getNodeData syncs nodeRef styles from graphology. */
  function wireGraphData(nodes, graphData) {
    cache.graphData = graphData;
    cache.graph.getNodeData = async () => {
      for (const node of nodes) {
        const attrs = graphData.getNodeAttributes(node.id);
        node.style.x = attrs.x;
        node.style.y = attrs.y;
      }
      return nodes;
    };
  }

  beforeEach(() => {
    cache = createMockCache([makeNode('a', 0, 0), makeNode('b', 0, 0)]);
    lm = new GraphLayoutManager(cache);
  });

  it('separates overlapping nodes, persists positions and redraws', async () => {
    // Arrange: two same-spot nodes on the live graphology instance.
    const graphData = new Graph();
    graphData.addNode('a', { x: 0, y: 0, size: 10 });
    graphData.addNode('b', { x: 0, y: 0, size: 10 });
    wireGraphData([...cache.nodeRef.values()], graphData);

    // Act
    await lm.removeNodeOverlaps();

    // Assert: graphology positions separated by ≥ combined size + margin.
    const a = graphData.getNodeAttributes('a');
    const b = graphData.getNodeAttributes('b');
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(10 + 10 + 5);

    // Moved positions are persisted to the active layout's position map.
    const stored = cache.data.layouts.default.positions;
    expect(stored.get('a').style).toEqual({ x: a.x, y: a.y });
    expect(stored.get('b').style).toEqual({ x: b.x, y: b.y });

    // And the standard layout-change pipeline ran.
    expect(cache.gcm.decideToRenderOrDraw).toHaveBeenCalledTimes(1);
    expect(cache.layoutChanged).toBe(true);
  });

  it('is a no-op without a graph model or with fewer than two nodes', async () => {
    // Arrange + Act: no graphData at all.
    cache.graphData = null;
    await lm.removeNodeOverlaps();

    // Arrange + Act: single-node graph.
    const single = new Graph();
    single.addNode('a', { x: 3, y: 4, size: 10 });
    wireGraphData([cache.nodeRef.get('a')], single);
    await lm.removeNodeOverlaps();

    // Assert: untouched position, no persist, no redraw.
    expect(single.getNodeAttributes('a')).toMatchObject({ x: 3, y: 4 });
    expect(cache.data.layouts.default.positions.size).toBe(0);
    expect(cache.gcm.decideToRenderOrDraw).not.toHaveBeenCalled();
  });
});
