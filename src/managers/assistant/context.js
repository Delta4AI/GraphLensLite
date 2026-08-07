// Builds a read-only snapshot of the current app state for the AI assistant.
// Contains no DOM writes; only reads from `cache` and one scoped DOM text query
// for the status log.
//
// Payload sizing is the caller's responsibility: pass `maxStatusLogLines`
// into buildContextSnapshot and `maxChars` into serializeSnapshot. The hard
// ceilings that used to live here (MAX_CONTEXT_NODES, MAX_SNAPSHOT_CHARS,
// SELECTION_DETAILS_BUDGET_CHARS) have moved into user-configurable settings
// or been removed entirely — the one exception is MAX_CATEGORY_VALUES_PER_PROP
// below, which is a structural defense against a single property with
// thousands of distinct categorical values ballooning the hierarchy dump.

// Category cap per property — a single categorical field with thousands of
// distinct values would blow the snapshot budget. 50 is enough to anchor the
// model on the naming convention without shipping an encyclopedia.
const MAX_CATEGORY_VALUES_PER_PROP = 50

// cache.selectedNodes / selectedEdges are *documented* as Sets but a number
// of code paths (undo/redo, metrics "add to selection", reselect-after-graph-
// update) replace them with plain Arrays. Reading `.size` on an Array yields
// undefined, which silently dropped selection counts out of graph_state.
function sizeOf(container) {
  if (!container) return 0
  if (typeof container.size === 'number') return container.size
  if (typeof container.length === 'number') return container.length
  return 0
}

// Flatten the element's nested D4Data property store into a flat
// Section::Sub::Prop → value map, dropping empty/null values so the assistant
// isn't distracted by them. See query.js #readValue for the source shape.
function flattenElementProperties(element) {
  const out = {}
  const d4 = element?.D4Data
  if (!d4 || typeof d4 !== 'object') return out
  for (const [section, subs] of Object.entries(d4)) {
    if (!subs || typeof subs !== 'object') continue
    for (const [sub, props] of Object.entries(subs)) {
      if (!props || typeof props !== 'object') continue
      for (const [prop, value] of Object.entries(props)) {
        if (value === null || value === undefined || value === '') continue
        out[`${section}::${sub}::${prop}`] = value
      }
    }
  }
  return out
}

// Attach per-element property dumps to each selection sample entry. There
// is no budget — the serializeSnapshot() caller is the single point where
// the final payload gets sliced if it's oversize.
function decorateSelectionWithProperties(sample, refMap) {
  for (const entry of sample) {
    const element = refMap.get(entry.id)
    if (!element) continue
    const props = flattenElementProperties(element)
    if (Object.keys(props).length) entry.properties = props
  }
  return sample
}

// Attach pre-computed network-metric values to selection entries for any
// metric the user has already calculated (the default centrality is
// auto-computed on graph load; the others compute on explicit selection in
// the metrics panel). This lets the assistant answer questions like
// "which of these has the highest centrality?" directly from values in
// graph_state, instead of hallucinating or hedging.
//
// `metricCache` shape: Map<metricId, {label, valueLabel, values: Map<nodeId, number>}>
// Output shape per entry: entry.metrics = {centrality: 0.37, pagerank: 0.012, …}
function decorateSelectionWithMetrics(sample, metricCache) {
  if (!metricCache || typeof metricCache.entries !== 'function') return sample
  for (const entry of sample) {
    const metrics = {}
    for (const [metricId, cached] of metricCache.entries()) {
      const v = cached?.values?.get?.(entry.id)
      if (typeof v === 'number' && Number.isFinite(v)) {
        metrics[metricId] = v
      }
    }
    if (Object.keys(metrics).length) entry.metrics = metrics
  }
  return sample
}

function readRecentActions(maxLines) {
  const container = typeof document !== 'undefined'
    ? document.getElementById('sidebarStatusContainer')
    : null
  if (!container) return []
  // Lines marked sensitive are excluded: the Neo4j query log reproduces the
  // user's Cypher verbatim, literal identifiers and all, and this goes to the
  // configured LLM endpoint.
  return [...container.querySelectorAll('p:not([data-sensitive])')]
    .slice(-maxLines)
    .map(p => p.textContent.trim())
}

// Derive the compact per-property metadata the model needs in order to pick a
// valid operator. Returns null for properties that have no filterDefaults
// entry (unloaded, excluded at load-time due to type collision, etc.) — the
// caller then keeps the bare name so the hierarchy stays complete.
function describeProperty(filterDefaults, propID) {
  const def = filterDefaults?.get?.(propID)
  if (!def) return {type: 'unknown'}
  if (def.unusable) return {type: 'unusable'}
  if (def.isBoolean) return {type: 'boolean'}

  if (def.isCategory) {
    const allValues = def.categories ? [...def.categories] : []
    const truncated = allValues.length > MAX_CATEGORY_VALUES_PER_PROP
    const values = truncated ? allValues.slice(0, MAX_CATEGORY_VALUES_PER_PROP) : allValues
    const out = {type: 'categorical', values}
    if (truncated) {
      out.truncated = true
      out.totalValues = allValues.length
    }
    return out
  }

  const hasBounds = Number.isFinite(def.lowerThreshold) && Number.isFinite(def.upperThreshold)
  if (!hasBounds) return {type: 'unknown'}
  return {
    type: 'numeric',
    min: def.lowerThreshold,
    max: def.upperThreshold,
    integer: !def.hasFloatValues,
  }
}

