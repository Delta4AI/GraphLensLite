import { StaticUtilities } from '../utilities/static.js';
import { replaceColorScale } from '../utilities/color_scale_picker.js';
import { replaceNumericScale } from '../utilities/numeric_scale_picker.js';
import { initTheme, nodeLabelColorForTheme } from '../utilities/theme.js';
import { buildGraphologyGraph, makeNodeReducer, makeEdgeReducer } from './graph_model.js';
// NOTE: sigma_adapter.js is imported lazily in createGraphInstance(), never
// statically: the sigma vendor bundle probes WebGL at module scope
// (@sigma/node-image reads MAX_TEXTURE_SIZE from a throwaway context), so a
// static import kills the whole app boot when WebGL is unavailable — before
// the isWebGL2Available() check below could ever run.
import {
  isWebGL2Available,
  renderWebGLUnavailableMessage,
  WEBGL2_ERROR_MESSAGE,
} from './webgl_support.js';

// One-time listener registration guards. These must live at module scope:
// the Cache singleton is reset *in place* on every file load (Cache.reset()),
// which would re-arm EVENT_LOCKS-based guards and stack duplicate document/
// window listeners (even counts turn toggle hotkeys into no-ops). The handlers
// resolve managers through `this.cache.*`, which always points at the live,
// in-place-reset Cache instance.
let hotkeysRegistered = false;
let globalEventsRegistered = false;

class GraphCoreManager {
  constructor(cache) {
    this.cache = cache;
    // In-flight createGraphInstance() memo — see the re-entrancy note there.
    this.graphInitPromise = null;
  }

  *traverseD4Data(nodeOrEdge) {
    if (!nodeOrEdge.D4Data) return;

    for (let section in nodeOrEdge.D4Data) {
      for (let subsection in nodeOrEdge.D4Data[section]) {
        for (let prop in nodeOrEdge.D4Data[section][subsection]) {
          yield [section, subsection, prop, nodeOrEdge.D4Data[section][subsection][prop]];
        }
      }
    }
  }

