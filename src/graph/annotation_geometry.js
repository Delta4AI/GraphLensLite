/**
 * Pure geometry + trust-boundary validation for text annotations (notes).
 *
 * Node-safe (no DOM, no sigma at module scope) so both the browser layer
 * (annotation_layer.js) and the SVG export (export_svg.js) share ONE source
 * of box metrics — the live DOM note, the PNG repaint and the SVG rect must
 * all frame the same text identically.
 *
 * Coordinates: an annotation's x/y is the box's TOP-LEFT corner in app-model
 * graph space (y-down, same frame as layout.positions), sized at camera
 * ratio 1 — the whole box scales with zoom like the rest of the drawing.
 */

// Font metrics shared by the DOM note (CSS), the canvas painter and the SVG
// serializer. line-height 1.25 is set explicitly on the DOM element so the
// canvas/SVG line stacking matches browser text layout.
const ANNOTATION_FONT_FAMILY = 'Arial, sans-serif';
const ANNOTATION_LINE_HEIGHT = 1.25;
const ANNOTATION_PADDING_PX = 6;

const MIN_FONT_SIZE = 6;
const MAX_FONT_SIZE = 200;
const MAX_BORDER_WIDTH = 20;
const MAX_TEXT_LENGTH = 2000;
// A crafted file must not "note-bomb" the DOM: every surviving record becomes
// a live element repositioned per frame, so the list itself is capped too.
const MAX_ANNOTATIONS = 500;
// Same paint-value policy as export_svg.js SAFE_PAINT_RE: hex/rgb()/hsl()/
// named colors pass; quotes, angle brackets, ampersands and colons don't.
// Applied at the trust boundary so the DOM, canvas and SVG sinks all inherit
// one rule instead of relying on per-engine leniency for junk values.
const SAFE_COLOR_RE = /^[#a-zA-Z0-9(),.%\s-]+$/;
const MAX_COLOR_LENGTH = 50;

const MAX_BORDER_RADIUS = 40;

// App red — readable on both the light and the dark stage background.
const ANNOTATION_DEFAULTS = Object.freeze({
  text: 'Text',
  fontSize: 14,
  fontColor: '#C33D35',
  borderColor: '#C33D35',
  borderWidth: 1.5,
  borderRadius: 6,
  bgColor: null, // transparent; a color makes the note a card
  shadow: false, // only painted when bgColor is set (see ANNOTATION_SHADOW)
});

// One fixed, tasteful shadow — not a knob. blur is the CSS blur-radius; the
// SVG feDropShadow stdDeviation is blur/2 (both ≈ 2σ of the Gaussian).
// Rendered ONLY together with a background fill: CSS casts an outer shadow
// as if the border-box were opaque, so a shadow on a transparent note would
// read as a floating ring — and SVG could not reproduce it at all.
const ANNOTATION_SHADOW = Object.freeze({
  offsetY: 2,
  blur: 8,
  color: 'rgba(0, 0, 0, 0.35)',
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Finite number or the fallback (loaded JSON is untrusted). */
function finiteOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Bounded string or the fallback. */
function stringOr(value, fallback, maxLength) {
  if (typeof value !== 'string') return fallback;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/** Bounded, allowlisted CSS color or the fallback. */
function colorOr(value, fallback) {
  const s = stringOr(value, fallback, MAX_COLOR_LENGTH);
  return typeof s === 'string' && SAFE_COLOR_RE.test(s) ? s : fallback;
}

/**
 * Validate one raw annotation from a loaded file into the canonical shape.
 * Returns null for records that cannot be placed (non-finite coordinates) —
 * a note without a position is unrecoverable, everything else has defaults.
 *
 * @param {unknown} raw
 * @returns {{id: string, text: string, x: number, y: number, fontSize: number,
 *   fontColor: string, borderColor: string, borderWidth: number} | null}
 */
function normalizeAnnotation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    id: stringOr(raw.id, '', 64) || `ann-${Math.abs(x).toFixed(2)}-${Math.abs(y).toFixed(2)}`,
    text: stringOr(raw.text, ANNOTATION_DEFAULTS.text, MAX_TEXT_LENGTH),
    x,
    y,
    fontSize: clamp(
      finiteOr(raw.fontSize, ANNOTATION_DEFAULTS.fontSize),
      MIN_FONT_SIZE,
      MAX_FONT_SIZE
    ),
    fontColor: colorOr(raw.fontColor, ANNOTATION_DEFAULTS.fontColor),
    borderColor: colorOr(raw.borderColor, ANNOTATION_DEFAULTS.borderColor),
    borderWidth: clamp(finiteOr(raw.borderWidth, ANNOTATION_DEFAULTS.borderWidth), 0, MAX_BORDER_WIDTH),
    borderRadius: clamp(
      finiteOr(raw.borderRadius, ANNOTATION_DEFAULTS.borderRadius),
      0,
      MAX_BORDER_RADIUS
    ),
    // null stays null (transparent); an invalid color string drops to null
    // rather than to some default paint.
    bgColor: raw.bgColor == null ? null : colorOr(raw.bgColor, null),
    shadow: raw.shadow === true,
  };
}

/**
 * Trust boundary for a loaded layout's annotations array: keep only records
 * that survive normalization. Anything non-array becomes [].
 *
 * @param {unknown} list
 * @returns {Array<object>}
 */
function sanitizeAnnotations(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_ANNOTATIONS).map(normalizeAnnotation).filter(Boolean);
}

/**
 * Box metrics for an annotation at camera ratio 1 (multiply by the zoom
 * factor for on-screen sizes). boxW/boxH are the OUTER border-box — the same
 * rectangle the DOM element occupies (content + 2×padding + 2×border).
 *
 * @param {object} ann  normalized annotation
 * @param {(text: string, font: string) => number} measureText
 * @returns {{lines: string[], lineHeight: number, pad: number, font: string,
 *   contentW: number, contentH: number, boxW: number, boxH: number}}
 */
function annotationLayout(ann, measureText) {
  const font = `${ann.fontSize}px ${ANNOTATION_FONT_FAMILY}`;
  const lines = String(ann.text).split('\n');
  const lineHeight = ann.fontSize * ANNOTATION_LINE_HEIGHT;
  let contentW = 0;
  for (const line of lines) contentW = Math.max(contentW, measureText(line, font));
  const contentH = lines.length * lineHeight;
  const pad = ANNOTATION_PADDING_PX;
  return {
    lines,
    lineHeight,
    pad,
    font,
    contentW,
    contentH,
    boxW: contentW + 2 * pad + 2 * ann.borderWidth,
    boxH: contentH + 2 * pad + 2 * ann.borderWidth,
  };
}

export {
  ANNOTATION_DEFAULTS,
  ANNOTATION_SHADOW,
  ANNOTATION_FONT_FAMILY,
  ANNOTATION_LINE_HEIGHT,
  ANNOTATION_PADDING_PX,
  MAX_TEXT_LENGTH,
  MAX_ANNOTATIONS,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  MAX_BORDER_WIDTH,
  MAX_BORDER_RADIUS,
  normalizeAnnotation,
  sanitizeAnnotations,
  annotationLayout,
};
