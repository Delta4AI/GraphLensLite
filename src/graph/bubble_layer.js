/**
 * Browser-only bubble-set rendering layer (MIGRATION.md Phase 4).
 *
 * One 2d canvas registered with sigma BELOW its edge/node layers
 * (createCanvasContext + beforeLayer: "edges"); all four bubble groups paint
 * in a single pass. GraphBubbleSetManager keeps talking to per-group
 * "plugin instances" — those are thin handles into this layer's group state
 * (see getGroupHandle), so the manager's member/filter/style logic survives
 * the G6 → sigma port unchanged.
 *
 * Outlines are computed by bubblesets-js from viewport-space node rects
 * (bubble_geometry.js), then cached in GRAPH space:
 *   - membership / style / member-position changes → full recompute (the
 *     identity key in #syncGroupOutline catches them on the next frame, so
 *     a filter event can never leave a stale outline painted)
 *   - camera pan/zoom → cheap reprojection of the cached points (exact for
 *     pans; node radii drift slightly under zoom until the camera settles
 *     and #scheduleSettleRecompute re-fits the outline)
 * This replaces the G6 plugin's recompute-per-draw churn (the patched
 * updateBubbleSetsPath path coalescing, issue #7195) with an owned cache.
 */
import { DEFAULTS } from "../config.js";
import {
  nodeViewportRect,
  computeOutlinePoints,
  outlineLabelAnchor,
  idsKey,
  positionsChecksum,
  styleKey,
} from "./bubble_geometry.js";

const LAYER_NAME = "bubbleSets";
const OUTLINE_STROKE_WIDTH = 2;
// Zoom drift before the settled camera forces an outline re-fit (node
// screen radii scale non-linearly with the camera ratio, so a reprojected
// outline slowly stops hugging the nodes).
const RATIO_RECOMPUTE_LOG2 = 0.3;
const SETTLE_RECOMPUTE_MS = 150;

class BubbleSetLayer {
  /**
   * @param {object} adapter  SigmaAdapter (owns sigma + graphology)
   * @param {object} cache    app cache
   */
  constructor(adapter, cache) {
    this.adapter = adapter;
    this.cache = cache;
    this.killed = false;

    /** @type {Map<string, {members: Map<string, true>, avoidMembers: string[], opts: object}>} */
    this.groups = new Map();
    // Per-group outline cache: identity key + graph-space points + the
    // camera ratio the outline was fitted at.
    /** @type {Map<string, {key: string, graphPoints: Array<{x,y}>, computedRatio: number}>} */
    this.outlines = new Map();

    this.rafHandle = null;
    this.settleTimer = null;
    this.lastPaintSignature = null;

    const sigma = adapter.sigma;
    // createCanvasContext returns the Sigma instance (fluent API); the canvas
    // and 2d context land in sigma.elements / sigma.canvasContexts.
    sigma.createCanvasContext(LAYER_NAME, {
      beforeLayer: "edges",
      style: { pointerEvents: "none" },
    });
    this.canvas = sigma.getCanvases()[LAYER_NAME];
    this.ctx = this.canvas.getContext("2d");

    this.renderHandler = () => this.scheduleRedraw();
    sigma.on("afterRender", this.renderHandler);
  }

  /**
   * Per-group handle with the old G6 plugin-instance call surface the
   * manager expects: a `members` Map plus async update()/drawBubbleSets().
   *
   * @param {string} group  bubble group key (e.g. "groupOne")
   */
  getGroupHandle(group) {
    this.#groupState(group); // materialize the state slot
    const layer = this;
    return {
      get members() {
        return layer.#groupState(group).members;
      },
      async update(opts = {}) {
        layer.#updateGroup(group, opts);
      },
      async drawBubbleSets() {
        layer.scheduleRedraw();
      },
    };
  }

  destroy() {
    if (this.killed) return;
    this.killed = true;
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.adapter.sigma.off("afterRender", this.renderHandler);
    // sigma.kill() may or may not remove custom layer canvases; remove() on
    // an already-detached node is a no-op, so drop ours defensively.
    this.canvas?.remove();
  }

