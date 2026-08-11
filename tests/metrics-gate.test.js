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

describe('NetworkMetrics empty results', () => {
  it('clears the panel and says so when the view is too small to score', async () => {
    // A filter can leave one visible node; every calculator returns no scores
    // there, and the panel used to keep the pre-filter numbers on screen.
    const cache = makeCache()
    const metrics = makeMetrics(cache)
    await metrics.updateMetricUI()
    expect(metrics.multiselect.options.length).toBe(3)

    cache.nodeIDsToBeShown = new Set(['A'])
    cache.edgeIDsToBeShown = new Set()
    cache.visibleElementsChanged = true
    await metrics.updateMetricUI()

    expect(metrics.multiselect.options.length).toBe(0)
    expect(metrics.table.querySelectorAll('tr').length).toBe(0)
    expect(metrics.emptyNote.hidden).toBe(false)
    expect(document.getElementById('metricInfoBtn').disabled).toBe(true)
  })

  it('hides the note again once the view can be scored', async () => {
    const cache = makeCache()
    cache.nodeIDsToBeShown = new Set(['A'])
    cache.edgeIDsToBeShown = new Set()
    const metrics = makeMetrics(cache)
    await metrics.updateMetricUI()
    expect(metrics.emptyNote.hidden).toBe(false)

    cache.nodeIDsToBeShown = new Set(['A', 'B', 'C'])
    cache.edgeIDsToBeShown = new Set(['A::B', 'B::C'])
    cache.visibleElementsChanged = true
    await metrics.updateMetricUI()

    expect(metrics.emptyNote.hidden).toBe(true)
    expect(document.getElementById('metricInfoBtn').disabled).toBe(false)
  })
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
    '<div class="tooltip-metric-wrapper">' +
    '<span class="tooltip-metric-header"></span>' +
    '<p class="tooltip-metric-content"></p></div>'

  /** What a hover would render for `nodeId`, metric line included. */
  function renderTooltip(metrics, cache, nodeId) {
    const el = document.createElement('div')
    el.innerHTML = cache.toolTips.get(nodeId)
    metrics.applyTooltipMetricText(el, nodeId)
    return el
  }

  it('blanks stale tooltip metric text when metrics were displayed', () => {
    // Arrange
    const cache = makeCache()
    cache.toolTips = new Map([['A', TOOLTIP_WITH_METRIC]])
    const metrics = makeMetrics(cache)
    metrics.metricValueCache.set('centrality', { values: new Map([['A', 2]]) })
    metrics.updateNodeToolTipMetricText('A', 'Degree Centrality', 'Degree 2')
    metrics.metricTooltipsActive = true
    expect(renderTooltip(metrics, cache, 'A').querySelector('.tooltip-metric-content').textContent)
      .toBe('Degree 2')

    // Act
    metrics.invalidateMetricValues()

    // Assert: cache cleared, metric line gone, flag reset
    expect(metrics.metricValueCache.size).toBe(0)
    const el = renderTooltip(metrics, cache, 'A')
    expect(el.querySelector('.tooltip-metric-content').textContent).toBe('')
    expect(el.querySelector('.tooltip-metric-wrapper').classList.contains('visible')).toBe(false)
    expect(metrics.metricTooltipsActive).toBe(false)
  })

  it('never rewrites the stored tooltip HTML', () => {
    // The metric line is composed onto the live element at hover time, so a
    // metric switch is Map writes — not an innerHTML parse and serialize per
    // node, twice (reset + repopulate).
    const cache = makeCache()
    cache.toolTips = new Map([['A', TOOLTIP_WITH_METRIC]])
    const metrics = makeMetrics(cache)

    metrics.updateNodeToolTipMetricText('A', 'Degree Centrality', 'Degree 2')
    metrics.resetNodeToolTipMetricTexts()

    expect(cache.toolTips.get('A')).toBe(TOOLTIP_WITH_METRIC)
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

// ==========================================================================
// Switching back to an already-computed metric must repaint the panel.
//
// The gate that skips recompute used to skip the *render* with it, so the
// second visit to a metric left the previous one's ranking, graph-level table
// and 🛈 popup on screen with no way back. Going to a metric for the first
// time worked (no cache -> full path), which is what made it look like only
// "backwards" navigation was broken.
// ==========================================================================

describe('NetworkMetrics metric switching', () => {
  const rankedIds = (metrics) => [...metrics.multiselect.options].map((o) => o.textContent)
  const tableRows = (metrics) =>
    [...metrics.table.rows].map((r) => r.cells[0].textContent)

  async function select(metrics, id) {
    metrics.selected = id
    await metrics.updateMetricUI()
  }

  it('repaints when returning to a metric that is already cached', async () => {
    const cache = makeCache({ visibleElementsChanged: false })
    const metrics = makeMetrics(cache)

    await select(metrics, 'centrality')
    const degreeRanking = rankedIds(metrics)
    const degreeTable = tableRows(metrics)
    expect(degreeRanking.length).toBeGreaterThan(0)

    await select(metrics, 'betweenness')
    expect(rankedIds(metrics)).not.toEqual(degreeRanking)
    expect(tableRows(metrics)).not.toEqual(degreeTable)

    // The regression: this left betweenness on screen.
    await select(metrics, 'centrality')
    expect(rankedIds(metrics)).toEqual(degreeRanking)
    expect(tableRows(metrics)).toEqual(degreeTable)
  })

  it('serves the return visit from cache instead of recomputing', async () => {
    const cache = makeCache({ visibleElementsChanged: false })
    const metrics = makeMetrics(cache)
    const spy = vi.spyOn(metrics.m.centrality, 'calculate')

    await select(metrics, 'centrality')
    expect(spy).toHaveBeenCalledTimes(1)

    await select(metrics, 'betweenness')
    await select(metrics, 'centrality')

    // Repainted, but the expensive calculation ran exactly once.
    expect(spy).toHaveBeenCalledTimes(1)
    expect(rankedIds(metrics).length).toBeGreaterThan(0)
    spy.mockRestore()
  })

  it('does not repaint on an unrelated refresh of the same metric', async () => {
    const cache = makeCache({ visibleElementsChanged: false })
    const metrics = makeMetrics(cache)
    await select(metrics, 'centrality')

    const firstOption = metrics.multiselect.options[0]
    // decideToRenderOrDraw calls updateMetricUI on every render; with nothing
    // changed it must touch neither the algorithms nor the DOM.
    await metrics.updateMetricUI()
    expect(metrics.multiselect.options[0]).toBe(firstOption)
  })

  it('recomputes and repaints when the visible subgraph changed', async () => {
    const cache = makeCache({ visibleElementsChanged: false })
    const metrics = makeMetrics(cache)
    await select(metrics, 'centrality')

    const spy = vi.spyOn(metrics.m.centrality, 'calculate')
    cache.visibleElementsChanged = true
    await metrics.updateMetricUI()
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})
