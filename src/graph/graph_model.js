/**
 * Node-safe graph model for the Sigma.js renderer (MIGRATION.md Phase 1).
 *
 * Builds the graphology instance from the app cache and provides the
 * G6-style → sigma attribute mapping plus the node/edge reducer factories.
 * Must never import the sigma bundle (directly or transitively) — vitest
 * imports this module under node.
 */
import { Graph } from "../lib/graphology.bundle.mjs";

// Former G6 state-spec colors (selected/highlight halo + fill, dim fill)
// from the old core.js Graph config. Phase 2 does full visual parity.
const STATE_ACCENT_COLOR = "#C33D35";
const STATE_DIM_COLOR = "#E4E3EA";

/**
 * Map a G6-shaped node style object to sigma node attributes.
 * Crude Phase-1 mapping; Phase 2 does full parity (shapes, borders, badges).
 * Only emits keys that are actually present on the style.
 *
 * @param {object} style  G6 node style ({x, y, size, fill, label, labelText, visibility, ...})
 * @returns {object} partial sigma attrs ({x?, y?, size?, color?, label?, hidden?})
 */
function nodeAttributesFromStyle(style = {}) {
  const attrs = {};
  if (Number.isFinite(style.x)) attrs.x = style.x;
  if (Number.isFinite(style.y)) attrs.y = style.y;
  if (style.size !== undefined) {
    // G6 size may be a number or [w, h] — take the first dimension.
    attrs.size = Array.isArray(style.size) ? style.size[0] : style.size;
  }
  if (style.fill !== undefined) attrs.color = style.fill;
  if (style.label === false) {
    attrs.label = null;
  } else if (style.label && style.labelText !== undefined) {
    attrs.label = style.labelText == null ? null : String(style.labelText);
  }
  if (style.visibility !== undefined) {
    attrs.hidden = style.visibility === "hidden";
  }
  return attrs;
}

/**
 * Map a G6-shaped edge style object to sigma edge attributes.
 * All edges render as straight lines in Phase 1 (curves/arrows are Phase 2).
 *
 * @param {object} style  G6 edge style ({lineWidth, stroke, label, labelText, visibility, ...})
 * @returns {object} partial sigma attrs ({size?, color?, label?, hidden?})
 */
function edgeAttributesFromStyle(style = {}) {
  const attrs = {};
  if (style.lineWidth !== undefined) attrs.size = style.lineWidth;
  if (style.stroke !== undefined) attrs.color = style.stroke;
  if (style.label === false) {
    attrs.label = null;
  } else if (style.label && style.labelText !== undefined) {
    attrs.label = style.labelText == null ? null : String(style.labelText);
  }
  if (style.visibility !== undefined) {
    attrs.hidden = style.visibility === "hidden";
  }
  return attrs;
}

/**
 * Deterministic placeholder coordinate for nodes without a position. Sigma
 * hard-requires numeric x/y on every node; the initial layout pass
 * overwrites these (see SigmaAdapter.render()).
 */
function placeholderPosition(index, total) {
  const angle = (2 * Math.PI * index) / Math.max(total, 1);
  const radius = 100 + 10 * Math.sqrt(Math.max(total, 1));
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/**
 * Build a graphology Graph from cache.nodeRef/edgeRef. Positions come from
 * the selected layout's persisted positions Map when present, else from the
 * node style, else a deterministic placeholder spread.
 *
 * @param {object} cache  app cache (needs nodeRef, edgeRef, data.layouts/selectedLayout)
 * @returns {Graph}
 */
function buildGraphologyGraph(cache) {
  const graph = new Graph({ multi: true, allowSelfLoops: true, type: "directed" });
  const positions = cache.data?.layouts?.[cache.data?.selectedLayout]?.positions;
  const total = cache.nodeRef.size;

  let index = 0;
  for (const node of cache.nodeRef.values()) {
    const mapped = nodeAttributesFromStyle(node.style ?? {});
    const persisted = positions?.get(node.id)?.style;
    const fallback = placeholderPosition(index, total);
    graph.addNode(node.id, {
      x: Number.isFinite(persisted?.x) ? persisted.x : (mapped.x ?? fallback.x),
      y: Number.isFinite(persisted?.y) ? persisted.y : (mapped.y ?? fallback.y),
      size: mapped.size,
      color: mapped.color,
      label: mapped.label ?? null,
      hidden: mapped.hidden ?? false,
      zIndex: 0,
    });
    index++;
  }

  for (const edge of cache.edgeRef.values()) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) {
      cache.ui?.debug?.(`Skipping edge ${edge.id}: missing endpoint node`);
      continue;
    }
    const mapped = edgeAttributesFromStyle(edge.style ?? {});
    graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
      size: mapped.size,
      color: mapped.color,
      label: mapped.label ?? null,
      hidden: mapped.hidden ?? false,
      zIndex: 0,
    });
  }

  return graph;
}

/**
 * Sigma nodeReducer factory. Reads the graphology `hidden` attribute plus the
 * app-level element-states Map (selected/highlight/dim, formerly G6 states).
 *
 * @param {object} cache
 * @param {Map<string, string[]>} elementStates
 */
function makeNodeReducer(cache, elementStates) {
  return (node, data) => {
    if (data.hidden) return data;
    const states = elementStates.get(node);
    if (!states || states.length === 0) return data;
    const res = { ...data };
    if (states.includes("selected")) {
      res.color = STATE_ACCENT_COLOR;
      res.zIndex = 1;
    } else if (states.includes("highlight")) {
      res.color = STATE_ACCENT_COLOR;
    } else if (states.includes("dim")) {
      res.color = STATE_DIM_COLOR;
    }
    return res;
  };
}

/**
 * Sigma edgeReducer factory. An edge is hidden when its own `hidden` attr is
 * set OR either endpoint is hidden/filtered.
 *
 * @param {object} cache  needs edgeRef and graphData (the live graphology graph)
 * @param {Map<string, string[]>} elementStates
 */
function makeEdgeReducer(cache, elementStates) {
  return (edge, data) => {
    if (data.hidden) return data;
    const ref = cache.edgeRef.get(edge);
    const graph = cache.graphData;
    if (ref && graph?.hasNode(ref.source) && graph.hasNode(ref.target)) {
      if (
        graph.getNodeAttribute(ref.source, "hidden") ||
        graph.getNodeAttribute(ref.target, "hidden")
      ) {
        return { ...data, hidden: true };
      }
    }
    const states = elementStates.get(edge);
    if (!states || states.length === 0) return data;
    const res = { ...data };
    if (states.includes("selected")) {
      res.color = STATE_ACCENT_COLOR;
      res.zIndex = 1;
    } else if (states.includes("highlight")) {
      res.color = STATE_ACCENT_COLOR;
    } else if (states.includes("dim")) {
      res.color = STATE_DIM_COLOR;
    }
    return res;
  };
}

export {
  buildGraphologyGraph,
  nodeAttributesFromStyle,
  edgeAttributesFromStyle,
  makeNodeReducer,
  makeEdgeReducer,
  STATE_ACCENT_COLOR,
  STATE_DIM_COLOR,
};
