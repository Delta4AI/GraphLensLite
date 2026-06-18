import { describe, it, expect } from 'vitest'
import { findShortestPath } from '../src/graph/shortest_path.js'

// ==========================================================================
// Unweighted (BFS) shortest path over the visible subgraph (pure, node-safe).
// The DOM-bound application path (adding the path to the selection) lives in
// graph/selection.js and is exercised through GraphSelectionManager.
// ==========================================================================

// Helper: build a minimal cache-like object (same shape as metrics.test.js).
// Edge ids carry an index suffix so parallel (multi) edges stay distinct.
// A third tuple element { hidden: true } keeps the edge out of the visible
// subgraph (in edgeRef but not edgeIDsToBeShown), mirroring an active filter.
function makeCache(nodeIds, edges) {
  const nodeIDsToBeShown = new Set(nodeIds)
  const edgeRef = new Map()
  const edgeIDsToBeShown = new Set()

  edges.forEach(([source, target, opts = {}], i) => {
    const id = `${source}::${target}::${i}`
    edgeRef.set(id, { source, target })
    if (!opts.hidden) edgeIDsToBeShown.add(id)
  })

  return { nodeIDsToBeShown, edgeIDsToBeShown, edgeRef }
}

const edgeId = (source, target, i) => `${source}::${target}::${i}`

describe('findShortestPath', () => {
  it('finds a direct one-hop path', () => {
    const cache = makeCache(['A', 'B'], [['A', 'B']])
    const result = findShortestPath(cache, 'A', 'B')

    expect(result.found).toBe(true)
    expect(result.nodes).toEqual(['A', 'B'])
    expect(result.edges).toEqual([edgeId('A', 'B', 0)])
    expect(result.hops).toBe(1)
  })

  it('finds a multi-hop path along a chain', () => {
    // A -- B -- C -- D -- E
    const cache = makeCache(
      ['A', 'B', 'C', 'D', 'E'],
      [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E']]
    )
    const result = findShortestPath(cache, 'A', 'E')

    expect(result.found).toBe(true)
    expect(result.nodes).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(result.edges).toEqual([
      edgeId('A', 'B', 0),
      edgeId('B', 'C', 1),
      edgeId('C', 'D', 2),
      edgeId('D', 'E', 3),
    ])
    expect(result.hops).toBe(4)
  })

  it('picks the shorter of two routes', () => {
    // Short: A-B-D (2 hops). Long: A-C-E-D (3 hops).
    const cache = makeCache(
      ['A', 'B', 'C', 'D', 'E'],
      [['A', 'B'], ['B', 'D'], ['A', 'C'], ['C', 'E'], ['E', 'D']]
    )
    const result = findShortestPath(cache, 'A', 'D')

    expect(result.found).toBe(true)
    expect(result.nodes).toEqual(['A', 'B', 'D'])
    expect(result.hops).toBe(2)
  })

  it('treats the graph as undirected (reverse direction)', () => {
    // Edges stored A->B, B->C; a C->A query must still find the path.
    const cache = makeCache(['A', 'B', 'C'], [['A', 'B'], ['B', 'C']])
    const result = findShortestPath(cache, 'C', 'A')

    expect(result.found).toBe(true)
    expect(result.nodes).toEqual(['C', 'B', 'A'])
    expect(result.hops).toBe(2)
    // Edge ids are derived regardless of stored endpoint order.
    expect(result.edges).toEqual([edgeId('B', 'C', 1), edgeId('A', 'B', 0)])
  })

  it('returns found=false for disconnected components', () => {
    // A--B and C--D are separate components.
    const cache = makeCache(['A', 'B', 'C', 'D'], [['A', 'B'], ['C', 'D']])
    const result = findShortestPath(cache, 'A', 'D')

    expect(result.found).toBe(false)
    expect(result.nodes).toEqual([])
    expect(result.edges).toEqual([])
    expect(result.hops).toBe(0)
  })

  it('returns a single-node, zero-hop path when source equals target', () => {
    const cache = makeCache(['A', 'B'], [['A', 'B']])
    const result = findShortestPath(cache, 'A', 'A')

    expect(result.found).toBe(true)
    expect(result.nodes).toEqual(['A'])
    expect(result.edges).toEqual([])
    expect(result.hops).toBe(0)
  })

  it('returns found=false when an endpoint is not visible', () => {
    // C exists as an edge endpoint but is filtered out of the visible nodes.
    const cache = makeCache(['A', 'B'], [['A', 'B'], ['B', 'C']])
    const result = findShortestPath(cache, 'A', 'C')

    expect(result.found).toBe(false)
    expect(result.nodes).toEqual([])
    expect(result.hops).toBe(0)
  })

  it('ignores a hidden/filtered edge and routes around it', () => {
    // Direct A-B edge is hidden, but A-C-B is visible → 2-hop detour.
    const cache = makeCache(
      ['A', 'B', 'C'],
      [['A', 'B', { hidden: true }], ['A', 'C'], ['C', 'B']]
    )
    const result = findShortestPath(cache, 'A', 'B')

    expect(result.found).toBe(true)
    expect(result.nodes).toEqual(['A', 'C', 'B'])
    expect(result.hops).toBe(2)
    expect(result.edges).toEqual([edgeId('A', 'C', 1), edgeId('C', 'B', 2)])
  })

  it('returns found=false when the only connecting edge is hidden', () => {
    const cache = makeCache(['A', 'B'], [['A', 'B', { hidden: true }]])
    const result = findShortestPath(cache, 'A', 'B')

    expect(result.found).toBe(false)
    expect(result.hops).toBe(0)
  })

  it('handles parallel edges, emitting one edge id per hop', () => {
    // A == B (two parallel edges), B -- C.
    const cache = makeCache(
      ['A', 'B', 'C'],
      [['A', 'B'], ['A', 'B'], ['B', 'C']]
    )
    const result = findShortestPath(cache, 'A', 'C')

    expect(result.found).toBe(true)
    expect(result.nodes).toEqual(['A', 'B', 'C'])
    expect(result.hops).toBe(2)
    expect(result.edges).toHaveLength(2)
    // First hop is one of the two parallel A--B edges; second is the B--C edge.
    expect([edgeId('A', 'B', 0), edgeId('A', 'B', 1)]).toContain(result.edges[0])
    expect(result.edges[1]).toBe(edgeId('B', 'C', 2))
  })
})
