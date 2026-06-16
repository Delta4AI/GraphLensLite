import { describe, it, expect } from 'vitest'
import { detectCommunities } from '../src/graph/communities.js'

// ==========================================================================
// Louvain community detection (pure, node-safe part of "Detect communities").
// The DOM-bound application path (manual bubble-group members) lives in
// bubble_sets.js and is exercised in the browser, consistent with repo
// practice for manager glue.
// ==========================================================================

const GROUPS = ['groupOne', 'groupTwo', 'groupThree', 'groupFour']

// Helper: build a minimal cache-like object (same shape as metrics.test.js).
// Edge ids carry an index suffix so parallel (multi) edges stay distinct.
function makeCache(nodeIds, edges) {
  const nodeIDsToBeShown = new Set(nodeIds)
  const edgeRef = new Map()
  const edgeIDsToBeShown = new Set()

  // edges: [source, target] or [source, target, weight]. A weight is exposed
  // the same way real edges carry numeric props: edge.featureValues.get('w').
  edges.forEach(([source, target, weight], i) => {
    const id = `${source}::${target}::${i}`
    edgeIDsToBeShown.add(id)
    const edge = { source, target }
    if (weight !== undefined) edge.featureValues = new Map([['w', weight]])
    edgeRef.set(id, edge)
  })

  return { nodeIDsToBeShown, edgeIDsToBeShown, edgeRef }
}

// Helper: all node pairs of a clique as edges.
function cliqueEdges(nodeIds) {
  const edges = []
  for (let i = 0; i < nodeIds.length; i++) {
    for (let j = i + 1; j < nodeIds.length; j++) {
      edges.push([nodeIds[i], nodeIds[j]])
    }
  }
  return edges
}

describe('detectCommunities — degenerate input guards', () => {
  it('returns null for an empty graph', () => {
    const cache = makeCache([], [])
    expect(detectCommunities(cache, GROUPS)).toBeNull()
  })

  it('returns null when there are nodes but no edges', () => {
    const cache = makeCache(['a', 'b', 'c'], [])
    expect(detectCommunities(cache, GROUPS)).toBeNull()
  })
})

describe('detectCommunities — community structure', () => {
  it('finds two communities for two cliques joined by a bridge', () => {
    // 5-clique and 4-clique joined by a single bridge edge: unequal sizes
    // make the largest-first ordering assertable.
    const big = ['b1', 'b2', 'b3', 'b4', 'b5']
    const small = ['s1', 's2', 's3', 's4']
    const cache = makeCache(
      [...big, ...small],
      [...cliqueEdges(big), ...cliqueEdges(small), ['b1', 's1']]
    )

    const result = detectCommunities(cache, GROUPS)
    expect(result.communityCount).toBe(2)
    expect(result.assignments.get('groupOne')).toEqual(new Set(big))
    expect(result.assignments.get('groupTwo')).toEqual(new Set(small))
  })

  it('leaves groups beyond the community count empty', () => {
    const cache = makeCache(
      ['a', 'b', 'c', 'x', 'y', 'z'],
      [...cliqueEdges(['a', 'b', 'c']), ...cliqueEdges(['x', 'y', 'z'])]
    )

    const result = detectCommunities(cache, GROUPS)
    expect(result.communityCount).toBe(2)
    expect(result.assignments.get('groupThree')).toEqual(new Set())
    expect(result.assignments.get('groupFour')).toEqual(new Set())
  })

  it('assigns exactly the top-4 communities by size, largest first, when more than 4 exist', () => {
    // Six disconnected cliques of strictly decreasing size → six communities.
    const cliques = [
      ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'],
      ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'],
      ['c1', 'c2', 'c3', 'c4', 'c5'],
      ['d1', 'd2', 'd3', 'd4'],
      ['e1', 'e2', 'e3'],
      ['f1', 'f2'],
    ]
    const cache = makeCache(cliques.flat(), cliques.flatMap(cliqueEdges))

    const result = detectCommunities(cache, GROUPS)
    expect(result.communityCount).toBe(6)

    expect(result.assignments.size).toBe(4)
    expect(result.assignments.get('groupOne')).toEqual(new Set(cliques[0]))
    expect(result.assignments.get('groupTwo')).toEqual(new Set(cliques[1]))
    expect(result.assignments.get('groupThree')).toEqual(new Set(cliques[2]))
    expect(result.assignments.get('groupFour')).toEqual(new Set(cliques[3]))

    // Members of the 5th and 6th community stay unassigned.
    const assigned = new Set([...result.assignments.values()].flatMap(set => [...set]))
    for (const node of [...cliques[4], ...cliques[5]]) {
      expect(assigned.has(node)).toBe(false)
    }
  })

  it('handles parallel (multi) edges in the visible subgraph', () => {
    const cache = makeCache(
      ['a', 'b', 'c', 'x', 'y', 'z'],
      [
        ...cliqueEdges(['a', 'b', 'c']),
        ['a', 'b'], // parallel edge
        ...cliqueEdges(['x', 'y', 'z']),
        ['c', 'x'], // bridge
      ]
    )

    const result = detectCommunities(cache, GROUPS)
    expect(result.communityCount).toBe(2)
    expect(result.assignments.get('groupOne')).toEqual(new Set(['a', 'b', 'c']))
    expect(result.assignments.get('groupTwo')).toEqual(new Set(['x', 'y', 'z']))
  })
})

