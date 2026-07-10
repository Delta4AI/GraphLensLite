/**
 * Vector (SVG) export of the rendered graph scene (node-safe).
 *
 * WHY: the raster export (canvas snapshot) pixelates when embedded in
 * papers/slides; an SVG document scales forever. WebGL has no vector
 * readback, so this module re-derives the scene geometrically from the live
 * sigma instance: post-reducer display data (getNode/EdgeDisplayData),
 * framed→viewport projection and scaleSize give the exact on-screen CSS-px
 * geometry, and each painter below replicates one renderer:
 *
 *  - edges/halos/markers: edge_programs.js shader math (quadratic control
 *    point built in FRAMED space — the viewport y-flip changes handedness,
 *    so screen-space construction would mirror the curve);
 *  - nodes: sigma's circle/square programs, @sigma/node-border rings,
 *    the app's SVG texture quads ("shape") and @sigma/node-piechart slices;
 *  - labels/badges: label_renderers.js, including the baked-#000000 theme
 *    fallback and the upright-rotation normalization;
 *  - bubble groups: bubble_layer.js #drawGroup/#drawLabel.
 *
 * Split into collectSvgScene (sigma → flat primitive list) and
 * primitivesToSvg (pure serializer) so vitest can assert geometry and markup
 * independently. No sigma import, no DOM at module scope: the sigma instance
 * and a measureText(text, font) function are injected (duck-typed).
 *
 * SECURITY: labels and colors originate from user Excel/JSON files. Every
 * text node and attribute value is XML-escaped, and every paint value must
 * pass SAFE_PAINT_RE (same policy as shape_textures.js) or it falls back to
 * a neutral grey. 8-digit hex (#rrggbbaa) is converted to rgba() because
 * several SVG viewers (and all pre-CSS4 ones) reject hex alpha.
 */
import { DEFAULTS } from "../config.js";
import { outlineLabelAnchor } from "./bubble_geometry.js";
import { placementVector, BAKED_DEFAULT_LABEL_COLOR } from "./label_renderers.js";

// Conservative paint-value allowlist (shape_textures.js SAFE_PAINT_RE):
// hex/rgb()/hsl()/named colors pass; anything that could break out of an
// attribute (quotes, angle brackets, ampersands, colons) is rejected.
// url(#localref) passes intentionally (harmless: the document carries no
// <defs>); the missing ":" blocks url(javascript:…) and url(data:…).
const SAFE_PAINT_RE = /^[#a-zA-Z0-9(),.%\s-]+$/;
const FALLBACK_COLOR = "#999999";

// Geometry constants mirrored from the live renderers (kept literal here so
// this module never imports browser-only files; values are asserted by the
// visual-check pass, see tests).
const OUTLINE_STROKE_WIDTH = 2; // bubble_layer.js
const LABEL_STANDOFF_PX = 8; // bubble_layer.js
const BACKGROUND_RADIUS = 4; // label_renderers.js
const ANCHOR_GAP = 2; // label_renderers.js
const FALLBACK_LABEL_SIZE = 14; // label_renderers.js
const BADGE_TEXT_COLOR = "#FFFFFF";
const FALLBACK_BADGE_COLOR = "#C33D35";
const FALLBACK_BADGE_FONT_SIZE = 8;
const BADGE_PADDING = 2;
const BUBBLE_LABEL_FONT_FAMILY = "Arial, sans-serif"; // bubble_layer.js font string

// edge_programs.js marker shader constants.
const DEFAULT_EDGE_CURVATURE = 0.25; // @sigma/edge-curve default
const MARKER_LENGTH_RATIO = 2.5; // sigma stock-arrow length/thickness
const MARKER_AUTO_BORDER_FRACTION = 0.2; // shader borderFraction
const TEE_MIN_BAR_PX = 1.5; // shader: max(l * 0.3, 1.5)
const FULL_TURN_EPS = 1e-4; // pie slice spanning ~2π renders as a disc

const RAD_TO_DEG = 180 / Math.PI;

// --- untrusted-input plumbing ----------------------------------------------

/** @returns {number} value rounded to 2 decimals (keeps SVG files small) */
function round2(value) {
  return Math.round(value * 100) / 100;
}

// Compact decimal for a coordinate/length. Non-finite input (NaN radius from
// malformed style data) becomes "0": deterministic invisibility beats "NaN",
// an SVG parse error with viewer-dependent fallback.
function fmt(value) {
  return Number.isFinite(value) ? String(round2(value)) : "0";
}

/** @returns {string} value with &, <, >, " and ' XML-escaped */
function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&apos;";
  });
}

