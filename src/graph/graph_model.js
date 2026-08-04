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
import { pieAttributesFromSlices } from "./pie_slices.js";

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
  if (style.fill !== undefined) attrs.color = applyHexOpacity(style.fill, style.opacity);
  if (style.stroke !== undefined) attrs.borderColor = applyHexOpacity(style.stroke, style.opacity);
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

  // Pie-chart override: orthogonal to the shape vocabulary — a non-empty
  // pieSlices list routes the node to the @sigma/node-piechart program
  // (type "pie") regardless of its underlying shape. Clearing pie (empty/absent
  // pieSlices) leaves the shape attrs above in force. The stale texture attrs
  // are nulled so a shape→pie switch can't smuggle a leftover image quad.
  if (Array.isArray(style.pieSlices) && style.pieSlices.length > 0) {
    Object.assign(
      attrs,
      pieAttributesFromSlices(style.pieSlices, DEFAULTS.NODE.PIE.MAX_SLICES, DEFAULTS.NODE.PIE.DEFAULT_COLOR),
    );
    attrs.image = null;
    attrs.fillColor = null;
    attrs.borderRatio = 0;
  }
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
  // Opacity folds into the fill/stroke alpha here so it reaches every program:
  // the baked SVG texture (shape), the border rings (borderCircle) and the
  // native circle/square fill alike. applyHexOpacity is null/opaque-safe.
  const fill = applyHexOpacity(style.fill ?? DEFAULTS.NODE.FILL_COLOR, style.opacity);
  const stroke = applyHexOpacity(style.stroke ?? null, style.opacity);
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
 * Edge flow-overlay vocabulary. The numeric codes are the `flowMode` float
 * attr consumed by the WebGL flow program (edge_flow_programs.js), which
 * selects the pattern in its fragment shader: dash (marching dash segments),
 * pulse (discrete travelling dots), comet (sharp head with a fading tail) or
 * chevron (travelling arrow shapes). 0 = no flow (the program collapses the
 * quad to zero fragments, like disabled halos/markers).
 */
const FLOW_MODES = { dash: 1, pulse: 2, comet: 3, chevron: 4 };

/** @returns {number} flow mode code: 0 unless flow is enabled (unknown type → dash) */
function edgeFlowMode(style) {
  if (!style.flow) return 0;
  return FLOW_MODES[style.flowType ?? DEFAULTS.EDGE.FLOW.TYPE] ?? FLOW_MODES.dash;
}

// Default flow color = the edge stroke mixed this far toward white, so the
// overlay contrasts with the body it travels on without a config color.
const FLOW_LIGHTEN_AMOUNT = 0.45;

/**
 * Mix a hex color toward white in RGB space, preserving alpha. Accepts
 * #rgb/#rgba/#rrggbb/#rrggbbaa; anything else (named colors, rgb() strings)
 * is returned unchanged — lightening is best-effort for the flow default,
 * not a general color parser.
 *
 * @param {string} hex
 * @param {number} amount  0 = identity (normalized to long form), 1 = white
 * @returns {string} #rrggbb or #rrggbbaa (lowercase)
 */
function lightenHexColor(hex, amount) {
  if (typeof hex !== "string" || !/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) {
    return hex;
  }
  let digits = hex.slice(1);
  if (digits.length <= 4) {
    digits = [...digits].map((d) => d + d).join("");
  }
  const t = Math.min(Math.max(amount, 0), 1);
  const channel = (i) => {
    const value = parseInt(digits.slice(i, i + 2), 16);
    return Math.round(value + (255 - value) * t)
      .toString(16)
      .padStart(2, "0");
  };
  const alpha = digits.length === 8 ? digits.slice(6, 8).toLowerCase() : "";
  return `#${channel(0)}${channel(2)}${channel(4)}${alpha}`;
}

