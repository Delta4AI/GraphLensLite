/**
 * Node-safe graph model for the Sigma.js renderer (MIGRATION.md Phases 1-2).
 *
 * Builds the graphology instance from the app cache and provides the
 * G6-style → sigma attribute mapping plus the node/edge reducer factories.
 * Must never import the sigma bundle (directly or transitively) — vitest
 * imports this module under node.
 */
import { Graph } from "../lib/graphology.bundle.mjs";
import { DEFAULTS } from "../config.js";
import { shapeTextureURI, isTextureOnlyShape, HALO_EXTRA_PX } from "./shape_textures.js";

// Element interaction-state colors (former G6 state spec) live in config so
// the styling UI and the reducers share one source.
const STATE_ACCENT_COLOR = DEFAULTS.STATE.ACCENT_COLOR;
const STATE_DIM_COLOR = DEFAULTS.STATE.DIM_COLOR;

// Texture nodes paint their fill inside the SVG; the sigma `color` attribute
// must be fully transparent or the image quad shows a colored square.
const TRANSPARENT = "#00000000";

/**
 * The model boundary owns the y-axis convention flip: the app model (G6
 * heritage: nodeRef styles, persisted positions, Excel/JSON files) is
 * y-down, sigma/graphology is y-up. Negate exactly once when crossing in
 * either direction so legacy files keep their orientation and save→load
 * round-trips are stable.
 */
function flipY(y) {
  return -y;
}

/**
 * Map a G6 node style + type to sigma node attributes.
 * Only emits keys that are actually present on the style; shape-program
 * attributes (`type`/`shape`/`image`/...) are only emitted when `type` is
 * given. Shapes without a native sigma program — and any non-circle shape
 * with a border, which the native circle/square programs cannot draw —
 * render through the SVG texture program ("shape"); bordered circles render
 * through the @sigma/node-border GLSL program ("borderCircle").
 *
 * @param {object} style  G6 node style ({x, y, size, fill, stroke, lineWidth, label*, visibility, ...})
 * @param {string} [type] G6 node type (circle|diamond|hexagon|rect|triangle|star)
 * @returns {object} partial sigma attrs
 */
function nodeAttributesFromStyle(style = {}, type = undefined) {
  const attrs = {};
  if (Number.isFinite(style.x)) attrs.x = style.x;
  if (Number.isFinite(style.y)) attrs.y = flipY(style.y);
  if (style.size !== undefined) {
    // G6 size is a diameter (or [w, h]); sigma size is a radius.
    attrs.size = (Array.isArray(style.size) ? style.size[0] : style.size) / 2;
  }
  if (style.fill !== undefined) attrs.color = style.fill;
  if (style.stroke !== undefined) attrs.borderColor = style.stroke;
  if (style.lineWidth !== undefined) attrs.borderSize = style.lineWidth;

  if (style.label === false) {
    attrs.label = null;
  } else if (style.label && style.labelText !== undefined) {
    attrs.label = style.labelText == null ? null : String(style.labelText);
  }
  Object.assign(attrs, labelStyleAttributes(style));
  Object.assign(attrs, badgeAttributes(style));
  if (style.visibility !== undefined) {
    attrs.hidden = style.visibility === "hidden";
  }

  if (type !== undefined) Object.assign(attrs, nodeProgramAttributes(style, type));
  return attrs;
}

/**
 * Badge attrs (read by drawNodeLabel). Emitted whenever the style carries
 * explicit badge fields — including badge:false / empty arrays — because the
 * adapter merges attributes; omitting the keys on a badge_clear would leave
 * stale badges in graphology. Missing palette entries get the default badge
 * color baked in so the renderer needs no config import.
 */
function badgeAttributes(style) {
  if (style.badge === undefined && style.badges === undefined) return {};
  const badges = style.badge ? (style.badges ?? []) : [];
  const attrs = {
    badge: badges.length > 0,
    badges,
    badgePalette: badges.map((_, i) => style.badgePalette?.[i] ?? DEFAULTS.NODE.BADGE.COLOR),
  };
  if (badges.length > 0) {
    attrs.badgeFontSize = style.badgeFontSize ?? DEFAULTS.NODE.BADGE.FONT_SIZE;
    attrs.badgeScaleFactor = badgeScaleFactor(style);
  }
  return attrs;
}

