/**
 * Browser-only Sigma.js adapter (MIGRATION.md Phase 1).
 *
 * The ONLY module in src/ that imports the sigma bundle (it references WebGL
 * globals at module scope and crashes under node). Wraps the Sigma instance,
 * the graphology graph, the element-states Map and a pending-layout slot
 * behind the G6-shaped facade the rest of the app still calls. Facade methods
 * are transitional and get slimmed/deleted in Phases 2-6.
 */
import {
  Sigma,
  exportImage,
  EdgeRectangleProgram,
  createEdgeCompoundProgram,
  drawDiscNodeHover,
  NodeSquareProgram,
  createNodeBorderProgram,
  nodeImage,
  edgeCurve,
} from "../lib/sigma.bundle.mjs";
import {
  EdgeHaloProgram,
  createCurveHaloProgram,
  createEdgeMarkerHeadProgram,
} from "./edge_programs.js";
import { clampExportScale } from "../utilities/export_scale.js";
import { nodeAttributesFromStyle, edgeAttributesFromStyle, flipY } from "./graph_model.js";
import { executeLayout } from "./layout_algorithms.js";
import { drawNodeLabel, drawEdgeLabel, BAKED_DEFAULT_LABEL_COLOR } from "./label_renderers.js";
import { InteractionManager } from "./interactions.js";
import { BubbleSetLayer } from "./bubble_layer.js";
import { Minimap } from "./minimap.js";

// Rasterization resolution for the SVG shape textures. 512 px keeps shapes
// crisp at the ~4x zoom the UI allows (risk #1 in MIGRATION.md).
const SHAPE_TEXTURE_RESOLUTION = 512;
// @sigma/node-image defaults to 500 ms before regenerating the texture atlas
// after a miss; style changes left nodes invisible (transparent base color)
// for that long. 50 ms keeps batching without visible flicker.
const ATLAS_REGEN_DEBOUNCE_MS = 50;
// Trailing-edge debounce for container ResizeObserver → this.resize();
// rides out the 0.3 s CSS panel transitions without a resize per frame.
const RESIZE_DEBOUNCE_MS = 50;

/**
 * Sigma's hover layer (drawDiscNodeHover and per-program drawHover) paints a
 * white disc + label pill on the hovers canvas, which sits ABOVE the labels
 * canvas — on light backgrounds the pill invisibly blanks every label
 * underneath. Acceptable on a deliberate hover; NOT while dragging, where
 * the dragged node is permanently hovered and would wipe labels along its
 * whole path (the dragged node's own label stays visible via the forceLabel
 * pin in InteractionManager, on the labels canvas). So: suppress ALL hover
 * drawing while a drag is in flight, keep the native pill otherwise.
 *
 * @param {(context, data, settings) => void} drawer
 * @param {() => string|null} getDraggedNode
 */
function guardHoverDrawer(drawer, getDraggedNode) {
  // Defensive: if a future sigma bundle moves the wrapped drawer off the
  // instance/export we read it from, fail to "no hover" instead of throwing
  // inside sigma's render loop (which would swallow the error silently).
  if (typeof drawer !== "function") return () => {};
  return (context, data, settings) => {
    if (getDraggedNode()) return;
    // Sigma's drawDiscNodeHover hardcodes a white pill behind the label, so
    // pin the FALLBACK to dark regardless of the theme-driven labelColor
    // setting (dark mode flips it to a light color, unreadable on the pill).
    // The attribute form keeps explicit per-element labelColor choices
    // (sigma resolves data[attribute] || color).
    drawer(context, data, {
      ...settings,
      labelColor: { attribute: "labelColor", color: "#000" },
    });
  };
}

/**
 * Node/edge program registry (G6 type vocabulary → sigma programs).
 * Nodes: circle native, square via @sigma/node-square, bordered circles via
 * @sigma/node-border ("borderCircle"); every other shape — and any bordered
 * non-circle or haloed node — uses the SVG texture program ("shape").
 * Edges: two parametric programs per curvature (graph_model.sigmaEdgeType
 * routes): "line"/"curve" are the plain fast paths for unstyled edges;
 * "styledLine"/"styledCurve" compose halo-under → body → marker heads
 * (compound programs draw in array order) and are fully parameterized by
 * per-edge attrs (startMarker/endMarker enum + sizes, haloWidth/haloColor) —
 * no registry growth per marker shape or halo toggle. Off states collapse to
 * degenerate geometry in the custom programs (see edge_programs.js).
 *
 * @param {() => string|null} getDraggedNode  hover-guard input (see
 *   guardHoverDrawer); NodeSquareProgram carries its own instance drawHover
 *   which bypasses defaultDrawNodeHover, so it gets wrapped here.
 */
