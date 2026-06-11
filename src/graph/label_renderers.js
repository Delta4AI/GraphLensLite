/**
 * Canvas label renderers for the sigma renderer (MIGRATION.md Phase 2).
 *
 * Replace sigma's built-in disc/straight label drawers to honour the
 * per-element label attrs emitted by graph_model.js (labelSize, labelColor,
 * labelBackground(Color), labelPlacement, labelOffsetX/Y, labelPadding,
 * labelAutoRotate). Pure functions of (context, data, settings) — no DOM or
 * sigma imports, so vitest covers them under node.
 */

const BACKGROUND_RADIUS = 4;
const ANCHOR_GAP = 2; // px between node/edge geometry and the label box
// Last-resort font size: a non-finite size would silently corrupt the canvas
// font string ("normal undefinedpx Arial") and draw at whatever was set last.
const FALLBACK_LABEL_SIZE = 14;

/** @returns {number} a finite label size, falling back hard */
function finiteSize(perElement, fromSettings) {
  const size = perElement ?? fromSettings;
  return Number.isFinite(size) ? size : FALLBACK_LABEL_SIZE;
}

// Unit direction per placement token; combined for corner placements
// ("left-top", "top-right", ...). Unknown tokens resolve to center.
const PLACEMENT_VECTORS = {
  left: [-1, 0],
  right: [1, 0],
  top: [0, -1],
  bottom: [0, 1],
  center: [0, 0],
};

/** @returns {[number, number]} combined unit vector for a placement string */
function placementVector(placement) {
  let ux = 0;
  let uy = 0;
  for (const token of String(placement ?? "bottom").split("-")) {
    const [dx, dy] = PLACEMENT_VECTORS[token] ?? [0, 0];
    ux = ux || dx;
    uy = uy || dy;
  }
  return [ux, uy];
}

function resolveSettingsColor(settingsColor, data) {
  if (settingsColor?.attribute) {
    return data[settingsColor.attribute] || settingsColor.color || "#000";
  }
  return settingsColor?.color ?? "#000";
}

// io.js bakes DEFAULTS.*.LABEL.FOREGROUND_COLOR ("#000000") into every
// labelled element's style, so the per-element labelColor attr always wins
// over the theme-driven sigma settings fallback. Treat that exact baked
// default as "no explicit choice" so dark mode can flip it (in light mode
// the fallback resolves to #000 — pixel-identical). Any other per-element
// label color is an explicit user choice and is honoured as-is.
const BAKED_DEFAULT_LABEL_COLOR = "#000000";

function resolveElementLabelColor(elementColor, settingsColor, data) {
  if (elementColor != null && elementColor !== BAKED_DEFAULT_LABEL_COLOR) {
    return elementColor;
  }
  return resolveSettingsColor(settingsColor, data);
}

function drawBackground(context, color, x, y, width, height, radius = BACKGROUND_RADIUS) {
  context.fillStyle = color;
  context.beginPath();
  if (typeof context.roundRect === "function") {
    context.roundRect(x, y, width, height, radius);
  } else {
    context.rect(x, y, width, height);
  }
  context.fill();
}

// G6 v5 badge parity: a badge is a small colored pill with white text,
// anchored on the node perimeter. Fallbacks mirror DEFAULTS.NODE.BADGE
// (config is intentionally not imported — this module stays dependency-free;
// graph_model.js bakes the configured defaults into the attrs).
const BADGE_TEXT_COLOR = "#FFFFFF";
const FALLBACK_BADGE_COLOR = "#C33D35";
const FALLBACK_BADGE_FONT_SIZE = 8;
const BADGE_PADDING = 2;

/**
 * Draw the node's badges as colored pills with white text, each centered on
 * the node perimeter per its placement. Called from drawNodeLabel, so badges
 * follow label visibility (v1 limitation).
 *
 * @param {CanvasRenderingContext2D} context
 * @param {object} data  node display data (x, y, size, badge, badges, badgePalette,
 *                       badgeFontSize, badgeScaleFactor)
 * @param {object} settings  sigma settings (labelFont)
 */
function drawNodeBadges(context, data, settings) {
  if (!data.badge || !Array.isArray(data.badges) || data.badges.length === 0) return;

  const fontSize = Number.isFinite(data.badgeFontSize)
    ? data.badgeFontSize
    : FALLBACK_BADGE_FONT_SIZE;
  // badgeScaleFactor (graph_model.js) is zoom-independent — like labels,
  // badges keep a constant on-screen size; only the perimeter anchor
  // (data.size) follows the camera.
  const scale = Number.isFinite(data.badgeScaleFactor) && data.badgeScaleFactor > 0
    ? data.badgeScaleFactor
    : 1;
  const size = fontSize * scale;
  context.font = `bold ${size}px ${settings.labelFont}`;

  data.badges.forEach((badge, index) => {
    const text = badge?.text == null ? "" : String(badge.text);
    if (!text) return;

    const width = context.measureText(text).width;
    const boxWidth = width + 2 * BADGE_PADDING;
    const boxHeight = size + 2 * BADGE_PADDING;

    // Normalize corner placements onto the perimeter circle.
    const [ux, uy] = placementVector(badge.placement);
    const norm = Math.hypot(ux, uy) || 1;
    const cx = data.x + (ux / norm) * data.size;
    const cy = data.y + (uy / norm) * data.size;

    const color = data.badgePalette?.[index] ?? FALLBACK_BADGE_COLOR;
    drawBackground(
      context,
      color,
      cx - boxWidth / 2,
      cy - boxHeight / 2,
      boxWidth,
      boxHeight,
      boxHeight / 2, // pill: fully rounded ends
    );
    context.fillStyle = BADGE_TEXT_COLOR;
    context.fillText(text, cx - width / 2, cy + size * 0.35);
  });
}

