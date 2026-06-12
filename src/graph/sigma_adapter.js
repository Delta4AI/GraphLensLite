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
  animateNodes,
  createNodePiechartProgram,
} from "../lib/sigma.bundle.mjs";
import { DEFAULTS } from "../config.js";
import {
  EdgeHaloProgram,
  createCurveHaloProgram,
  createEdgeMarkerHeadProgram,
} from "./edge_programs.js";
import { EdgeFlowProgram, createCurveFlowProgram } from "./edge_flow_programs.js";
import { FlowAnimator } from "./flow_animator.js";
import { clampExportScale } from "../utilities/export_scale.js";
import {
  nodeAttributesFromStyle,
  edgeAttributesFromStyle,
  flipY,
  buildLayoutTransitionTargets,
} from "./graph_model.js";
import { executeLayout } from "./layout_algorithms.js";
import { drawNodeLabel, drawEdgeLabel, BAKED_DEFAULT_LABEL_COLOR } from "./label_renderers.js";
import { InteractionManager } from "./interactions.js";
import { BubbleSetLayer } from "./bubble_layer.js";
import { HeatmapLayer } from "./heatmap_layer.js";
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
// Node-position tween when switching workspaces (sigma/utils animateNodes):
// long enough to read the motion, short enough not to gate interaction.
const LAYOUT_TRANSITION_MS = 450;
// Above this node count the per-frame attribute writes + refresh stop being
// free; snap instead of animating so big graphs never pay the tween cost.
const LAYOUT_TRANSITION_MAX_NODES = 2000;