/**
 * Zoom-independent badge scale factor, baked here (not in the renderer, which
 * only sees zoom-scaled display data and stays config-free). When
 * `badgeScaleWithNode` is on, badges grow/shrink with the node's model size
 * relative to the default node size; otherwise the factor is 1 (current
 * behavior). Recomputed on every restyle because the merged ref style always
 * carries `size` alongside the badge keys.
 *
 * @param {object} style  G6 node style ({size, badgeScaleWithNode, ...})
 * @returns {number} multiplier applied to badgeFontSize by the renderer
 */
function badgeScaleFactor(style) {
  const scaleWithNode = style.badgeScaleWithNode ?? DEFAULTS.NODE.BADGE.SCALE_WITH_NODE;
  if (!scaleWithNode) return 1;
  const diameter = Array.isArray(style.size) ? style.size[0] : style.size;
  return Number.isFinite(diameter) && diameter > 0 ? diameter / DEFAULTS.NODE.SIZE : 1;
}

/**
 * Shape-program attributes for a node: which sigma program draws it, plus
 * the texture data-URI when the SVG shape program is needed.
 *
 * Three programs and their attribute sets (the adapter applies updates via
 * mergeNodeAttributes, so every branch must overwrite/clear exactly what the
 * other branches set — a stale fillColor corrupts state textures on hover, a
 * stale TRANSPARENT color makes the node invisible, a stale image would
 * matter if the texture program saw it; the image program skips non-string
 * images, so null is safe):
 *   - "shape"        texture (fillColor, TRANSPARENT color, image, borderRatio 0)
 *   - "borderCircle" @sigma/node-border GLSL rings — bordered circles only
 *                    (color=fill, borderRatio, fillColor/image cleared)
 *   - native circle/square (color=fill, fillColor/image cleared, borderRatio 0)
 */
function nodeProgramAttributes(style = {}, type) {
  const fill = style.fill ?? DEFAULTS.NODE.FILL_COLOR;
  const stroke = style.stroke ?? null;
  const lineWidth = style.lineWidth ?? 0;
  const hasBorder = Boolean(stroke) && lineWidth > 0;
  const size = Array.isArray(style.size) ? style.size[0] : style.size;
  const radius = (size ?? DEFAULTS.NODE.SIZE) / 2;
  const attrs = { shape: type };

  if (isTextureOnlyShape(type) || (hasBorder && type !== "circle")) {
    attrs.type = "shape";
    attrs.fillColor = fill;
    attrs.color = TRANSPARENT;
    attrs.image = shapeTextureURI({
      shape: type,
      fill,
      stroke: hasBorder ? stroke : null,
      lineWidth: hasBorder ? lineWidth : 0,
      size: radius,
    });
    attrs.borderRatio = 0;
  } else if (hasBorder) {
    // Bordered circle: the node-border program draws border + fill as GLSL
    // rings (crisp at all zooms, no texture atlas churn). The border ring is
    // a fraction of the radius so it scales with zoom exactly like the baked
    // textures (and G6) did. State halos still go through the texture path —
    // applyNodeState reads fillColor ?? color / borderColor / borderSize,
    // all coherent here.
    attrs.type = "borderCircle";
    attrs.color = fill;
    attrs.fillColor = null;
    attrs.image = null;
    attrs.borderRatio = radius > 0 ? Math.min(lineWidth / radius, 1) : 1;
  } else {
    attrs.type = type === "rect" ? "square" : "circle";
    attrs.color = fill;
    attrs.fillColor = null;
    attrs.image = null;
    attrs.borderRatio = 0;
    // Unconditionally clear border attrs: a style delta that drops the border
    // without an explicit stroke key (e.g. {lineWidth: 0} on the no-nodeRef
    // fallback path) would otherwise leave a stale borderColor in graphology,
    // which applyNodeState bakes into halo textures.
    attrs.borderColor = null;
    attrs.borderSize = 0;
  }
  return attrs;
}

/**
 * Shared label styling attrs (read by the custom label renderers).
 * G6 names → renderer attrs; only present keys are emitted.
 */
