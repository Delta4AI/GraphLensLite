/**
 * Browser-only atmospheric canvas layer: node-density heatmap.
 *
 * One 2d canvas registered BOTTOM-MOST — below the bubbleSets canvas.
 * LAYER ORDERING (verified against the bundled sigma createLayer): a layer
 * created with beforeLayer: "edges" is inserted into the DOM immediately
 * before the "edges" canvas via Element.before(), so among several layers
 * targeting the same beforeLayer the EARLIEST-created one ends up deepest
 * (each later sibling lands between the previous insert and "edges"). This
 * layer is therefore instantiated BEFORE BubbleSetLayer in the adapter
 * constructor: heatmap < bubbleSets < edges.
 *
 * HEATMAP pass (off by default): gaussian-ish alpha splats per visible node,
 * accumulated into an OFFSCREEN canvas in graph-space px and colored through
 * the theme ramp (heatmap_geometry.js). The offscreen is cached under a
 * viewport-INDEPENDENT key (positions checksum + theme + settings), so
 * pan/zoom never re-splats — each frame is a single drawImage with the
 * camera affine.
 *
 * `settings` are the live appearance knobs (styling-panel card): intensity,
 * gamma and threshold shape the density field, bandwidthScale the splat
 * radius, ramp picks the color preset (config RAMPS) — all five ride the
 * heat key so a tweak rebuilds the offscreen. opacity only affects the
 * per-frame composite (signature, not key). dimGraph is consumed by the
 * reducers (graph_model.js heatmapDimActive), not painted here — enabled/
 * dimGraph flips refresh sigma so the reducers re-run.
 *
 * Redraw plumbing mirrors bubble_layer.js: afterRender → scheduleRedraw rAF
 * coalescing, paint-signature skip, destroy() discipline. With the pass off
 * the canvas is cleared once and the handler does zero per-frame work.
 *
 * Known cost bound: dragging a node WITH the heatmap enabled re-splats the
 * offscreen every frame (positions are part of the heat key — staleness
 * would be worse). The dominant term is the getImageData readback of the
 * ≤ MAX_RESOLUTION² offscreen; fine at the app's typical graph sizes, the
 * knob to lower on huge graphs is DEFAULTS.HEATMAP.MAX_RESOLUTION.
 */
import { DEFAULTS } from "../config.js";
import { currentTheme } from "../utilities/theme.js";
import { positionsChecksum } from "./bubble_geometry.js";
import {
  graphBBox,
  splatTransform,
  heatBandwidth,
  buildRampLut,
  applyRampToAlpha,
} from "./heatmap_geometry.js";

const LAYER_NAME = "heatmap";

/** Initial runtime settings, copied from config (see header comment). */
function defaultSettings() {
  return {
    opacity: DEFAULTS.HEATMAP.OPACITY,
    intensity: DEFAULTS.HEATMAP.INTENSITY,
    gamma: DEFAULTS.HEATMAP.GAMMA,
    threshold: DEFAULTS.HEATMAP.THRESHOLD,
    bandwidthScale: DEFAULTS.HEATMAP.BANDWIDTH_SCALE,
    ramp: DEFAULTS.HEATMAP.RAMP,
    dimGraph: DEFAULTS.HEATMAP.DIM_GRAPH,
  };
}

/** Theme-resolved stops for a preset name; unknown names fall back to default. */
function rampStopsFor(ramp, theme) {
  const preset = DEFAULTS.HEATMAP.RAMPS[ramp] ?? DEFAULTS.HEATMAP.RAMPS.default;
  return theme === "dark" ? preset.dark : preset.light;
}

class HeatmapLayer {
  /**
   * @param {object} adapter  SigmaAdapter (owns sigma + graphology)
   */
  constructor(adapter) {
    this.adapter = adapter;
    this.killed = false;
    this.heatmapEnabled = DEFAULTS.HEATMAP.ENABLED;
    this.settings = defaultSettings();

    this.rafHandle = null;
    this.lastPaintSignature = null;
    // Blank-canvas tracker: lets scheduleRedraw skip the rAF entirely while
    // the pass is off (the canvas starts blank).
    this.cleared = true;
    /** @type {{key: string, canvas: HTMLCanvasElement|null, transform: object|null}|null} */
    this.heatCache = null;
    /** @type {Map<string, Uint8ClampedArray>} ramp stops JSON → buildRampLut output */
    this.rampLuts = new Map();

    const sigma = adapter.sigma;
    sigma.createCanvasContext(LAYER_NAME, {
      beforeLayer: "edges",
      style: { pointerEvents: "none" },
    });
    this.canvas = sigma.getCanvases()[LAYER_NAME];
    this.ctx = this.canvas.getContext("2d");

    this.renderHandler = () => this.scheduleRedraw();
    sigma.on("afterRender", this.renderHandler);
  }