function buildProgramRegistry(getDraggedNode) {
  const shapeProgram = nodeImage.createNodeImageProgram({
    size: { mode: "force", value: SHAPE_TEXTURE_RESOLUTION },
    objectFit: "contain",
    drawingMode: "background",
    keepWithinCircle: false,
    padding: 0,
    debounceTimeout: ATLAS_REGEN_DEBOUNCE_MS,
  });
  // ANGLE/radeonsi intermittently fails generateMipmap on NPOT atlas
  // re-uploads (GL_INVALID_OPERATION), leaving textures mipmap-incomplete —
  // sampled as opaque black (the hover-after-restyle black boxes). The
  // program never sets TEXTURE_MIN_FILTER, so the NEAREST_MIPMAP_LINEAR
  // default requires a complete mip chain; force LINEAR, which needs none.
  // 512 px rasters lose nothing visible to non-mipmapped minification.
  const originalBindTextures = shapeProgram.prototype.bindTextures;
  shapeProgram.prototype.bindTextures = function () {
    originalBindTextures.call(this);
    const gl = this.normalProgram?.gl ?? this.gl;
    if (!gl) return;
    for (let i = 0; i < (this.textures?.length ?? 0); i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[i]);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
  };
  class GuardedSquareProgram extends NodeSquareProgram {
    constructor(...args) {
      super(...args);
      this.drawHover = guardHoverDrawer(this.drawHover, getDraggedNode);
    }
  }
  // Bordered circles: outer ring reads borderColor/borderRatio (graph_model
  // emits borderRatio = lineWidth / radius so the border scales with zoom
  // like the baked textures did), the rest is filled with the node color.
  // No hover guard needed: the program leaves its instance drawHover
  // undefined, so sigma falls back to the guarded defaultDrawNodeHover.
  const borderCircleProgram = createNodeBorderProgram({
    borders: [
      {
        size: { attribute: "borderRatio", defaultValue: 0, mode: "relative" },
        color: { attribute: "borderColor" },
      },
      { size: { fill: true }, color: { attribute: "color" } },
    ],
  });
  // One curve class serves both the plain "curve" type and the body/halo
  // sub-programs of "styledCurve" (each gets its own instance + buffers).
  // arrowHead stays null: end markers are drawn by the parametric marker-head
  // sub-programs, oriented along the same bezier tangent.
  const curveProgram = edgeCurve.createEdgeCurveProgram({
    arrowHead: null,
    drawLabel: drawCurvedEdgeLabelWithSize,
  });
  return {
    nodeProgramClasses: {
      square: GuardedSquareProgram,
      shape: shapeProgram,
      borderCircle: borderCircleProgram,
    },
    edgeProgramClasses: {
      line: EdgeRectangleProgram,
      styledLine: createEdgeCompoundProgram([
        EdgeHaloProgram,
        EdgeRectangleProgram,
        createEdgeMarkerHeadProgram({ extremity: "source" }),
        createEdgeMarkerHeadProgram({ extremity: "target" }),
      ]),
      curve: curveProgram,
      styledCurve: createEdgeCompoundProgram(
        [
          createCurveHaloProgram(curveProgram),
          curveProgram,
          createEdgeMarkerHeadProgram({ extremity: "source", curved: true }),
          createEdgeMarkerHeadProgram({ extremity: "target", curved: true }),
        ],
        drawCurvedEdgeLabelWithSize,
      ),
    },
  };
}

// Curved-edge labels reuse @sigma/edge-curve's drawer, proxying the settings
// so per-edge labelSize/labelColor (graph_model attrs) are honoured.
const drawCurvedEdgeLabelBase = edgeCurve.createDrawCurvedEdgeLabel(
  edgeCurve.DEFAULT_EDGE_CURVE_PROGRAM_OPTIONS,
);
function drawCurvedEdgeLabelWithSize(context, edgeData, sourceData, targetData, settings) {
  // The baked #000000 default counts as "no explicit color" so the
  // theme-driven settings fallback applies (see label_renderers.js).
  const explicitColor =
    edgeData.labelColor && edgeData.labelColor !== BAKED_DEFAULT_LABEL_COLOR
      ? edgeData.labelColor
      : null;
  const effective =
    edgeData.labelSize != null || explicitColor != null
      ? {
          ...settings,
          edgeLabelSize: edgeData.labelSize ?? settings.edgeLabelSize,
          edgeLabelColor: explicitColor
            ? { color: explicitColor }
            : settings.edgeLabelColor,
        }
      : settings;
  drawCurvedEdgeLabelBase(context, edgeData, sourceData, targetData, effective);
}