/** @returns {boolean} whether the user asked the OS to minimize motion */
function prefersReducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

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
 * "styledLine"/"styledCurve" compose halo-under → body → flow overlay →
 * marker heads (compound programs draw in array order: the flow pattern rides
 * on the body, marker heads stay crisp on top) and are fully parameterized by
 * per-edge attrs (startMarker/endMarker enum + sizes, haloWidth/haloColor,
 * flowMode/flowSpeed/flowColor) — no registry growth per marker shape or
 * halo/flow toggle. Off states collapse to degenerate geometry in the custom
 * programs (see edge_programs.js / edge_flow_programs.js). styledCurve's flow
 * sub-program forks the @sigma/edge-curve shaders via string patches
 * (edge_flow_glsl.js); on anchor drift after a sigma upgrade it is dropped
 * with a warning and curves render without animation.
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
  // Pie-chart nodes: one program with a fixed slice count, each slice reading
  // its angle/color from the per-node pieValue{k}/pieColor{k} attrs emitted by
  // graph_model (pieAttributesFromSlices). Unused slots carry value 0 + a
  // transparent color, so a node with fewer categories than MAX_SLICES draws
  // only its real wedges. Reuses the custom node-label drawer and the
  // drag-guarded hover so pie nodes behave like every other node type.
  const pie = DEFAULTS.NODE.PIE;
  const pieProgram = createNodePiechartProgram({
    defaultColor: pie.DEFAULT_COLOR,
    offset: { value: 0 },
    slices: Array.from({ length: pie.MAX_SLICES }, (_, k) => ({
      color: { attribute: `pieColor${k}`, defaultValue: "#00000000" },
      value: { attribute: `pieValue${k}` },
    })),
    drawLabel: drawNodeLabel,
    drawHover: guardHoverDrawer(drawDiscNodeHover, getDraggedNode),
  });
  // One curve class serves both the plain "curve" type and the body/halo
  // sub-programs of "styledCurve" (each gets its own instance + buffers).
  // arrowHead stays null: end markers are drawn by the parametric marker-head
  // sub-programs, oriented along the same bezier tangent.
  const curveProgram = edgeCurve.createEdgeCurveProgram({
    arrowHead: null,
    drawLabel: drawCurvedEdgeLabelWithSize,
  });
  // Curve flow overlay: forked @sigma/edge-curve shaders (edge_flow_glsl.js
  // string patches). The patchers throw when a sigma upgrade moves their GLSL
  // anchors — degrade to curves WITHOUT animation rather than break curve
  // rendering; straight-edge flow is unaffected.
  let curveFlowProgram = null;
  try {
    curveFlowProgram = createCurveFlowProgram(curveProgram);
  } catch (error) {
    console.warn("buildProgramRegistry: curve flow overlay disabled:", error);
  }
  return {
    nodeProgramClasses: {
      square: GuardedSquareProgram,
      shape: shapeProgram,
      borderCircle: borderCircleProgram,
      pie: pieProgram,
    },
    edgeProgramClasses: {
      line: EdgeRectangleProgram,
      styledLine: createEdgeCompoundProgram([
        EdgeHaloProgram,
        EdgeRectangleProgram,
        EdgeFlowProgram,
        createEdgeMarkerHeadProgram({ extremity: "source" }),
        createEdgeMarkerHeadProgram({ extremity: "target" }),
      ]),
      curve: curveProgram,
      styledCurve: createEdgeCompoundProgram(
        [
          createCurveHaloProgram(curveProgram),
          curveProgram,
          // Flow overlay rides on the body, marker heads stay crisp on top.
          ...(curveFlowProgram ? [curveFlowProgram] : []),
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

/**
 * Temporarily override `window.devicePixelRatio`, returning a restore fn.
 * @sigma/export-image reads it once to size its export canvas, so raising it
 * for the duration of a single export yields a higher-DPI render of the live
 * view with proportions intact. Defining an own property shadows the (often
 * accessor-based, prototype-level) browser ratio; restore reinstates the
 * original descriptor, or deletes the shadow when there wasn't one.
 *
 * @param {number} value
 * @returns {() => void} restore
 */
function overrideDevicePixelRatio(value) {
  const original = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value });
  return () => {
    if (original) Object.defineProperty(window, "devicePixelRatio", original);
    else delete window.devicePixelRatio;
  };
}

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
    // When set, the next render() leaves node positions untouched: a workspace
    // switch is mid-flight and runLayoutTransition() owns the positions (it
    // tweens them from the outgoing view to the incoming one once the loading
    // overlay clears). See GraphLayoutManager.changeLayout.
    this.pendingLayoutTransition = false;
    this.layoutTransitionCancel = null;
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
    // Created BEFORE BubbleSetLayer on purpose: both register with
    // beforeLayer: "edges", and the earliest-created canvas sits deepest
    // (see the layer-ordering note in heatmap_layer.js), keeping the
    // atmospheric field under the bubble bodies.
    this.heatmapLayer = new HeatmapLayer(this);
    this.bubbleLayer = new BubbleSetLayer(this, cache);
    this.minimap = new Minimap(this, containerEl);
    this.flowAnimator = new FlowAnimator(this);
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
    this.layoutTransitionCancel?.();
    this.layoutTransitionCancel = null;
    clearTimeout(this.resizeDebounce);
    this.resizeObserver.disconnect();
    this.flowAnimator.destroy();
    this.heatmapLayer.destroy();
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
    // A workspace switch is animating its own positions — don't snap them out
    // from under the tween (runLayoutTransition consumes the flag).
    if (this.pendingLayoutTransition) return;
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

  /**
   * Tween node positions from wherever they currently sit (the outgoing
   * workspace, left in place because render() skipped its snap while
   * pendingLayoutTransition was set) to the incoming workspace's persisted
   * positions. Consumes the flag. Reduced-motion users and large graphs get
   * an instant snap instead — both still end at the exact target positions, so
   * the rest of the switch (nodeRef sync, bubble redraw) is identical.
   *
   * @param {Map<string, {style?: {x:number, y:number}}>} positionsMap  the
   *   incoming layout's persisted positions (app-model y-down).
   * @returns {Promise<void>} resolves once nodes are settled at the targets.
   */
  async runLayoutTransition(positionsMap) {
    this.pendingLayoutTransition = false;
    if (this.killed || !positionsMap) return;

    // Build graph-space targets (y-flipped) only for nodes that still exist.
    const { targets, count } = buildLayoutTransitionTargets(positionsMap, (id) =>
      this.graph.hasNode(id),
    );
    if (count === 0) return;

    const snap = () => {
      for (const [id, target] of Object.entries(targets)) {
        this.graph.mergeNodeAttributes(id, target);
      }
    };

    if (count > LAYOUT_TRANSITION_MAX_NODES || prefersReducedMotion()) {
      snap();
      this.sigma.refresh({ skipIndexation: true });
    } else {
      // A prior tween still running (rapid switches): cancel before starting a
      // new one so they don't fight over the same node attributes.
      this.layoutTransitionCancel?.();
      await new Promise((resolve) => {
        this.layoutTransitionCancel = animateNodes(
          this.graph,
          targets,
          { duration: LAYOUT_TRANSITION_MS, easing: "cubicInOut" },
          resolve,
        );
      });
      this.layoutTransitionCancel = null;
    }

    // Mirror the settled positions back into the nodeRef cache (the app-model
    // store the rest of the code reads), then redraw bubble hulls at the
    // final positions (they were last drawn at the outgoing view's layout).
    for (const [id, pos] of positionsMap) {
      const ref = this.cache.nodeRef.get(id);
      if (ref && Number.isFinite(pos?.style?.x) && Number.isFinite(pos?.style?.y)) {
        ref.style.x = pos.style.x;
        ref.style.y = pos.style.y;
      }
    }
    if (!this.killed) await this.cache.bs?.redrawBubbleSets?.();
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
   * scene on a temp renderer, which only carries sigma's own layers, so the
   * bubble-set canvases are composited here in their on-screen z-order: the
   * body/outline UNDER the sigma image, the group labels OVER it. An opaque
   * stage-background fill goes down first (export-image renders sigma
   * transparent). The minimap is a viewport control and stays out of exports.
   *
   * `scale` raises the export resolution by bumping the device pixel ratio
   * (see overrideDevicePixelRatio), so node/label proportions match the live
   * view exactly at any factor. It is clamped to the canvas size limits;
   * returns the data URL plus the scale actually applied so callers can warn
   * on a clamp.
   *
   * @param {{ scale?: number }} [opts]
   * @returns {Promise<{ url: string, requestedScale: number, appliedScale: number }>}
   */
  async toDataURL({ scale = 1 } = {}) {
    const dims = this.sigma.getDimensions();
    const dpr = window.devicePixelRatio || 1;
    const appliedScale = clampExportScale(scale, dims, dpr);
    const background = this.#stageBackgroundColor();

    // High-res export = the SAME framing at higher pixel density. Growing the
    // temp renderer's CSS dimensions (export-image's width/height) scales node
    // positions with the viewport but leaves node/label sizes in absolute px,
    // so nodes shrink relative to the frame (2x → half size, 8x → invisible).
    // Bumping the device pixel ratio instead scales the WHOLE pipeline
    // uniformly — positions, radii, label fonts, edge widths, paddings — so
    // the output is a true DPI multiple of the on-screen view. export-image
    // reads window.devicePixelRatio once while building its own temp renderer
    // and never re-renders the live one, so the override is invisible outside
    // this call and always restored.
    const restoreDpr = appliedScale !== 1 ? overrideDevicePixelRatio(dpr * appliedScale) : null;
    let blob;
    try {
      blob = await exportImage.toBlob(this.sigma, { format: "png" });
    } finally {
      restoreDpr?.();
    }

    const sigmaImage = await createImageBitmap(blob);
    try {
      const out = document.createElement("canvas");
      out.width = sigmaImage.width;
      out.height = sigmaImage.height;
      const ctx = out.getContext("2d");
      // Opaque stage background first: export-image renders sigma transparent,
      // so without this the PNG shows through to whatever the viewer paints
      // behind alpha (which reads as "dark mode" regardless of the theme).
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, out.width, out.height);
      const bubbleCanvas = this.bubbleLayer.canvas;
      if (bubbleCanvas?.width > 0 && bubbleCanvas?.height > 0) {
        // Both canvases are viewport-aligned, so the stretch to the (DPR-
        // scaled) output is geometry-preserving — worst case is resolution
        // blur on the bubble body, never an offset.
        ctx.drawImage(bubbleCanvas, 0, 0, out.width, out.height);
      }
      ctx.drawImage(sigmaImage, 0, 0);
      // Group labels sit above sigma's node labels on screen (their own canvas
      // at afterLayer "labels"); composite them last to keep that z-order.
      const labelCanvas = this.bubbleLayer.labelCanvas;
      if (labelCanvas?.width > 0 && labelCanvas?.height > 0) {
        ctx.drawImage(labelCanvas, 0, 0, out.width, out.height);
      }
      return { url: out.toDataURL("image/png"), requestedScale: scale, appliedScale };
    } catch (error) {
      throw new Error(`Graph image export failed: ${error?.message ?? error}`);
    } finally {
      sigmaImage.close();
    }
  }

  /**
   * The live stage background (the `--bg` token painted on the graph
   * container). Falls back to opaque white so an export is never see-through.
   *
   * @returns {string} a CSS color usable as a 2d fillStyle
   */
  #stageBackgroundColor() {
    const fallback = "#ffffff";
    try {
      const el = this.sigma.getContainer?.();
      if (!el || typeof getComputedStyle !== "function") return fallback;
      const bg = getComputedStyle(el).backgroundColor;
      // Transparent container → fall back (otherwise we'd re-introduce alpha).
      if (!bg || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") return fallback;
      return bg;
    } catch {
      return fallback;
    }
  }
}

export { SigmaAdapter };
