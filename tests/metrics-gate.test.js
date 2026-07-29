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

// Helper: NetworkMetrics wired to a live DOM (multiselect, table, info button).
// Metrics now compute lazily — only while the panel is open — so the
// cache/visibility gating tests open the panel explicitly. Lazy-gate tests
// pass { open: false } to assert the closed-panel no-op.
function makeMetrics(cache, { open = true } = {}) {
  const metrics = new NetworkMetrics(cache)
  document.body.appendChild(metrics.buildMetricUI())
  // The toggle button toggleUI() reaches for; absent it would throw.
  const btn = document.createElement('button')
  btn.id = 'metricsToggleBtn'
  document.body.appendChild(btn)
  if (open) metrics.collapsed = false
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

describe('NetworkMetrics lazy panel gate', () => {
  it('does not compute while the panel is closed', async () => {
    // Arrange: panel closed (default real-world state)
    const cache = makeCache({ visibleElementsChanged: true })
    const metrics = makeMetrics(cache, { open: false })
    expect(metrics.collapsed).toBe(true)

    // Act
    await metrics.updateMetricUI()

    // Assert: no compute, no loading UI, no cached values
    expect(cache.ui.showLoading).not.toHaveBeenCalled()
    expect(metrics.metricValueCache.size).toBe(0)
    expect(metrics.multiselect.options.length).toBe(0)
  })

  // Visibility is the workbench's call now; the gate follows it through
  // setWorkbenchVisible. toggleUI is a one-line delegation, covered below.
  it('triggers a compute and flips collapsed when the tab becomes visible', () => {
    // Arrange
    const cache = makeCache()
    const metrics = makeMetrics(cache, { open: false })
    const spy = vi.spyOn(metrics, 'updateMetricUI').mockResolvedValue(undefined)

    // Act
    metrics.setWorkbenchVisible(true)

    // Assert
    expect(metrics.collapsed).toBe(false)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('does not compute when the tab is hidden', () => {
    // Arrange: start visible so the call under test is the hide
    const cache = makeCache()
    const metrics = makeMetrics(cache, { open: true })
    const spy = vi.spyOn(metrics, 'updateMetricUI').mockResolvedValue(undefined)

    // Act
    metrics.setWorkbenchVisible(false)

    // Assert
    expect(metrics.collapsed).toBe(true)
    expect(spy).not.toHaveBeenCalled()
  })

  it('toggleUI defers to the workbench rather than driving the DOM itself', () => {
    // Arrange
    const cache = makeCache()
    cache.workbench = { toggle: vi.fn() }
    const metrics = makeMetrics(cache, { open: false })

    // Act
    metrics.toggleUI()

    // Assert
    expect(cache.workbench.toggle).toHaveBeenCalledWith('metrics')
  })
})

describe('NetworkMetrics.invalidateMetricValues tooltip blanking', () => {
  const TOOLTIP_WITH_METRIC =
    '<div class="tooltip-metric-wrapper visible">' +
    '<span class="tooltip-metric-header">Degree Centrality</span>' +
    '<p class="tooltip-metric-content">Degree 2</p></div>'

  function metricContentOf(tooltipHtml) {
    const div = document.createElement('div')
    div.innerHTML = tooltipHtml
    return div.querySelector('.tooltip-metric-content')?.textContent
  }

  it('blanks stale tooltip metric text when metrics were displayed', () => {
    // Arrange
    const cache = makeCache()
    cache.toolTips = new Map([['A', TOOLTIP_WITH_METRIC]])
    const metrics = makeMetrics(cache)
    metrics.metricValueCache.set('centrality', { values: new Map([['A', 2]]) })
    metrics.metricTooltipsActive = true

    // Act
    metrics.invalidateMetricValues()

    // Assert: cache cleared, tooltip metric text blanked, flag reset
    expect(metrics.metricValueCache.size).toBe(0)
    expect(metricContentOf(cache.toolTips.get('A'))).toBe('')
    expect(metrics.metricTooltipsActive).toBe(false)
  })

  it('leaves tooltips untouched when no metric text is active', () => {
    // Arrange: metrics never shown → nothing to blank
    const cache = makeCache()
    cache.toolTips = new Map([['A', TOOLTIP_WITH_METRIC]])
    const metrics = makeMetrics(cache)
    metrics.metricTooltipsActive = false

    // Act
    metrics.invalidateMetricValues()

    // Assert: tooltip preserved verbatim
    expect(cache.toolTips.get('A')).toBe(TOOLTIP_WITH_METRIC)
  })
})
