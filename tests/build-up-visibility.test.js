// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { visibilityRule } from '../src/graph/visibility_rule.js';

// ==========================================================================
// Build up vs narrow down. Build up (the OR join) starts from nothing: every
// ticked row adds what it matches, so nothing ticked shows nothing, and links
// between the shown nodes follow an explicit All / Only ticked / None choice.
// Narrow down (AND) is unchanged. Elements without properties follow their own
// switch in both modes.
// ==========================================================================

const { GraphCoreManager } = await import('../src/graph/core.js');
const { IOManager } = await import('../src/managers/io.js');

const NODE_P = 'Node filters::g::type';
const EDGE_P = 'Edge filters::g::kind';

const node = (id, props = []) => ({ id, features: new Set(props), featureIsWithinThreshold: new Map() });
const edge = (id, source, target, props = [EDGE_P]) => ({
  id,
  source,
  target,
  features: new Set(props),
  featureIsWithinThreshold: new Map(),
});

/**
 * p1, p2 carry the node property; bare has none. e1 p1–p2 and e2 p2–bare carry
 * the edge property; plain links p1–bare without any property. The AST
 * matches nodes and edges by id, standing in for whatever the rows say.
 */
function run(layout, { nodeMatches = [], edgeMatches = [] } = {}) {
  const nodes = [node('p1', [NODE_P]), node('p2', [NODE_P]), node('bare')];
  const edges = [edge('e1', 'p1', 'p2'), edge('e2', 'p2', 'bare'), edge('plain', 'p1', 'bare', [])];
  const cache = {
    CFG: { EXCEL_EDGE_HEADER: 'Edge filters' },
    EVENT_LOCKS: {},
    data: { selectedLayout: 'L', layouts: { L: { filters: new Map(), ...layout } } },
    nodeRef: new Map(nodes.map((n) => [n.id, n])),
    edgeRef: new Map(edges.map((e) => [e.id, e])),
    hiddenDanglingNodeIDs: new Set(),
    hiddenDanglingEdgeIDs: new Set(),
    qm: { resetQuery: vi.fn(), decodeQueryAndBuildAST: vi.fn(), storeQuery: vi.fn() },
    query: {
      ast: {
        testNode: (n) => nodeMatches.includes(n.id),
        testEdge: (e) => edgeMatches.includes(e.id),
      },
    },
    fm: { resetFeatureIsWithinThresholdMaps: vi.fn(), updateElementVisibility: vi.fn(async () => {}) },
    bs: { updateBubbleSetIfChanged: vi.fn(async () => {}) },
  };
  return new GraphCoreManager(cache).preRenderEvent().then(() => ({
    nodes: [...cache.nodeIDsToBeShown].sort(),
    edges: [...cache.edgeIDsToBeShown].sort(),
  }));
}

const ticked = (...props) => new Map(props.map((p) => [p, { active: true }]));

describe('visibilityRule', () => {
  it('counts ticked rows per section and knows when nothing is ticked', () => {
    const rule = visibilityRule({ filters: ticked(NODE_P) }, 'Edge filters');
    expect(rule).toMatchObject({ buildUp: true, nothingTicked: false, tickedNodeRows: 1, tickedEdgeRows: 0 });
    expect(visibilityRule({ filters: new Map() }, 'Edge filters').nothingTicked).toBe(true);
  });

  it('leaves a hand-typed query and narrow-down alone', () => {
    expect(visibilityRule({ filters: new Map(), query: 'x' }, 'Edge filters').nothingTicked).toBe(false);
    expect(visibilityRule({ filters: new Map(), filterJoinMode: 'AND' }, 'Edge filters').nothingTicked).toBe(false);
  });
});

describe('build up', () => {
  it('shows only elements without properties when nothing is ticked, and nothing once those are off', async () => {
    expect(await run({}, { nodeMatches: ['p1', 'p2'], edgeMatches: ['e1', 'e2'] })).toEqual({
      nodes: ['bare'],
      edges: [],
    });
    expect(await run({ includePropertyless: false }, { nodeMatches: ['p1', 'p2'] })).toEqual({
      nodes: [],
      edges: [],
    });
  });

  it('All links: a ticked node row shows its nodes and every link between them', async () => {
    const shown = await run({ filters: ticked(NODE_P), includePropertyless: false }, { nodeMatches: ['p1', 'p2'] });
    // e1 shows although no edge row matched it.
    expect(shown).toEqual({ nodes: ['p1', 'p2'], edges: ['e1'] });
  });

  it('Only ticked: just the links an edge row matches, which bring their end nodes', async () => {
    const shown = await run(
      { filters: ticked(EDGE_P), filterLinks: 'ticked', includePropertyless: false },
      { edgeMatches: ['e2'] },
    );
    expect(shown).toEqual({ nodes: ['bare', 'p2'], edges: ['e2'] });
  });

  it('None: the nodes without any link', async () => {
    const shown = await run({ filters: ticked(NODE_P), filterLinks: 'none' }, { nodeMatches: ['p1', 'p2'] });
    expect(shown).toEqual({ nodes: ['bare', 'p1', 'p2'], edges: [] });
  });
});

describe('narrow down', () => {
  it('still filters links by the query', async () => {
    const shown = await run({ filterJoinMode: 'AND' }, { nodeMatches: ['p1', 'p2'], edgeMatches: [] });
    expect(shown).toEqual({ nodes: ['bare', 'p1', 'p2'], edges: ['plain'] });
  });
});

describe('files saved before build-up', () => {
  const io = new IOManager({});
  const file = (version, layout) => ({ version, layouts: { W: layout } });

  it('tick every row of an OR workspace that had none ticked, so it still shows the full graph', () => {
    const old = file('1.17.1', { filters: { [NODE_P]: { active: false }, [EDGE_P]: { active: false } } });
    io.keepPreBuildUpWorkspacesFull(old);
    expect(Object.values(old.layouts.W.filters).every((f) => f.active)).toBe(true);
  });

  it('leave newer files, narrow-down workspaces and workspaces with a ticked row as they are', () => {
    const current = file('1.18.0', { filters: { [NODE_P]: { active: false } } });
    const and = file('1.17.1', { filterJoinMode: 'AND', filters: { [NODE_P]: { active: false } } });
    const some = file('1.17.1', { filters: { [NODE_P]: { active: true }, [EDGE_P]: { active: false } } });
    for (const f of [current, and, some]) io.keepPreBuildUpWorkspacesFull(f);
    expect(current.layouts.W.filters[NODE_P].active).toBe(false);
    expect(and.layouts.W.filters[NODE_P].active).toBe(false);
    expect(some.layouts.W.filters[EDGE_P].active).toBe(false);
  });
});
