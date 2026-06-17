/**
 * Browser-only bubble-set rendering layer (MIGRATION.md Phase 4).
 *
 * Two 2d canvases registered with sigma: the fill/outline canvas sits ABOVE
 * the node layer (createCanvasContext + afterLayer: "nodes") so the group
 * body/outline stays visible at deep zoom-in, where enlarged nodes would
 * otherwise cover a body painted underneath them; the group-LABEL canvas sits
 * ABOVE sigma's node-label layer (afterLayer: "labels") so a member node's own
 * label can never obscure the group name (a primary read). All four bubble
 * groups paint in a single pass. GraphBubbleSetManager keeps talking to per-group
 * "plugin instances" — those are thin handles into this layer's group state
 * (see getGroupHandle), so the manager's member/filter/style logic survives
 * the G6 → sigma port unchanged.
 *
 * Outlines are fitted by bubblesets-js at the ratio-1 reference scale
 * (bubble_geometry.js) and cached in GRAPH space, so they are zoom-invariant —
 * a member is always enclosed at every zoom:
 *   - membership / style / member-position changes → full recompute (the
 *     identity key in #syncGroupOutline catches them on the next frame, so
 *     a filter event can never leave a stale outline painted)
 *   - camera pan/zoom → cheap per-frame reprojection of the cached graph
 *     points; the camera is NOT in the identity key, so zoom never re-fits
 * This replaces the G6 plugin's recompute-per-draw churn (the patched
 * updateBubbleSetsPath path coalescing, issue #7195) with an owned cache.
 */
import { DEFAULTS } from '../config.js';
import {
  nodeViewportRect,
  computeOutlinePoints,
  polygonSelfIntersects,
  outlineLabelAnchor,
  idsKey,
  positionsChecksum,
  styleKey,
} from './bubble_geometry.js';