function labelStyleAttributes(style) {
  const attrs = {};
  if (style.labelFontSize !== undefined) attrs.labelSize = style.labelFontSize;
  if (style.labelFill !== undefined) attrs.labelColor = style.labelFill;
  if (style.labelBackground !== undefined) attrs.labelBackground = style.labelBackground;
  if (style.labelBackgroundFill !== undefined) attrs.labelBackgroundColor = style.labelBackgroundFill;
  if (style.labelPlacement !== undefined) attrs.labelPlacement = style.labelPlacement;
  if (style.labelOffsetX !== undefined) attrs.labelOffsetX = style.labelOffsetX;
  if (style.labelOffsetY !== undefined) attrs.labelOffsetY = style.labelOffsetY;
  if (style.labelPadding !== undefined) attrs.labelPadding = style.labelPadding;
  if (style.labelAutoRotate !== undefined) attrs.labelAutoRotate = style.labelAutoRotate;
  return attrs;
}

/**
 * Edge end-marker vocabulary. The numeric codes are the `startMarker` /
 * `endMarker` float attrs consumed by the WebGL marker-head program
 * (edge_programs.js), which selects the SDF in its fragment shader:
 *   arrow (directional triangle), rect, diamond, circle,
 *   tee (⊣ inhibition bar, pharmacology-style).
 * Legacy G6 arrow-type names map onto the nearest new marker so old files
 * keep rendering; the original string still round-trips via the edge style.
 */
const EDGE_MARKERS = { arrow: 1, rect: 2, diamond: 3, circle: 4, tee: 5 };
const LEGACY_MARKER_ALIASES = {
  triangle: "arrow",
  vee: "arrow",
  simple: "arrow",
  triangleRect: "rect",
  square: "rect",
};

/** @returns {number} marker code for an arrow-type string (unknown → arrow) */
function edgeMarkerCode(arrowType) {
  const name = LEGACY_MARKER_ALIASES[arrowType] ?? arrowType;
  return EDGE_MARKERS[name] ?? EDGE_MARKERS.arrow;
}

/** Effective halo width in px: 0 unless halo is enabled with a positive width. */
function edgeHaloWidth(style) {
  const width = style.haloLineWidth ?? DEFAULTS.EDGE.HALO.WIDTH;
  return style.halo && width > 0 ? width : 0;
}

/**
 * Sigma edge program key for a G6 edge type + marker/halo styling.
 * Two parametric programs per curvature: the plain fast path ("line"/"curve")
 * for the unstyled majority, and the compound halo+line+marker-heads program
 * ("styledLine"/"styledCurve") whenever any end marker or halo is active —
 * the per-edge attrs (start/endMarker, haloWidth, ...) parameterize it, so
 * the registry never grows with the marker vocabulary.
 * Degradations (documented in API.md §5): `polyline` renders as a curve,
 * `lineDash` is dropped.
 */
function sigmaEdgeType(type, style = {}) {
  const curved = type === "cubic" || type === "quadratic" || type === "polyline";
  const styled = Boolean(style.startArrow) || Boolean(style.endArrow) || edgeHaloWidth(style) > 0;
  if (curved) return styled ? "styledCurve" : "curve";
  return styled ? "styledLine" : "line";
}

/**
 * Marker + halo attrs read by the custom edge programs. Always emits the
 * FULL set (off → 0/null): the adapter applies updates via
 * mergeEdgeAttributes, so every toggle must overwrite what the previous
 * style set or stale markers/halos survive a disable. Sizes are graph-space
 * px (G6 arrow-size heritage); 0 means "derive from edge thickness" (sigma
 * stock-arrow proportions).
 */
function edgeMarkerHaloAttributes(style) {
  const haloWidth = edgeHaloWidth(style);
  return {
    startMarker: style.startArrow ? edgeMarkerCode(style.startArrowType) : 0,
    startMarkerSize:
      Number.isFinite(style.startArrowSize) && style.startArrowSize > 0 ? style.startArrowSize : 0,
    // null fill → marker program inherits the edge stroke color; null border → no border.
    startMarkerColor: style.startArrow ? (style.startArrowColor ?? null) : null,
    startMarkerBorderColor: style.startArrow ? (style.startArrowBorderColor ?? null) : null,
    // Border band thickness in px; 0 → auto (proportional to the marker).
    startMarkerBorderSize:
      style.startArrow && Number.isFinite(style.startArrowBorderSize) && style.startArrowBorderSize > 0
        ? style.startArrowBorderSize
        : 0,
    endMarker: style.endArrow ? edgeMarkerCode(style.endArrowType) : 0,
    endMarkerSize:
      Number.isFinite(style.endArrowSize) && style.endArrowSize > 0 ? style.endArrowSize : 0,
    endMarkerColor: style.endArrow ? (style.endArrowColor ?? null) : null,
    endMarkerBorderColor: style.endArrow ? (style.endArrowBorderColor ?? null) : null,
    endMarkerBorderSize:
      style.endArrow && Number.isFinite(style.endArrowBorderSize) && style.endArrowBorderSize > 0
        ? style.endArrowBorderSize
        : 0,
    haloWidth,
    haloColor: haloWidth > 0 ? (style.haloStroke ?? DEFAULTS.EDGE.HALO.COLOR) : null,
  };
}