/**
 * Validate an untrusted paint value for embedding in an SVG attribute.
 * Rejected values fall back to a neutral grey; 8-digit hex is rewritten to
 * rgba() for viewer compatibility.
 *
 * @param {unknown} color  user-derived CSS color
 * @returns {string} a safe CSS color
 */
function safeColor(color) {
  if (typeof color !== "string" || color.length === 0 || !SAFE_PAINT_RE.test(color)) {
    return FALLBACK_COLOR;
  }
  const hex8 = /^#([0-9a-fA-F]{8})$/.exec(color);
  if (hex8) {
    const n = parseInt(hex8[1], 16);
    const alpha = Math.round(((n & 255) / 255) * 1000) / 1000;
    return `rgba(${(n >>> 24) & 255},${(n >>> 16) & 255},${(n >>> 8) & 255},${alpha})`;
  }
  return color;
}

/**
 * Whether a color paints anything (non-zero alpha). Only formats that can
 * carry alpha are inspected; every other parseable format is opaque.
 *
 * @param {unknown} color
 * @returns {boolean}
 */
function hasVisibleAlpha(color) {
  if (typeof color !== "string" || color.length === 0) return false;
  const hex8 = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})$/.exec(color);
  if (hex8) return parseInt(hex8[1], 16) > 0;
  const hex4 = /^#[0-9a-fA-F]{3}([0-9a-fA-F])$/.exec(color);
  if (hex4) return parseInt(hex4[1], 16) > 0;
  const fn = /^(?:rgba|hsla)\([^)]*[,/]\s*([0-9.]+)%?\s*\)$/.exec(color);
  if (fn) return parseFloat(fn[1]) > 0;
  return true;
}

// --- label color resolution (label_renderers.js parity) --------------------

/** @returns {number} a finite label size, falling back hard */
function finiteSize(perElement, fromSettings) {
  const size = perElement ?? fromSettings;
  return Number.isFinite(size) ? size : FALLBACK_LABEL_SIZE;
}

function resolveSettingsColor(settingsColor, data) {
  if (settingsColor?.attribute) {
    return data[settingsColor.attribute] || settingsColor.color || "#000";
  }
  return settingsColor?.color ?? "#000";
}

function resolveElementLabelColor(elementColor, settingsColor, data) {
  if (elementColor != null && elementColor !== BAKED_DEFAULT_LABEL_COLOR) {
    return elementColor;
  }
  return resolveSettingsColor(settingsColor, data);
}

// --- graph iteration (duck-typed: graphology or plain fake) ----------------

function eachNodeId(graph, fn) {
  if (typeof graph.forEachNode === "function") {
    graph.forEachNode((id) => fn(id));
    return;
  }
  for (const id of graph.nodes()) fn(id);
}

function eachEdgeId(graph, fn) {
  if (typeof graph.forEachEdge === "function") {
    graph.forEachEdge((id, _attrs, source, target) => fn(id, source, target));
    return;
  }
  for (const id of graph.edges()) fn(id, graph.source(id), graph.target(id));
}

/** Stable ascending-zIndex order (Array.sort is stable per ES2019). */
function sortByZIndex(records) {
  return [...records].sort((a, b) => (a.data.zIndex ?? 0) - (b.data.zIndex ?? 0));
}

// --- scene environment ------------------------------------------------------

/**
 * Which labels sigma actually rendered this frame. Sets of keys when the
 * instance exposes them; null means "no API available — include every
 * visible element that has a label".
 */
function displayedLabelSet(sigma, method, property) {
  if (typeof sigma[method] === "function") return sigma[method]() ?? null;
  return sigma[property] ?? null;
}

function labelEnvironment(sigma, measureText) {
  const get = (name) => sigma.getSetting?.(name);
  return {
    measureText,
    renderLabels: get("renderLabels") !== false,
    renderEdgeLabels: get("renderEdgeLabels") !== false,
    labelFont: get("labelFont") ?? "Arial",
    labelWeight: get("labelWeight") ?? "normal",
    labelSize: get("labelSize"),
    labelColor: get("labelColor"),
    edgeLabelFont: get("edgeLabelFont") ?? "Arial",
    edgeLabelWeight: get("edgeLabelWeight") ?? "normal",
    edgeLabelSize: get("edgeLabelSize"),
    edgeLabelColor: get("edgeLabelColor"),
    nodeLabelSet: displayedLabelSet(sigma, "getNodeDisplayedLabels", "displayedNodeLabels"),
    edgeLabelSet: displayedLabelSet(sigma, "getEdgeDisplayedLabels", "displayedEdgeLabels"),
  };
}

// --- node/edge collection ----------------------------------------------------