  async decideToRenderOrDraw(forceRender = false) {
    await this.cache.ui.showLoading('Loading', 'Deciding to render or draw ..');
    await new Promise((resolve) => requestAnimationFrame(resolve));

    if (this.cache.EVENT_LOCKS.QUERY_SELECTION_EVENT) {
      this.cache.qm.storeQuery();
    }

    await this.preRenderEvent();
    await this.cache.metrics.updateMetricUI();

    try {
      if (
        this.cache.bubbleSetChanged ||
        this.cache.styleChanged ||
        this.cache.layoutChanged ||
        forceRender
      ) {
        // NOTE: only `styleChanged` re-syncs cached-ref mutations to the
        // renderer here. `layoutChanged` does NOT trigger updateData — callers
        // that flip it while mutating node.style.x/y on cache.nodeRef refs must
        // push their own updateNodeData payload. See layoutSelectedNodes.
        if (this.cache.styleChanged) {
          await this.cache.ui.showLoading('Loading', 'Updating graph ..');
          await new Promise((resolve) => requestAnimationFrame(resolve));
          await this.cache.graph.updateData({
            nodes: [...this.cache.nodeRef.values()],
            edges: [...this.cache.edgeRef.values()],
          });
          this.cache.styleChanged = false;
          this.cache.labelStyleChanged = false;
        }
        await this.cache.ui.showLoading('Loading', 'Rendering graph ..');
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return await this.cache.graph.render();
      } else {
        await this.cache.ui.showLoading('Loading', 'Redrawing graph ..');
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return await this.cache.graph.draw();
      }
    } catch (errorMsg) {
      this.cache.ui.error(errorMsg);
      return false;
    } finally {
      await this.cache.ui.hideLoading();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  async createGraphInstance() {
    if (this.cache.graph !== null) return;

    // The init body awaits (dynamic import, layout passes), so two rapid
    // calls would both pass the null check above and construct two
    // SigmaAdapters — the first one orphaned, leaking a WebGL context.
    // Memoize the in-flight init; cleared in finally so a failed init
    // (cache.graph stays null) can be retried by the next load.
    if (this.graphInitPromise) return this.graphInitPromise;

    this.graphInitPromise = this.#initGraphInstance();
    try {
      return await this.graphInitPromise;
    } finally {
      this.graphInitPromise = null;
    }
  }

  async #initGraphInstance() {
    // Sigma v3 dies with an opaque TypeError when no WebGL context can be
    // created (GPU blocklist, remote desktop, disabled flags). Probe first
    // and leave cache.graph null — the same state as "no data loaded", so
    // the rest of the app chrome keeps working; load paths already guard
    // on a null graph after this call.
    const containerEl = document.getElementById('innerGraphContainer');
    if (!isWebGL2Available()) {
      renderWebGLUnavailableMessage(containerEl);
      this.cache.ui.error(WEBGL2_ERROR_MESSAGE);
      return;
    }

    // Rebuild the graphology model from the current refs/positions; it is
    // the single data source the sigma renderer reads from.
    this.cache.graphData = buildGraphologyGraph(this.cache);

    const elementStates = new Map();
    // Hover layer (InteractionManager writes, reducers read) is separate
    // from elementStates so hover can never corrupt selection state.
    const hoverIds = new Set();
    try {
      const { SigmaAdapter } = await import('./sigma_adapter.js');
      // initTheme (not currentTheme): re-resolves stored/OS preference so a
      // graph constructed before the DOMContentLoaded theme boot still gets
      // the right label colors. Idempotent after boot.
      const theme = initTheme(document, window);
      this.cache.graph = new SigmaAdapter(this.cache, 'innerGraphContainer', {
        nodeReducer: makeNodeReducer(this.cache, elementStates, hoverIds),
        edgeReducer: makeEdgeReducer(this.cache, elementStates, hoverIds),
        elementStates,
        hoverIds,
        // Label visibility (CFG.HIDE_LABELS) is synced live by the adapter
        // on construction and on every render(). The labelColor fallback is
        // theme-driven (ui.toggleDarkMode flips it live via setSetting).
        settings: {
          labelColor: { color: nodeLabelColorForTheme(theme) },
          // Same for edge labels: label_renderers falls back here whenever
          // the per-edge labelColor is the baked #000000 default (in light
          // mode this resolves to #000 — identical to the old baked render).
          edgeLabelColor: { color: nodeLabelColorForTheme(theme) },
        },
      });
    } catch (err) {
      // The probe can pass while sigma's own context creation still fails
      // (e.g. context-count limits). Same dead-renderer handling.
      this.cache.graph = null;
      renderWebGLUnavailableMessage(containerEl);
      this.cache.ui.error(`Graph renderer failed to initialize: ${err.message}`);
      return;
    }

    const layout = this.cache.data.layouts[this.cache.data.selectedLayout];

    // Re-apply per-layout node/edge styles on every graph rebuild (data-editor
    // apply, JSON load). buildGraphologyGraph does not merge layout.nodeStyles/
    // edgeStyles, and the only other applyLayoutStyles caller is changeLayout().
    // Runs before the layout algorithm below so freshly computed positions are
    // never clobbered by the style reset. Skipped when the layout carries no
    // custom styles: refs are already originalStyle right after a rebuild, and
    // the full reset pass clones every element (~700 ms at 15k elements).
    if (layout.nodeStyles?.size || layout.edgeStyles?.size) {
      await this.cache.lm.applyLayoutStyles(layout);
    }

    // If layout has no positions yet but has a layoutType, apply that layout algorithm once
    if (layout.positions.size === 0 && layout.layoutType) {
      const internals = this.cache.DEFAULTS.LAYOUT_INTERNALS[layout.layoutType] || {};
      await this.cache.graph.setLayout({
        type: layout.layoutType,
        ...internals,
      });
    }
  }

  /**
   * One-time post-first-render routine (hotkeys, global listeners, plugin
   * stubs, initial filter pass, initial layout persistence). Called
   * sequentially by SigmaAdapter.render() — formerly G6's AFTER_RENDER event.
   */
  async initialAfterRenderEvent() {
    if (this.cache.EVENT_LOCKS.ONCE_AFTER_RENDER_RUNNING) return;

    try {
      this.cache.ui.debug('ONCE AFTER RENDER');
      await this.cache.ui.showLoading('Post-processing', 'Post-processing ..');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.cache.EVENT_LOCKS.ONCE_AFTER_RENDER_RUNNING = true;

      await this.cache.ui.showLoading('Post-processing', 'Registering event listeners ..');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.registerHotkeyEvents();
      this.registerGlobalEventListeners();
      await this.registerPluginStates();

      // to initially fill caches related to the query/filters, preRenderEvent is called without rendering afterwards
      await this.cache.ui.showLoading('Post-processing', 'Pre-render event ..');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await this.preRenderEvent();

      await this.cache.ui.showLoading('Post-processing', 'Updating metrics UI ..');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await this.cache.metrics.updateMetricUI();

      await this.cache.ui.showLoading('Post-processing', 'Finalizing rendering ..');
      await new Promise((resolve) => requestAnimationFrame(resolve));

      if (this.cache.EVENT_LOCKS.TRIGGER_SET_LAYOUT_ONCE) {
        // suppresses the info in case of loading from a json model
        if (this.cache.nodePositionsFromExcelImport.size !== 0) {
          this.cache.ui.info(
            `Created view "${this.cache.DEFAULTS.CUSTOM_LAYOUT_NAME}". Applying ${this.cache.DEFAULTS.LAYOUT} layout to nodes without coordinates ..`
          );
        }
        await this.cache.graph.setLayout({
          type: this.cache.DEFAULTS.LAYOUT,
          ...this.cache.DEFAULTS.LAYOUT_INTERNALS[this.cache.DEFAULTS.LAYOUT],
        });
      }

      this.cache.EVENT_LOCKS.ONCE_AFTER_RENDER_COMPLETED = true;
      await this.cache.graph.render();

      if (this.cache.EVENT_LOCKS.TRIGGER_SET_LAYOUT_ONCE) {
        this.cache.ui.debug('Initially persisting custom layout ..');
        await this.cache.lm.persistNodePositions();
        this.cache.EVENT_LOCKS.TRIGGER_SET_LAYOUT_ONCE = false;
      }

      await this.applyHideDisconnectedState();
    } catch (errorMsg) {
      this.cache.ui.error(`Error in initial AFTER_RENDER: ${errorMsg}`);
      this.cache.ui.error('Graph setup failed. Please check your input data.');
      await this.cache.ui.hideLoading();
    } finally {
      this.cache.EVENT_LOCKS.ONCE_AFTER_RENDER_RUNNING = false;
    }
  }

  async toggleCleanUpDanglingElements(btn) {
    const shouldEnable = btn.classList.contains('red');
    const currentLayout = this.cache.data.layouts[this.cache.data.selectedLayout];

    if (shouldEnable) {
      btn.classList.remove('red');
      btn.classList.add('green', 'highlight');
      btn.title = 'Show all nodes and edges, irrespectively of their connectedness.';
      btn.textContent = '👁';
      currentLayout.hideDisconnectedNodes = true;
      await this.hideDanglingElements();
    } else {
      btn.classList.remove('green', 'highlight');
      btn.classList.add('red');
      btn.title = 'Hide all nodes and edges that are not connected to any other node or edge.';
      btn.textContent = '🚫';
      currentLayout.hideDisconnectedNodes = false;
      await this.showDanglingElements();
    }
  }

  nodeHasAVisibleEdge(nodeID) {
    for (const edgeID of this.cache.nodeIDToEdgeIDs.get(nodeID) || []) {
      if (
        this.cache.edgeIDsToBeShown.has(edgeID) &&
        !this.cache.hiddenDanglingEdgeIDs.has(edgeID)
      ) {
        return true;
      }
    }

    return false;
  }

  edgeIsConnectedToTwoVisibleNodes(edgeID) {
    for (const nodeID of this.cache.edgeIDToNodeIDs.get(edgeID) || []) {
      if (
        !this.cache.nodeIDsToBeShown.has(nodeID) ||
        this.cache.hiddenDanglingNodeIDs.has(nodeID)
      ) {
        return false;
      }
    }
    return true;
  }

  // Pure computation: populate hiddenDanglingNodeIDs/hiddenDanglingEdgeIDs by
  // iterating the CURRENT show sets until a fixpoint. Hiding a dangling node
  // can strand its neighbour, so we repeat until no further changes. No side
  // effects beyond the cache sets — callers own bubble/render updates.
  computeDanglingElements() {
    let changes;

    do {
      changes = false;

      for (let nodeID of this.cache.nodeIDsToBeShown) {
        if (!this.nodeHasAVisibleEdge(nodeID) && !this.cache.hiddenDanglingNodeIDs.has(nodeID)) {
          this.cache.hiddenDanglingNodeIDs.add(nodeID);
          changes = true;
        }
      }

      for (let edgeID of this.cache.edgeIDsToBeShown) {
        if (
          !this.edgeIsConnectedToTwoVisibleNodes(edgeID) &&
          !this.cache.hiddenDanglingEdgeIDs.has(edgeID)
        ) {
          this.cache.hiddenDanglingEdgeIDs.add(edgeID);
          changes = true;
        }
      }
    } while (changes);
  }

  async hideDanglingElements() {
    this.computeDanglingElements();

    // Update bubble groups to exclude hidden dangling nodes
    await this.cache.bs.updateBubbleSetIfChanged();

    await this.cache.fm.handleFilterEvent(
      'Hiding Elements',
      'Hiding nodes and edges that are not connected to any other node or edge.',
      null,
      false
    );
  }

  async showDanglingElements() {
    this.cache.hiddenDanglingNodeIDs.clear();
    this.cache.hiddenDanglingEdgeIDs.clear();

    // Update bubble groups to restore hidden dangling nodes
    await this.cache.bs.updateBubbleSetIfChanged();

    await this.cache.fm.handleFilterEvent(
      'Showing Elements',
      'Showing all previously hidden nodes and edges that are not connected to any other node or edge.',
      null,
      false
    );
  }

  updateHideDisconnectedButtonState() {
    const btn = document.getElementById('hideDisconnectedBtn');
    if (!btn) return;
    const currentLayout = this.cache.data.layouts[this.cache.data.selectedLayout];
    if (currentLayout && currentLayout.hideDisconnectedNodes) {
      btn.classList.remove('red');
      btn.classList.add('green', 'highlight');
      btn.title = 'Show all nodes and edges, irrespectively of their connectedness.';
      btn.textContent = '👁';
    } else {
      btn.classList.remove('green', 'highlight');
      btn.classList.add('red');
      btn.title = 'Hide all nodes and edges that are not connected to any other node or edge.';
      btn.textContent = '🚫';
    }
  }

  async applyHideDisconnectedState() {
    const currentLayout = this.cache.data.layouts[this.cache.data.selectedLayout];
    this.cache.hiddenDanglingNodeIDs.clear();
    this.cache.hiddenDanglingEdgeIDs.clear();
    this.updateHideDisconnectedButtonState();
    if (currentLayout && currentLayout.hideDisconnectedNodes) {
      await this.hideDanglingElements();
    }
  }

  async focusNodes(nodeIDs = undefined) {
    if (!nodeIDs) {
      nodeIDs = this.cache.selectedNodes;
    }
    await this.focusElements(nodeIDs);
  }

  async focusEdges(edgeIDs = undefined) {
    if (!edgeIDs) {
      edgeIDs = this.cache.selectedEdges;
    }
    await this.focusElements(edgeIDs);
  }

  /** Center and zoom to the whole selection (nodes and edges) — the rail chip's 🔍. */
  async focusSelection() {
    const ids = [...this.cache.selectedNodes, ...this.cache.selectedEdges];
    if (ids.length === 0) return;
    await this.focusElements(ids);
  }

  async focusElements(elementIDs, isNode) {
    const zoom = await this.cache.graph.getZoom();
    if (zoom < 2) {
      await this.cache.graph.zoomTo(2);
    }
    await this.cache.graph.focusElement([...elementIDs]);

    const targetMap = isNode ? this.cache.nodeRef : this.cache.edgeRef;
    await this.cache.sm.selectElements(elementIDs, targetMap, 'highlight');
    setTimeout(async () => {
      await this.cache.sm.selectElements([], targetMap, 'highlight');
    }, 2500);
  }

  async fitViewToVisibleNodes() {
    const visibleNodeIDs = [...this.cache.nodeIDsToBeShown].filter(
      (id) => !this.cache.hiddenDanglingNodeIDs.has(id)
    );
    await this.fitViewToNodes(visibleNodeIDs);
  }

  // Centre and scale the viewport so the given set of nodes fills it with
  // padding. Direct camera fit — the old G6 zoom-at-non-1 translate
  // workaround (antvis/G6#6373) is gone with the sigma renderer.
  async fitViewToNodes(nodeIDs) {
    const ids = [...nodeIDs];
    if (ids.length === 0) {
      await this.cache.graph.fitView();
      return;
    }

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const id of ids) {
      const pos = this.cache.graph.getElementPosition(id);
      if (!pos) continue;
      const [x, y] = pos;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    if (!isFinite(minX)) {
      await this.cache.graph.fitView();
      return;
    }

    this.cache.graph.fitViewToBounds({ minX, minY, maxX, maxY });
  }

  async updateEdges(overrides = {}, commands = []) {
    let colorMap = null;
    if (commands.includes('set_continuous_color_scale')) {
      colorMap = await this.cache.picker.pickColors('edges');
      if (!colorMap) {
        this.cache.ui.info('Aborted color picker');
        return;
      }
    }

    let numericScaleMap = null;
    if (commands.includes('set_numeric_scale')) {
      const propertyName = this.cache.numericPicker.currentProperty || null;
      numericScaleMap = await this.cache.numericPicker.pickNumericScale('edges', propertyName);
      if (!numericScaleMap) {
        this.cache.ui.info('Aborted numeric scale picker');
        return;
      }
    }

    for (const edgeID of this.cache.selectedEdges) {
      const edge = this.cache.edgeRef.get(edgeID);

      for (const command of commands) {
        if (command === 'label_set_to_id') {
          edge.style.label = true;
          edge.style.labelText = edge.id;
        }
        if (command === 'label_set_to_label') {
          edge.style.label = true;
          edge.style.labelText = edge.label;
        }
      }

      // apply overrides
      const overridesCopy = structuredClone(overrides);
      if (colorMap) {
        replaceColorScale(overridesCopy, edgeID, colorMap);
      }
      if (numericScaleMap) {
        replaceNumericScale(overridesCopy, edgeID, numericScaleMap);
      }
      StaticUtilities.deepMerge(edge, overridesCopy);
      this.cache.edgeRef.set(edgeID, edge);

      // Save to current layout's style map (including type)
      const currentLayout = this.cache.data.layouts[this.cache.data.selectedLayout];
      currentLayout.edgeStyles.set(edgeID, {
        type: edge.type,
        style: structuredClone(edge.style),
      });
    }

    await this.cache.style.handleStyleChangeLoadingEvent('Style', 'Updating Edge Styles');
  }

  async updateNodes(overrides = {}, commands = []) {
    let colorMap = null;
    if (commands.includes('set_continuous_color_scale')) {
      colorMap = await this.cache.picker.pickColors('nodes');
      if (!colorMap) {
        this.cache.ui.info('Aborted color picker');
        return;
      }
    }

    let numericScaleMap = null;
    if (commands.includes('set_numeric_scale')) {
      const propertyName = this.cache.numericPicker.currentProperty || null;
      numericScaleMap = await this.cache.numericPicker.pickNumericScale('nodes', propertyName);
      if (!numericScaleMap) {
        this.cache.ui.info('Aborted numeric scale picker');
        return;
      }
    }

    let pieResult = null;
    if (commands.includes('set_pie_chart')) {
      pieResult = await this.cache.piePicker.pickPie();
      if (!pieResult) {
        this.cache.ui.info('Aborted pie chart picker');
        return;
      }
    }

    const badgesToAdd = overrides.style?.badges;
    const badgePaletteToAdd = overrides.style?.badgePalette;

    if (commands.includes('badge_add')) {
      delete overrides.style?.badges;
      delete overrides.style?.badgePalette;
    }

    for (const nodeID of this.cache.selectedNodes) {
      const node = this.cache.nodeRef.get(nodeID);

      for (const command of commands) {
        if (command === 'badge_clear') {
          node.style.badge = false;
          node.style.badges = [];
          node.style.badgePalette = [];
        }
        if (command === 'badge_add') {
          node.style.badge = true;
          node.style.badges = node.style.badges || [];
          node.style.badgePalette = node.style.badgePalette || [];

          if (badgesToAdd) {
            node.style.badges = [
              ...node.style.badges,
              ...(Array.isArray(badgesToAdd) ? badgesToAdd : [badgesToAdd]),
            ];
          }

          if (badgePaletteToAdd) {
            node.style.badgePalette = [
              ...node.style.badgePalette,
              ...(Array.isArray(badgePaletteToAdd) ? badgePaletteToAdd : [badgePaletteToAdd]),
            ];
          }
        }

        if (command === 'label_set_to_id') {
          node.style.label = true;
          node.style.labelText = node.id;
        }
        if (command === 'label_set_to_label') {
          node.style.label = true;
          node.style.labelText = node.label;
        }
        if (command === 'clear_pie_chart') {
          delete node.style.pieSlices;
          delete node.style.pieMode;
          delete node.style.pieProperties;
        }
      }

      // apply overrides
      const overridesCopy = structuredClone(overrides);
      if (colorMap) {
        replaceColorScale(overridesCopy, nodeID, colorMap);
      }
      if (numericScaleMap) {
        replaceNumericScale(overridesCopy, nodeID, numericScaleMap);
      }
      StaticUtilities.deepMerge(node, overridesCopy);

      // Pie chart: bake the per-node resolved slices (and the config, for
      // re-edit/persistence) onto the style. Empty slices for a node means it
      // carries none of the chosen values — it falls back to its shape.
      if (pieResult) {
        node.style.pieSlices = pieResult.sliceByNode.get(nodeID) ?? [];
        node.style.pieMode = pieResult.mode;
        node.style.pieProperties = pieResult.properties;
      }
      this.cache.nodeRef.set(nodeID, node);

      // Save to current layout's style map (including type)
      const currentLayout = this.cache.data.layouts[this.cache.data.selectedLayout];
      currentLayout.nodeStyles.set(nodeID, {
        type: node.type,
        style: structuredClone(node.style),
      });
    }

    await this.cache.style.handleStyleChangeLoadingEvent('Style', `Updating Node Styles`);
  }

  getTargetNodes(propID) {
    if (!propID) return this.cache.selectedNodes;
    if (!this.cache.propToNodeIDs.has(propID)) {
      return [];
    }
    return [...this.cache.propToNodeIDs.get(propID)].filter((nodeID) =>
      this.cache.nodeIDsToBeShown.has(nodeID)
    );
  }

  getTargetEdges(propID) {
    if (!propID) return this.cache.selectedEdges;
    if (!this.cache.propToEdgeIDs.has(propID)) {
      return [];
    }
    return [...this.cache.propToEdgeIDs.get(propID)].filter((edgeID) =>
      this.cache.edgeIDsToBeShown.has(edgeID)
    );
  }

  async preRenderEvent() {
    if (this.cache.styleChanged) return;

    // Only reset query if not manually updated AND filters not locked by manual query
    if (
      !this.cache.EVENT_LOCKS.QUERY_UPDATE_EVENT &&
      !this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY
    ) {
      this.cache.qm.resetQuery();
    }

    this.cache.nodeIDsToBeShown = new Set();
    this.cache.propIDsToNodeIDsToBeShown = new Map(); // this is used by the bubble-grouping functionality after rendering
    this.cache.edgeIDsToBeShown = new Set();
    this.cache.propIDsToEdgeIDsToBeShown = new Map();
    this.cache.remainingEdgeRelatedNodes = new Set();
    this.cache.fm.resetFeatureIsWithinThresholdMaps();

    this.cache.bubbleSetChanged = false;
    this.cache.qm.decodeQueryAndBuildAST();

    for (const node of this.cache.nodeRef.values()) {
      // Nodes with no features are always visible (nothing to filter on)
      if (node.features.size === 0) {
        this.cache.nodeIDsToBeShown.add(node.id);
        continue;
      }
      if (this.cache.query.ast.testNode(node)) {
        this.cache.nodeIDsToBeShown.add(node.id);
        node.featureIsWithinThreshold.forEach((v, k) => {
          if (v === true) {
            if (!this.cache.propIDsToNodeIDsToBeShown.has(k)) {
              this.cache.propIDsToNodeIDsToBeShown.set(k, new Set());
            }
            this.cache.propIDsToNodeIDsToBeShown.get(k).add(node.id);
          }
        });
      }
    }

    for (const edge of this.cache.edgeRef.values()) {
      const endsOk =
        this.cache.nodeIDsToBeShown.has(edge.source) &&
        this.cache.nodeIDsToBeShown.has(edge.target);

      // Edges with no features are always visible (nothing to filter on),
      // but still require both endpoints to be visible
      if (edge.features.size === 0) {
        if (endsOk) {
          this.cache.edgeIDsToBeShown.add(edge.id);
        }
        continue;
      }

      if (endsOk && this.cache.query.ast.testEdge(edge)) {
        this.cache.edgeIDsToBeShown.add(edge.id);
        edge.featureIsWithinThreshold.forEach((v, k) => {
          if (v === true) {
            if (!this.cache.propIDsToEdgeIDsToBeShown.has(k)) {
              this.cache.propIDsToEdgeIDsToBeShown.set(k, new Set());
            }
            this.cache.propIDsToEdgeIDsToBeShown.get(k).add(edge.id);
          }
        });
      }
    }

    // Re-evaluate disconnected elements against the freshly filtered view.
    // The dangling sets are recomputed from scratch every pass: a node hidden
    // as dangling under the previous filter state may now be connected (and
    // vice versa). Without this, a stale dangling node still passing the filter
    // lands in BOTH idsToShow and idsToHide, and updateElementVisibility's
    // show-then-hide diff resurfaces it on every filter change.
    this.cache.hiddenDanglingNodeIDs.clear();
    this.cache.hiddenDanglingEdgeIDs.clear();
    const currentLayout = this.cache.data.layouts[this.cache.data.selectedLayout];
    if (currentLayout && currentLayout.hideDisconnectedNodes) {
      this.computeDanglingElements();
    }

    const nodeIDsToBeHidden = [...this.cache.nodeRef.keys()].filter(
      (nodeID) => !this.cache.nodeIDsToBeShown.has(nodeID)
    );
    const edgeIDsToBeHidden = [...this.cache.edgeRef.keys()].filter(
      (edgeID) => !this.cache.edgeIDsToBeShown.has(edgeID)
    );

    const idsToShow = [...this.cache.nodeIDsToBeShown, ...this.cache.edgeIDsToBeShown].filter(
      (id) => !this.cache.hiddenDanglingNodeIDs.has(id) && !this.cache.hiddenDanglingEdgeIDs.has(id)
    );

    const idsToHide = [
      ...nodeIDsToBeHidden,
      ...edgeIDsToBeHidden,
      ...this.cache.hiddenDanglingNodeIDs,
      ...this.cache.hiddenDanglingEdgeIDs,
    ];

    await this.cache.fm.updateElementVisibility(idsToShow, idsToHide);
    await this.cache.bs.updateBubbleSetIfChanged();
  }

  resetEventLocks() {
    this.cache.EVENT_LOCKS.AFTER_DRAW_RUNNING = false;
    this.cache.EVENT_LOCKS.ONCE_AFTER_RENDER_RUNNING = false;
    this.cache.EVENT_LOCKS.ONCE_AFTER_RENDER_COMPLETED = false;
    this.cache.EVENT_LOCKS.BUBBLE_GROUP_REDRAW_RUNNING = false;
    this.cache.EVENT_LOCKS.TRIGGER_SET_LAYOUT_ONCE = false;
  }

  async destroyGraphAndRollBackUI() {
    // Anchored popovers hold document-level outside-click listeners and may
    // reference the adapter being destroyed — close them with the graph.
    this.cache.ui?.closeAnchoredPopovers?.();
    await this.cache.graph?.destroy();
    this.cache.graph = null;
    // Drop renderer-cycle state with the instance: the graphology model is
    // rebuilt by createGraphInstance, plugin stubs are re-registered there.
    this.cache.graphData = null;
    this.cache.INSTANCES.BUBBLE_GROUPS = {};

    // isPositionsDirty = false;
    // syncPositionsDebounced.cancel?.();

    const status = document.getElementById('sidebarStatusContainer');
    status.innerHTML = '';
    status.style.height = '0';
  }

  registerHotkeyEvents() {
    if (hotkeysRegistered) return;

    document.addEventListener('keydown', async (event) => {
      // Suppress hotkeys while a workspace/layout/render is loading. The overlay
      // blocks pointer input but not keydown, so without this the user could
      // fire export/toggle/fit actions against a graph that is still settling.
      if (this.cache.ui.isBusy()) return;

      const activeElement = document.activeElement;

      // Skip hotkeys if currently focused on an input, textarea, or select element
      if (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.tagName === 'SELECT' ||
        activeElement.isContentEditable
      ) {
        return;
      }

      switch (event.key) {
        case 'p':
          await this.cache.io.exportPNG();
          break;
        case 's':
          await this.cache.io.exportGraphAsJSON();
          break;
        case 'f':
          await this.fitViewToVisibleNodes();
          break;
        case 'd':
          await this.cache.ui.toggleDataEditor();
          break;
        case 'q':
          this.cache.ui.toggleQueryEditor();
          break;
        case 'm':
          this.cache.metrics.toggleUI();
          break;
        case 'y':
          this.cache.ui.toggleStylingPanel();
          break;
        case 'l':
          await this.cache.ui.toggleLassoSelection();
          break;
        case 'h':
          await this.cache.ui.toggleHoverEffect(document.getElementById('hoverToggleBtn'));
          break;
        case 'a':
          this.cache.assistant.togglePanel();
          break;
        case '?':
          this.cache.ui.toggleKeyboardSheet();
          break;
        default:
          break;
      }
    });

    hotkeysRegistered = true;
  }

  registerGlobalEventListeners() {
    // All targets (document, queryTextArea, innerGraphContainer, bottomBar)
    // are static DOM that survives file loads — same stacking hazard as hotkeys.
    if (globalEventsRegistered) return;

    ['input', 'keydown', 'keyup', 'mousedown', 'mouseup', 'focus', 'blur', 'scroll'].forEach(
      (evt) => this.cache.query.text.addEventListener(evt, () => this.cache.qm.moveCaret())
    );

    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection();
      if (sel.rangeCount && this.cache.query.text.contains(sel.getRangeAt(0).startContainer)) {
        this.cache.qm.moveCaret();
      }
    });

