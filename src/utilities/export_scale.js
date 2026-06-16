/**
 * Pure helpers for high-resolution PNG export. Node-safe (no DOM/canvas) so the
 * clamping math can be unit-tested in isolation.
 *
 * The exported image is re-rendered by @sigma/export-image at
 * `cssWidth * scale * devicePixelRatio` pixels. Large viewports times a high
 * factor can blow past per-browser canvas ceilings (~16384 px per side and
 * ~268 MP total area in Chrome) and crash the render, so the requested scale is
 * clamped to the largest factor that still fits.
 *
 * The ladder tops out at 4x. An 8x factor pushed real GPUs into a regime where
 * the WebGL framebuffer AND the same-size 2D composite canvas (~half a GB each
 * for a HiDPI viewport) silently failed to allocate — yielding a blank or, when
 * only the node program lost its buffer, a partial render (edges but no nodes).
 * Partial renders evade the blank-probe net, so the only robust fix is not to
 * offer the factor that triggers them; 4x already yields multi-thousand-pixel
 * figures, and SVG covers truly resolution-independent output.
 */

export const EXPORT_SCALES = [1, 2, 4];

export const MAX_CANVAS_SIDE = 16384;
const MAX_CANVAS_AREA = 268_000_000;

/**
 * Render no larger than this fraction of the GPU's probed max canvas side.
 * Drivers report MAX_TEXTURE_SIZE / MAX_RENDERBUFFER_SIZE optimistically;
 * allocating a framebuffer AT that ceiling while the scene's other GPU buffers
 * are resident routinely fails (blank/partial render, no exception). Staying
 * back a margin keeps the export inside the reliably-allocatable envelope.
 */
export const WEBGL_SAFE_SIDE_FRACTION = 0.9;

/**
 * Largest export scale ≤ `scale` whose rendered canvas stays within the canvas
 * limits. Never returns above the requested scale; floors at a tiny positive so
 * a callable factor always comes back even for an already-huge viewport.
 *
 * @param {number} scale Requested multiplier (e.g. 1, 2, 4).
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