const LAYER_NAME = 'bubbleSets';
const LABEL_LAYER_NAME = 'bubbleSetsLabels';
const OUTLINE_STROKE_WIDTH = 2;
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
      afterLayer: 'nodes',
      style: { pointerEvents: 'none' },
    });
    this.canvas = sigma.getCanvases()[LAYER_NAME];
    this.ctx = this.canvas.getContext('2d');

    // Group labels paint on their own canvas stacked above sigma's node-label
    // layer so they always win the z-order contest against member labels.
    sigma.createCanvasContext(LABEL_LAYER_NAME, {
      afterLayer: 'labels',
      style: { pointerEvents: 'none' },
    });
    this.labelCanvas = sigma.getCanvases()[LABEL_LAYER_NAME];
    this.labelCtx = this.labelCanvas.getContext('2d');

    this.renderHandler = () => this.scheduleRedraw();
    sigma.on('afterRender', this.renderHandler);
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
    this.adapter.sigma.off('afterRender', this.renderHandler);
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
      state = { members: new Map(), avoidMembers: [], opts: {}, membersKey: '', avoidKey: '' };
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

    // Outlines are fitted in GRAPH space (zoom-invariant), so the camera never
    // forces a re-fit — #syncGroupOutline only re-fits when a group's identity
    // (members, positions, style) changes. Any camera move just reprojects the
    // cached graph points each frame (cheap), keeping the hull hugging at every
    // zoom with members always enclosed.
    let outlinesChanged = false;
    const active = [];
    for (const [group, state] of this.groups) {
      if (state.members.size === 0) {
        if (this.outlines.delete(group)) outlinesChanged = true;
        continue;
      }
      outlinesChanged = this.#syncGroupOutline(group, state) || outlinesChanged;
      if (this.outlines.get(group)?.graphPoints.length) active.push([group, state]);
    }

    // Skip repainting when neither the outlines nor the view changed (sigma
    // re-renders on hover etc. without clearing custom layers).
    const signature =
      `${width}x${height}x${dpr}|${camera.x},${camera.y},${camera.ratio},${camera.angle}` +
      `|${active.map(([g]) => g).join(',')}`;
    if (!outlinesChanged && signature === this.lastPaintSignature) return;
    this.lastPaintSignature = signature;

    this.#prepareCanvas(this.canvas, this.ctx, width, height, dpr);
    this.#prepareCanvas(this.labelCanvas, this.labelCtx, width, height, dpr);
    this.#drawOutlines(active, sigma);
  }

  /** Reproject each cached graph-space outline to viewport px and paint it. */
  #drawOutlines(active, sigma) {
    for (const [group, state] of active) {
      // Reprojection assumes camera.angle === 0 (the app never rotates the camera).
      const points = this.outlines.get(group).graphPoints.map((p) => sigma.graphToViewport(p));
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
   * Outlines for export, in viewport CSS px at the CURRENT camera. The cached
   * outline is graph-space and zoom-invariant, so reprojecting it at the
   * current camera is exact — it matches the on-screen hull. Fits on the fly
   * for any group not yet painted.
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
      let graphPoints = this.outlines.get(group)?.graphPoints;
      if (!graphPoints?.length) {
        const visibleMembers = [];
        for (const id of state.members.keys()) {
          if (!graph.hasNode(id)) continue;
          const attrs = graph.getNodeAttributes(id);
          if (!attrs.hidden) visibleMembers.push({ id, attrs });
        }
        if (visibleMembers.length === 0) continue;
        graphPoints = this.#fitGraphOutline(state, visibleMembers);
      }
      if (!graphPoints || graphPoints.length < 2) continue;
      out.push({
        group,
        points: graphPoints.map((p) => sigma.graphToViewport(p)),
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
    // Own the CSS display size too: sigma.createCanvasContext only sets
    // position:absolute, and sigma.resize() (the sole writer of element.style
    // width/height) runs once at construction — before this canvas exists — and
    // early-returns on unchanged dimensions. Left unset, the canvas displays at
    // its backing-store size (width*dpr CSS px), which is dpr* too large on a
    // >1 DPR display, so the group lands in the wrong place until a panel toggle
    // forces a real sigma resize. Setting it here keeps the overlay 1:1 with the
    // WebGL layers regardless of sigma's resize timing or the display's DPR.
    if (canvas.style.width !== `${width}px`) canvas.style.width = `${width}px`;
    if (canvas.style.height !== `${height}px`) canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
  }

  /**
   * Recompute the group's outline when its identity (members, positions,
   * style) changes. The fit is in graph space and zoom-invariant, so the
   * camera is NOT part of the key — zoom never re-fits, it only reprojects.
   *
   * @returns {boolean} true when the cached outline was replaced
   */
  #syncGroupOutline(group, state) {
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

    // membersKey/avoidKey are precomputed in #updateGroup, so the per-frame
    // cost here is the O(n) position checksum. Hidden flips stay correct: an
    // unhide changes visibleMembers.length, and a same-count hidden swap
    // changes the checksum. No camera/viewport term — the graph-space outline
    // is the same at every zoom.
    const key =
      `${state.membersKey}|${state.avoidKey}|${visibleMembers.length}` +
      `|${styleKey(state.opts)}|${positionsChecksum(memberPositions)}`;
    const cached = this.outlines.get(group);
    if (cached && cached.key === key) return false;

    if (visibleMembers.length === 0) {
      this.outlines.delete(group);
      return cached !== undefined;
    }

    const graphPoints = this.#fitGraphOutline(state, visibleMembers);
    // computeOutlinePoints repairs self-intersections, so a bad fit here is a
    // collapse to nothing or the rare unrepairable self-cross. Never let it
    // replace a good outline.
    const selfIntersects = graphPoints.length >= 4 && polygonSelfIntersects(graphPoints);
    const collapsed = graphPoints.length < 3;
    if (selfIntersects || collapsed) {
      if (cached?.graphPoints.length) {
        this.outlines.set(group, { key, graphPoints: cached.graphPoints });
        return true;
      }
      // No prior good outline yet: stay absent until a clean fit appears.
      return this.outlines.delete(group);
    }
    this.outlines.set(group, { key, graphPoints });
    return true;
  }

  /**
   * Fit a group's outline at the ratio-1 REFERENCE viewport scale, then map it
   * to graph space for the cache. bubblesets-js' field constants are tuned for
   * on-screen pixels, so the fit must run where node sizes are pixel-scale —
   * the ratio-1 viewport, which is independent of the current camera. That
   * makes the outline zoom-invariant: a member is always enclosed and the same
   * cached hull reprojects to hug the nodes at any zoom. Shared by
   * #syncGroupOutline and the export path.
   *
   * @param {object} state  group state (avoidMembers, opts)
   * @param {Array<{id: string, attrs: object}>} visibleMembers
   * @returns {Array<{x: number, y: number}>} graph-space outline (may be empty)
   */
  #fitGraphOutline(state, visibleMembers) {
    const graph = this.adapter.graph;
    const sigma = this.adapter.sigma;
    const { width, height } = sigma.getDimensions();
    const camera = sigma.getCamera().getState();
    const cx = width / 2;
    const cy = height / 2;
    const r = camera.ratio;
    // graphToViewport divides the offset-from-centre by the ratio; multiply it
    // back to land at the ratio-1 viewport (ratio cancels, so this is the same
    // at any zoom). Node radius is taken at ratio 1 too.
    const toRefRect = (attrs) => {
      const v = sigma.graphToViewport({ x: attrs.x, y: attrs.y });
      const rx = cx + (v.x - cx) * r;
      const ry = cy + (v.y - cy) * r;
      return nodeViewportRect(rx, ry, sigma.scaleSize(attrs.size ?? DEFAULTS.NODE.SIZE / 2, 1));
    };
    const memberRects = visibleMembers.map(({ attrs }) => toRefRect(attrs));
    const avoidRects = [];
    for (const id of state.avoidMembers) {
      if (!graph.hasNode(id)) continue;
      const attrs = graph.getNodeAttributes(id);
      if (attrs.hidden) continue;
      avoidRects.push(toRefRect(attrs));
    }

    const outlineOpts = { virtualEdges: state.opts.virtualEdges, scale: 1 };
    let refPoints = computeOutlinePoints(memberRects, avoidRects, outlineOpts);
    // Safety net: if the avoid nodes' negative field collapses the outline, a
    // hull that ignores avoid nodes beats a vanished group.
    if (refPoints.length === 0 && avoidRects.length > 0) {
      refPoints = computeOutlinePoints(memberRects, [], outlineOpts);
    }
    // Reference-viewport → graph space (undo the ratio-1 mapping, then the
    // camera): the cache holds zoom-independent graph coords.
    return refPoints.map((p) =>
      sigma.viewportToGraph({ x: cx + (p.x - cx) / r, y: cy + (p.y - cy) / r })
    );
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
      ctx.fillStyle = opts.fill ?? defaults.fill ?? '#403C53';
      ctx.fill(path);
      ctx.globalAlpha = opts.strokeOpacity ?? defaults.strokeOpacity ?? 1;
      ctx.strokeStyle = opts.stroke ?? defaults.stroke ?? '#403C53';
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
    const text = opts.labelText ?? defaults.labelText ?? '';
    if (!text) return;
    const placement = opts.labelPlacement ?? defaults.labelPlacement ?? 'bottom';
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
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const textWidth = ctx.measureText(text).width;

    // Rotation only makes sense hugging the path; "center" has no tangent.
    const rotated = autoRotate && closeToPath && placement !== 'center';
    if (rotated) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(anchor.angle);
    }
    const lx = rotated ? 0 : x;
    const ly = rotated ? 0 : y;

    if (opts.labelBackground ?? defaults.labelBackground) {
      const radius = opts.labelBackgroundRadius ?? defaults.labelBackgroundRadius ?? 5;
      ctx.fillStyle = opts.labelBackgroundFill ?? defaults.labelBackgroundFill ?? '#403C53';
      ctx.beginPath();
      ctx.roundRect(
        lx - textWidth / 2 - padding,
        ly - fontSize / 2 - padding,
        textWidth + 2 * padding,
        fontSize + 2 * padding,
        radius
      );
      ctx.fill();
    }
    ctx.fillStyle = opts.labelFill ?? defaults.labelFill ?? '#fff';
    ctx.fillText(text, lx, ly);
    if (rotated) ctx.restore();
  }
}

export { BubbleSetLayer };
