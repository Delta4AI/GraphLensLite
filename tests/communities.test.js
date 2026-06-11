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

  edges.forEach(([source, target], i) => {
    const id = `${source}::${target}::${i}`
    edgeIDsToBeShown.add(id)
    edgeRef.set(id, { source, target })
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
