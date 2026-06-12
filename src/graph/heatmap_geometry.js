/**
 * Node-safe density-heatmap geometry helpers.
 *
 * Pure math between the graph model and the atmospheric canvas layer
 * (heatmap_layer.js): bbox/splat-canvas sizing, bandwidth derivation and the
 * color-ramp lookup the layer applies to the accumulated splat density. Must
 * never import the sigma bundle or touch the DOM — vitest imports this
 * module under node.
 */

// Derived-bandwidth clamp, as a fraction of the bbox diagonal. The default
// bandwidth shrinks as points get denser (diagonal/√n: average inter-point
// spacing for a uniform spread), but is bounded so it never degenerates —
// the lower clamp keeps splats visible on huge graphs, the upper clamp keeps
// tiny graphs from melting into one undifferentiated blob.
const BANDWIDTH_MIN_DIAGONAL_FRACTION = 0.02;
const BANDWIDTH_MAX_DIAGONAL_FRACTION = 0.12;

// Degenerate-bbox fallback (single node / zero area with zero bandwidth):
// a fixed small canvas spanning 1 graph unit centered on the bbox keeps
// callers crash-free without allocating a meaningless 1024px surface.
const DEGENERATE_SPAN = 1;
const DEGENERATE_RESOLUTION = 8;

const HEX_COLOR_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const LUT_SIZE = 256;

/**
 * Axis-aligned bounding box over graph-space positions. Entries with a
 * non-finite coordinate are ignored.
 *
 * @param {Iterable<{x: number, y: number}>} positions
 * @returns {{minX: number, minY: number, maxX: number, maxY: number}|null}
 *   null when no finite position exists
 */
function graphBBox(positions) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of positions) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Graph-space → offscreen-canvas-px mapping for the splat surface: the bbox
 * PLUS a bandwidth margin on every side fits the canvas, long side capped at
 * maxResolution. The mapping is uniform and axis-aligned:
 *
 *   px = (x - offsetX) * scale,  py = (y - offsetY) * scale
 *
 * (no y flip — the layer's per-frame drawImage affine absorbs whatever
 * orientation sigma's graphToViewport applies).
 *
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} bbox
 * @param {number} bandwidth  graph-units margin (splat radius)
 * @param {number} [maxResolution]  long-side px cap
 * @returns {{scale: number, offsetX: number, offsetY: number,
 *   width: number, height: number}}
 */
function splatTransform(bbox, bandwidth, maxResolution = 1024) {
  const spanX = bbox.maxX - bbox.minX + 2 * bandwidth;
  const spanY = bbox.maxY - bbox.minY + 2 * bandwidth;
  const longSide = Math.max(spanX, spanY);
  if (!Number.isFinite(longSide) || longSide <= 0) {
    const half = DEGENERATE_SPAN / 2;
    return {
      scale: DEGENERATE_RESOLUTION / DEGENERATE_SPAN,
      offsetX: (bbox.minX + bbox.maxX) / 2 - half,
      offsetY: (bbox.minY + bbox.maxY) / 2 - half,
      width: DEGENERATE_RESOLUTION,
      height: DEGENERATE_RESOLUTION,
    };
  }
  const scale = maxResolution / longSide;
  return {
    scale,
    offsetX: bbox.minX - bandwidth,
    offsetY: bbox.minY - bandwidth,
    width: Math.max(1, Math.round(spanX * scale)),
    height: Math.max(1, Math.round(spanY * scale)),
  };
}

/**
 * Gaussian splat radius in graph units. An explicit positive configBandwidth
 * wins; otherwise diagonal/√(nodeCount), clamped to
 * [BANDWIDTH_MIN_DIAGONAL_FRACTION, BANDWIDTH_MAX_DIAGONAL_FRACTION] of the
 * diagonal (see the clamp-constants comment for the rationale).
 *
 * @param {{minX: number, minY: number, maxX: number, maxY: number}|null} bbox
 * @param {number} nodeCount
 * @param {number} configBandwidth  graph units; <= 0 → derive
 * @returns {number}  0 when there is no drawable extent
 */