  /** @param {boolean} enabled */
  setHeatmapEnabled(enabled) {
    if (this.heatmapEnabled === !!enabled) return;
    this.heatmapEnabled = !!enabled;
    this.lastPaintSignature = null;
    // The reducers consult heatmapEnabled for the dim-graph companion; a
    // refresh re-runs them and its afterRender drives our repaint too.
    if (this.settings.dimGraph) this.adapter.sigma.refresh();
    this.scheduleRedraw();
  }

  /**
   * Merge new appearance settings (styling-panel card). Field-shaping knobs
   * ride the heat key, so the offscreen rebuilds on the next paint by itself.
   * Unknown keys and non-finite numbers are dropped — a NaN would poison the
   * heat key and the composite alpha silently.
   *
   * @param {Partial<ReturnType<typeof defaultSettings>>} partial
   */
  updateSettings(partial) {
    const dimWas = this.settings.dimGraph;
    const next = { ...this.settings };
    for (const [key, value] of Object.entries(partial)) {
      if (!(key in next)) continue;
      if (key === "dimGraph") next.dimGraph = !!value;
      else if (key === "ramp") {
        if (typeof value === "string" && value in DEFAULTS.HEATMAP.RAMPS) next.ramp = value;
      } else if (Number.isFinite(value)) next[key] = value;
    }
    this.settings = next;
    this.lastPaintSignature = null;
    if (this.settings.dimGraph !== dimWas && this.heatmapEnabled) {
      this.adapter.sigma.refresh();
    }
    this.scheduleRedraw();
  }

  /** Reset all appearance settings to their config defaults. */
  resetSettings() {
    this.updateSettings(defaultSettings());
  }

  destroy() {
    if (this.killed) return;
    this.killed = true;
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.adapter.sigma.off("afterRender", this.renderHandler);
    // sigma.kill() may or may not remove custom layer canvases; remove() on
    // an already-detached node is a no-op, so drop ours defensively.
    this.canvas?.remove();
    // The offscreen holds up to MAX_RESOLUTION² of GPU-backed canvas memory;
    // release it eagerly rather than waiting out the GC (workspace switches
    // replace the whole adapter, so these can otherwise pile up).
    this.#releaseHeatCache();
    this.rampLuts.clear();
  }