/**
 * Node label drawer (sigma `defaultDrawNodeLabel`). G6 parity: default
 * placement is "bottom" (sigma's default drawer is right-anchored only).
 * Also draws the node's badges (see drawNodeBadges) after the label.
 *
 * @param {CanvasRenderingContext2D} context
 * @param {object} data  node display data in viewport px (x, y, size, label, label* attrs)
 * @param {object} settings  sigma settings (labelSize/labelFont/labelWeight/labelColor)
 */
function drawNodeLabel(context, data, settings) {
  if (!data.label) return;

  const size = finiteSize(data.labelSize, settings.labelSize);
  const font = settings.labelFont;
  const weight = settings.labelWeight;
  const color = resolveElementLabelColor(data.labelColor, settings.labelColor, data);
  const padding = data.labelPadding ?? 2;

  context.font = `${weight} ${size}px ${font}`;
  const width = context.measureText(data.label).width;
  const boxWidth = width + 2 * padding;
  const boxHeight = size + 2 * padding;

  const [ux, uy] = placementVector(data.labelPlacement);
  const gap = ANCHOR_GAP;
  const boxCenterX =
    data.x + ux * (data.size + gap + boxWidth / 2) + (data.labelOffsetX ?? 0);
  const boxCenterY =
    data.y + uy * (data.size + gap + boxHeight / 2) + (data.labelOffsetY ?? 0);

  if (data.labelBackground && data.labelBackgroundColor) {
    drawBackground(
      context,
      data.labelBackgroundColor,
      boxCenterX - boxWidth / 2,
      boxCenterY - boxHeight / 2,
      boxWidth,
      boxHeight,
    );
  }

  context.fillStyle = color;
  context.fillText(data.label, boxCenterX - width / 2, boxCenterY + size * 0.35);

  drawNodeBadges(context, data, settings);
}

/**
 * Straight-edge label drawer (sigma `defaultDrawEdgeLabel`). G6 parity:
 * `labelPlacement` start/center/end positions along the edge,
 * `labelAutoRotate` (default false) aligns the text with the edge.
 *
 * @param {CanvasRenderingContext2D} context
 * @param {object} edgeData    edge display data (label, size, label* attrs)
 * @param {object} sourceData  source node display data in viewport px
 * @param {object} targetData  target node display data in viewport px
 * @param {object} settings    sigma settings (edgeLabel*)
 */
function drawEdgeLabel(context, edgeData, sourceData, targetData, settings) {
  if (!edgeData.label) return;

  const size = finiteSize(edgeData.labelSize, settings.edgeLabelSize);
  const font = settings.edgeLabelFont;
  const weight = settings.edgeLabelWeight;
  const color = resolveElementLabelColor(edgeData.labelColor, settings.edgeLabelColor, edgeData);
  const padding = edgeData.labelPadding ?? 1;

  context.font = `${weight} ${size}px ${font}`;
  const width = context.measureText(edgeData.label).width;

  const t = { start: 0.2, center: 0.5, end: 0.8 }[edgeData.labelPlacement] ?? 0.5;
  const x = sourceData.x + (targetData.x - sourceData.x) * t + (edgeData.labelOffsetX ?? 0);
  const y = sourceData.y + (targetData.y - sourceData.y) * t + (edgeData.labelOffsetY ?? 0);

  let angle = 0;
  if (edgeData.labelAutoRotate) {
    angle = Math.atan2(targetData.y - sourceData.y, targetData.x - sourceData.x);
    // Keep text upright (never upside down); range (-π/2, π/2] so the two
    // vertical-edge boundaries (±π/2 exactly) normalize consistently.
    if (angle > Math.PI / 2) angle -= Math.PI;
    else if (angle <= -Math.PI / 2) angle += Math.PI;
  }

  context.save();
  context.translate(x, y);
  context.rotate(angle);

  if (edgeData.labelBackground && edgeData.labelBackgroundColor) {
    drawBackground(
      context,
      edgeData.labelBackgroundColor,
      -width / 2 - padding,
      -size / 2 - padding,
      width + 2 * padding,
      size + 2 * padding,
    );
  }

  context.fillStyle = color;
  context.fillText(edgeData.label, -width / 2, size * 0.35);
  context.restore();
}

export { drawNodeLabel, drawEdgeLabel, placementVector, BAKED_DEFAULT_LABEL_COLOR };