describe('detectCommunities — edge weighting', () => {
  const A = ['a1', 'a2', 'a3']
  const B = ['b1', 'b2', 'b3']
  // K6: every A-B pair also connected, so the two triangles are topologically
  // invisible. Heavy intra-triangle weights + light cross weights make the
  // structure visible ONLY to a weighted run.
  const weightedClique = (ns, w) => cliqueEdges(ns).map(([s, t]) => [s, t, w])
  const crossEdges = (w) => A.flatMap((a) => B.map((b) => [a, b, w]))
  const k6 = [...weightedClique(A, 10), ...weightedClique(B, 10), ...crossEdges(0.1)]

  it('finds no structure in a complete graph when unweighted', () => {
    const cache = makeCache([...A, ...B], k6)
    expect(detectCommunities(cache, GROUPS).communityCount).toBe(1)
  })

  it('recovers the two heavy triangles when weighted by the chosen property', () => {
    const cache = makeCache([...A, ...B], k6)
    const result = detectCommunities(cache, GROUPS, { weightProperty: 'w' })
    expect(result.communityCount).toBe(2)
    expect(result.assignments.get('groupOne')).toEqual(new Set(A))
    expect(result.assignments.get('groupTwo')).toEqual(new Set(B))
  })

  it('matches the unweighted result when every weight is equal', () => {
    const edges = [...cliqueEdges(A), ...cliqueEdges(B), ['a1', 'b1']]
    const unweighted = detectCommunities(makeCache([...A, ...B], edges), GROUPS)
    const equalWeights = edges.map(([s, t]) => [s, t, 5])
    const weighted = detectCommunities(makeCache([...A, ...B], equalWeights), GROUPS, { weightProperty: 'w' })
    expect(weighted.communityCount).toBe(unweighted.communityCount)
  })

  it('falls back to weight 1 for edges missing the weight property (no throw)', () => {
    // Mixed: triangle A weighted, triangle B and bridge carry no 'w' value.
    const edges = [...weightedClique(A, 10), ...cliqueEdges(B), ['a1', 'b1']]
    const cache = makeCache([...A, ...B], edges)
    let result
    expect(() => { result = detectCommunities(cache, GROUPS, { weightProperty: 'w' }) }).not.toThrow()
    expect(result.communityCount).toBe(2)
  })
})

describe('detectCommunities — resolution', () => {
  const A = ['a1', 'a2', 'a3']
  const B = ['b1', 'b2', 'b3']
  const bridged = [...cliqueEdges(A), ...cliqueEdges(B), ['a1', 'b1']]

  it('keeps the two natural communities at resolution 1', () => {
    const result = detectCommunities(makeCache([...A, ...B], bridged), GROUPS, { resolution: 1 })
    expect(result.communityCount).toBe(2)
  })

  it('splits into finer communities at a high resolution', () => {
    const coarse = detectCommunities(makeCache([...A, ...B], bridged), GROUPS, { resolution: 1 })
    const fine = detectCommunities(makeCache([...A, ...B], bridged), GROUPS, { resolution: 4 })
    expect(fine.communityCount).toBeGreaterThan(coarse.communityCount)
  })

  it('defaults to resolution 1 when omitted', () => {
    const explicit = detectCommunities(makeCache([...A, ...B], bridged), GROUPS, { resolution: 1 })
    const implicit = detectCommunities(makeCache([...A, ...B], bridged), GROUPS)
    expect(implicit.communityCount).toBe(explicit.communityCount)
    expect(implicit.modularity).toBeCloseTo(explicit.modularity, 10)
  })
})

describe('detectCommunities — modularity', () => {
  it('returns the known modularity for two disconnected triangles', () => {
    // Two equal disconnected cliques: Q = 2 * (3/6 - (6/12)^2) = 0.5.
    const cache = makeCache(
      ['a', 'b', 'c', 'x', 'y', 'z'],
      [...cliqueEdges(['a', 'b', 'c']), ...cliqueEdges(['x', 'y', 'z'])]
    )

    const result = detectCommunities(cache, GROUPS)
    expect(result.modularity).toBeCloseTo(0.5, 5)
  })
})

describe('detectCommunities — seeded determinism', () => {
  it('produces identical assignments across repeated runs', () => {
    // Ring of small cliques with bridges: enough ambiguity that an unseeded
    // Louvain could flip outcomes between runs.
    const cliques = [
      ['a1', 'a2', 'a3', 'a4'],
      ['b1', 'b2', 'b3', 'b4'],
      ['c1', 'c2', 'c3', 'c4'],
      ['d1', 'd2', 'd3', 'd4'],
      ['e1', 'e2', 'e3', 'e4'],
    ]
    const bridges = [['a1', 'b1'], ['b2', 'c1'], ['c2', 'd1'], ['d2', 'e1'], ['e2', 'a2']]
    const cache = makeCache(cliques.flat(), [...cliques.flatMap(cliqueEdges), ...bridges])

    const first = detectCommunities(cache, GROUPS)
    for (let run = 0; run < 5; run++) {
      const again = detectCommunities(cache, GROUPS)
      expect(again.communityCount).toBe(first.communityCount)
      expect(again.modularity).toBe(first.modularity)
      for (const group of GROUPS) {
        expect(again.assignments.get(group)).toEqual(first.assignments.get(group))
      }
    }
  })
})