  /** Zero the cached offscreen's backing store and drop the cache slot. */
  #releaseHeatCache() {
    if (this.heatCache?.canvas) {
      this.heatCache.canvas.width = 0;
      this.heatCache.canvas.height = 0;
    }
    this.heatCache = null;
  }

  scheduleRedraw() {
    if (this.killed || this.rafHandle !== null) return;
    // Pass off and the canvas already blank: the afterRender handler must
    // stay free — don't even take a rAF.
    if (!this.heatmapEnabled && this.cleared) return;
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      this.#paint();
    });
  }

  // ----------------------------------------------------------------- paint

  #paint() {
    if (this.killed) return;
    const sigma = this.adapter.sigma;
    const { width, height } = sigma.getDimensions();
    const dpr = sigma.pixelRatio ?? window.devicePixelRatio ?? 1;

    // Disabled: clear once, then scheduleRedraw stays a no-op (early return
    // BEFORE any signature computation).
    if (!this.heatmapEnabled) {
      this.#prepareCanvas(width, height, dpr);
      this.cleared = true;
      this.lastPaintSignature = null;
      return;
    }
    this.cleared = false;

    const camera = sigma.getCamera().getState();
    const theme = currentTheme(document);

    // Heatmap identity is viewport-INDEPENDENT — pan/zoom must not re-splat.
    // positionsChecksum already folds the node count in (length prefix).
    // The ramp rides the key as its serialized stops (not the theme name),
    // so a runtime ramp edit can never serve a stale recolor. The field-
    // shaping settings (intensity/gamma/bandwidthScale) ride it too.
    const positions = this.#visibleNodePositions();
    const s = this.settings;
    const rampStops = rampStopsFor(s.ramp, theme);
    const heatKey =
      `${positionsChecksum(positions)}|${JSON.stringify(rampStops)}` +
      `|${DEFAULTS.HEATMAP.BANDWIDTH}|${DEFAULTS.HEATMAP.MAX_RESOLUTION}` +
      `|${s.intensity}|${s.gamma}|${s.threshold}|${s.bandwidthScale}`;

    // Skip repainting when neither the content nor the view changed (sigma
    // re-renders on hover etc. without clearing custom layers). opacity is
    // composite-only: part of the signature, not the heat key.
    const signature =
      `${width}x${height}x${dpr}|${camera.x},${camera.y},${camera.ratio},${camera.angle}` +
      `|h:${heatKey}|o:${s.opacity}`;
    if (signature === this.lastPaintSignature) return;
    this.lastPaintSignature = signature;

    this.#prepareCanvas(width, height, dpr);
    this.#syncHeatmap(positions, heatKey, rampStops);
    this.#drawHeatmap();
  }

  /** Resize (if needed) and clear the layer canvas, scaled to the device ratio. */
  #prepareCanvas(width, height, dpr) {
    if (this.canvas.width !== width * dpr || this.canvas.height !== height * dpr) {
      this.canvas.width = width * dpr;
      this.canvas.height = height * dpr;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, width, height);
  }

  /** @returns {Array<{x: number, y: number}>} positions of non-hidden nodes */
  #visibleNodePositions() {
    const positions = [];
    this.adapter.graph.forEachNode((id, attrs) => {
      if (!attrs.hidden) positions.push({ x: attrs.x, y: attrs.y });
    });
    return positions;
  }

  // --------------------------------------------------------------- heatmap

  /** Ramp LUT, cached by the stops' serialization (not the theme name). */
  #rampLut(stops) {
    const key = JSON.stringify(stops);
    let lut = this.rampLuts.get(key);
    if (!lut) {
      lut = buildRampLut(stops);
      this.rampLuts.set(key, lut);
    }
    return lut;
  }

  /**
   * Rebuild the colored offscreen when the viewport-independent key changed:
   * alpha splats accumulated in graph-space px, then mapped through the
   * theme ramp (a theme flip is part of the key, so it recolors).
   */
  #syncHeatmap(positions, key, rampStops) {
    if (this.heatCache?.key === key) return;
    this.#releaseHeatCache();
    const bbox = graphBBox(positions);
    const bandwidth = bbox
      ? heatBandwidth(bbox, positions.length, DEFAULTS.HEATMAP.BANDWIDTH) *
        this.settings.bandwidthScale
      : 0;
    if (!bbox || !(bandwidth > 0)) {
      // No drawable field (empty graph, or a zero-extent bbox under auto
      // bandwidth) — cache the verdict so the next frames stay free.
      this.heatCache = { key, canvas: null, transform: null };
      return;
    }
    const transform = splatTransform(bbox, bandwidth, DEFAULTS.HEATMAP.MAX_RESOLUTION);
    const off = document.createElement("canvas");
    off.width = transform.width;
    off.height = transform.height;
    const offCtx = off.getContext("2d", { willReadFrequently: true });

    // One alpha-only sprite stamped per node beats N radial-gradient fills.
    const radiusPx = Math.max(1, bandwidth * transform.scale);
    const sprite = this.#buildSplatSprite(radiusPx);
    const half = sprite.width / 2;
    for (const p of positions) {
      offCtx.drawImage(
        sprite,
        (p.x - transform.offsetX) * transform.scale - half,
        (p.y - transform.offsetY) * transform.scale - half,
      );
    }

    // NOTE: synchronous GPU→CPU readback of the whole offscreen — the slow
    // path of a rebuild; MAX_RESOLUTION bounds it. applyRampToAlpha mutates
    // in place and returns the same ImageData; using the return value keeps
    // the contract explicit at this call site.
    const image = offCtx.getImageData(0, 0, transform.width, transform.height);
    offCtx.putImageData(
      applyRampToAlpha(image, this.#rampLut(rampStops), this.settings.gamma, this.settings.threshold),
      0,
      0,
    );
    this.heatCache = { key, canvas: off, transform };
  }

  /** Radial alpha falloff sprite: settings.intensity at center → 0 at radius. */
  #buildSplatSprite(radiusPx) {
    const size = Math.max(2, Math.ceil(radiusPx * 2));
    const sprite = document.createElement("canvas");
    sprite.width = size;
    sprite.height = size;
    const ctx = sprite.getContext("2d");
    const c = size / 2;
    const gradient = ctx.createRadialGradient(c, c, 0, c, c, radiusPx);
    gradient.addColorStop(0, `rgba(0, 0, 0, ${this.settings.intensity})`);
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return sprite;
  }

  /**
   * Per-frame composite: one drawImage of the cached offscreen under the
   * camera transform. The affine is derived from graphToViewport of the
   * offscreen's two graph-space corners, which absorbs sigma's y orientation
   * (sy comes out negative when graph y points up). Assumes camera.angle
   * === 0 — the app never rotates the camera (same as bubble_layer.js).
   */
  #drawHeatmap() {
    const { canvas: off, transform: t } = this.heatCache;
    if (!off) return;
    const sigma = this.adapter.sigma;
    const p0 = sigma.graphToViewport({ x: t.offsetX, y: t.offsetY });
    const p1 = sigma.graphToViewport({
      x: t.offsetX + t.width / t.scale,
      y: t.offsetY + t.height / t.scale,
    });
    const ctx = this.ctx;
    ctx.save();
    try {
      ctx.globalAlpha = this.settings.opacity;
      ctx.transform((p1.x - p0.x) / t.width, 0, 0, (p1.y - p0.y) / t.height, p0.x, p0.y);
      ctx.drawImage(off, 0, 0);
    } finally {
      ctx.restore();
    }
  }
}

export { HeatmapLayer };