function heatBandwidth(bbox, nodeCount, configBandwidth) {
  if (configBandwidth > 0) return configBandwidth;
  if (!bbox) return 0;
  const diagonal = Math.hypot(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
  if (!(diagonal > 0)) return 0;
  const derived = diagonal / Math.sqrt(Math.max(1, nodeCount));
  return Math.min(
    BANDWIDTH_MAX_DIAGONAL_FRACTION * diagonal,
    Math.max(BANDWIDTH_MIN_DIAGONAL_FRACTION * diagonal, derived),
  );
}

/**
 * @param {string} color  "#rrggbb" or "#rrggbbaa"
 * @returns {number[]} RGBA 0-255
 * @throws {Error} on any other form — silent NaN channels paint nothing
 *   (Canvas2D ignores invalid rgba() strings), which is far harder to debug
 */
function parseHexColor(color) {
  if (typeof color !== "string" || !HEX_COLOR_RE.test(color)) {
    throw new Error(`parseHexColor: expected "#rrggbb" or "#rrggbbaa", got ${JSON.stringify(color)}`);
  }
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const a = color.length === 9 ? parseInt(color.slice(7, 9), 16) : 255;
  return [r, g, b, a];
}

/**
 * 256-entry RGBA lookup table from color stops, linearly interpolated per
 * channel. Densities below the first stop's t take the first color, above
 * the last stop's t the last color.
 *
 * @param {Array<{t: number, color: string}>} stops  t in [0, 1] ascending,
 *   color "#rrggbb" or "#rrggbbaa"
 * @returns {Uint8ClampedArray}  length 256*4
 * @throws {Error} on malformed stops (wrong shape, t out of range or
 *   unsorted, unparseable color)
 */
function buildRampLut(stops) {
  if (!Array.isArray(stops) || stops.length < 2) {
    throw new Error("buildRampLut: need an array of at least 2 stops");
  }
  const parsed = stops.map((stop, i) => {
    if (!stop || !Number.isFinite(stop.t) || stop.t < 0 || stop.t > 1) {
      throw new Error(`buildRampLut: stop ${i} needs a finite t in [0, 1]`);
    }
    if (i > 0 && stop.t < stops[i - 1].t) {
      throw new Error("buildRampLut: stops must be sorted ascending by t");
    }
    if (typeof stop.color !== "string" || !HEX_COLOR_RE.test(stop.color)) {
      throw new Error(`buildRampLut: stop ${i} color must be "#rrggbb" or "#rrggbbaa"`);
    }
    return { t: stop.t, rgba: parseHexColor(stop.color) };
  });

  const lut = new Uint8ClampedArray(LUT_SIZE * 4);
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = i / (LUT_SIZE - 1);
    let seg = 0;
    while (seg < parsed.length - 2 && parsed[seg + 1].t < t) seg++;
    const lo = parsed[seg];
    const hi = parsed[seg + 1];
    const span = hi.t - lo.t;
    // Clamping covers t outside [first.t, last.t]; coincident stops (span 0)
    // resolve to the later stop.
    const f = span > 0 ? Math.min(1, Math.max(0, (t - lo.t) / span)) : 1;
    for (let c = 0; c < 4; c++) {
      lut[i * 4 + c] = lo.rgba[c] + (hi.rgba[c] - lo.rgba[c]) * f;
    }
  }
  return lut;
}

/**
 * Map each pixel's accumulated alpha through the ramp LUT into RGBA — IN
 * PLACE (the one deliberate mutation in this module: the ImageData buffer is
 * the output surface). Pixels with alpha 0 stay fully transparent.
 *
 * Threshold semantics: densities below `threshold` clear entirely and the
 * surviving range renormalizes to [0, 1] before gamma, so the ramp keeps its
 * full sweep above the cutoff. Splat accumulation is alpha compositing
 * (1 − (1 − intensity)ⁿ for n overlaps), so a lone node peaks at exactly the
 * splat intensity — a threshold just above it shows only real clusters.
 *
 * @param {{data: Uint8ClampedArray}} imageData  canvas ImageData (or a
 *   node-side stand-in with a `data` buffer)
 * @param {Uint8ClampedArray} lut  buildRampLut output
 * @param {number} [gamma]  density exponent before the lookup (> 1 thins
 *   low-density haze, < 1 boosts it)
 * @param {number} [threshold]  density floor in [0, 1); <= 0 → no floor,
 *   >= 1 degenerates to a fully transparent field
 * @returns {{data: Uint8ClampedArray}} the same imageData
 */
function applyRampToAlpha(imageData, lut, gamma = 1, threshold = 0) {
  const data = imageData.data;
  const span = 1 - threshold;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 0) continue;
    let density = alpha / 255;
    if (threshold > 0) {
      if (density < threshold || !(span > 0)) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 0;
        continue;
      }
      density = (density - threshold) / span;
    }
    const idx = 4 * Math.min(LUT_SIZE - 1, Math.round((LUT_SIZE - 1) * Math.pow(density, gamma)));
    data[i] = lut[idx];
    data[i + 1] = lut[idx + 1];
    data[i + 2] = lut[idx + 2];
    data[i + 3] = lut[idx + 3];
  }
  return imageData;
}

export { graphBBox, splatTransform, heatBandwidth, parseHexColor, buildRampLut, applyRampToAlpha };
