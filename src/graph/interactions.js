/**
 * Browser-only interaction wiring for the sigma renderer (MIGRATION.md
 * Phase 3): node drag with position persistence, click/shift-select, hover
 * 1-degree highlight, freehand lasso overlay and the click tooltip. Replaces
 * the G6 behaviors/plugins; instantiated by SigmaAdapter.
 *
 * Selection changes are routed through GraphSelectionManager so selection
 * memory (undo/redo), the data table and button states stay in sync.
 */
import DOMPurify from "../lib/purify.esm.mjs";
import { hoverNeighborhood } from "./graph_model.js";
import { idsInsidePolygon } from "./lasso_geometry.js";

// Lasso visuals from the old G6 lasso-select behavior style.
const LASSO_STROKE = "#C33D35";
const LASSO_FILL = "rgba(195, 61, 53, 0.3)";
const TOOLTIP_OFFSET_PX = 12;

class InteractionManager {
  /**
   * @param {object} adapter  SigmaAdapter (owns sigma + graphology + states)
   * @param {object} cache    app cache
   * @param {Set<string>} hoverIds  hover layer shared with the reducers
   * @param {HTMLElement} container  the sigma container (#innerGraphContainer)
   */
  constructor(adapter, cache, hoverIds, container) {
    this.adapter = adapter;
    this.cache = cache;
    this.hoverIds = hoverIds;
    this.container = container;
    this.enabled = { drag: true, click: true, hover: true, tooltip: true, lasso: false };

    this.draggedNode = null;
    this.dragMoved = false;
    // Covers the click that ends a micro-drag (1-2 move events — sigma's
    // captor only swallows clicks after >=3 dragged events itself).
    this.suppressNextClick = false;

    this.lassoCanvas = null;
    this.lassoPolygon = null;
    this.tooltipEl = null;
    // Serializes drag-end persists: a second drag finishing while the first
    // persist is still in flight must not race it.
    this.persistChain = Promise.resolve();
    this.escHandler = (event) => {
      if (event.key === "Escape" && this.enabled.lasso) this.cache.ui.toggleLassoSelection();
    };

    this.#wireSigmaEvents();
  }

  /** @param {"drag"|"click"|"hover"|"tooltip"|"lasso"} name */
  setEnabled(name, enabled) {
    if (!(name in this.enabled)) {
      this.cache.ui.error(`Unknown interaction: ${name}`);
      return;
    }
    this.enabled[name] = Boolean(enabled);
    if (name === "hover" && !enabled) this.#clearHover();
    if (name === "tooltip" && !enabled) this.hideTooltip();
    if (name === "lasso") enabled ? this.#activateLasso() : this.#deactivateLasso();
  }

  isEnabled(name) {
    return Boolean(this.enabled[name]);
  }

  destroy() {
    document.removeEventListener("keydown", this.escHandler);
    this.lassoCanvas?.remove();
    this.lassoCanvas = null;
    this.tooltipEl?.remove();
    this.tooltipEl = null;
    // Sigma/captor/camera listeners die with sigma.kill() in the adapter.
  }

  // ------------------------------------------------------------------ wiring