/** @returns {Map<string, {id, data, x, y, r}>} visible nodes in screen px */
function collectNodes(sigma, graph) {
  const nodes = new Map();
  eachNodeId(graph, (id) => {
    const data = sigma.getNodeDisplayData(id);
    if (!data || data.hidden) return;
    const point = sigma.framedGraphToViewport({ x: data.x, y: data.y });
    nodes.set(id, { id, data, x: point.x, y: point.y, r: sigma.scaleSize(data.size) });
  });
  return nodes;
}

/**
 * Visible edges with both endpoints visible, projected to screen px. Curved
 * edges carry the projected quadratic control point: it is constructed in
 * FRAMED space (display-data coordinates) because the framed→viewport map
 * flips y, which would mirror a control point built from screen deltas.
 */
function collectEdges(sigma, graph, nodes) {
  const minThickness = sigma.getSetting?.("minEdgeThickness") ?? 1;
  const edges = [];
  eachEdgeId(graph, (id, sourceId, targetId) => {
    const data = sigma.getEdgeDisplayData(id);
    if (!data || data.hidden) return;
    const source = nodes.get(sourceId);
    const target = nodes.get(targetId);
    if (!source || !target) return; // hidden or missing endpoint
    const curved = data.type === "curve" || data.type === "styledCurve";
    let cp = null;
    if (curved) {
      const c = data.curvature ?? DEFAULT_EDGE_CURVATURE;
      const dx = target.data.x - source.data.x;
      const dy = target.data.y - source.data.y;
      cp = sigma.framedGraphToViewport({
        x: (source.data.x + target.data.x) / 2 - dy * c,
        y: (source.data.y + target.data.y) / 2 + dx * c,
      });
    }
    const thickness = Math.max(sigma.scaleSize(data.size || 1), minThickness);
    edges.push({ id, data, source, target, cp, curved, thickness });
  });
  return edges;
}

// --- edge primitives ----------------------------------------------------------

function edgeStrokePrimitive(edge, stroke, strokeWidth) {
  if (edge.curved) {
    const { source: s, target: t, cp } = edge;
    const d =
      `M ${fmt(s.x)} ${fmt(s.y)} ` +
      `Q ${fmt(cp.x)} ${fmt(cp.y)} ${fmt(t.x)} ${fmt(t.y)}`;
    return { kind: "path", d, fill: "none", stroke, strokeWidth };
  }
  const { source: s, target: t } = edge;
  return { kind: "line", x1: s.x, y1: s.y, x2: t.x, y2: t.y, stroke, strokeWidth };
}

/**
 * Marker head for one extremity, replicating the edge_programs.js shader
 * SDFs as polygons/circles (all in CSS screen px).
 */
function markerPrimitives(edge, extremity, sigma) {
  const isSource = extremity === "source";
  const data = edge.data;
  const code = (isSource ? data.startMarker : data.endMarker) || 0;
  if (!code) return [];

  const marked = isSource ? edge.source : edge.target;
  const toward = edge.curved ? edge.cp : isSource ? edge.target : edge.source;
  const awayLen = Math.hypot(toward.x - marked.x, toward.y - marked.y);
  if (!(awayLen > 0)) return [];
  const away = { x: (toward.x - marked.x) / awayLen, y: (toward.y - marked.y) / awayLen };
  const n = { x: -away.y, y: away.x };

  const markerSize = (isSource ? data.startMarkerSize : data.endMarkerSize) || 0;
  const len = markerSize > 0 ? sigma.scaleSize(markerSize) : MARKER_LENGTH_RATIO * edge.thickness;
  const halfW = markerSize > 0 ? sigma.scaleSize(markerSize) / 2 : edge.thickness;
  const anchor = {
    x: marked.x + away.x * sigma.scaleSize(marked.data.size),
    y: marked.y + away.y * sigma.scaleSize(marked.data.size),
  };
  const at = (t, u) => ({ x: anchor.x + away.x * t + n.x * u, y: anchor.y + away.y * t + n.y * u });

  const fill = safeColor((isSource ? data.startMarkerColor : data.endMarkerColor) ?? data.color);
  const prim = markerShape(code, anchor, at, len, halfW, fill);

  const borderColor = isSource ? data.startMarkerBorderColor : data.endMarkerBorderColor;
  if (borderColor != null) {
    const borderSize = (isSource ? data.startMarkerBorderSize : data.endMarkerBorderSize) || 0;
    prim.stroke = safeColor(borderColor);
    // Approximation of the shader's INSIDE border band (an SVG stroke
    // straddles the outline; the GLSL border lies fully within the SDF).
    prim.strokeWidth =
      borderSize > 0
        ? sigma.scaleSize(borderSize)
        : MARKER_AUTO_BORDER_FRACTION * Math.min(2 * halfW, len);
  }
  return [prim];
}

