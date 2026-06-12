/**
 * Pure helpers for high-resolution PNG export. Node-safe (no DOM/canvas) so the
 * clamping math can be unit-tested in isolation.
 *
 * The exported image is re-rendered by @sigma/export-image at
 * `cssWidth * scale * devicePixelRatio` pixels. Large viewports times an 8x
 * factor can blow past per-browser canvas ceilings (~16384 px per side and
 * ~268 MP total area in Chrome) and crash the render, so the requested scale is
 * clamped to the largest factor that still fits.
 */

export const EXPORT_SCALES = [1, 2, 4, 8];

const MAX_CANVAS_SIDE = 16384;
const MAX_CANVAS_AREA = 268_000_000;

/**
 * Largest export scale ≤ `scale` whose rendered canvas stays within the canvas
 * limits. Never returns above the requested scale; floors at a tiny positive so
 * a callable factor always comes back even for an already-huge viewport.
 *
 * @param {number} scale Requested multiplier (e.g. 1, 2, 4, 8).
 * @param {{ width: number, height: number }} dims Live viewport CSS dimensions.
 * @param {number} dpr Device pixel ratio the renderer composites at.
 * @param {{ maxSide?: number, maxArea?: number }} [limits]
 * @returns {number} Applied scale.
 */
export function clampExportScale(scale, dims, dpr, limits = {}) {
  const { maxSide = MAX_CANVAS_SIDE, maxArea = MAX_CANVAS_AREA } = limits;
  const ratio = dpr > 0 ? dpr : 1;
  const baseW = (dims?.width ?? 0) * ratio;
  const baseH = (dims?.height ?? 0) * ratio;
  const requested = Number.isFinite(scale) && scale > 0 ? scale : 1;

  if (baseW <= 0 || baseH <= 0) return requested;

  const sideCap = Math.min(maxSide / baseW, maxSide / baseH);
  const areaCap = Math.sqrt(maxArea / (baseW * baseH));
  const cap = Math.min(sideCap, areaCap);

  return Math.max(0.05, Math.min(requested, cap));
}

/**
 * Whether the applied scale fell short of what was requested (a clamp
 * happened), using an epsilon so float noise does not trigger a false warning.
 */
export function wasScaleClamped(requested, applied) {
  return applied < requested - 1e-6;
}