  scheduleRedraw() {
    if (this.killed || this.rafHandle !== null) return;
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      this.#paint();
    });
  }

  // ------------------------------------------------------------ group state

  #groupState(group) {
    let state = this.groups.get(group);
    if (!state) {
      state = { members: new Map(), avoidMembers: [], opts: {}, membersKey: "", avoidKey: "" };
      this.groups.set(group, state);
    }
    return state;
  }

  #updateGroup(group, opts) {
    const state = this.#groupState(group);
    const { members, avoidMembers, ...style } = opts;
    // Membership only changes here, so the O(n log n) identity keys are
    // computed once per update instead of on every afterRender frame.
    if (Array.isArray(members)) {
      state.members = new Map(members.map((id) => [id, true]));
      state.membersKey = idsKey(state.members.keys());
    }
    if (Array.isArray(avoidMembers)) {
      state.avoidMembers = [...avoidMembers];
      state.avoidKey = idsKey(state.avoidMembers);
    }
    state.opts = { ...state.opts, ...style };
    this.scheduleRedraw();
  }

  // ----------------------------------------------------------------- paint

  #paint() {
    if (this.killed) return;
    const sigma = this.adapter.sigma;
    const { width, height } = sigma.getDimensions();
    const dpr = sigma.pixelRatio ?? window.devicePixelRatio ?? 1;
    const camera = sigma.getCamera().getState();

    let outlinesChanged = false;
    const active = [];
    for (const [group, state] of this.groups) {
      if (state.members.size === 0) {
        if (this.outlines.delete(group)) outlinesChanged = true;
        continue;
      }
      outlinesChanged =
        this.#syncGroupOutline(group, state, camera, width, height) || outlinesChanged;
      if (this.outlines.get(group)?.graphPoints.length) active.push([group, state]);
    }

    // Skip repainting when neither the outlines nor the view changed (sigma
    // re-renders on hover etc. without clearing custom layers).
    const signature =
      `${width}x${height}x${dpr}|${camera.x},${camera.y},${camera.ratio},${camera.angle}` +
      `|${active.map(([g]) => g).join(",")}`;
    if (!outlinesChanged && signature === this.lastPaintSignature) return;
    this.lastPaintSignature = signature;

    const canvas = this.canvas;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    for (const [group, state] of active) {
      this.#drawGroup(ctx, group, state);
    }
  }

  /**
   * Recompute the group's outline when its identity (members, positions,
   * style) changed, or when the camera ratio drifted too far from the one
   * the outline was fitted at (debounced to camera idle).
   *
   * @returns {boolean} true when the cached outline was replaced
   */
  #syncGroupOutline(group, state, camera, width, height) {
    const graph = this.adapter.graph;
    const memberPositions = [];
    const visibleMembers = [];
    for (const id of state.members.keys()) {
      if (!graph.hasNode(id)) continue;
      const attrs = graph.getNodeAttributes(id);
      if (attrs.hidden) continue;
      visibleMembers.push({ id, attrs });
      memberPositions.push({ x: attrs.x, y: attrs.y });
    }

    // Identity keys are precomputed in #updateGroup, so the per-frame cost
    // here is the O(n) position checksum. Hidden flips stay correct: an
    // unhide changes visibleMembers.length, and a same-count hidden swap
    // changes the checksum (different nodes contribute their positions).
    const key =
      `${state.membersKey}|${state.avoidKey}|${visibleMembers.length}` +
      `|${styleKey(state.opts)}|${positionsChecksum(memberPositions)}|${width}x${height}`;
    const cached = this.outlines.get(group);
    if (cached && cached.key === key) {
      if (Math.abs(Math.log2(camera.ratio / cached.computedRatio)) > RATIO_RECOMPUTE_LOG2) {
        this.#scheduleSettleRecompute();
      }
      return false;
    }

    if (visibleMembers.length === 0) {
      this.outlines.delete(group);
      return cached !== undefined;
    }

    const sigma = this.adapter.sigma;
    const toRect = ({ attrs }) => {
      const p = sigma.graphToViewport({ x: attrs.x, y: attrs.y });
      const radius = sigma.scaleSize(attrs.size ?? DEFAULTS.NODE.SIZE / 2);
      return nodeViewportRect(p.x, p.y, radius);
    };
    const memberRects = visibleMembers.map(toRect);
    const avoidRects = [];
    for (const id of state.avoidMembers) {
      if (!graph.hasNode(id)) continue;
      const attrs = graph.getNodeAttributes(id);
      if (attrs.hidden) continue;
      avoidRects.push(toRect({ attrs }));
    }

    const viewportPoints = computeOutlinePoints(memberRects, avoidRects, {
      virtualEdges: state.opts.virtualEdges,
    });
    this.outlines.set(group, {
      key,
      // Round-trip assumes camera.angle === 0 (the app never rotates the camera).
      graphPoints: viewportPoints.map((p) => sigma.viewportToGraph(p)),
      computedRatio: camera.ratio,
    });
    return true;
  }

  #scheduleSettleRecompute() {
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      if (this.killed) return;
      this.outlines.clear();
      this.scheduleRedraw();
    }, SETTLE_RECOMPUTE_MS);
  }

  #drawGroup(ctx, group, state) {
    const sigma = this.adapter.sigma;
    // Reprojection assumes camera.angle === 0 (the app never rotates the camera).
    const points = this.outlines.get(group).graphPoints.map((p) => sigma.graphToViewport(p));
    if (!points || points.length < 2) return;
    const opts = state.opts;
    const defaults = this.cache.DEFAULTS.BUBBLE_GROUP_STYLE[group] ?? {};

    const path = new Path2D();
    path.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) path.lineTo(points[i].x, points[i].y);
    path.closePath();

    ctx.save();
    try {
      ctx.globalAlpha = opts.fillOpacity ?? defaults.fillOpacity ?? 0.25;
      ctx.fillStyle = opts.fill ?? defaults.fill ?? "#403C53";
      ctx.fill(path);
      ctx.globalAlpha = opts.strokeOpacity ?? defaults.strokeOpacity ?? 1;
      ctx.strokeStyle = opts.stroke ?? defaults.stroke ?? "#403C53";
      ctx.lineWidth = OUTLINE_STROKE_WIDTH;
      ctx.stroke(path);
      ctx.globalAlpha = 1;

      if (opts.label) this.#drawLabel(ctx, points, opts, defaults);
    } finally {
      ctx.restore();
    }
  }

  /**
   * Group label at the topmost outline point (the old plugin's default
   * hanging position). Honors text/fill/size/padding/background/offsets;
   * labelPlacement/labelCloseToPath/labelAutoRotate are documented
   * degradations of the port.
   */
  #drawLabel(ctx, points, opts, defaults) {
    const text = opts.labelText ?? defaults.labelText ?? "";
    if (!text) return;
    const anchor = outlineLabelAnchor(points);
    if (!anchor) return;

    const fontSize = opts.labelFontSize ?? defaults.labelFontSize ?? 12;
    const padding = opts.labelPadding ?? defaults.labelPadding ?? 2;
    const x = anchor.x + (opts.labelOffsetX ?? 0);
    const y = anchor.y + (opts.labelOffsetY ?? 0);

    ctx.font = `${fontSize}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const textWidth = ctx.measureText(text).width;

    if (opts.labelBackground ?? defaults.labelBackground) {
      const radius = opts.labelBackgroundRadius ?? defaults.labelBackgroundRadius ?? 5;
      ctx.fillStyle = opts.labelBackgroundFill ?? defaults.labelBackgroundFill ?? "#403C53";
      ctx.beginPath();
      ctx.roundRect(
        x - textWidth / 2 - padding,
        y - fontSize / 2 - padding,
        textWidth + 2 * padding,
        fontSize + 2 * padding,
        radius,
      );
      ctx.fill();
    }
    ctx.fillStyle = opts.labelFill ?? defaults.labelFill ?? "#fff";
    ctx.fillText(text, x, y);
  }
}

export { BubbleSetLayer };