/** One marker body per EDGE_MARKERS code (graph_model.js vocabulary). */
function markerShape(code, anchor, at, len, halfW, fill) {
  if (code === 2) {
    return { kind: "polygon", points: [at(0, -halfW), at(0, halfW), at(len, halfW), at(len, -halfW)], fill };
  }
  if (code === 3) {
    return { kind: "polygon", points: [anchor, at(len / 2, halfW), at(len, 0), at(len / 2, -halfW)], fill };
  }
  if (code === 4) {
    const center = at(len / 2, 0);
    return { kind: "circle", cx: center.x, cy: center.y, r: Math.min(2 * halfW, len) / 2, fill };
  }
  if (code === 5) {
    const bar = Math.max(len * 0.3, TEE_MIN_BAR_PX);
    return { kind: "polygon", points: [at(0, -halfW), at(0, halfW), at(bar, halfW), at(bar, -halfW)], fill };
  }
  // arrow (code 1; unknown codes degrade to it like the shader's first branch)
  return { kind: "polygon", points: [anchor, at(len, -halfW), at(len, halfW)], fill };
}

/** Halo underdraw + body + marker heads for one edge. */
function edgePrimitives(edge, sigma) {
  const prims = [];
  const styled = edge.data.type === "styledLine" || edge.data.type === "styledCurve";
  if (styled && edge.data.haloWidth > 0) {
    const haloWidth = sigma.scaleSize((edge.data.size || 1) + 2 * edge.data.haloWidth);
    prims.push(edgeStrokePrimitive(edge, safeColor(edge.data.haloColor ?? edge.data.color), haloWidth));
  }
  prims.push(edgeStrokePrimitive(edge, safeColor(edge.data.color), edge.thickness));
  if (styled) {
    prims.push(...markerPrimitives(edge, "source", sigma));
    prims.push(...markerPrimitives(edge, "target", sigma));
  }
  return prims;
}

// --- node primitives -----------------------------------------------------------

/**
 * Plain disc, or @sigma/node-border rings when borderRatio > 0 (the border
 * is the OUTER borderRatio fraction of the radius — graph_model.js bakes
 * lineWidth/radius into the attr).
 */
function circleNodePrimitives({ data, x, y, r }) {
  const fill = safeColor(data.color);
  const ratio = data.borderRatio;
  if (Number.isFinite(ratio) && ratio > 0) {
    return [
      { kind: "circle", cx: x, cy: y, r, fill: safeColor(data.borderColor) },
      { kind: "circle", cx: x, cy: y, r: r * (1 - Math.min(ratio, 1)), fill },
    ];
  }
  return [{ kind: "circle", cx: x, cy: y, r, fill }];
}

/**
 * Texture node: the app's own SVG data URI as an <image> quad. A visible
 * display color (state halos use drawingMode "background") gets a disc
 * underneath, mirroring the image program's background pass.
 */
// Only the app's own texture URIs (shapeTextureURI) may embed: javascript:,
// http(s): and other data: MIME types are dropped, so a future user-supplied
// node image can never become a script-execution or tracking vector.
const SAFE_IMAGE_HREF_RE = /^data:image\/svg\+xml,/;

function shapeNodePrimitives({ data, x, y, r }) {
  const prims = [];
  if (hasVisibleAlpha(data.color)) {
    prims.push({ kind: "circle", cx: x, cy: y, r, fill: safeColor(data.color) });
  }
  if (typeof data.image === "string" && SAFE_IMAGE_HREF_RE.test(data.image)) {
    prims.push({ kind: "image", href: data.image, x: x - r, y: y - r, width: 2 * r, height: 2 * r });
  }
  return prims;
}

/**
 * One wedge path. Slice angles are GRAPH-space CCW from +x; the screen point
 * negates y, so on the y-down screen the arc traces visually clockwise —
 * which in SVG's y-down convention is sweep flag 0.
 */
function pieWedgePath(cx, cy, r, a0, a1) {
  const p0 = { x: cx + r * Math.cos(a0), y: cy - r * Math.sin(a0) };
  const p1 = { x: cx + r * Math.cos(a1), y: cy - r * Math.sin(a1) };
  const largeArc = a1 - a0 > Math.PI ? 1 : 0;
  return (
    `M ${fmt(cx)} ${fmt(cy)} L ${fmt(p0.x)} ${fmt(p0.y)} ` +
    `A ${fmt(r)} ${fmt(r)} 0 ${largeArc} 0 ${fmt(p1.x)} ${fmt(p1.y)} Z`
  );
}

