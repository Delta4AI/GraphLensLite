/**
 * Browser-only bubble-set rendering layer (MIGRATION.md Phase 4).
 *
 * Two 2d canvases registered with sigma: the fill/outline canvas sits BELOW
 * its edge/node layers (createCanvasContext + beforeLayer: "edges") so nodes
 * paint over the translucent body; the group-LABEL canvas sits ABOVE sigma's
 * node-label layer (afterLayer: "labels") so a member node's own label can
 * never obscure the group name (a primary read). All four bubble groups paint
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
 *     pans; under zoom the cache key quantizes log2(camera.ratio) into
 *     RATIO_RECOMPUTE_LOG2-wide buckets, so node-radius drift forces a
 *     re-fit at each bucket crossing — this also keeps an empty outline
 *     from sticking once the zoom moves on)
 * This replaces the G6 plugin's recompute-per-draw churn (the patched
 * updateBubbleSetsPath path coalescing, issue #7195) with an owned cache.
 */
import { DEFAULTS } from "../config.js";
import {
  nodeViewportRect,
  computeOutlinePoints,
  polygonSelfIntersects,
  outlineLabelAnchor,
  idsKey,
  positionsChecksum,
  styleKey,
} from "./bubble_geometry.js";

const LAYER_NAME = "bubbleSets";
const LABEL_LAYER_NAME = "bubbleSetsLabels";
const OUTLINE_STROKE_WIDTH = 2;
// Zoom drift before an outline re-fit: log2(camera.ratio) is quantized into
// buckets of this width inside the outline cache key (node screen radii
// scale non-linearly with the camera ratio, so a reprojected outline slowly
// stops hugging the nodes).
const RATIO_RECOMPUTE_LOG2 = 0.3;
// Extra screen-px gap (beyond half the font box) between the outline and a
// label drawn with labelCloseToPath: false.
const LABEL_STANDOFF_PX = 8;

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
    // Per-group outline cache: identity key (membership, style, positions,
    // viewport size, ratio bucket) + graph-space points.
    /** @type {Map<string, {key: string, graphPoints: Array<{x,y}>}>} */
    this.outlines = new Map();

    this.rafHandle = null;
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

    // Group labels paint on their own canvas stacked above sigma's node-label
    // layer so they always win the z-order contest against member labels.
    sigma.createCanvasContext(LABEL_LAYER_NAME, {
      afterLayer: "labels",
      style: { pointerEvents: "none" },
    });
    this.labelCanvas = sigma.getCanvases()[LABEL_LAYER_NAME];
    this.labelCtx = this.labelCanvas.getContext("2d");

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
    this.adapter.sigma.off("afterRender", this.renderHandler);
    // sigma.kill() may or may not remove custom layer canvases; remove() on
    // an already-detached node is a no-op, so drop ours defensively.
    this.canvas?.remove();
    this.labelCanvas?.remove();
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

    this.#prepareCanvas(this.canvas, this.ctx, width, height, dpr);
    this.#prepareCanvas(this.labelCanvas, this.labelCtx, width, height, dpr);

    for (const [group, state] of active) {
      // Reprojection assumes camera.angle === 0 (the app never rotates the camera).
      const points = this.outlines
        .get(group)
        .graphPoints.map((p) => sigma.graphToViewport(p));
      const defaults = this.cache.DEFAULTS.BUBBLE_GROUP_STYLE[group] ?? {};
      const drawn = this.#drawGroup(this.ctx, points, state, defaults);
      // Labels paint on the top canvas (afterLayer: "labels") so they read
      // over member-node labels; the body/outline stayed on the bottom one.
      if (drawn && state.opts.label) {
        this.#drawLabel(this.labelCtx, points, state.opts, defaults);
      }
    }
  }

  // ---------------------------------------------------------------- export

  /**
   * Exact-fit outlines for export, in viewport CSS px at the CURRENT camera.
   * The on-screen cache quantizes zoom into buckets and merely reprojects
   * between crossings — close enough live, but visibly adrift next to a
   * freshly re-rendered export frame. Falls back to the cached (reprojected)
   * outline when the fresh fit self-intersects, mirroring #syncGroupOutline.
   *
   * @returns {Array<{group: string, points: Array<{x: number, y: number}>,
   *   opts: object, defaults: object}>}
   */
  exportOutlines() {
    const graph = this.adapter.graph;
    const sigma = this.adapter.sigma;
    const out = [];
    for (const [group, state] of this.groups) {
      if (state.members.size === 0) continue;
      const visibleMembers = [];
      for (const id of state.members.keys()) {
        if (!graph.hasNode(id)) continue;
        const attrs = graph.getNodeAttributes(id);
        if (!attrs.hidden) visibleMembers.push({ id, attrs });
      }
      if (visibleMembers.length === 0) continue;

      let points = this.#fitViewportPoints(state, visibleMembers);
      const cached = this.outlines.get(group);
      if (cached?.graphPoints.length && polygonSelfIntersects(points)) {
        points = cached.graphPoints.map((p) => sigma.graphToViewport(p));
      }
      if (points.length < 2) continue;
      out.push({
        group,
        points,
        opts: state.opts,
        defaults: this.cache.DEFAULTS.BUBBLE_GROUP_STYLE[group] ?? {},
      });
    }
    return out;
  }

  /**
   * Paint the groups' bodies/outlines onto an export context at `scale`
   * device px per CSS px. Geometry is in CSS px (same numbers the screen
   * uses), so the transform re-renders it crisp at the export resolution —
   * this replaces the old bitmap stretch of the on-screen canvas, which
   * blurred hulls at 2×+ exports.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {ReturnType<BubbleSetLayer["exportOutlines"]>} groups
   * @param {number} scale
   */
  drawExportBodies(ctx, groups, scale) {
    ctx.save();
    try {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      for (const { points, opts, defaults } of groups) {
        this.#drawGroup(ctx, points, { opts }, defaults);
      }
    } finally {
      ctx.restore();
    }
  }

  /**
   * Paint the groups' labels onto an export context at `scale` device px per
   * CSS px (composited ABOVE the sigma image, like the live label canvas).
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {ReturnType<BubbleSetLayer["exportOutlines"]>} groups
   * @param {number} scale
   */
  drawExportLabels(ctx, groups, scale) {
    ctx.save();
    try {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      for (const { points, opts, defaults } of groups) {
        if (opts.label) this.#drawLabel(ctx, points, opts, defaults);
      }
    } finally {
      ctx.restore();
    }
  }

  /** Resize (if needed) and clear a layer canvas, scaled to the device ratio. */
  #prepareCanvas(canvas, ctx, width, height, dpr) {
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
  }

  /**
   * Recompute the group's outline when its identity (members, positions,
   * style) changed, or when the camera ratio left the log2 bucket the
   * outline was fitted in (between crossings the cached points are merely
   * reprojected).
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
    // The ratio bucket keys the zoom level the outline was fitted at: a
    // bucket crossing recomputes (radius drift re-fit), and an empty
    // outline can never outlive the zoom level that produced it.
    const ratioBucket = Math.round(Math.log2(camera.ratio) / RATIO_RECOMPUTE_LOG2);
    const key =
      `${state.membersKey}|${state.avoidKey}|${visibleMembers.length}` +
      `|${styleKey(state.opts)}|${positionsChecksum(memberPositions)}` +
      `|${width}x${height}|r${ratioBucket}`;
    const cached = this.outlines.get(group);
    if (cached && cached.key === key) return false;

    if (visibleMembers.length === 0) {
      this.outlines.delete(group);
      return cached !== undefined;
    }

    const viewportPoints = this.#fitViewportPoints(state, visibleMembers);
    // When members spread apart faster than the influence field grows (deep
    // zoom-in), bubblesets' bSpline smoothing loops the contour over itself —
    // it paints as rough edges / a phantom lobe in empty space. A reprojection
    // is affine, so the previous *good* outline can never become malformed:
    // keep it (under the new key, so we don't refit every frame) until a zoom
    // bucket yields a clean fit again. The group stays a smooth single blob.
    if (cached?.graphPoints.length && polygonSelfIntersects(viewportPoints)) {
      this.outlines.set(group, { key, graphPoints: cached.graphPoints });
      return true;
    }
    this.outlines.set(group, {
      key,
      // Round-trip assumes camera.angle === 0 (the app never rotates the camera).
      graphPoints: viewportPoints.map((p) => this.adapter.sigma.viewportToGraph(p)),
    });
    return true;
  }

  /**
   * Fit a group's outline against the CURRENT camera, in viewport CSS px.
   * Shared by the cached on-screen path (#syncGroupOutline) and the export
   * path (exportOutlines), which must re-fit exactly — exports composited
   * from the zoom-bucketed cache visibly drift from the re-rendered nodes.
   *
   * @param {object} state  group state (avoidMembers, opts)
   * @param {Array<{id: string, attrs: object}>} visibleMembers
   * @returns {Array<{x: number, y: number}>} outline points (may be empty)
   */
  #fitViewportPoints(state, visibleMembers) {
    const graph = this.adapter.graph;
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

    // Zoom-invariant influence field: bubblesets-js' radii are absolute
    // pixels, so they must shrink/grow with the node rects. With sigma's
    // default settings scaleSize(s, ratio) = s / sqrt(ratio), making
    // fieldScale = scaleSize(1) / scaleSize(1, 1) exactly the node-radius
    // zoom factor, normalized to 1 at camera ratio 1 (the reference zoom
    // the pixel constants were tuned for) for any zoomToSizeRatioFunction.
    const fieldScale = sigma.scaleSize(1) / sigma.scaleSize(1, 1);
    const outlineOpts = { virtualEdges: state.opts.virtualEdges, scale: fieldScale };
    let viewportPoints = computeOutlinePoints(memberRects, avoidRects, outlineOpts);
    // Safety net: at extreme zoom-out the avoid nodes' negative field can
    // still cancel the members' field entirely and collapse the outline.
    // A hull that ignores avoid nodes beats a vanished group.
    if (viewportPoints.length === 0 && avoidRects.length > 0) {
      viewportPoints = computeOutlinePoints(memberRects, [], outlineOpts);
    }
    return viewportPoints;
  }

  /**
   * Paint one group's body + outline from viewport-projected points. Returns
   * true when something was painted (false when the outline is too small),
   * so the caller knows whether a label belongs on the top canvas.
   */
  #drawGroup(ctx, points, { opts }, defaults) {
    if (!points || points.length < 2) return false;

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
    } finally {
      ctx.restore();
    }
    return true;
  }

  /**
   * Group label at the outline extreme picked by labelPlacement (the old G6
   * plugin's surface): labelCloseToPath: false pushes it off the path along
   * the outward normal; labelAutoRotate aligns on-path labels with the
   * outline tangent. labelOffsetX/Y stay additive in screen space.
   */
  #drawLabel(ctx, points, opts, defaults) {
    const text = opts.labelText ?? defaults.labelText ?? "";
    if (!text) return;
    const placement = opts.labelPlacement ?? defaults.labelPlacement ?? "bottom";
    const closeToPath = opts.labelCloseToPath ?? defaults.labelCloseToPath ?? true;
    const autoRotate = opts.labelAutoRotate ?? defaults.labelAutoRotate ?? true;
    const anchor = outlineLabelAnchor(points, placement);
    if (!anchor) return;

    const fontSize = opts.labelFontSize ?? defaults.labelFontSize ?? 12;
    const padding = opts.labelPadding ?? defaults.labelPadding ?? 2;
    // Off-path labels clear the outline by half the padded font box plus a
    // fixed gap, pushed along the outward normal (no-op for "center").
    const standoff = closeToPath ? 0 : fontSize / 2 + padding + LABEL_STANDOFF_PX;
    const x = anchor.x + anchor.nx * standoff + (opts.labelOffsetX ?? 0);
    const y = anchor.y + anchor.ny * standoff + (opts.labelOffsetY ?? 0);

    ctx.font = `${fontSize}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const textWidth = ctx.measureText(text).width;

    // Rotation only makes sense hugging the path; "center" has no tangent.
    const rotated = autoRotate && closeToPath && placement !== "center";
    if (rotated) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(anchor.angle);
    }
    const lx = rotated ? 0 : x;
    const ly = rotated ? 0 : y;

    if (opts.labelBackground ?? defaults.labelBackground) {
      const radius = opts.labelBackgroundRadius ?? defaults.labelBackgroundRadius ?? 5;
      ctx.fillStyle = opts.labelBackgroundFill ?? defaults.labelBackgroundFill ?? "#403C53";
      ctx.beginPath();
      ctx.roundRect(
        lx - textWidth / 2 - padding,
        ly - fontSize / 2 - padding,
        textWidth + 2 * padding,
        fontSize + 2 * padding,
        radius,
      );
      ctx.fill();
    }
    ctx.fillStyle = opts.labelFill ?? defaults.labelFill ?? "#fff";
    ctx.fillText(text, lx, ly);
    if (rotated) ctx.restore();
  }
}

export { BubbleSetLayer };
