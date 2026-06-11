import { describe, it, expect, vi } from 'vitest'
import {
  calculateDegreeCentrality,
  calculateBetweennessCentrality,
  calculateClosenessCentrality,
  calculateEigenvectorCentrality,
  calculatePageRank,
} from '../src/managers/metrics.js'

// ==========================================================================
// Network metrics — unit tests with known graph topologies
// (algorithm cores delegated to graphology-metrics)
// ==========================================================================

const PRECISION = 5

// Helper: build a minimal cache-like object for the metric functions.
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

// --------------------------------------------------------------------------
// Degree Centrality
// --------------------------------------------------------------------------

describe('Degree Centrality', () => {
  it('returns empty results for empty graph', async () => {
    const cache = makeCache([], [])
    const result = await calculateDegreeCentrality(cache)
    expect(result.scores).toEqual([])
  })

  it('calculates star graph correctly', async () => {
    // Star: center connected to A, B, C, D
    const cache = makeCache(
      ['center', 'A', 'B', 'C', 'D'],
      [['center', 'A'], ['center', 'B'], ['center', 'C'], ['center', 'D']]
    )
    const result = await calculateDegreeCentrality(cache)

    // Center has degree 4 out of 4 possible → centrality = 4/4 = 1.0
    const centerScore = result.nodeValues.get('center')
    expect(centerScore).toBe(1.0)

    // Leaf nodes have degree 1 out of 4 possible → centrality = 1/4 = 0.25
    expect(result.nodeValues.get('A')).toBe(0.25)
    expect(result.nodeValues.get('B')).toBe(0.25)

    // Center should be first (highest)
    expect(result.scores[0].id).toBe('center')
  })

  it('calculates complete graph (K4) correctly', async () => {
    // K4: every node connected to every other
    const cache = makeCache(
      ['A', 'B', 'C', 'D'],
      [['A', 'B'], ['A', 'C'], ['A', 'D'], ['B', 'C'], ['B', 'D'], ['C', 'D']]
    )
    const result = await calculateDegreeCentrality(cache)

    // Every node has degree 3 out of 3 possible → centrality = 1.0
    for (const id of ['A', 'B', 'C', 'D']) {
      expect(result.nodeValues.get(id)).toBe(1.0)
    }

    // Graph density should be 1.0 for a complete graph
    expect(result.graphLevelMetrics["Graph Density"]).toBe(1)
  })

  it('handles isolated node correctly', async () => {
    // A--B  C (isolated)
    const cache = makeCache(['A', 'B', 'C'], [['A', 'B']])
    const result = await calculateDegreeCentrality(cache)

    expect(result.nodeValues.get('A')).toBe(0.5)
    expect(result.nodeValues.get('B')).toBe(0.5)
    expect(result.nodeValues.get('C')).toBe(0)
  })

  it('calculates path graph correctly', async () => {
    // A -- B -- C
    const cache = makeCache(['A', 'B', 'C'], [['A', 'B'], ['B', 'C']])
    const result = await calculateDegreeCentrality(cache)

    // B has degree 2 out of 2 possible → 1.0
    expect(result.nodeValues.get('B')).toBe(1.0)
    // A and C have degree 1 out of 2 possible → 0.5
    expect(result.nodeValues.get('A')).toBe(0.5)
    expect(result.nodeValues.get('C')).toBe(0.5)
  })

  it('returns correct graph-level metrics', async () => {
    const cache = makeCache(
      ['A', 'B', 'C', 'D'],
      [['A', 'B'], ['B', 'C'], ['B', 'D']]
    )
    const result = await calculateDegreeCentrality(cache)
    const glm = result.graphLevelMetrics

    expect(glm).toHaveProperty('Maximum Degree Centrality')
    expect(glm).toHaveProperty('Minimum Degree Centrality')
    expect(glm).toHaveProperty('Average Degree Centrality')
    expect(glm).toHaveProperty('Median Degree')
    expect(glm).toHaveProperty('Graph Density')
    expect(glm).toHaveProperty('Centralization')

    // B has degree 3 (highest)
    expect(glm['Maximum Degree Centrality']).toBe(3)
  })

  it('counts parallel (multi) edges toward degree', async () => {
    // A == B (two parallel edges), C connected once
    const cache = makeCache(
      ['A', 'B', 'C'],
      [['A', 'B'], ['A', 'B'], ['B', 'C']]
    )
    const result = await calculateDegreeCentrality(cache)

    // A has degree 2 of 2 possible → 1.0; B degree 3 → 1.5
    expect(result.nodeValues.get('A')).toBe(1.0)
    expect(result.nodeValues.get('B')).toBe(1.5)
    expect(result.nodeValues.get('C')).toBe(0.5)
    expect(result.scores[0].text).toContain('Degree 3')
  })

  it('counts a visible self-loop twice toward degree (unchanged semantics)', async () => {
    // Old accumulation (`if has(source) +1; if has(target) +1`) counted a
    // self-loop twice — identical to graphology undirected multigraph degree.
    const cache = makeCache(['A', 'B', 'C'], [['A', 'A'], ['A', 'B']])
    const result = await calculateDegreeCentrality(cache)

    // A: self-loop (2) + edge to B (1) = degree 3 → centrality 3/(n-1) = 1.5
    expect(result.nodeValues.get('A')).toBe(1.5)
    expect(result.scores[0].text).toContain('Degree 3')
    expect(result.nodeValues.get('B')).toBe(0.5)
  })

  it('ignores edges whose endpoint is not visible', async () => {
    const cache = makeCache(['A', 'B'], [['A', 'B'], ['A', 'ghost']])
    const result = await calculateDegreeCentrality(cache)

    expect(result.nodeValues.get('A')).toBe(1.0)
    expect(result.nodeValues.has('ghost')).toBe(false)
  })

  it('reports real graph density (2m / n(n-1))', async () => {
    // Star K1,4: density = 2*4 / (5*4) = 0.4
    const star = makeCache(
      ['center', 'A', 'B', 'C', 'D'],
      [['center', 'A'], ['center', 'B'], ['center', 'C'], ['center', 'D']]
    )
    const starResult = await calculateDegreeCentrality(star)
    expect(starResult.graphLevelMetrics['Graph Density']).toBe(0.4)

    // Path A-B-C: density = 2*2 / (3*2) = 0.66667
    const path = makeCache(['A', 'B', 'C'], [['A', 'B'], ['B', 'C']])
    const pathResult = await calculateDegreeCentrality(path)
    expect(pathResult.graphLevelMetrics['Graph Density']).toBeCloseTo(2 / 3, PRECISION)
  })

  it('formats score text with degree, centrality, and percent of max', async () => {
    const cache = makeCache(['A', 'B', 'C'], [['A', 'B'], ['B', 'C']])
    const result = await calculateDegreeCentrality(cache)
    expect(result.scores[0].text).toBe('Degree 2 | Centrality 1.00000 (100 %)')
  })
})