/** @sigma/node-piechart parity: pieValue0..N-1 / pieColor0..N-1 slices. */
function pieNodePrimitives({ data, x, y, r }) {
  let total = 0;
  const slices = [];
  for (let k = 0; k < DEFAULTS.NODE.PIE.MAX_SLICES; k++) {
    const raw = data[`pieValue${k}`];
    const value = Number.isFinite(raw) && raw > 0 ? raw : 0;
    slices.push({ value, color: data[`pieColor${k}`] ?? DEFAULTS.NODE.PIE.DEFAULT_COLOR });
    total += value;
  }
  if (total <= 0) {
    return [{ kind: "circle", cx: x, cy: y, r, fill: safeColor(DEFAULTS.NODE.PIE.DEFAULT_COLOR) }];
  }
  const prims = [];
  let angle = 0;
  for (const slice of slices) {
    if (slice.value <= 0) continue;
    const start = angle;
    angle += (slice.value * 2 * Math.PI) / total;
    if (!hasVisibleAlpha(slice.color)) continue;
    const fill = safeColor(slice.color);
    if (angle - start >= 2 * Math.PI - FULL_TURN_EPS) {
      prims.push({ kind: "circle", cx: x, cy: y, r, fill });
    } else {
      prims.push({ kind: "path", d: pieWedgePath(x, y, r, start, angle), fill });
    }
  }
  return prims;
}

function nodePrimitives(node) {
  const type = node.data.type;
  // NOTE for the visual-check pass: sigma's square program spans the FULL
  // node size as the half-side, so the square circumscribes the equivalent
  // disc rather than inscribing it.
  if (type === "square") {
    const { data, x, y, r } = node;
    return [{ kind: "rect", x: x - r, y: y - r, width: 2 * r, height: 2 * r, fill: safeColor(data.color) }];
  }
  if (type === "shape") return shapeNodePrimitives(node);
  if (type === "pie") return pieNodePrimitives(node);
  return circleNodePrimitives(node); // "circle", "borderCircle", default
}

// --- label primitives ------------------------------------------------------------

function textPrimitive(x, y, text, fill, fontSize, fontFamily, fontWeight) {
  return { kind: "text", x, y, text, fill, fontSize, fontFamily, fontWeight };
}

/** drawNodeBadges parity: colored pill + white text on the node perimeter. */
function badgePrimitives(node, env) {
  const { data, x, y, r } = node;
  if (!data.badge || !Array.isArray(data.badges) || data.badges.length === 0) return [];
  const fontSize = Number.isFinite(data.badgeFontSize) ? data.badgeFontSize : FALLBACK_BADGE_FONT_SIZE;
  const scale =
    Number.isFinite(data.badgeScaleFactor) && data.badgeScaleFactor > 0 ? data.badgeScaleFactor : 1;
  const size = fontSize * scale;
  const font = `bold ${size}px ${env.labelFont}`;

  const prims = [];
  data.badges.forEach((badge, index) => {
    const text = badge?.text == null ? "" : String(badge.text);
    if (!text) return;
    const boxWidth = env.measureText(text, font) + 2 * BADGE_PADDING;
    const boxHeight = size + 2 * BADGE_PADDING;
    const [ux, uy] = placementVector(badge.placement);
    const norm = Math.hypot(ux, uy) || 1;
    const cx = x + (ux / norm) * r;
    const cy = y + (uy / norm) * r;
    prims.push({
      kind: "rect",
      x: cx - boxWidth / 2,
      y: cy - boxHeight / 2,
      width: boxWidth,
      height: boxHeight,
      rx: boxHeight / 2, // pill: fully rounded ends
      fill: safeColor(data.badgePalette?.[index] ?? FALLBACK_BADGE_COLOR),
    });
    prims.push(textPrimitive(cx, cy + size * 0.35, text, BADGE_TEXT_COLOR, size, env.labelFont, "bold"));
  });
  return prims;
}

/** drawNodeLabel parity (background + text + badges). */
function nodeLabelPrimitives(node, env) {
  const { data, x, y, r } = node;
  if (!data.label) return [];
  const size = finiteSize(data.labelSize, env.labelSize);
  const font = `${env.labelWeight} ${size}px ${env.labelFont}`;
  const color = safeColor(resolveElementLabelColor(data.labelColor, env.labelColor, data));
  const padding = data.labelPadding ?? 2;
  const boxWidth = env.measureText(data.label, font) + 2 * padding;
  const boxHeight = size + 2 * padding;

  const [ux, uy] = placementVector(data.labelPlacement);
  const cx = x + ux * (r + ANCHOR_GAP + boxWidth / 2) + (data.labelOffsetX ?? 0);
  const cy = y + uy * (r + ANCHOR_GAP + boxHeight / 2) + (data.labelOffsetY ?? 0);

  const prims = [];
  if (data.labelBackground && data.labelBackgroundColor) {
    prims.push({
      kind: "rect",
      x: cx - boxWidth / 2,
      y: cy - boxHeight / 2,
      width: boxWidth,
      height: boxHeight,
      rx: BACKGROUND_RADIUS,
      fill: safeColor(data.labelBackgroundColor),
    });
  }
  prims.push(textPrimitive(cx, cy + size * 0.35, data.label, color, size, env.labelFont, env.labelWeight));
  prims.push(...badgePrimitives(node, env)); // badges follow label visibility
  return prims;
}