/**
 * Multiply a hex color's alpha channel by `opacity` (flow-overlay prominence
 * knob — the programs alpha-blend, so opacity folds into the color CPU-side
 * with zero shader cost). Same best-effort contract as lightenHexColor:
 * non-hex strings and opacity ≥ 1 return the input unchanged.
 *
 * @param {string} hex
 * @param {number} opacity  clamped to [0, 1]
 * @returns {string} #rrggbbaa (lowercase) when applied, else the input
 */
function applyHexOpacity(hex, opacity) {
  if (!(Number.isFinite(opacity) && opacity < 1)) return hex;
  if (typeof hex !== "string" || !/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) {
    return hex;
  }
  let digits = hex.slice(1).toLowerCase();
  if (digits.length <= 4) {
    digits = [...digits].map((d) => d + d).join("");
  }
  const baseAlpha = digits.length === 8 ? parseInt(digits.slice(6, 8), 16) : 255;
  const alpha = Math.round(baseAlpha * Math.max(opacity, 0))
    .toString(16)
    .padStart(2, "0");
  return `#${digits.slice(0, 6)}${alpha}`;
}

/**
 * Sigma edge program key for a G6 edge type + marker/halo/flow styling.
 * Two parametric programs per curvature: the plain fast path ("line"/"curve")
 * for the unstyled majority, and the compound halo+line+flow+marker-heads
 * program ("styledLine"/"styledCurve") whenever any end marker, halo or flow
 * is active — the per-edge attrs (start/endMarker, haloWidth, flowMode, ...)
 * parameterize it, so the registry never grows with the marker vocabulary.
 * Flow on curved edges routes to "styledCurve", whose flow sub-program forks
 * the @sigma/edge-curve shaders (createCurveFlowProgram + edge_flow_glsl.js).
 * Degradations (documented in API.md §5): `polyline` renders as a curve,
 * `lineDash` is dropped.
 */
function sigmaEdgeType(type, style = {}) {
  const curved = type === "cubic" || type === "quadratic" || type === "polyline";
  const styled =
    Boolean(style.startArrow) ||
    Boolean(style.endArrow) ||
    edgeHaloWidth(style) > 0 ||
    edgeFlowMode(style) > 0;
  if (curved) return styled ? "styledCurve" : "curve";
  return styled ? "styledLine" : "line";
}

/**
 * Marker + halo + flow attrs read by the custom edge programs. Always emits
 * the FULL set (off → 0/null): the adapter applies updates via
 * mergeEdgeAttributes, so every toggle must overwrite what the previous
 * style set or stale markers/halos/flows survive a disable. Sizes are
 * graph-space px (G6 arrow-size heritage); 0 means "derive from edge
 * thickness" (sigma stock-arrow proportions).
 */
function edgeMarkerHaloAttributes(style) {
  const haloWidth = edgeHaloWidth(style);
  const flowMode = edgeFlowMode(style);
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
    flowMode,
    // Speed is a unitless multiplier on the shader's base px/s; non-finite or
    // non-positive values fall back to the default rather than freezing/reversing.
    flowSpeed:
      flowMode > 0
        ? Number.isFinite(style.flowSpeed) && style.flowSpeed > 0
          ? style.flowSpeed
          : DEFAULTS.EDGE.FLOW.SPEED
        : 0,
    // Explicit flow color wins; unset derives a lighter shade of the stroke
    // so the overlay contrasts with the body without configuration. The
    // opacity knob multiplies into the color's alpha (no shader involvement).
    flowColor:
      flowMode > 0
        ? applyHexOpacity(
            style.flowStroke ?? lightenHexColor(style.stroke ?? DEFAULTS.EDGE.COLOR, FLOW_LIGHTEN_AMOUNT),
            Number.isFinite(style.flowOpacity) ? style.flowOpacity : DEFAULTS.EDGE.FLOW.OPACITY,
          )
        : null,
    // Pattern-period multiplier (higher = sparser). Neutral 1 when off or
    // invalid — the shaders divide by it, so it must stay positive.
    flowDensity:
      flowMode > 0 && Number.isFinite(style.flowDensity) && style.flowDensity > 0
        ? style.flowDensity
        : 1,
  };
}