export function buildContextSnapshot(cache, {
  readActions = readRecentActions,
  maxStatusLogLines = 20,
  minimalSelection = false,
} = {}) {
  if (!cache.initialized) return {state: 'no graph loaded'}

  const layout = cache.data.layouts?.[cache.data.selectedLayout]
  const filterDefaults = cache.data?.filterDefaults

  const totalSelectedNodes = sizeOf(cache.selectedNodes)
  const totalSelectedEdges = sizeOf(cache.selectedEdges)

  // minimalSelection: drop the per-element samples entirely. counts +
  // properties.hierarchy still flow through, so the model knows totals and
  // what fields exist, but cannot enumerate individual elements. Used by
  // the over-budget modal as a one-shot token-reduction option.
  let selectedNodeSample
  let selectedEdgeSample
  if (minimalSelection) {
    selectedNodeSample = []
    selectedEdgeSample = []
  } else {
    selectedNodeSample = [...cache.selectedNodes].map(id => {
      const n = cache.nodeRef.get(id)
      return {id, label: n?.label ?? null}
    })
    selectedEdgeSample = [...cache.selectedEdges].map(id => {
      const e = cache.edgeRef.get(id)
      return {id, label: e?.label ?? null, source: e?.source, target: e?.target}
    })
    // Attach per-element property values so the assistant can reason about
    // what's actually in the current selection, not just IDs.
    decorateSelectionWithProperties(selectedNodeSample, cache.nodeRef)
    decorateSelectionWithProperties(selectedEdgeSample, cache.edgeRef)
    // Attach pre-computed metric values (centrality etc.) where available —
    // node-only in GLL. The model now sees concrete scores instead of just
    // knowing "centrality exists".
    decorateSelectionWithMetrics(selectedNodeSample, cache.metrics?.metricValueCache)
  }

  const activeFilters = []
  if (layout?.filters) {
    for (const [propID, fObj] of layout.filters.entries()) {
      if (fObj.active !== false) activeFilters.push(propID)
    }
  }

  const bubbleGroups = {}
  for (const [g, s] of cache.lastBubbleSetMembers.entries()) {
    bubbleGroups[g] = s.size
  }

  // Hierarchy is a 3-level tree: Section → Group → {propName: typeInfo}.
  // Shipping type info lets the model pick BETWEEN for numeric fields and
  // IN [...] for categorical fields without guessing.
  const propHierarchy = {}
  for (const [main, subs] of Object.entries(cache.uniquePropHierarchy || {})) {
    propHierarchy[main] = {}
    for (const [sub, props] of Object.entries(subs)) {
      propHierarchy[main][sub] = {}
      for (const prop of props) {
        const propID = `${main}::${sub}::${prop}`
        propHierarchy[main][sub][prop] = describeProperty(filterDefaults, propID)
      }
    }
  }

  return {
    app: {version: cache.VERSION},
    workspace: {
      current: cache.data.selectedLayout,
      all: cache.data.layouts ? Object.keys(cache.data.layouts) : [],
      hideDisconnected: layout?.hideDisconnectedNodes ?? false,
      hasCustomQuery: !!(layout?.query),
    },
    counts: {
      totalNodes: sizeOf(cache.nodeRef),
      totalEdges: sizeOf(cache.edgeRef),
      visibleNodes: sizeOf(cache.nodeIDsToBeShown),
      visibleEdges: sizeOf(cache.edgeIDsToBeShown),
      selectedNodes: totalSelectedNodes,
      selectedEdges: totalSelectedEdges,
      hiddenDangling: sizeOf(cache.hiddenDanglingNodeIDs),
    },
    selection: minimalSelection
      ? {
          note: 'selection samples omitted to fit context budget — counts.selectedNodes / selectedEdges still reflect the real totals',
          nodesOmitted: totalSelectedNodes,
          edgesOmitted: totalSelectedEdges,
        }
      : {nodes: selectedNodeSample, edges: selectedEdgeSample},
    filters: {
      activeFilterProps: activeFilters,
      query: {text: cache.query.text, valid: cache.query.valid},
    },
    properties: {hierarchy: propHierarchy},
    bubbleGroups,
    metrics: {
      selected: cache.metrics?.selected ?? null,
      cached: cache.metrics?.metricValueCache ? [...cache.metrics.metricValueCache.keys()] : [],
    },
    recentActions: readActions(maxStatusLogLines),
  }
}

// Serializes the snapshot to JSON. No trimming or truncation — the
// over-budget modal in AssistantManager is now the single policy layer for
// "this payload is too big". Callers that want a shrunken payload rebuild
// the snapshot with `minimalSelection: true`.
export function serializeSnapshot(snapshot) {
  return JSON.stringify(snapshot, null, 2)
}