/**
 * Label anchor + tangent for an edge. Curved edges use the bezier point at
 * t = 0.5 (= 0.25·S + 0.5·CP + 0.25·T) whose tangent is exactly T − S —
 * an approximation of @sigma/edge-curve's path-following label drawer.
 */
function edgeLabelAnchor(edge) {
  const { source: s, target: t, cp, data } = edge;
  const offsetX = data.labelOffsetX ?? 0;
  const offsetY = data.labelOffsetY ?? 0;
  const tangent = { x: t.x - s.x, y: t.y - s.y };
  if (edge.curved) {
    return {
      x: 0.25 * s.x + 0.5 * cp.x + 0.25 * t.x + offsetX,
      y: 0.25 * s.y + 0.5 * cp.y + 0.25 * t.y + offsetY,
      tangent,
    };
  }
  const frac = { start: 0.2, center: 0.5, end: 0.8 }[data.labelPlacement] ?? 0.5;
  return { x: s.x + tangent.x * frac + offsetX, y: s.y + tangent.y * frac + offsetY, tangent };
}

/** drawEdgeLabel parity: translated/rotated group with background + text. */
function edgeLabelPrimitives(edge, env) {
  const data = edge.data;
  if (!data.label) return [];
  const size = finiteSize(data.labelSize, env.edgeLabelSize);
  const font = `${env.edgeLabelWeight} ${size}px ${env.edgeLabelFont}`;
  const color = safeColor(resolveElementLabelColor(data.labelColor, env.edgeLabelColor, data));
  const padding = data.labelPadding ?? 1;
  const width = env.measureText(data.label, font);
  const { x, y, tangent } = edgeLabelAnchor(edge);

  let angle = 0;
  if (data.labelAutoRotate) {
    angle = Math.atan2(tangent.y, tangent.x);
    // Keep text upright; range (-π/2, π/2] (label_renderers.js).
    if (angle > Math.PI / 2) angle -= Math.PI;
    else if (angle <= -Math.PI / 2) angle += Math.PI;
  }

  const children = [];
  if (data.labelBackground && data.labelBackgroundColor) {
    children.push({
      kind: "rect",
      x: -width / 2 - padding,
      y: -size / 2 - padding,
      width: width + 2 * padding,
      height: size + 2 * padding,
      rx: BACKGROUND_RADIUS,
      fill: safeColor(data.labelBackgroundColor),
    });
  }
  children.push(textPrimitive(0, size * 0.35, data.label, color, size, env.edgeLabelFont, env.edgeLabelWeight));
  return [
    {
      kind: "group",
      transform: `translate(${fmt(x)} ${fmt(y)}) rotate(${fmt(angle * RAD_TO_DEG)})`,
      children,
    },
  ];
}

// --- bubble group primitives ---------------------------------------------------