const FIT_PADDING_PX = 80;
// Clamp fit zoom so a tiny selection (e.g. a single node) doesn't punch the
// viewport to 100x — same UX guard as the old G6 fitViewToNodes.
const MAX_FIT_ZOOM = 4;

class SigmaAdapter {
  /**
   * @param {object} cache  app cache; cache.graphData must hold the graphology graph
   * @param {string|HTMLElement} container
   * @param {object} opts  {nodeReducer, edgeReducer, elementStates, hoverIds, settings}
   */
  constructor(
    cache,
    container,
    { nodeReducer, edgeReducer, elementStates, hoverIds = new Set(), settings = {} },
  ) {
    this.cache = cache;
    this.graph = cache.graphData;
    this.elementStates = elementStates;
    this.pendingLayout = null;
    this.killed = false;

    const containerEl =
      typeof container === "string" ? document.getElementById(container) : container;

    // Lazy read: this.interactions is assigned AFTER new Sigma(...); the
    // closure only runs per hover render, by which time it exists.
    const getDraggedNode = () => this.interactions?.draggedNode ?? null;

    this.sigma = new Sigma(this.graph, containerEl, {
      allowInvalidContainer: true,
      enableEdgeEvents: true,
      zIndex: true,
      nodeReducer,
      edgeReducer,
      ...buildProgramRegistry(getDraggedNode),
      // Custom drawers honour the per-element label attrs from graph_model
      // (size, color, background, placement, offsets, auto-rotate).
      defaultDrawNodeLabel: drawNodeLabel,
      defaultDrawEdgeLabel: drawEdgeLabel,
      defaultDrawNodeHover: guardHoverDrawer(drawDiscNodeHover, getDraggedNode),
      renderEdgeLabels: true,
      // Label-grid thinning stays on, tuned denser than sigma's default
      // (1 label per 100px cell): 50px cells show ~4x the labels and shrink
      // the zone where two nearby nodes compete for one label slot. Drags
      // can't pop neighbours' labels regardless — InteractionManager pins
      // all on-screen labels for the duration of a drag. CFG.HIDE_LABELS
      // remains the guard for huge graphs (MAX_NODES_BEFORE_HIDING_LABELS).
      labelGridCellSize: 50,
      ...settings,
    });
    // Sigma only auto-resizes on window resize. Sidebar/bottom-bar toggles
    // animate the container via CSS (0.3 s), which used to blank the graph
    // until the next zoom/pan; observe the container directly instead.
    this.resizeDebounce = null;
    this.resizeObserver = new ResizeObserver(() => {
      clearTimeout(this.resizeDebounce);
      this.resizeDebounce = setTimeout(() => this.resize(), RESIZE_DEBOUNCE_MS);
    });
    this.resizeObserver.observe(containerEl);
    this.interactions = new InteractionManager(this, cache, hoverIds, containerEl);
    this.bubbleLayer = new BubbleSetLayer(this, cache);
    this.minimap = new Minimap(this, containerEl);
    this.#syncLabelVisibility();
  }