/**
 * Map a G6 edge style + type to sigma edge attributes.
 *
 * Like the node mapper, the program-dependent attrs (type + marker/halo set)
 * are only emitted when `type` is given — the adapter always maps from the
 * merged ref (full style), so the set is complete and coherent there.
 *
 * @param {object} style  G6 edge style ({lineWidth, stroke, *Arrow*, halo*, label*, visibility, ...})
 * @param {string} [type] G6 edge type (line|cubic|quadratic|polyline)
 * @returns {object} partial sigma attrs
 */
function edgeAttributesFromStyle(style = {}, type = undefined) {
  const attrs = {};
  if (style.lineWidth !== undefined) attrs.size = style.lineWidth;
  if (style.stroke !== undefined) attrs.color = style.stroke;
  if (style.label === false) {
    attrs.label = null;
  } else if (style.label && style.labelText !== undefined) {
    attrs.label = style.labelText == null ? null : String(style.labelText);
  }
  Object.assign(attrs, labelStyleAttributes(style));
  if (style.visibility !== undefined) {
    attrs.hidden = style.visibility === "hidden";
  }
  if (type !== undefined) {
    attrs.type = sigmaEdgeType(type, style);
    Object.assign(attrs, edgeMarkerHaloAttributes(style));
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
 * the selected layout's persisted positions Map when present (app-model
 * y-down → flipped), else from the node style (flipped by the mapper), else
 * a deterministic placeholder spread (already in sigma space).
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
    const mapped = nodeAttributesFromStyle(node.style ?? {}, node.type);
    const persisted = positions?.get(node.id)?.style;
    const fallback = placeholderPosition(index, total);
    graph.addNode(node.id, {
      ...mapped,
      x: Number.isFinite(persisted?.x) ? persisted.x : (mapped.x ?? fallback.x),
      y: Number.isFinite(persisted?.y) ? flipY(persisted.y) : (mapped.y ?? fallback.y),
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
    const mapped = edgeAttributesFromStyle(edge.style ?? {}, edge.type);
    graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
      ...mapped,
      label: mapped.label ?? null,
      hidden: mapped.hidden ?? false,
      zIndex: 0,
    });
  }

  return graph;
}

/**
 * State treatment for a node, per the old G6 state spec:
 *   selected  → own fill, accent halo ring, raised zIndex
 *   highlight → accent fill, accent halo ring
 *   dim       → dim fill
 * Halo states render through the texture program (the only sigma mechanism
 * that draws a ring around non-circular shapes); the node grows by
 * HALO_EXTRA_PX so the halo bleeds outward like G6's did. Halos stay on the
 * texture path for ALL shapes — including borderCircle nodes — so there is a
 * single halo implementation; a node-border halo ring for circles would have
 * to visually match the SVG halo on the other five shapes forever. This works
 * unchanged for borderCircle data because its branch keeps fillColor ?? color,
 * borderColor and borderSize coherent (reducers never write to graphology, so
 * the transient type switch needs no merge hygiene).
 */
function applyNodeState(data, state) {
  const res = { ...data };
  const shape = data.shape ?? "circle";
  const baseSize = data.size ?? DEFAULTS.NODE.SIZE / 2;
  const fill = data.fillColor ?? data.color;
  const stroke = data.borderColor ?? null;
  const lineWidth = data.borderSize ?? 0;

  if (state === "dim" && data.type !== "shape") {
    res.color = STATE_DIM_COLOR;
    return res;
  }

  res.type = "shape";
  res.color = TRANSPARENT;
  res.image = shapeTextureURI({ shape, fill, stroke, lineWidth, size: baseSize, state });
  if (state !== "dim") res.size = baseSize + HALO_EXTRA_PX;
  return res;
}