/** bubble_layer #drawGroup parity: closed body polygon + 2px outline. */
function bubbleBodyPrimitives({ points, opts = {}, defaults = {} }) {
  if (!points || points.length < 2) return [];
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${fmt(p.x)} ${fmt(p.y)}`).join(" ") + " Z";
  return [
    {
      kind: "path",
      d,
      fill: safeColor(opts.fill ?? defaults.fill ?? "#403C53"),
      fillOpacity: opts.fillOpacity ?? defaults.fillOpacity ?? 0.25,
      stroke: safeColor(opts.stroke ?? defaults.stroke ?? "#403C53"),
      strokeWidth: OUTLINE_STROKE_WIDTH,
      strokeOpacity: opts.strokeOpacity ?? defaults.strokeOpacity ?? 1,
    },
  ];
}

/**
 * bubble_layer #drawLabel parity. The live layer gates on the manager-merged
 * opts.label; the export receives raw opts + defaults, so the gate resolves
 * through the same opts ?? defaults chain as every other label option.
 */
function bubbleLabelPrimitives({ points, opts = {}, defaults = {} }, measureText) {
  if (!points || points.length < 2) return [];
  if (!(opts.label ?? defaults.label)) return [];
  const text = String(opts.labelText ?? defaults.labelText ?? "");
  if (!text) return [];
  const placement = opts.labelPlacement ?? defaults.labelPlacement ?? "bottom";
  const closeToPath = opts.labelCloseToPath ?? defaults.labelCloseToPath ?? true;
  const autoRotate = opts.labelAutoRotate ?? defaults.labelAutoRotate ?? true;
  const anchor = outlineLabelAnchor(points, placement);
  if (!anchor) return [];

  const fontSize = opts.labelFontSize ?? defaults.labelFontSize ?? 12;
  const padding = opts.labelPadding ?? defaults.labelPadding ?? 2;
  const standoff = closeToPath ? 0 : fontSize / 2 + padding + LABEL_STANDOFF_PX;
  const x = anchor.x + anchor.nx * standoff + (opts.labelOffsetX ?? 0);
  const y = anchor.y + anchor.ny * standoff + (opts.labelOffsetY ?? 0);
  const textWidth = measureText(text, `${fontSize}px ${BUBBLE_LABEL_FONT_FAMILY}`);

  const rotated = autoRotate && closeToPath && placement !== "center";
  const lx = rotated ? 0 : x;
  const ly = rotated ? 0 : y;

  const prims = [];
  if (opts.labelBackground ?? defaults.labelBackground) {
    prims.push({
      kind: "rect",
      x: lx - textWidth / 2 - padding,
      y: ly - fontSize / 2 - padding,
      width: textWidth + 2 * padding,
      height: fontSize + 2 * padding,
      rx: opts.labelBackgroundRadius ?? defaults.labelBackgroundRadius ?? 5,
      fill: safeColor(opts.labelBackgroundFill ?? defaults.labelBackgroundFill ?? "#403C53"),
    });
  }
  prims.push(
    textPrimitive(
      lx,
      ly + fontSize * 0.35,
      text,
      safeColor(opts.labelFill ?? defaults.labelFill ?? "#fff"),
      fontSize,
      BUBBLE_LABEL_FONT_FAMILY,
      "normal",
    ),
  );
  if (!rotated) return prims;
  return [
    {
      kind: "group",
      transform: `translate(${fmt(x)} ${fmt(y)}) rotate(${fmt(anchor.angle * RAD_TO_DEG)})`,
      children: prims,
    },
  ];
}

// --- scene collection ----------------------------------------------------------

/**
 * Collect the full scene as a flat array of typed primitives, in draw order:
 * edges → nodes → bubble bodies → edge labels → node labels (+badges) →
 * bubble labels. Bubble bodies sit above nodes/edges to match the live layer
 * (afterLayer:"nodes"), below labels. (The background rect is the serializer's job.)
 *
 * @param {object} args  same shape as buildGraphSvg (background unused here)
 * @returns {Array<object>} primitives ({kind: "rect"|"circle"|"path"|
 *   "polygon"|"line"|"image"|"text"|"group", ...})
 */
function collectSvgScene({ sigma, graph, bubbleGroups = [], measureText }) {
  const env = labelEnvironment(sigma, measureText);
  const nodes = collectNodes(sigma, graph);
  const edges = sortByZIndex(collectEdges(sigma, graph, nodes));
  const sortedNodes = sortByZIndex([...nodes.values()]);

  const prims = [];
  for (const edge of edges) prims.push(...edgePrimitives(edge, sigma));
  for (const node of sortedNodes) prims.push(...nodePrimitives(node));
  for (const group of bubbleGroups) prims.push(...bubbleBodyPrimitives(group));
  if (env.renderEdgeLabels) {
    for (const edge of edges) {
      if (env.edgeLabelSet && !env.edgeLabelSet.has(edge.id)) continue;
      prims.push(...edgeLabelPrimitives(edge, env));
    }
  }
  if (env.renderLabels) {
    for (const node of sortedNodes) {
      if (env.nodeLabelSet && !env.nodeLabelSet.has(node.id)) continue;
      prims.push(...nodeLabelPrimitives(node, env));
    }
  }
  for (const group of bubbleGroups) prims.push(...bubbleLabelPrimitives(group, measureText));
  return prims;
}

// --- serialization ---------------------------------------------------------------

/** Shared fill/stroke/opacity attribute fragment. */
function paintAttrs(p) {
  let s = "";
  if (p.fill !== undefined) s += ` fill="${escapeXml(p.fill)}"`;
  if (p.fillOpacity !== undefined) s += ` fill-opacity="${fmt(p.fillOpacity)}"`;
  if (p.stroke !== undefined) s += ` stroke="${escapeXml(p.stroke)}"`;
  if (p.strokeWidth !== undefined) s += ` stroke-width="${fmt(p.strokeWidth)}"`;
  if (p.strokeOpacity !== undefined) s += ` stroke-opacity="${fmt(p.strokeOpacity)}"`;
  return s;
}

function serializePrimitive(p) {
  if (p.kind === "rect") {
    const rx = p.rx !== undefined ? ` rx="${fmt(p.rx)}"` : "";
    return `<rect x="${fmt(p.x)}" y="${fmt(p.y)}" width="${fmt(p.width)}" height="${fmt(p.height)}"${rx}${paintAttrs(p)}/>`;
  }
  if (p.kind === "circle") {
    return `<circle cx="${fmt(p.cx)}" cy="${fmt(p.cy)}" r="${fmt(p.r)}"${paintAttrs(p)}/>`;
  }
  if (p.kind === "line") {
    return `<line x1="${fmt(p.x1)}" y1="${fmt(p.y1)}" x2="${fmt(p.x2)}" y2="${fmt(p.y2)}"${paintAttrs(p)}/>`;
  }
  if (p.kind === "path") {
    return `<path d="${escapeXml(p.d)}"${paintAttrs(p)}/>`;
  }
  if (p.kind === "polygon") {
    const points = p.points.map((pt) => `${fmt(pt.x)},${fmt(pt.y)}`).join(" ");
    return `<polygon points="${points}"${paintAttrs(p)}/>`;
  }
  if (p.kind === "image") {
    return `<image href="${escapeXml(p.href)}" x="${fmt(p.x)}" y="${fmt(p.y)}" width="${fmt(p.width)}" height="${fmt(p.height)}"/>`;
  }
  if (p.kind === "text") {
    return (
      `<text x="${fmt(p.x)}" y="${fmt(p.y)}" fill="${escapeXml(p.fill)}"` +
      ` font-size="${fmt(p.fontSize)}" font-family="${escapeXml(p.fontFamily)}"` +
      ` font-weight="${escapeXml(p.fontWeight)}" text-anchor="middle">${escapeXml(p.text)}</text>`
    );
  }
  if (p.kind === "group") {
    return `<g transform="${escapeXml(p.transform)}">${p.children.map(serializePrimitive).join("")}</g>`;
  }
  throw new Error(`export_svg: unknown primitive kind "${p.kind}"`);
}

/**
 * Serialize primitives into a standalone SVG document.
 *
 * @param {Array<object>} primitives  collectSvgScene output
 * @param {{width: number, height: number}} dims  CSS px
 * @param {string} background  CSS color for the page rect
 * @returns {string}
 */
function primitivesToSvg(primitives, dims, background) {
  const w = fmt(dims.width);
  const h = fmt(dims.height);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect x="0" y="0" width="${w}" height="${h}" fill="${escapeXml(safeColor(background))}"/>`,
  ];
  for (const p of primitives) parts.push(serializePrimitive(p));
  parts.push("</svg>");
  return parts.join("\n");
}

