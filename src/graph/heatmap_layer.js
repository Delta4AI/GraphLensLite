/**
 * Browser-only atmospheric canvas layer: density heatmap + selection glow.
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
 * Two independent passes share the canvas (both off by default):
 * - HEATMAP: gaussian-ish alpha splats per visible node, accumulated into an
 *   OFFSCREEN canvas in graph-space px and colored through the theme ramp
 *   (heatmap_geometry.js). The offscreen is cached under a viewport-
 *   INDEPENDENT key (positions checksum + theme + config), so pan/zoom never
 *   re-splats — each frame is a single drawImage with the camera affine.
 * - GLOW: accent radial gradients behind SELECTED nodes, drawn in viewport
 *   space directly each repaint (selection sets are small; no offscreen).
 *
 * Redraw plumbing mirrors bubble_layer.js: afterRender → scheduleRedraw rAF
 * coalescing, paint-signature skip, destroy() discipline. With both passes
 * off the canvas is cleared once and the handler does zero per-frame work.
 *
 * Known cost bound: dragging a node WITH the heatmap enabled re-splats the
 * offscreen every frame (positions are part of the heat key — staleness
 * would be worse). The dominant term is the getImageData readback of the
 * ≤ MAX_RESOLUTION² offscreen; fine at the app's typical graph sizes, the
 * knob to lower on huge graphs is DEFAULTS.HEATMAP.MAX_RESOLUTION.
 */
import { DEFAULTS } from "../config.js";
import { currentTheme } from "../utilities/theme.js";
import { idsKey, positionsChecksum } from "./bubble_geometry.js";
import {
  graphBBox,
  splatTransform,
  heatBandwidth,
  parseHexColor,
  buildRampLut,
  applyRampToAlpha,
} from "./heatmap_geometry.js";

const LAYER_NAME = "heatmap";
// Per-splat center alpha: low enough that density only saturates where many
// bandwidths overlap, keeping the field atmospheric instead of opaque.
const SPLAT_CENTER_ALPHA = 0.18;

class HeatmapLayer {
  /**
   * @param {object} adapter  SigmaAdapter (owns sigma + graphology + elementStates)
   */
  constructor(adapter) {
    this.adapter = adapter;
    this.killed = false;
    this.heatmapEnabled = DEFAULTS.HEATMAP.ENABLED;
    this.glowEnabled = DEFAULTS.GLOW.ENABLED;

    this.rafHandle = null;
    this.lastPaintSignature = null;
    // Blank-canvas tracker: lets scheduleRedraw skip the rAF entirely while
    // both passes are off (the canvas starts blank).
    this.cleared = true;
    /** @type {{key: string, canvas: HTMLCanvasElement|null, transform: object|null}|null} */
    this.heatCache = null;
    /** @type {Map<string, Uint8ClampedArray>} theme → buildRampLut output */
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
    this.scheduleRedraw();
  }

