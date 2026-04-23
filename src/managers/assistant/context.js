// Builds a read-only snapshot of the current app state for the AI assistant.
// Contains no DOM writes; only reads from `cache` and one scoped DOM text query
// for the status log.

const MAX_SNAPSHOT_CHARS = 32000
// Category cap per property — a single categorical field with thousands of
// distinct values would blow the snapshot budget. 50 is enough to anchor the
// model on the naming convention without shipping an encyclopedia.
const MAX_CATEGORY_VALUES_PER_PROP = 50

function readRecentActions(maxLines) {
  const container = typeof document !== 'undefined'
    ? document.getElementById('sidebarStatusContainer')
    : null
  if (!container) return []
  return [...container.querySelectorAll('p')]
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

export function buildContextSnapshot(cache, {readActions = readRecentActions} = {}) {
  if (!cache.initialized) return {state: 'no graph loaded'}

  const cfg = cache.CFG.ASSISTANT
  const layout = cache.data.layouts?.[cache.data.selectedLayout]
  const filterDefaults = cache.data?.filterDefaults

  const selectedNodeSample = [...cache.selectedNodes].slice(0, cfg.MAX_CONTEXT_NODES).map(id => {
    const n = cache.nodeRef.get(id)
    return {id, label: n?.label ?? null}
  })
  const selectedEdgeSample = [...cache.selectedEdges].slice(0, cfg.MAX_CONTEXT_NODES).map(id => {
    const e = cache.edgeRef.get(id)
    return {id, label: e?.label ?? null, source: e?.source, target: e?.target}
  })

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
      totalNodes: cache.nodeRef?.size ?? 0,
      totalEdges: cache.edgeRef?.size ?? 0,
      visibleNodes: cache.nodeIDsToBeShown.size,
      visibleEdges: cache.edgeIDsToBeShown.size,
      selectedNodes: cache.selectedNodes.size,
      selectedEdges: cache.selectedEdges.size,
      hiddenDangling: cache.hiddenDanglingNodeIDs.size,
    },
    selection: {nodes: selectedNodeSample, edges: selectedEdgeSample},
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
    recentActions: readActions(cfg.MAX_STATUS_LOG_LINES),
  }
}

// Serializes the snapshot and enforces a hard character ceiling so a huge
// graph cannot produce a multi-MB payload on every turn.
export function serializeSnapshot(snapshot, maxChars = MAX_SNAPSHOT_CHARS) {
  const json = JSON.stringify(snapshot, null, 2)
  if (json.length <= maxChars) return json
  return json.slice(0, maxChars) + `\n…[truncated: snapshot exceeded ${maxChars} chars]`
}