    this.cache.ui.makeBottomBarResizable();
    this.registerTooltipWheelHandler();
    this.registerTooltipExpandToggle();
    globalEventsRegistered = true;
  }

  registerTooltipExpandToggle() {
    window.toggleTooltipExpand = function (button) {
      const tooltip = button.closest('.tooltip');
      if (!tooltip) return;

      const isExpanded = tooltip.classList.contains('expanded');

      if (isExpanded) {
        tooltip.classList.remove('expanded');
        button.textContent = '⛶';
        button.title = 'Expand to fit content';
      } else {
        tooltip.classList.add('expanded');
        button.textContent = '⤡';
        button.title = 'Restore size';
      }
    };

    window.closeTooltip = function (button) {
      const tooltip = button.closest('.tooltip');
      if (!tooltip) return;
      tooltip.style.visibility = 'hidden';
    };
  }

  registerTooltipWheelHandler() {
    const graphContainer = document.getElementById('innerGraphContainer');
    if (!graphContainer) return;

    graphContainer.addEventListener(
      'wheel',
      (event) => {
        const target = event.target;
        const tooltip = target.closest('.tooltip');

        if (tooltip) {
          event.stopPropagation();
        }
      },
      { passive: false, capture: true }
    );

    this.makeTooltipDraggable(graphContainer);
  }

  makeTooltipDraggable(graphContainer) {
    let isDragging = false;
    let currentTooltip = null;
    let offsetX = 0;
    let offsetY = 0;

    const stopEvent = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    graphContainer.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.tooltip-expand-btn') || e.target.closest('.tooltip-close-btn')) return;

      const header = e.target.closest('.tooltip-header');
      if (!header) return;

      const tooltip = header.closest('.tooltip');
      if (!tooltip) return;

      isDragging = true;
      currentTooltip = tooltip;

      const tooltipRect = tooltip.getBoundingClientRect();
      const parentRect = graphContainer.getBoundingClientRect();
      offsetX = e.clientX - tooltipRect.left + parentRect.left;
      offsetY = e.clientY - tooltipRect.top + parentRect.top;

      header.style.cursor = 'grabbing';
      stopEvent(e);
    });

    document.addEventListener('pointermove', (e) => {
      if (!isDragging || !currentTooltip) return;

      currentTooltip.style.left = `${e.clientX - offsetX}px`;
      currentTooltip.style.top = `${e.clientY - offsetY}px`;
      stopEvent(e);
    });

    document.addEventListener('pointerup', (e) => {
      if (!isDragging) return;

      if (currentTooltip) {
        const header = currentTooltip.querySelector('.tooltip-header');
        if (header) header.style.cursor = 'move';
      }
      isDragging = false;
      currentTooltip = null;
      stopEvent(e);

      window.addEventListener('click', stopEvent, {
        capture: true,
        once: true,
      });
    });
  }

  async registerPluginStates() {
    this.cache.ui.debug('Registering bubble set plugin instances ..');
    for (const group of this.cache.bs.traverseBubbleSets()) {
      this.cache.INSTANCES.BUBBLE_GROUPS[group] = await this.cache.graph.getPluginInstance(
        `bubbleSetPlugin-${group}`
      );
    }
  }
}

export { GraphCoreManager };