// --- public API -------------------------------------------------------------------

/**
 * Build a standalone SVG document of the current scene.
 *
 * @param {object} args
 * @param {object} args.sigma     live Sigma instance (duck-typed)
 * @param {object} args.graph     graphology graph (nodes()/edges()/source()/target() or forEach*)
 * @param {{width: number, height: number}} args.dims  CSS px
 * @param {string} args.background  CSS color for the page rect
 * @param {Array<{group: string, points: Array<{x: number, y: number}>, opts: object, defaults: object}>} args.bubbleGroups
 * @param {(text: string, font: string) => number} args.measureText
 * @returns {string} standalone SVG document
 */
function buildGraphSvg(args) {
  if (!args || typeof args !== "object") {
    throw new TypeError("buildGraphSvg: args object required");
  }
  const { sigma, graph, dims, measureText } = args;
  if (!sigma || typeof sigma.getNodeDisplayData !== "function") {
    throw new TypeError("buildGraphSvg: a sigma instance with getNodeDisplayData is required");
  }
  if (!graph) throw new TypeError("buildGraphSvg: graph is required");
  if (
    !dims ||
    !Number.isFinite(dims.width) ||
    !Number.isFinite(dims.height) ||
    dims.width <= 0 ||
    dims.height <= 0
  ) {
    throw new TypeError("buildGraphSvg: dims must have positive finite width/height");
  }
  if (typeof measureText !== "function") {
    throw new TypeError("buildGraphSvg: measureText function is required");
  }
  return primitivesToSvg(collectSvgScene(args), dims, args.background);
}

export { buildGraphSvg, collectSvgScene, primitivesToSvg };