  /** @param {boolean} enabled */
  setGlowEnabled(enabled) {
    if (this.glowEnabled === !!enabled) return;
    this.glowEnabled = !!enabled;
    this.lastPaintSignature = null;
    this.scheduleRedraw();
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
    // Both passes off and the canvas already blank: the afterRender handler
    // must stay free — don't even take a rAF.
    if (!this.heatmapEnabled && !this.glowEnabled && this.cleared) return;
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

    // Disabled entirely: clear once, then scheduleRedraw stays a no-op
    // (early return BEFORE any signature computation).
    if (!this.heatmapEnabled && !this.glowEnabled) {
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
    // so a runtime ramp edit can never serve a stale recolor.
    let positions = null;
    let heatKey = "off";
    let rampStops = null;
    if (this.heatmapEnabled) {
      positions = this.#visibleNodePositions();
      rampStops = theme === "dark" ? DEFAULTS.HEATMAP.RAMP_DARK : DEFAULTS.HEATMAP.RAMP_LIGHT;
      heatKey =
        `${positionsChecksum(positions)}|${JSON.stringify(rampStops)}` +
        `|${DEFAULTS.HEATMAP.BANDWIDTH}|${DEFAULTS.HEATMAP.MAX_RESOLUTION}`;
    }
    let selectedIds = null;
    let glowKey = "off";
    if (this.glowEnabled) {
      selectedIds = this.#selectedVisibleNodes();
      // Positions fold in so dragging a selected node moves its glow even
      // when nothing else (camera, heatmap) invalidates the signature.
      const selectedPositions = selectedIds.map((id) =>
        this.adapter.graph.getNodeAttributes(id),
      );
      glowKey = `${idsKey(selectedIds)}|${positionsChecksum(selectedPositions)}`;
    }

    // Skip repainting when neither the content nor the view changed (sigma
    // re-renders on hover etc. without clearing custom layers).
    const signature =
      `${width}x${height}x${dpr}|${camera.x},${camera.y},${camera.ratio},${camera.angle}` +
      `|h:${heatKey}|g:${glowKey}`;
    if (signature === this.lastPaintSignature) return;
    this.lastPaintSignature = signature;

    this.#prepareCanvas(width, height, dpr);
    if (this.heatmapEnabled) {
      this.#syncHeatmap(positions, heatKey, rampStops);
      this.#drawHeatmap();
    }
    if (this.glowEnabled) this.#drawGlow(selectedIds);
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

  /** @returns {string[]} ids of visible nodes carrying the "selected" state */
  #selectedVisibleNodes() {
    const graph = this.adapter.graph;
    const ids = [];
    // elementStates holds nodes AND edges; hasNode filters the edges out.
    for (const [id, states] of this.adapter.elementStates) {
      if (!states.includes("selected") || !graph.hasNode(id)) continue;
      if (graph.getNodeAttributes(id).hidden) continue;
      ids.push(id);
    }
    return ids;
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
      ? heatBandwidth(bbox, positions.length, DEFAULTS.HEATMAP.BANDWIDTH)
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
    offCtx.putImageData(applyRampToAlpha(image, this.#rampLut(rampStops)), 0, 0);
    this.heatCache = { key, canvas: off, transform };
  }

  /** Radial alpha falloff sprite: SPLAT_CENTER_ALPHA at center → 0 at radius. */
  #buildSplatSprite(radiusPx) {
    const size = Math.max(2, Math.ceil(radiusPx * 2));
    const sprite = document.createElement("canvas");
    sprite.width = size;
    sprite.height = size;
    const ctx = sprite.getContext("2d");
    const c = size / 2;
    const gradient = ctx.createRadialGradient(c, c, 0, c, c, radiusPx);
    gradient.addColorStop(0, `rgba(0, 0, 0, ${SPLAT_CENTER_ALPHA})`);
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
      // Fixed layer opacity keeps the field atmospheric under any density.
      ctx.globalAlpha = DEFAULTS.HEATMAP.OPACITY;
      ctx.transform((p1.x - p0.x) / t.width, 0, 0, (p1.y - p0.y) / t.height, p0.x, p0.y);
      ctx.drawImage(off, 0, 0);
    } finally {
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------ glow

  /** Accent radial gradients behind the selected nodes, in viewport space. */
  #drawGlow(ids) {
    const sigma = this.adapter.sigma;
    const graph = this.adapter.graph;
    const ctx = this.ctx;
    const [r, g, b] = parseHexColor(DEFAULTS.STATE.ACCENT_COLOR);
    for (const id of ids) {
      const attrs = graph.getNodeAttributes(id);
      const p = sigma.graphToViewport({ x: attrs.x, y: attrs.y });
      const radius =
        sigma.scaleSize(attrs.size ?? DEFAULTS.NODE.SIZE / 2) * DEFAULTS.GLOW.RADIUS_MULTIPLIER;
      if (!(radius > 0)) continue;
      const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${DEFAULTS.GLOW.OPACITY})`);
      gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
}

export { HeatmapLayer };