/**
 * Map a G6 edge style + type to sigma edge attributes.
 *
 * Like the node mapper, the program-dependent attrs (type + marker/halo/flow
 * set) are only emitted when `type` is given — the adapter always maps from
 * the merged ref (full style), so the set is complete and coherent there.
 *
 * @param {object} style  G6 edge style ({lineWidth, stroke, *Arrow*, halo*, flow*, label*, visibility, ...})
 * @param {string} [type] G6 edge type (line|cubic|quadratic|polyline)
 * @returns {object} partial sigma attrs
 */
function edgeAttributesFromStyle(style = {}, type = undefined) {
  const attrs = {};
  if (style.lineWidth !== undefined) attrs.size = style.lineWidth;
  if (style.stroke !== undefined) attrs.color = applyHexOpacity(style.stroke, style.opacity);
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
 * Build the graph-space target map for a workspace-switch position tween
 * (consumed by sigma/utils animateNodes via SigmaAdapter.runLayoutTransition).
 * Persisted positions are app-model (y-down) → flipped into graphology's
 * y-up frame. Nodes absent from the graph or carrying non-finite coordinates
 * are skipped (a stale persisted id must not animate a missing node).
 *
 * @param {Map<string, {style?: {x:number, y:number}}>|null|undefined} positionsMap
 * @param {(id: string) => boolean} hasNode  graph membership predicate
 * @returns {{targets: Record<string, {x:number, y:number}>, count: number}}
 */
function buildLayoutTransitionTargets(positionsMap, hasNode) {
  const targets = {};
  let count = 0;
  if (!positionsMap) return { targets, count };
  for (const [id, pos] of positionsMap) {
    const x = pos?.style?.x;
    const y = pos?.style?.y;
    if (hasNode(id) && Number.isFinite(x) && Number.isFinite(y)) {
      targets[id] = { x, y: flipY(y) };
      count++;
    }
  }
  return { targets, count };
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
  // Pie nodes have no texture/halo path (the SVG halo draws a single-fill
  // shape, which would erase the slices). Emphasis is a size pop for
  // selected/highlight; dim is a no-op — the slice colors carry the data, so
  // there is no flat fill to dim toward. (Known limitation: pie nodes don't
  // de-emphasize on hover-dim; selection/hover still raise them via zIndex.)
  if (data.type === "pie") {
    if (state === "dim") return data;
    return { ...data, size: (data.size ?? DEFAULTS.NODE.SIZE / 2) + HALO_EXTRA_PX };
  }

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
 * two endpoints.
 *
 * Traversal respects the current filter state: a hidden edge is not a path to
 * a neighbor, and a hidden neighbor is not a member. Without that, hovering a
 * node lit up nodes it no longer has a visible edge to — the highlight claimed
 * a connection the filtered graph does not show.
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
    for (const edge of graph.edges(id)) {
      if (graph.getEdgeAttribute(edge, "hidden")) continue;
      const neighbor = graph.opposite(id, edge);
      if (graph.getNodeAttribute(neighbor, "hidden")) continue;
      ids.add(edge);
      ids.add(neighbor);
    }
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
 * Heatmap fade companion: while the density heatmap is on, every element
 * without an explicit/hover state fades so the field reads through (the
 * heatmap canvas sits BELOW nodes and edges — no ramp tuning can fix
 * occlusion; de-emphasizing the occluders can). Selection, highlight and hover
 * all keep their normal treatment. Read live off the cache each reducer call:
 * the layer's setters trigger sigma.refresh.
 *
 * This replaced a boolean that swapped `color` for an opaque grey, which did
 * not fade anything — an opaque grey node occludes the field exactly as much
 * as an opaque red one did.
 *
 * @returns {number} fade strength in [0, 1]; 0 means "leave the graph alone"
 */
function heatmapFade(cache) {
  const layer = cache.graph?.heatmapLayer;
  if (!layer?.heatmapEnabled) return 0;
  const fade = layer.settings?.fadeGraph;
  return Number.isFinite(fade) ? Math.min(Math.max(fade, 0), 1) : 0;
}

/**
 * Past this much fade the two big occluders — labels and edges — cut out
 * rather than fading further. Both are cutoffs for their own reason:
 *
 * Labels, because the color contract makes fading them unsafe. label_renderers
 * treats the baked "#000000" as "no explicit choice" so dark mode can flip it,
 * so writing an alpha'd black here would pin labels black on a dark ground. A
 * cutoff also takes the label background with it, which an alpha on the text
 * alone would leave sitting there opaque.
 *
 * Edges, because sigma blends with gl.blendFunc(ONE, ONE_MINUS_SRC_ALPHA) —
 * premultiplied — while neither its shaders nor ours emit premultiplied color.
 * The result at low alpha is `src.rgb + dst * (1 - a)`, i.e. ADDITIVE: a faded
 * edge brightens whatever is under it instead of disappearing, which paints
 * white hairballs across the density field. Verified live. Premultiplying the
 * shaders would fix it properly, but the default edge color is already
 * #403C5390, so that restyles every edge in the app and is its own change.
 * Nodes are unaffected — they fade through a baked texture, not the shader.
 */
const OCCLUDER_CUTOFF = 0.4;

/** Remaining opacity for a fade strength, quantized — see applyNodeFade. */
function fadeOpacity(fade) {
  return Math.max(0, Math.round((1 - fade) * FADE_STEPS) / FADE_STEPS);
}

// Texture keys include the fill and stroke colors, so a continuous slider
// would mint a new bake per alpha value per color and thrash the (full-clear)
// texture cache. 20 steps is finer than the eye reads and bounds the keyspace.
const FADE_STEPS = 20;

/**
 * Fade a node toward transparent. Mirrors applyNodeState's branching, because
 * the same three node shapes need the same three treatments.
 *
 * Textured shapes cannot fade through `color` — it is TRANSPARENT and the
 * pixels come from a baked SVG — so the alpha goes into the bake instead.
 * That needs no new bake axis: shapeTextureURI's fill already accepts a hex
 * carrying alpha, and its cache key already covers fill and stroke.
 */
function applyNodeFade(data, opacity) {
  // Pie nodes have no flat fill to fade, same limitation as the dim state.
  if (opacity >= 1 || data.type === "pie") return data;

  if (data.type !== "shape") {
    const res = { ...data, color: applyHexOpacity(data.color, opacity) };
    if (data.borderColor) res.borderColor = applyHexOpacity(data.borderColor, opacity);
    return res;
  }
  const stroke = data.borderColor ?? null;
  return {
    ...data,
    color: TRANSPARENT,
    image: shapeTextureURI({
      shape: data.shape ?? "circle",
      fill: applyHexOpacity(data.fillColor ?? data.color, opacity),
      stroke: stroke && applyHexOpacity(stroke, opacity),
      lineWidth: data.borderSize ?? 0,
      size: data.size ?? DEFAULTS.NODE.SIZE / 2,
    }),
  };
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
    const fade = heatmapFade(cache);
    if (!fade) return data;
    const faded = applyNodeFade(data, fadeOpacity(fade));
    return fade >= OCCLUDER_CUTOFF ? { ...faded, label: "" } : faded;
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
    if (states.length === 0 && hoverState === null) {
      const fade = heatmapFade(cache);
      if (!fade) return data;
      // Cut, never fade — see OCCLUDER_CUTOFF. A partially faded edge blends
      // additively and paints white over the field.
      return fade >= OCCLUDER_CUTOFF ? { ...data, hidden: true, label: "" } : data;
    }
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
  buildLayoutTransitionTargets,
  nodeAttributesFromStyle,
  edgeAttributesFromStyle,
  sigmaEdgeType,
  edgeMarkerCode,
  EDGE_MARKERS,
  FLOW_MODES,
  edgeFlowMode,
  lightenHexColor,
  applyHexOpacity,
  flipY,
  hoverNeighborhood,
  makeNodeReducer,
  makeEdgeReducer,
  STATE_ACCENT_COLOR,
  STATE_DIM_COLOR,
};
