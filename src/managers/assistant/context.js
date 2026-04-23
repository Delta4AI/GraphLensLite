// Builds a read-only snapshot of the current app state for the AI assistant.
// Contains no DOM writes; only reads from `cache` and one scoped DOM text query
// for the status log.

const MAX_SNAPSHOT_CHARS = 32000

function readRecentActions(maxLines) {
  const container = typeof document !== 'undefined'
    ? document.getElementById('sidebarStatusContainer')
    : null
  if (!container) return []
  return [...container.querySelectorAll('p')]
    .slice(-maxLines)
    .map(p => p.textContent.trim())
}

export function buildContextSnapshot(cache, {readActions = readRecentActions} = {}) {
  if (!cache.initialized) return {state: 'no graph loaded'}

  const cfg = cache.CFG.ASSISTANT
  const layout = cache.data.layouts?.[cache.data.selectedLayout]

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

  const propHierarchy = {}
  for (const [main, subs] of Object.entries(cache.uniquePropHierarchy || {})) {
    propHierarchy[main] = {}
    for (const [sub, props] of Object.entries(subs)) {
      propHierarchy[main][sub] = [...props]
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