  /**
   * Keep CFG.HIDE_LABELS live (io.preProcessData flips it per
   * MAX_NODES_BEFORE_HIDING_LABELS on every load). Sigma's label density
   * grid stays the default thinning mechanism; HIDE_LABELS is the explicit
   * override on top — but elements the user explicitly labelled (style
   * pipeline emits a label attr despite HIDE_LABELS) must stay visible,
   * matching the old G6 semantics.
   *
   * NOTE: this owns renderLabels/renderEdgeLabels — a caller-supplied value
   * in constructor `settings` is overwritten here by design (CFG.HIDE_LABELS
   * is the single source of truth for label visibility).
   */
  #syncLabelVisibility() {
    let nodeLabels = true;
    let edgeLabels = true;
    if (this.cache.CFG?.HIDE_LABELS) {
      nodeLabels = this.graph.someNode((_, attrs) => attrs.label != null);
      edgeLabels = this.graph.someEdge((_, attrs) => attrs.label != null);
    }
    this.sigma.setSetting("renderLabels", nodeLabels);
    this.sigma.setSetting("renderEdgeLabels", edgeLabels);
  }

  // ---------------------------------------------------------------- lifecycle

  /**
   * G6 render = layout + draw. Runs the pending layout (if any), then the
   * persisted-position choreography that used to live in core.js's G6
   * `afterlayout` handler, then a full (re-indexing) refresh.
   */
  async render() {
    if (this.killed) return false;
    if (this.pendingLayout) await this.layout();
    await this.#applyPersistedPositions();
    this.#syncLabelVisibility();

    this.sigma.refresh();

    if (this.cache.EVENT_LOCKS.ONCE_AFTER_RENDER_COMPLETED) {
      await this.#postRefresh();
    } else {
      // First render: run the one-time post-render routine (which re-renders
      // once with ONCE_AFTER_RENDER_COMPLETED set, taking the branch above).
      await this.cache.gcm.initialAfterRenderEvent();
    }
    return true;
  }

  /** G6 draw = pure visual update; graph structure is unchanged. */
  async draw() {
    if (this.killed) return false;
    this.sigma.refresh({ skipIndexation: true });
    await this.#postRefresh();
    return true;
  }

  /**
   * Kills the sigma instance. The `killed` guard keeps in-flight async
   * choreography (e.g. a draw awaited across a reload) from refreshing a
   * dead renderer — sigma throws on refresh-after-kill.
   */
  destroy() {
    if (this.killed) return;
    this.killed = true;
    clearTimeout(this.resizeDebounce);
    this.resizeObserver.disconnect();
    this.bubbleLayer.destroy();
    this.minimap.destroy();
    this.interactions.destroy();
    this.sigma.kill();
  }

  /**
   * Container-resize entry point (ResizeObserver debounce + panel-toggle
   * callers). NOT sigma.resize(): that only resizes the canvases — clearing
   * their WebGL buffers — and never schedules a render, leaving the graph
   * blank until the next camera move (scripts/resize_redraw_check.js).
   * render() starts by resizing, so scheduling a render covers both.
   */
  resize() {
    if (this.killed) return;
    this.sigma.scheduleRender();
  }

  /**
   * Post-refresh choreography formerly driven by G6's AFTER_DRAW/AFTER_RENDER
   * events: sync selection caches/UI, redraw bubble sets, drop the overlay.
   */
  async #postRefresh() {
    if (this.cache.EVENT_LOCKS.AFTER_DRAW_RUNNING) return;
    this.cache.EVENT_LOCKS.AFTER_DRAW_RUNNING = true;
    try {
      await this.cache.sm.updateSelectedNodesAndEdges();
      await this.cache.bs.redrawBubbleSets();
    } finally {
      this.cache.EVENT_LOCKS.AFTER_DRAW_RUNNING = false;
      // Inside finally: a throw above must never strand the loading overlay.
      await this.cache.ui.hideLoading();
    }
  }

  /**
   * Persisted positions override layout output; a fresh initial layout gets
   * persisted once and its `layoutType` marker removed (see commit b6f8606:
   * authored payloads with empty positions are force-laid-out).
   */
  async #applyPersistedPositions() {
    const layout = this.cache.data.layouts?.[this.cache.data.selectedLayout];
    if (!layout) return;

    if (layout.positions.size > 0) {
      for (const [id, pos] of layout.positions) {
        const x = pos?.style?.x;
        const y = pos?.style?.y;
        if (!this.graph.hasNode(id) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
        // Persisted positions are app-model (y-down); graphology is y-up.
        this.graph.mergeNodeAttributes(id, { x, y: flipY(y) });
        const ref = this.cache.nodeRef.get(id);
        if (ref) {
          ref.style.x = x;
          ref.style.y = y;
        }
      }
    } else if (layout.layoutType) {
      await this.cache.lm.persistNodePositions();
      delete layout.layoutType;
      this.cache.ui.debug("Initial layout positions persisted");
    }
  }

  // --------------------------------------------------------------------- data

  /** G6-shaped bulk update ({nodes, edges} arrays of {id, type?, style?}). */
  async updateData({ nodes = [], edges = [] } = {}) {
    await this.updateNodeData(nodes);
    await this.updateEdgeData(edges);
  }

  /** @param {Array<{id: string, type?: string, style?: object}>} payload */
  async updateNodeData(payload) {
    for (const item of payload ?? []) {
      if (!item || !this.graph.hasNode(item.id)) continue;
      const ref = this.cache.nodeRef.get(item.id);
      if (ref) {
        if (item.type !== undefined) ref.type = item.type;
        if (item.style) Object.assign(ref.style, item.style);
      }
      // Map from the merged ref where possible: shape/texture attrs depend on
      // the full style (fill+stroke+lineWidth+size), not just the delta.
      const attrs = nodeAttributesFromStyle(ref?.style ?? item.style ?? {}, ref?.type ?? item.type);
      if (Object.keys(attrs).length > 0) {
        this.graph.mergeNodeAttributes(item.id, attrs);
      }
    }
  }

  /** @param {Array<{id: string, type?: string, style?: object}>} payload */
  async updateEdgeData(payload) {
    for (const item of payload ?? []) {
      if (!item || !this.graph.hasEdge(item.id)) continue;
      const ref = this.cache.edgeRef.get(item.id);
      if (ref) {
        if (item.type !== undefined) ref.type = item.type;
        if (item.style) Object.assign(ref.style, item.style);
      }
      // Merged ref: the program key depends on type + both arrow flags.
      const attrs = edgeAttributesFromStyle(ref?.style ?? item.style ?? {}, ref?.type ?? item.type);
      if (Object.keys(attrs).length > 0) {
        this.graph.mergeEdgeAttributes(item.id, attrs);
      }
    }
  }

  /**
   * G6-shaped live node objects backed by cache.nodeRef. Callers (selection.js,
   * layout.js) mutate .style.x/.style.y on the returned objects and push them
   * back via updateNodeData; x/y/visibility are synced from graphology here.
   *
   * @param {string[]} [ids]
   */
  getNodeData(ids) {
    const refs = ids
      ? [...ids].map((id) => this.cache.nodeRef.get(id)).filter(Boolean)
      : [...this.cache.nodeRef.values()];
    const views = [];
    for (const ref of refs) {
      if (!this.graph.hasNode(ref.id)) continue;
      const attrs = this.graph.getNodeAttributes(ref.id);
      ref.style.x = attrs.x;
      // Graphology is y-up; the app model (and everything persisted from it)
      // stays y-down — flip on the way out, mirror of the mapper's flip in.
      ref.style.y = flipY(attrs.y);
      ref.style.visibility = attrs.hidden ? "hidden" : "visible";
      ref.states = [...(this.elementStates.get(ref.id) ?? [])];
      views.push(ref);
    }
    return views;
  }

  /** @param {string[]} [ids] */
  getEdgeData(ids) {
    const refs = ids
      ? [...ids].map((id) => this.cache.edgeRef.get(id)).filter(Boolean)
      : [...this.cache.edgeRef.values()];
    const views = [];
    for (const ref of refs) {
      if (!this.graph.hasEdge(ref.id)) continue;
      const attrs = this.graph.getEdgeAttributes(ref.id);
      ref.style.visibility = attrs.hidden ? "hidden" : "visible";
      ref.states = [...(this.elementStates.get(ref.id) ?? [])];
      views.push(ref);
    }
    return views;
  }

  /**
   * Synchronous (returns a plain object); callers `await` it for G6 parity,
   * which is a no-op. Keep it sync — getNodeData/getEdgeData results are
   * chained with array methods directly under `await` across the app.
   */
  getData() {
    return { nodes: this.getNodeData(), edges: this.getEdgeData() };
  }

  // ------------------------------------------------------------------- states

  /** @returns {string[]} copy of the element's states (callers mutate freely) */
  getElementState(id) {
    return [...(this.elementStates.get(id) ?? [])];
  }

  /**
   * G6 semantics: either (id, states[]) or a map of id → states[].
   * Triggers the draw choreography (selection UI sync happens there).
   */
  async setElementState(mapOrId, states) {
    if (typeof mapOrId === "string") {
      this.#setStates(mapOrId, states ?? []);
    } else {
      for (const [id, elementStates] of Object.entries(mapOrId ?? {})) {
        this.#setStates(id, elementStates ?? []);
      }
    }
    await this.draw();
  }

  #setStates(id, states) {
    if (states.length === 0) {
      this.elementStates.delete(id);
    } else {
      this.elementStates.set(id, [...states]);
    }
  }

  // --------------------------------------------------------------- visibility

  // Both are `async` only for the G6 call-site contract; the body is fully
  // synchronous (graphology writes + one skipIndexation refresh).
  async showElement(ids) {
    this.#setHidden(ids, false);
  }

  async hideElement(ids) {
    this.#setHidden(ids, true);
  }

  #setHidden(ids, hidden) {
    if (this.killed) return;
    const visibility = hidden ? "hidden" : "visible";
    for (const id of Array.isArray(ids) ? ids : [ids]) {
      if (this.graph.hasNode(id)) {
        this.graph.setNodeAttribute(id, "hidden", hidden);
        const ref = this.cache.nodeRef.get(id);
        if (ref) ref.style.visibility = visibility;
      } else if (this.graph.hasEdge(id)) {
        this.graph.setEdgeAttribute(id, "hidden", hidden);
        const ref = this.cache.edgeRef.get(id);
        if (ref) ref.style.visibility = visibility;
      }
    }
    this.sigma.refresh({ skipIndexation: true });
  }

  // ----------------------------------------------------------------- viewport

  async fitView() {
    // Drop the bbox pinned by node dragging (see InteractionManager) so the
    // normalization re-covers all current positions, then the default camera
    // frames everything.
    this.sigma.setCustomBBox(null);
    this.sigma.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
  }

  /**
   * Frame the given graph-space bounding box with padding. Replaces the old
   * G6 zoom-at-non-1 workaround (antvis/G6#6373) with a direct camera fit.
   */
  fitViewToBounds({ minX, minY, maxX, maxY }) {
    const camera = this.sigma.getCamera();
    const { width, height } = this.sigma.getDimensions();
    const p1 = this.sigma.graphToViewport({ x: minX, y: minY });
    const p2 = this.sigma.graphToViewport({ x: maxX, y: maxY });
    const spanX = Math.abs(p2.x - p1.x) || 1;
    const spanY = Math.abs(p2.y - p1.y) || 1;
    const scale = Math.max(
      spanX / Math.max(width - 2 * FIT_PADDING_PX, 1),
      spanY / Math.max(height - 2 * FIT_PADDING_PX, 1),
    );
    const ratio = Math.max(camera.getState().ratio * scale, 1 / MAX_FIT_ZOOM);
    const center = this.sigma.viewportToFramedGraph(
      this.sigma.graphToViewport({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }),
    );
    camera.setState({ x: center.x, y: center.y, ratio });
  }

  /** G6 zoom z ↔ sigma camera ratio 1/z. */
  async zoomTo(zoom) {
    if (!Number.isFinite(zoom) || zoom <= 0) return;
    this.sigma.getCamera().setState({ ratio: 1 / zoom });
  }

  getZoom() {
    return 1 / this.sigma.getCamera().getState().ratio;
  }

  /** @param {[number, number]} offset  viewport pixels */
  async translateBy([dx, dy]) {
    const { width, height } = this.sigma.getDimensions();
    const target = this.sigma.viewportToFramedGraph({
      x: width / 2 - dx,
      y: height / 2 - dy,
    });
    this.sigma.getCamera().setState({ x: target.x, y: target.y });
  }

  /** Center the camera on the centroid of the given node/edge ids (zoom kept). */
  async focusElement(ids) {
    const points = [];
    for (const id of Array.isArray(ids) ? ids : [ids]) {
      if (this.graph.hasNode(id)) {
        const attrs = this.graph.getNodeAttributes(id);
        points.push({ x: attrs.x, y: attrs.y });
      } else if (this.graph.hasEdge(id)) {
        const edge = this.cache.edgeRef.get(id);
        for (const nodeId of [edge?.source, edge?.target]) {
          if (nodeId && this.graph.hasNode(nodeId)) {
            const attrs = this.graph.getNodeAttributes(nodeId);
            points.push({ x: attrs.x, y: attrs.y });
          }
        }
      }
    }
    if (points.length === 0) return;
    const centroid = {
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
    };
    const framed = this.sigma.viewportToFramedGraph(this.sigma.graphToViewport(centroid));
    this.sigma.getCamera().setState({ x: framed.x, y: framed.y });
  }

  /** @returns {[number, number]|null} graph-space position */
  getElementPosition(id) {
    if (!this.graph.hasNode(id)) return null;
    const attrs = this.graph.getNodeAttributes(id);
    return [attrs.x, attrs.y];
  }

  /** Debug-only in callers; returns the camera center (framed coordinates). */
  getPosition() {
    const state = this.sigma.getCamera().getState();
    return [state.x, state.y];
  }

  /** @returns {[number, number]} viewport size in px */
  getSize() {
    const { width, height } = this.sigma.getDimensions();
    return [width, height];
  }

  /** Graph-space → viewport pixels (G6 name kept transitionally). */
  getViewportByCanvas([x, y]) {
    const point = this.sigma.graphToViewport({ x, y });
    return [point.x, point.y];
  }

  // ------------------------------------------------------------------- layout

  /** Stores the layout spec; executed by layout() or the next render(). */
  async setLayout(spec) {
    this.pendingLayout = spec;
  }

  /** Execute the pending (or default) layout and write x/y into graphology. */
  async layout() {
    const spec = this.pendingLayout ?? { type: this.cache.DEFAULTS.LAYOUT };
    this.pendingLayout = null;
    await executeLayout(this.graph, spec);
  }

  // ------------------------------------------------------------- interactions

  /** @param {"drag"|"click"|"hover"|"tooltip"|"lasso"} name */
  setInteractionEnabled(name, enabled) {
    this.interactions.setEnabled(name, enabled);
  }

  isInteractionEnabled(name) {
    return this.interactions.isEnabled(name);
  }

  // ---------------------------------------------------------------- plugins

  /**
   * Per-group bubble-set handle backed by the shared BubbleSetLayer (the
   * old G6 plugin-instance surface: `members` Map + update/drawBubbleSets).
   * core.registerPluginStates caches one per group in INSTANCES.BUBBLE_GROUPS,
   * which destroyGraphAndRollBackUI resets together with this adapter.
   *
   * @param {string} key  legacy plugin key ("bubbleSetPlugin-<group>") or
   *   plain group key
   */
  getPluginInstance(key) {
    const group = key.startsWith("bubbleSetPlugin-") ? key.slice("bubbleSetPlugin-".length) : key;
    return this.bubbleLayer.getGroupHandle(group);
  }

  // ------------------------------------------------------------------- export

  /**
   * PNG data URL of the current viewport. @sigma/export-image re-renders the
   * scene on a temp renderer, which only carries sigma's own layers — the
   * bubble-set canvas is composited UNDER it here (matching its on-screen
   * z-order; export-image's default transparent background lets it show
   * through). The minimap is a viewport control and stays out of exports.
   *
   * `scale` re-renders at a multiple of the viewport size for crisp high-res
   * output (sigma redraws at the larger dimensions, so labels/nodes stay
   * sharp). The factor is clamped to the canvas size limits. Returns the data
   * URL plus the scale actually applied so callers can warn on a clamp.
   *
   * @param {{ scale?: number }} [opts]
   * @returns {Promise<{ url: string, requestedScale: number, appliedScale: number }>}
   */
  async toDataURL({ scale = 1 } = {}) {
    const dims = this.sigma.getDimensions();
    const dpr = window.devicePixelRatio || 1;
    const appliedScale = clampExportScale(scale, dims, dpr);
    const blob = await exportImage.toBlob(this.sigma, {
      format: "png",
      width: dims.width * appliedScale,
      height: dims.height * appliedScale,
    });
    const sigmaImage = await createImageBitmap(blob);
    try {
      const out = document.createElement("canvas");
      out.width = sigmaImage.width;
      out.height = sigmaImage.height;
      const ctx = out.getContext("2d");
      const bubbleCanvas = this.bubbleLayer.canvas;
      if (bubbleCanvas?.width > 0 && bubbleCanvas?.height > 0) {
        // Both canvases are viewport-aligned (export-image renders at
        // window.devicePixelRatio over the live CSS dimensions), so the
        // stretch is geometry-preserving at any DPR — worst case is
        // resolution blur, never an offset.
        ctx.drawImage(bubbleCanvas, 0, 0, out.width, out.height);
      }
      ctx.drawImage(sigmaImage, 0, 0);
      return { url: out.toDataURL("image/png"), requestedScale: scale, appliedScale };
    } catch (error) {
      throw new Error(`Graph image export failed: ${error?.message ?? error}`);
    } finally {
      sigmaImage.close();
    }
  }
}

export { SigmaAdapter };