  /**
   * Sigma's emitter does not handle rejected promises from async handlers —
   * route them to the UI instead of letting them vanish unhandled.
   */
  #guard(promise) {
    promise.catch((err) => this.cache.ui.error(`Interaction failed: ${err?.message ?? err}`));
  }

  #wireSigmaEvents() {
    const sigma = this.adapter.sigma;
    const captor = sigma.getMouseCaptor();

    sigma.on("downNode", (e) => this.#onDownNode(e.node));
    captor.on("mousemovebody", (e) => this.#onMouseMoveBody(e));
    captor.on("mouseup", () => this.#guard(this.#onMouseUp()));
    captor.on("mousedown", () => {
      this.suppressNextClick = false;
    });

    sigma.on("clickNode", (e) => this.#guard(this.#onClickElement(e.node, false, e.event)));
    sigma.on("clickEdge", (e) => this.#guard(this.#onClickElement(e.edge, true, e.event)));
    sigma.on("clickStage", () => this.#guard(this.#onClickStage()));

    sigma.on("enterNode", (e) => this.#onEnter(e.node, false));
    sigma.on("leaveNode", () => this.#clearHover());
    sigma.on("enterEdge", (e) => this.#onEnter(e.edge, true));
    sigma.on("leaveEdge", () => this.#clearHover());

    // Any camera move (wheel zoom, drag-pan, programmatic fit) orphans the
    // tooltip anchor — hide instead of tracking it.
    sigma.getCamera().on("updated", () => this.hideTooltip());
  }

  // -------------------------------------------------------------------- drag

  #onDownNode(node) {
    if (!this.enabled.drag) return;
    this.draggedNode = node;
    this.dragMoved = false;
    // Pin the normalization bbox: without it every x/y write re-normalizes
    // the coordinate space and the graph swims under the cursor.
    const sigma = this.adapter.sigma;
    if (!sigma.getCustomBBox()) sigma.setCustomBBox(sigma.getBBox());
  }

  #onMouseMoveBody(event) {
    if (!this.draggedNode) return;
    // viewportToGraph returns sigma-space (y-up) — written to graphology
    // as-is; the flip to app space happens once in getNodeData (see
    // graph_model.js flipY contract).
    const pos = this.adapter.sigma.viewportToGraph(event);
    this.adapter.graph.mergeNodeAttributes(this.draggedNode, { x: pos.x, y: pos.y });
    this.dragMoved = true;
    this.hideTooltip();
    // Keep the camera from panning along with the node drag.
    event.preventSigmaDefault();
    event.original.preventDefault();
    event.original.stopPropagation();
  }

  async #onMouseUp() {
    if (!this.draggedNode) return;
    const moved = this.dragMoved;
    this.draggedNode = null;
    this.dragMoved = false;
    if (!moved) return;
    // Set synchronously before any await: sigma emits clickNode right after
    // mouseup with no microtask boundary, so the flag must already be up.
    this.suppressNextClick = true;
    // Reads getNodeData (sigma y-up → app y-down) and persists app-space
    // positions into the selected layout. Chained so overlapping drag-ends
    // persist in order instead of racing.
    this.persistChain = this.persistChain.then(() => this.cache.lm.persistNodePositions());
    await this.persistChain;
  }

  // ----------------------------------------------------------------- clicks

  #consumeSuppressedClick() {
    if (!this.suppressNextClick) return false;
    this.suppressNextClick = false;
    return true;
  }

  /** nodeRef + edgeRef in one map so a plain click deselects everything else. */
  #combinedRefMap() {
    return new Map([...this.cache.nodeRef, ...this.cache.edgeRef]);
  }

  async #onClickElement(id, isEdge, event) {
    if (this.#consumeSuppressedClick()) return;
    if (this.enabled.click) {
      const shift = Boolean(event?.original?.shiftKey);
      if (shift) {
        const refMap = isEdge ? this.cache.edgeRef : this.cache.nodeRef;
        const isSelected = this.adapter.getElementState(id).includes("selected");
        await this.cache.sm.updateSelectedState([refMap.get(id)], !isSelected);
      } else {
        await this.cache.sm.selectElements([id], this.#combinedRefMap());
      }
    }
    if (this.enabled.tooltip) this.showTooltip(id, isEdge);
  }

  async #onClickStage() {
    if (this.#consumeSuppressedClick()) return;
    this.hideTooltip();
    if (!this.enabled.click) return;
    await this.cache.sm.selectElements([], this.#combinedRefMap());
  }

  // ------------------------------------------------------------------ hover

  #onEnter(id, isEdge) {
    // CFG.DISABLE_HOVER_EFFECT is checked live: io.preProcessData and the
    // hover toggle button flip it at runtime.
    if (!this.enabled.hover || this.cache.CFG.DISABLE_HOVER_EFFECT) return;
    if (this.draggedNode) return;
    this.hoverIds.clear();
    for (const member of hoverNeighborhood(this.adapter.graph, id, isEdge)) {
      this.hoverIds.add(member);
    }
    this.adapter.sigma.refresh({ skipIndexation: true });
  }

  #clearHover() {
    if (this.hoverIds.size === 0) return;
    this.hoverIds.clear();
    this.adapter.sigma.refresh({ skipIndexation: true });
  }

  // ------------------------------------------------------------------ lasso

  #activateLasso() {
    this.hideTooltip();
    this.#clearHover();
    if (!this.lassoCanvas) this.lassoCanvas = this.#createLassoCanvas();
    this.#resizeLassoCanvas();
    this.lassoCanvas.style.display = "";
    document.addEventListener("keydown", this.escHandler);
  }

  #deactivateLasso() {
    if (this.lassoCanvas) {
      this.lassoCanvas.style.display = "none";
      this.lassoCanvas
        .getContext("2d")
        .clearRect(0, 0, this.lassoCanvas.width, this.lassoCanvas.height);
    }
    this.lassoPolygon = null;
    document.removeEventListener("keydown", this.escHandler);
  }

  #createLassoCanvas() {
    const canvas = document.createElement("canvas");
    canvas.className = "lasso-overlay";
    // Sits above sigma's layers and swallows all pointer input while active,
    // which is what disables camera pan / node drag in lasso mode.
    Object.assign(canvas.style, {
      position: "absolute",
      inset: "0",
      zIndex: "1000",
      cursor: "crosshair",
      touchAction: "none",
      display: "none",
    });
    canvas.addEventListener("pointerdown", (e) => this.#onLassoPointerDown(e));
    canvas.addEventListener("pointermove", (e) => this.#onLassoPointerMove(e));
    canvas.addEventListener("pointerup", (e) => this.#guard(this.#onLassoPointerUp(e)));
    // OS-interrupted gestures (touch cancel, system gestures) must not leave
    // a half-drawn polygon active.
    canvas.addEventListener("pointercancel", () => this.#cancelLasso());
    this.container.appendChild(canvas);
    return canvas;
  }

  #resizeLassoCanvas() {
    const canvas = this.lassoCanvas;
    if (canvas.width !== this.container.clientWidth) canvas.width = this.container.clientWidth;
    if (canvas.height !== this.container.clientHeight) canvas.height = this.container.clientHeight;
  }

  #onLassoPointerDown(event) {
    if (event.button !== 0) return;
    this.#resizeLassoCanvas();
    this.lassoPolygon = [{ x: event.offsetX, y: event.offsetY }];
    // Capture keeps move/up events on the overlay even outside its bounds.
    this.lassoCanvas.setPointerCapture(event.pointerId);
  }

  #onLassoPointerMove(event) {
    if (!this.lassoPolygon) return;
    this.lassoPolygon.push({ x: event.offsetX, y: event.offsetY });
    this.#drawLasso();
  }

  async #onLassoPointerUp(event) {
    if (!this.lassoPolygon) return;
    const polygon = this.lassoPolygon;
    this.lassoPolygon = null;
    const ctx = this.lassoCanvas.getContext("2d");
    ctx.clearRect(0, 0, this.lassoCanvas.width, this.lassoCanvas.height);
    await this.#applyLassoSelection(polygon, event.shiftKey);
  }

  #cancelLasso() {
    if (!this.lassoPolygon) return;
    this.lassoPolygon = null;
    const ctx = this.lassoCanvas.getContext("2d");
    ctx.clearRect(0, 0, this.lassoCanvas.width, this.lassoCanvas.height);
  }

  #drawLasso() {
    const ctx = this.lassoCanvas.getContext("2d");
    ctx.clearRect(0, 0, this.lassoCanvas.width, this.lassoCanvas.height);
    ctx.beginPath();
    ctx.moveTo(this.lassoPolygon[0].x, this.lassoPolygon[0].y);
    for (const p of this.lassoPolygon.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fillStyle = LASSO_FILL;
    ctx.strokeStyle = LASSO_STROKE;
    ctx.lineWidth = 1.5;
    ctx.fill("evenodd");
    ctx.stroke();
  }

  /**
   * Point-in-polygon over VISIBLE node viewport coordinates. Plain lasso
   * replaces the selection (an empty/degenerate lasso therefore deselects,
   * matching a canvas click); shift adds the hits to the selection.
   */
  async #applyLassoSelection(polygon, additive) {
    const sigma = this.adapter.sigma;
    const points = [];
    this.adapter.graph.forEachNode((id, attrs) => {
      if (attrs.hidden) return;
      const p = sigma.graphToViewport({ x: attrs.x, y: attrs.y });
      points.push({ id, x: p.x, y: p.y });
    });
    const ids = idsInsidePolygon(points, polygon);

    if (additive) {
      if (ids.length === 0) return;
      const refs = ids.map((id) => this.cache.nodeRef.get(id)).filter(Boolean);
      await this.cache.sm.updateSelectedState(refs, true);
    } else {
      await this.cache.sm.selectElements(ids, this.#combinedRefMap());
    }
  }

  // ---------------------------------------------------------------- tooltip

  showTooltip(id, isEdge) {
    const content = this.cache.toolTips.get(id);
    if (!content) return;
    const el = this.#ensureTooltipEl();
    // Tooltip HTML embeds unescaped node/edge labels, ids and descriptions
    // from loaded files — sanitize at the display boundary. DOMPurify also
    // strips inline onclick attrs; the expand/close buttons are driven by
    // the delegated listener in #ensureTooltipEl instead.
    el.innerHTML = DOMPurify.sanitize(content);
    el.style.visibility = "visible";
    this.#positionTooltip(el, id, isEdge);
    this.#syncExpandButton(el);
  }

  hideTooltip() {
    if (this.tooltipEl) this.tooltipEl.style.visibility = "hidden";
  }

  #ensureTooltipEl() {
    if (this.tooltipEl) return this.tooltipEl;
    const el = document.createElement("div");
    // The surviving core.js helpers (drag, wheel, expand/close) expect a
    // `.tooltip` element inside #innerGraphContainer with this structure.
    el.className = "tooltip";
    el.style.visibility = "hidden";
    el.style.background = "#fff"; // the old G6 plugin supplied the backdrop
    // Delegated expand/close handling (sanitization strips inline onclick).
    el.addEventListener("click", (event) => {
      const expandBtn = event.target.closest(".tooltip-expand-btn");
      if (expandBtn) return window.toggleTooltipExpand(expandBtn);
      const closeBtn = event.target.closest(".tooltip-close-btn");
      if (closeBtn) return window.closeTooltip(closeBtn);
    });
    this.container.appendChild(el);
    this.tooltipEl = el;
    return el;
  }

  #positionTooltip(el, id, isEdge) {
    const graph = this.adapter.graph;
    let anchor;
    if (isEdge && graph.hasEdge(id)) {
      const [source, target] = graph.extremities(id);
      const a = graph.getNodeAttributes(source);
      const b = graph.getNodeAttributes(target);
      anchor = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    } else if (graph.hasNode(id)) {
      const attrs = graph.getNodeAttributes(id);
      anchor = { x: attrs.x, y: attrs.y };
    } else {
      return;
    }
    const viewport = this.adapter.sigma.graphToViewport(anchor);
    const maxLeft = Math.max(0, this.container.clientWidth - el.offsetWidth);
    const maxTop = Math.max(0, this.container.clientHeight - el.offsetHeight);
    el.style.left = `${Math.min(Math.max(0, viewport.x + TOOLTIP_OFFSET_PX), maxLeft)}px`;
    el.style.top = `${Math.min(Math.max(0, viewport.y + TOOLTIP_OFFSET_PX), maxTop)}px`;
  }

  /**
   * Ported from the old G6 tooltip plugin: show the expand button only when
   * the content actually clips, measured one frame after layout.
   */
  #syncExpandButton(el) {
    requestAnimationFrame(() => {
      const body = el.querySelector(".tooltip-content");
      const btn = el.querySelector(".tooltip-expand-btn");
      if (!body || !btn) return;
      el.classList.remove("expanded");
      btn.textContent = "⛶";
      const isClipped =
        body.scrollHeight > body.clientHeight + 1 || body.scrollWidth > body.clientWidth + 1;
      btn.style.display = isClipped ? "" : "none";
    });
  }
}

export { InteractionManager };