/**
 * 1-degree hover neighborhood (G6 hover-activate parity): the element itself
 * plus, for a node, its neighbors and incident edges, or, for an edge, its
 * two endpoints. Hidden members are harmless to include — the reducers bail
 * out on hidden elements before consulting hover state.
 *
 * @param {import("../lib/graphology.bundle.mjs").Graph} graph
 * @param {string} id  node or edge key
 * @param {boolean} isEdge
 * @returns {Set<string>}
 */
function hoverNeighborhood(graph, id, isEdge) {
  const ids = new Set([id]);
  if (isEdge) {
    if (graph.hasEdge(id)) {
      for (const nodeId of graph.extremities(id)) ids.add(nodeId);
    }
    return ids;
  }
  if (graph.hasNode(id)) {
    for (const neighbor of graph.neighbors(id)) ids.add(neighbor);
    for (const edge of graph.edges(id)) ids.add(edge);
  }
  return ids;
}

/**
 * Hover layer is separate from the selection-bearing elementStates Map so a
 * hover/leave cycle can never corrupt selection: a non-empty hoverIds Set
 * means "hover active" — members render highlighted, every other visible
 * element dims. Selection wins over hover so selected elements stay
 * recognizable while the rest of the graph dims.
 */
function hoverStateFor(id, hoverIds) {
  if (hoverIds.size === 0) return null;
  return hoverIds.has(id) ? "highlight" : "dim";
}

/**
 * Sigma nodeReducer factory. Reads the graphology `hidden` attribute, the
 * app-level element-states Map (selected/highlight/dim, formerly G6 states)
 * and the hover layer (see hoverStateFor).
 *
 * @param {object} cache
 * @param {Map<string, string[]>} elementStates
 * @param {Set<string>} [hoverIds]  production code MUST pass the shared Set
 *   mutated by InteractionManager — the default creates a fresh (permanently
 *   empty) Set and exists only so node tests can omit hover wiring
 */
function makeNodeReducer(cache, elementStates, hoverIds = new Set()) {
  return (node, data) => {
    if (data.hidden) return data;
    const states = elementStates.get(node) ?? [];
    const hoverState = hoverStateFor(node, hoverIds);
    if (states.includes("selected")) {
      return { ...applyNodeState(data, "selected"), zIndex: 1 };
    }
    if (states.includes("highlight") || hoverState === "highlight") {
      return applyNodeState(data, "highlight");
    }
    if (states.includes("dim") || hoverState === "dim") return applyNodeState(data, "dim");
    return data;
  };
}

/**
 * Sigma edgeReducer factory. An edge is hidden when its own `hidden` attr is
 * set OR either endpoint is hidden/filtered. States: selected = accent +
 * widened (the emphasis budget), highlight = accent, dim = de-emphasis color.
 * User halos compose with selection by construction: the halo program derives
 * its width from the post-reducer `size` (+ 2 × haloWidth), so a selected
 * edge's halo widens with the line while keeping its own color.
 *
 * @param {object} cache  needs edgeRef and graphData (the live graphology graph)
 * @param {Map<string, string[]>} elementStates
 * @param {Set<string>} [hoverIds]
 */
function makeEdgeReducer(cache, elementStates, hoverIds = new Set()) {
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
    const states = elementStates.get(edge) ?? [];
    const hoverState = hoverStateFor(edge, hoverIds);
    if (states.length === 0 && hoverState === null) return data;
    const res = { ...data };
    if (states.includes("selected")) {
      res.color = STATE_ACCENT_COLOR;
      res.size = (data.size ?? 1) + DEFAULTS.STATE.EDGE_HALO_WIDTH / 2;
      res.zIndex = 1;
    } else if (states.includes("highlight") || hoverState === "highlight") {
      res.color = STATE_ACCENT_COLOR;
    } else if (states.includes("dim") || hoverState === "dim") {
      res.color = STATE_DIM_COLOR;
    }
    return res;
  };
}

export {
  buildGraphologyGraph,
  nodeAttributesFromStyle,
  edgeAttributesFromStyle,
  sigmaEdgeType,
  edgeMarkerCode,
  EDGE_MARKERS,
  flipY,
  hoverNeighborhood,
  makeNodeReducer,
  makeEdgeReducer,
  STATE_ACCENT_COLOR,
  STATE_DIM_COLOR,
};