// --------------------------------------------------------------------------
// Betweenness Centrality
// --------------------------------------------------------------------------

describe('Betweenness Centrality', () => {
  it('returns empty results for empty graph', async () => {
    const cache = makeCache([], [])
    const result = await calculateBetweennessCentrality(cache)
    expect(result.scores).toEqual([])
  })

  it('identifies the bridge node in a path graph', async () => {
    // A -- B -- C
    // B is on all shortest paths between A↔C
    const cache = makeCache(['A', 'B', 'C'], [['A', 'B'], ['B', 'C']])
    const result = await calculateBetweennessCentrality(cache)

    expect(result.nodeValues.get('B')).toBeGreaterThan(0)
    expect(result.nodeValues.get('A')).toBe(0)
    expect(result.nodeValues.get('C')).toBe(0)
  })

  it('calculates star graph correctly (center is bridge)', async () => {
    const cache = makeCache(
      ['center', 'A', 'B', 'C'],
      [['center', 'A'], ['center', 'B'], ['center', 'C']]
    )
    const result = await calculateBetweennessCentrality(cache)

    // Center is on all shortest paths between leaf pairs
    expect(result.nodeValues.get('center')).toBeGreaterThan(0)
    // Leaves are never on a shortest path between other pairs
    expect(result.nodeValues.get('A')).toBe(0)
    expect(result.nodeValues.get('B')).toBe(0)
    expect(result.nodeValues.get('C')).toBe(0)
  })

  it('gives zero betweenness for complete graph', async () => {
    // In K4, there's always a direct edge, so no node is a bridge
    const cache = makeCache(
      ['A', 'B', 'C', 'D'],
      [['A', 'B'], ['A', 'C'], ['A', 'D'], ['B', 'C'], ['B', 'D'], ['C', 'D']]
    )
    const result = await calculateBetweennessCentrality(cache)

    for (const id of ['A', 'B', 'C', 'D']) {
      expect(result.nodeValues.get(id)).toBe(0)
    }
  })

  it('correctly handles a longer path', async () => {
    // A -- B -- C -- D -- E
    const cache = makeCache(
      ['A', 'B', 'C', 'D', 'E'],
      [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E']]
    )
    const result = await calculateBetweennessCentrality(cache)

    // C is the most central (on paths between {A,B} and {D,E})
    const cScore = result.nodeValues.get('C')
    const bScore = result.nodeValues.get('B')
    const dScore = result.nodeValues.get('D')

    // B and D should be symmetric
    expect(bScore).toBeCloseTo(dScore, PRECISION)
    // C should be higher than B
    expect(cScore).toBeGreaterThan(bScore)
    // Endpoints should be 0
    expect(result.nodeValues.get('A')).toBe(0)
    expect(result.nodeValues.get('E')).toBe(0)
  })

  it('star center has exactly 1.0 normalized betweenness', async () => {
    // K1,3: center lies on all 3 leaf pairs; normalization (n-1)(n-2)/2 = 3
    const cache = makeCache(
      ['center', 'A', 'B', 'C'],
      [['center', 'A'], ['center', 'B'], ['center', 'C']]
    )
    const result = await calculateBetweennessCentrality(cache)
    expect(result.nodeValues.get('center')).toBe(1.0)
  })

  it('computes exact normalized values on a 5-path', async () => {
    // A-B-C-D-E: B(B)=3 pairs, B(C)=4 pairs, normalization (4*3)/2 = 6
    const cache = makeCache(
      ['A', 'B', 'C', 'D', 'E'],
      [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E']]
    )
    const result = await calculateBetweennessCentrality(cache)
    expect(result.nodeValues.get('B')).toBeCloseTo(3 / 6, PRECISION)
    expect(result.nodeValues.get('C')).toBeCloseTo(4 / 6, PRECISION)
  })

  it('returns finite zeros for two-node graphs (no NaN)', async () => {
    // Previous hand-rolled code divided by ((n-1)(n-2))/2 = 0 → NaN here.
    const cache = makeCache(['A', 'B'], [['A', 'B']])
    const result = await calculateBetweennessCentrality(cache)
    expect(result.nodeValues.get('A')).toBe(0)
    expect(result.nodeValues.get('B')).toBe(0)
    expect(result.graphLevelMetrics['Centralization']).toBe(0)
  })
})

// --------------------------------------------------------------------------
// Closeness Centrality
// --------------------------------------------------------------------------

describe('Closeness Centrality', () => {
  it('returns empty results for empty graph', async () => {
    const cache = makeCache([], [])
    const result = await calculateClosenessCentrality(cache)
    expect(result.scores).toEqual([])
  })

  it('calculates star graph correctly', async () => {
    const cache = makeCache(
      ['center', 'A', 'B', 'C'],
      [['center', 'A'], ['center', 'B'], ['center', 'C']]
    )
    const result = await calculateClosenessCentrality(cache)

    // Center is closest to all nodes (distance 1 to each)
    const centerCloseness = result.nodeValues.get('center')
    const leafCloseness = result.nodeValues.get('A')

    expect(centerCloseness).toBeGreaterThan(leafCloseness)
  })

  it('gives equal closeness for complete graph', async () => {
    const cache = makeCache(
      ['A', 'B', 'C'],
      [['A', 'B'], ['A', 'C'], ['B', 'C']]
    )
    const result = await calculateClosenessCentrality(cache)

    const a = result.nodeValues.get('A')
    const b = result.nodeValues.get('B')
    const c = result.nodeValues.get('C')

    expect(a).toBeCloseTo(b, PRECISION)
    expect(b).toBeCloseTo(c, PRECISION)
  })

  it('handles isolated node (closeness = 0)', async () => {
    const cache = makeCache(['A', 'B', 'C'], [['A', 'B']])
    const result = await calculateClosenessCentrality(cache)

    // Isolated node C has no paths → closeness 0
    expect(result.nodeValues.get('C')).toBe(0)
  })

  it('center node in path has highest closeness', async () => {
    // A -- B -- C -- D -- E
    const cache = makeCache(
      ['A', 'B', 'C', 'D', 'E'],
      [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E']]
    )
    const result = await calculateClosenessCentrality(cache)

    const scores = ['A', 'B', 'C', 'D', 'E'].map(id => result.nodeValues.get(id))
    // C (index 2) should have the highest closeness
    const maxIdx = scores.indexOf(Math.max(...scores))
    expect(maxIdx).toBe(2)
  })

  it('computes exact Wasserman-Faust values on a 3-path', async () => {
    // A-B-C: B reaches 2 nodes at total distance 2 → 2²/(2·2) = 1.0
    //        A reaches 2 nodes at total distance 3 → 2²/(2·3) = 2/3
    const cache = makeCache(['A', 'B', 'C'], [['A', 'B'], ['B', 'C']])
    const result = await calculateClosenessCentrality(cache)
    expect(result.nodeValues.get('B')).toBeCloseTo(1.0, PRECISION)
    expect(result.nodeValues.get('A')).toBeCloseTo(2 / 3, PRECISION)
    expect(result.nodeValues.get('C')).toBeCloseTo(2 / 3, PRECISION)
  })

  it('applies the reachable-fraction correction on disconnected graphs', async () => {
    // A-B plus isolated C (n=3): A reaches 1 node at distance 1
    // → WF closeness = 1²/((3-1)·1) = 0.5
    const cache = makeCache(['A', 'B', 'C'], [['A', 'B']])
    const result = await calculateClosenessCentrality(cache)
    expect(result.nodeValues.get('A')).toBeCloseTo(0.5, PRECISION)
    expect(result.nodeValues.get('B')).toBeCloseTo(0.5, PRECISION)
    expect(result.nodeValues.get('C')).toBe(0)
  })

  it('reports graph diameter for connected graphs', async () => {
    // Path A..E: diameter 4
    const path = makeCache(
      ['A', 'B', 'C', 'D', 'E'],
      [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E']]
    )
    const pathResult = await calculateClosenessCentrality(path)
    expect(pathResult.graphLevelMetrics['Graph Diameter']).toBe(4)

    // K4: diameter 1
    const k4 = makeCache(
      ['A', 'B', 'C', 'D'],
      [['A', 'B'], ['A', 'C'], ['A', 'D'], ['B', 'C'], ['B', 'D'], ['C', 'D']]
    )
    const k4Result = await calculateClosenessCentrality(k4)
    expect(k4Result.graphLevelMetrics['Graph Diameter']).toBe(1)
  })

  it('reports infinite diameter for disconnected graphs', async () => {
    const cache = makeCache(['A', 'B', 'C'], [['A', 'B']])
    const result = await calculateClosenessCentrality(cache)
    expect(result.graphLevelMetrics['Graph Diameter']).toBe('∞ (disconnected)')
  })
})

// --------------------------------------------------------------------------
// Eigenvector Centrality
// --------------------------------------------------------------------------

describe('Eigenvector Centrality', () => {
  it('returns empty results for empty graph', async () => {
    const cache = makeCache([], [])
    const result = await calculateEigenvectorCentrality(cache)
    expect(result.scores).toEqual([])
  })

  it('gives highest score to most connected node in star', async () => {
    const cache = makeCache(
      ['center', 'A', 'B', 'C', 'D'],
      [['center', 'A'], ['center', 'B'], ['center', 'C'], ['center', 'D']]
    )
    const result = await calculateEigenvectorCentrality(cache)

    // Center should have the highest eigenvector centrality
    expect(result.scores[0].id).toBe('center')
  })

  it('gives equal scores for complete graph', async () => {
    const cache = makeCache(
      ['A', 'B', 'C'],
      [['A', 'B'], ['A', 'C'], ['B', 'C']]
    )
    const result = await calculateEigenvectorCentrality(cache)

    const a = result.nodeValues.get('A')
    const b = result.nodeValues.get('B')
    const c = result.nodeValues.get('C')

    expect(a).toBeCloseTo(b, 4)
    expect(b).toBeCloseTo(c, 4)
  })

  it('gives equal scores for symmetric leaf nodes', async () => {
    const cache = makeCache(
      ['center', 'A', 'B'],
      [['center', 'A'], ['center', 'B']]
    )
    const result = await calculateEigenvectorCentrality(cache)

    const a = result.nodeValues.get('A')
    const b = result.nodeValues.get('B')
    expect(a).toBeCloseTo(b, PRECISION)
  })

  it('returns graph-level metrics with expected keys', async () => {
    const cache = makeCache(['A', 'B'], [['A', 'B']])
    const result = await calculateEigenvectorCentrality(cache)

    expect(result.graphLevelMetrics).toHaveProperty('Maximum Eigenvector Centrality')
    expect(result.graphLevelMetrics).toHaveProperty('Minimum Eigenvector Centrality')
    expect(result.graphLevelMetrics).toHaveProperty('Average Eigenvector Centrality')
    expect(result.graphLevelMetrics).toHaveProperty('Variance Eigenvector Centrality')
    expect(result.graphLevelMetrics).toHaveProperty('Centralization')
  })

  it('converges to the exact principal eigenvector on a star (bipartite) graph', async () => {
    // K1,4 principal eigenvector (L2-normalized): center 1/√2, leaves 1/(2√2).
    // The old plain power iteration oscillated on bipartite graphs and
    // silently returned a non-converged iterate after 100 iterations.
    const cache = makeCache(
      ['center', 'A', 'B', 'C', 'D'],
      [['center', 'A'], ['center', 'B'], ['center', 'C'], ['center', 'D']]
    )
    const result = await calculateEigenvectorCentrality(cache)
    expect(result.nodeValues.get('center')).toBeCloseTo(Math.SQRT1_2, 4)
    expect(result.nodeValues.get('A')).toBeCloseTo(1 / (2 * Math.SQRT2), 4)
  })

  it('surfaces a clear error when the power iteration fails to converge', async () => {
    vi.resetModules()
    vi.doMock('../src/lib/graphology.bundle.mjs', async (importOriginal) => {
      const actual = await importOriginal()
      return {
        ...actual,
        eigenvectorCentrality: () => {
          throw new Error('graphology-metrics/centrality/eigenvector: failed to converge.')
        },
      }
    })

    try {
      const mocked = await import('../src/managers/metrics.js')
      const cache = makeCache(['A', 'B'], [['A', 'B']])
      await expect(mocked.calculateEigenvectorCentrality(cache))
        .rejects.toThrow(/did not converge/)
    } finally {
      vi.doUnmock('../src/lib/graphology.bundle.mjs')
      vi.resetModules()
    }
  })
})

// --------------------------------------------------------------------------
// PageRank
// --------------------------------------------------------------------------

describe('PageRank', () => {
  it('returns empty results for empty graph', async () => {
    const cache = makeCache([], [])
    const result = await calculatePageRank(cache)
    expect(result.scores).toEqual([])
  })

  it('gives highest PageRank to most connected node in star', async () => {
    const cache = makeCache(
      ['center', 'A', 'B', 'C', 'D'],
      [['center', 'A'], ['center', 'B'], ['center', 'C'], ['center', 'D']]
    )
    const result = await calculatePageRank(cache)

    // Center should have highest PageRank
    expect(result.scores[0].id).toBe('center')
    expect(result.nodeValues.get('center')).toBeGreaterThan(result.nodeValues.get('A'))
  })

  it('gives equal PageRank for complete graph', async () => {
    const cache = makeCache(
      ['A', 'B', 'C'],
      [['A', 'B'], ['A', 'C'], ['B', 'C']]
    )
    const result = await calculatePageRank(cache)

    const a = result.nodeValues.get('A')
    const b = result.nodeValues.get('B')
    const c = result.nodeValues.get('C')

    expect(a).toBeCloseTo(b, 4)
    expect(b).toBeCloseTo(c, 4)
  })

  it('PageRank scores sum to approximately 1', async () => {
    const cache = makeCache(
      ['A', 'B', 'C', 'D', 'E'],
      [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E'], ['E', 'A']]
    )
    const result = await calculatePageRank(cache)

    const sum = Array.from(result.nodeValues.values()).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1.0, 2)
  })

  it('returns correct graph-level metrics', async () => {
    const cache = makeCache(
      ['A', 'B', 'C'],
      [['A', 'B'], ['B', 'C']]
    )
    const result = await calculatePageRank(cache)
    const glm = result.graphLevelMetrics

    expect(glm).toHaveProperty('Maximum PageRank Score')
    expect(glm).toHaveProperty('Minimum PageRank Score')
    expect(glm).toHaveProperty('Mean PageRank Score')
    expect(glm).toHaveProperty('Maximum Degree')
    expect(glm).toHaveProperty('Minimum Degree')
    expect(glm).toHaveProperty('Mean Degree')
  })

  it('symmetric nodes receive equal PageRank', async () => {
    // A -- B -- C   (B is center, A and C are symmetric)
    const cache = makeCache(['A', 'B', 'C'], [['A', 'B'], ['B', 'C']])
    const result = await calculatePageRank(cache)

    expect(result.nodeValues.get('A')).toBeCloseTo(result.nodeValues.get('C'), PRECISION)
  })

  it('matches the reference value for a star graph hub', async () => {
    // K1,4 with d=0.85 converges to hub ≈ 0.47568 (NetworkX reference)
    const cache = makeCache(
      ['center', 'A', 'B', 'C', 'D'],
      [['center', 'A'], ['center', 'B'], ['center', 'C'], ['center', 'D']]
    )
    const result = await calculatePageRank(cache)
    expect(result.nodeValues.get('center')).toBeCloseTo(0.47568, 4)
  })

  it('reports degree statistics from the visible multigraph', async () => {
    const cache = makeCache(['A', 'B', 'C'], [['A', 'B'], ['A', 'B'], ['B', 'C']])
    const result = await calculatePageRank(cache)
    const glm = result.graphLevelMetrics

    expect(glm['Maximum Degree']).toBe(3)
    expect(glm['Minimum Degree']).toBe(1)
    expect(glm['Mean Degree']).toBe(2)
  })
})

// --------------------------------------------------------------------------
// Degenerate visible graphs (n <= 1 guard, all-zero percentage guard)
// --------------------------------------------------------------------------

const ALL_METRICS = [
  ['degree', calculateDegreeCentrality],
  ['betweenness', calculateBetweennessCentrality],
  ['closeness', calculateClosenessCentrality],
  ['eigenvector', calculateEigenvectorCentrality],
  ['pagerank', calculatePageRank],
]

describe('Single visible node (n <= 1 guard)', () => {
  it.each(ALL_METRICS)('%s returns empty results for a single visible node', async (_name, calc) => {
    const result = await calc(makeCache(['A'], []))
    expect(result.scores).toEqual([])
    expect(result.graphLevelMetrics).toEqual({})
  })
})

describe('Isolated nodes (n >= 2, no visible edges)', () => {
  it('degree renders "(0 %)" instead of NaN when all scores are zero', async () => {
    const result = await calculateDegreeCentrality(makeCache(['A', 'B', 'C'], []))
    expect(result.scores).toHaveLength(3)
    for (const s of result.scores) {
      expect(s.text).toContain('(0 %)')
      expect(s.text).not.toContain('NaN')
    }
  })

  it('betweenness renders "(0%)" instead of NaN when all scores are zero', async () => {
    const result = await calculateBetweennessCentrality(makeCache(['A', 'B', 'C'], []))
    expect(result.scores).toHaveLength(3)
    for (const s of result.scores) {
      expect(s.text).toContain('(0%)')
      expect(s.text).not.toContain('NaN')
    }
  })

  it('closeness renders "(0%)" instead of NaN when all scores are zero', async () => {
    const result = await calculateClosenessCentrality(makeCache(['A', 'B', 'C'], []))
    expect(result.scores).toHaveLength(3)
    for (const s of result.scores) {
      expect(s.text).toContain('(0%)')
      expect(s.text).not.toContain('NaN')
    }
  })

  it.each(ALL_METRICS)('%s renders no NaN in score texts on edgeless graphs', async (_name, calc) => {
    // eigenvector/pagerank distribute uniform non-zero mass here, so only
    // the NaN absence is universal.
    const result = await calc(makeCache(['A', 'B', 'C'], []))
    expect(result.scores).toHaveLength(3)
    for (const s of result.scores) {
      expect(s.text).not.toContain('NaN')
    }
  })
})

// --------------------------------------------------------------------------
// Cross-metric consistency checks
// --------------------------------------------------------------------------

describe('Cross-metric consistency', () => {
  it('all metrics agree on highest-centrality node for star graph', async () => {
    const cache = makeCache(
      ['hub', 'A', 'B', 'C', 'D', 'E'],
      [['hub', 'A'], ['hub', 'B'], ['hub', 'C'], ['hub', 'D'], ['hub', 'E']]
    )

    const degree = await calculateDegreeCentrality(cache)
    const betweenness = await calculateBetweennessCentrality(cache)
    const closeness = await calculateClosenessCentrality(cache)
    const eigenvector = await calculateEigenvectorCentrality(cache)
    const pagerank = await calculatePageRank(cache)

    expect(degree.scores[0].id).toBe('hub')
    expect(betweenness.scores[0].id).toBe('hub')
    expect(closeness.scores[0].id).toBe('hub')
    expect(eigenvector.scores[0].id).toBe('hub')
    expect(pagerank.scores[0].id).toBe('hub')
  })

  it('all metrics return nodeValues Map with correct size', async () => {
    const cache = makeCache(
      ['A', 'B', 'C'],
      [['A', 'B'], ['B', 'C']]
    )

    const results = await Promise.all([
      calculateDegreeCentrality(cache),
      calculateBetweennessCentrality(cache),
      calculateClosenessCentrality(cache),
      calculateEigenvectorCentrality(cache),
      calculatePageRank(cache),
    ])

    for (const result of results) {
      expect(result.nodeValues).toBeInstanceOf(Map)
      expect(result.nodeValues.size).toBe(3)
    }
  })
})
