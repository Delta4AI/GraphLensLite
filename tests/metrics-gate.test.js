// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NetworkMetrics } from '../src/managers/metrics.js'

// ==========================================================================
// NetworkMetrics.updateMetricUI gating
//
// Requirement: metrics must compute on a fresh load even when no visibility
// diff has occurred (under sigma, fresh elements report "visible", so
// cache.visibleElementsChanged stays false). The gate may only skip when the
// selected metric already has cached values AND visibility is unchanged.
//
// Uses the real degree-centrality calculation and real DOM elements; only the
// loading-spinner UI is stubbed.
// ==========================================================================

// Helper: minimal cache for NetworkMetrics + calculateDegreeCentrality
function makeCache({ visibleElementsChanged = false } = {}) {
  return {
    visibleElementsChanged,
    nodeIDsToBeShown: new Set(['A', 'B', 'C']),
    edgeIDsToBeShown: new Set(['A::B', 'B::C']),
    edgeRef: new Map([
      ['A::B', { source: 'A', target: 'B' }],
      ['B::C', { source: 'B', target: 'C' }],
    ]),
    toolTips: new Map(),
    ui: {
      showLoading: vi.fn(async () => {}),
      hideLoading: vi.fn(async () => {}),
    },
  }
}

// Helper: NetworkMetrics wired to a live DOM (multiselect, table, info button)
function makeMetrics(cache) {
  const metrics = new NetworkMetrics(cache)
  document.body.appendChild(metrics.buildMetricUI())
  return metrics
}

beforeEach(() => {
  document.body.innerHTML = ''
  // jsdom has no requestAnimationFrame by default
  globalThis.requestAnimationFrame = (cb) => cb()
})

describe('NetworkMetrics.updateMetricUI gating', () => {
  it('computes on fresh load when visibleElementsChanged is false and cache is empty', async () => {
    // Arrange
    const cache = makeCache({ visibleElementsChanged: false })
    const metrics = makeMetrics(cache)
    expect(metrics.metricValueCache.size).toBe(0)

    // Act
    await metrics.updateMetricUI()

    // Assert: node list populated, graph-level table populated, values cached
    expect(metrics.multiselect.options.length).toBe(3)
    expect(metrics.table.querySelectorAll('tr').length).toBeGreaterThan(0)
    const cached = metrics.metricValueCache.get('centrality')
    expect(cached?.values?.size).toBe(3)
    // B is the path center → highest degree centrality, listed first
    expect(metrics.multiselect.options[0].value).toBe('B')
  })

  it('skips recomputation when cached values exist and visibility is unchanged', async () => {
    // Arrange: first pass fills the cache
    const cache = makeCache({ visibleElementsChanged: false })
    const metrics = makeMetrics(cache)
    await metrics.updateMetricUI()
    cache.ui.showLoading.mockClear()
    metrics.multiselect.innerHTML = ''

    // Act
    await metrics.updateMetricUI()

    // Assert: early return — no loading UI, no DOM rebuild
    expect(cache.ui.showLoading).not.toHaveBeenCalled()
    expect(metrics.multiselect.options.length).toBe(0)
  })

  it('recomputes when visibleElementsChanged is true even with cached values', async () => {
    // Arrange
    const cache = makeCache({ visibleElementsChanged: false })
    const metrics = makeMetrics(cache)
    await metrics.updateMetricUI()
    metrics.multiselect.innerHTML = ''

    // Act: visibility diff occurred (e.g. filter change)
    cache.visibleElementsChanged = true
    await metrics.updateMetricUI()

    // Assert: full recompute repopulates the node list
    expect(metrics.multiselect.options.length).toBe(3)
  })

  it('computes a never-computed metric after dropdown switch with no visibility diff', async () => {
    // Arrange: centrality cached, pagerank never computed
    const cache = makeCache({ visibleElementsChanged: false })
    const metrics = makeMetrics(cache)
    await metrics.updateMetricUI()

    // Act: user switches the metric dropdown (handler sets selected, then updates)
    metrics.selected = 'pagerank'
    await metrics.updateMetricUI()

    // Assert
    const cached = metrics.metricValueCache.get('pagerank')
    expect(cached?.values?.size).toBe(3)
    expect(metrics.multiselect.options.length).toBe(3)
  })
})
