import { Popup } from '../utilities/popup.js';
import { applyNoverlap, layoutSelectionSubgraph } from './layout_algorithms.js';

class GraphLayoutManager {
  constructor(cache) {
    this.cache = cache;
  }

  async handleLayoutChangeLoadingEvent(header, text) {
    await this.cache.ui.showLoading(header, text);
    this.cache.layoutChanged = true;
    await this.cache.gcm.decideToRenderOrDraw();
    this.cache.ui.debug(`Graph updated after layout event with message ${header} ${text}`);
  }

  /**
   * Apply the selected workspace's stored state to the screen. `message`
   * overrides the closing status line — undo/redo re-use this path and say what
   * they restored rather than claiming a workspace switch.
   */
  async changeLayout(message = null) {
    this.cache.data.selectedLayout = document.getElementById('selectView').value;
    await this.cache.ui.showLoading('Switching Workspace', this.cache.data.selectedLayout);
    // Pin the overlay up across the whole switch so the inner render's
    // #postRefresh hideLoading() can't drop it before bubble-sync and
    // hide-disconnected finish. Released right before the position tween (which
    // is meant to animate with the overlay clear) and again in finally.
    this.cache.ui.holdLoading();
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const currentLayout = this.cache.data.layouts[this.cache.data.selectedLayout];

    // Animate node positions from the outgoing workspace to this one when it
    // carries persisted positions. The adapter leaves positions in place
    // through the render (pendingLayoutTransition) and tweens them once the
    // loading overlay clears (runLayoutTransition, last step below). A
    // position-less view (fresh template) has nothing to tween from/to and
    // takes the normal snap path.
    const animatePositions = currentLayout.positions?.size > 0;
    this.cache.graph.pendingLayoutTransition = animatePositions;

    // finally: never leave pendingLayoutTransition stuck on. If any step below
    // throws before runLayoutTransition consumes it, every later render would
    // otherwise skip #applyPersistedPositions and freeze nodes at the outgoing
    // workspace for the adapter's lifetime.
    try {
      // Apply per-view node and edge styles (positions held at the outgoing
      // view's when animating, so the tween starts from what's on screen).
      await this.applyLayoutStyles(currentLayout, animatePositions);

      // All layouts are now position-based, no need to re-apply layout algorithms
      this.cache.ui.buildFilterUI();

      // Update filter lock state based on whether this layout has a custom query
      this.cache.qm.updateQueryTextArea();
      if (currentLayout['query']) {
        this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY = true;
      } else {
        this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY = false;
      }
      this.cache.ui.updateFilterLockState();
      this.cache.ui.clearActivePropsCacheOnLayoutChange();

      await this.cache.metrics.updateMetricUI();

      this.cache.EVENT_LOCKS.ONCE_AFTER_RENDER_COMPLETED = false;

      await this.cache.gcm.decideToRenderOrDraw(true);

      // Restore hide disconnected nodes state for this workspace
      await this.cache.gcm.applyHideDisconnectedState();

      // Force bubble group sync - recalculate which nodes should be in groups for this view
      this.cache.bubbleSetChanged = true;
      await this.cache.bs.updateBubbleSetIfChanged();

      // Update manual bubble group status after layout change
      this.cache.bs.renderGroupList();
      this.cache.bs.refreshBubbleStyleElements();

      // Everything that mutates the graph is done — drop the overlay now so the
      // position tween below animates with it clear (its design intent).
      this.cache.ui.releaseLoading();
      await this.cache.ui.hideLoading();

      // Last: tween node positions from the outgoing view to this one (no-op
      // when there was nothing to animate; consumes pendingLayoutTransition).
      if (animatePositions) {
        await this.cache.graph.runLayoutTransition(currentLayout.positions);
      }

      this.cache.ui.info(message ?? `Switched to workspace: ${this.cache.data.selectedLayout}`);
      // Snapshots describe one workspace's state; a real switch invalidates
      // them. A restore drives this same path and re-baselines itself.
      if (!message) this.cache.history?.reset();
    } finally {
      // Defensive: if a step above threw before the release, drop the hold and
      // the overlay here so a failed switch never strands a blocked UI.
      this.cache.ui.releaseLoading();
      await this.cache.ui.hideLoading();
      if (this.cache.graph) this.cache.graph.pendingLayoutTransition = false;
    }
  }

  async applyLayoutStyles(layout, animatePositions = false) {
    // Apply per-view node styles - reset ALL nodes, not just styled ones
    const nodeUpdates = [];
    for (const [nodeID, node] of this.cache.nodeRef.entries()) {
      let newStyle;
      let newType = node.type;

      if (layout.nodeStyles && layout.nodeStyles.has(nodeID)) {
        // Apply view-specific style and type
        const layoutData = layout.nodeStyles.get(nodeID);
        if (layoutData.style) {
          newStyle = structuredClone(layoutData.style);
        } else {
          // Old format compatibility: layoutData is the style directly
          newStyle = structuredClone(layoutData);
        }
        if (layoutData.type !== undefined) {
          newType = layoutData.type;
        }
      } else {
        // Reset to original default style and type
        newStyle = structuredClone(node.originalStyle);
        newType = node.originalType || node.type;
      }

      // Apply positions from the layout's position map (positions are stored
      // separately). While animating a workspace switch, keep each node at its
      // current (outgoing) position so the tween starts from what's on screen;
      // runLayoutTransition moves it to the target afterwards.
      if (animatePositions) {
        newStyle.x = node.style.x;
        newStyle.y = node.style.y;
      } else {
        const position = layout.positions.get(nodeID);
        if (position && position.style) {
          newStyle.x = position.style.x;
          newStyle.y = position.style.y;
        }
      }

      nodeUpdates.push({ id: nodeID, type: newType, style: newStyle });

      // Update the nodeRef cache to keep it in sync
      node.type = newType;
      node.style = newStyle;
      this.cache.nodeRef.set(nodeID, node);
    }
    if (nodeUpdates.length > 0) {
      await this.cache.graph.updateNodeData(nodeUpdates);
    }

    // Apply per-view edge styles - reset ALL edges, not just styled ones
    const edgeUpdates = [];
    for (const [edgeID, edge] of this.cache.edgeRef.entries()) {
      let newStyle;
      let newType = edge.type;

      if (layout.edgeStyles && layout.edgeStyles.has(edgeID)) {
        // Apply view-specific style and type
        const layoutData = layout.edgeStyles.get(edgeID);
        if (layoutData.style) {
          newStyle = structuredClone(layoutData.style);
        } else {
          // Old format compatibility: layoutData is the style directly
          newStyle = structuredClone(layoutData);
        }
        if (layoutData.type !== undefined) {
          newType = layoutData.type;
        }
      } else {
        // Reset to original default style and type
        newStyle = structuredClone(edge.originalStyle);
        newType = edge.originalType || edge.type;
      }

      edgeUpdates.push({ id: edgeID, type: newType, style: newStyle });

      // Update the edgeRef cache to keep it in sync
      edge.type = newType;
      edge.style = newStyle;
      this.cache.edgeRef.set(edgeID, edge);
    }
    if (edgeUpdates.length > 0) {
      await this.cache.graph.updateEdgeData(edgeUpdates);
    }

    // Bubble set styles are automatically used since all references now use the current layout
  }

  async addLayout() {
    // Show dialog with clone vs template options
    const result = await Popup.layoutCreationDialog(this.cache.DEFAULTS.LAYOUT_INTERNALS);
    if (!result) {
      this.cache.ui.info('Creating workspace canceled');
      return;
    }

    // Check if name already exists
    let existing = Object.keys(this.cache.data.layouts);
    if (existing.includes(result.name)) {
      this.cache.ui.error(`Workspace with name "${result.name}" already exists.`);
      return;
    }

    const currentLayout = this.cache.data.layouts[this.cache.data.selectedLayout];

    if (result.mode === 'clone') {
      // Clone current view - copy everything including CURRENT visual state
      // Capture ALL node and edge styles and types as they currently appear
      const nodeStyles = new Map();
      for (const [nodeID, node] of this.cache.nodeRef.entries()) {
        nodeStyles.set(nodeID, {
          type: node.type,
          style: structuredClone(node.style),
        });
      }

      const edgeStyles = new Map();
      for (const [edgeID, edge] of this.cache.edgeRef.entries()) {
        edgeStyles.set(edgeID, {
          type: edge.type,
          style: structuredClone(edge.style),
        });
      }

      this.cache.data.layouts[result.name] = {
        internals: null,
        layoutType: currentLayout.layoutType, // inherit origin type for re-layout default
        positions: structuredClone(currentLayout.positions),
        filters: structuredClone(currentLayout.filters),
        isCustom: true,
        hideDisconnectedNodes: currentLayout.hideDisconnectedNodes || false,
        // Capture complete current visual state
        nodeStyles: nodeStyles,
        edgeStyles: edgeStyles,
        bubbleSetStyle: structuredClone(currentLayout.bubbleSetStyle),
        annotations: structuredClone(currentLayout.annotations ?? []),
      };

      // Copy query if it exists
      if (currentLayout['query']) {
        this.cache.data.layouts[result.name]['query'] = currentLayout['query'];
      }

      // Copy bubble group props and manual members. The group list comes from
      // the SOURCE layout's own bubbleSetStyle, not from traverseBubbleSets():
      // that reads the selected layout, which is only the source by accident of
      // ordering here and would silently copy the wrong set of groups if this
      // ever moved after the switch.
      for (let group of Object.keys(currentLayout.bubbleSetStyle ?? {})) {
        this.cache.data.layouts[result.name][`${group}Props`] = structuredClone(
          currentLayout[`${group}Props`] || new Set()
        );
        this.cache.data.layouts[result.name][`${group}ManualMembers`] = structuredClone(
          currentLayout[`${group}ManualMembers`] || new Set()
        );
      }

      this.cache.ui.info(`Cloned view: ${result.name}`);

      // Switch to the new layout
      this.cache.uiComponents.buildDropdownOptions();
      document.getElementById('selectView').value = result.name;

      // The changeLayout call will handle:
      // - Applying styles and positions
      // - Syncing bubble groups via updateBubbleSetIfChanged
      // - Refreshing all UI elements
      await this.cache.lm.changeLayout();
    } else {
      // Warn before kicking off a super-linear layout (dagre/mds) on a large
      // graph: even off the main thread it can run for minutes, and the overlay
      // blocks the UI for the whole time. Bail out cleanly if the user declines,
      // before any workspace state is created.
      const nodeCount = this.cache.graphData?.order ?? this.cache.nodeRef.size;
      if (
        this.cache.DEFAULTS.EXPENSIVE_LAYOUTS.includes(result.templateType) &&
        nodeCount > this.cache.DEFAULTS.LAYOUT_NODE_WARNING_THRESHOLD
      ) {
        const proceed = await Popup.confirm(
          `The "${result.templateType}" layout is computationally intensive and may ` +
            `take several minutes on ${nodeCount.toLocaleString()} nodes. The UI stays ` +
            `blocked until it finishes. Continue?`
        );
        if (!proceed) {
          this.cache.ui.info('Creating workspace canceled');
          return;
        }
      }

      // Create the layout structure first
      this.cache.data.layouts[result.name] = {
        internals: null,
        layoutType: result.templateType, // remember origin type for re-layout default
        positions: new Map(), // Will be filled after layout
        filters: structuredClone(this.cache.data.filterDefaults), // Reset to defaults
        isCustom: true, // All layouts are custom (position-based)
        query: undefined, // No query
        hideDisconnectedNodes: false,
        // Start with default styles
        nodeStyles: new Map(),
        edgeStyles: new Map(),
        // A new workspace starts with NO groups. Four always-present empty
        // groups were the main reason the feature read as decoration; the
        // Groups panel now shows an empty state that says what a group is.
        bubbleSetStyle: {},
      };

      // Initialize empty bubble group props (no groups selected). Keyed off the
      // NEW layout's own bubbleSetStyle — traverseBubbleSets() would describe
      // the workspace being left behind.
      for (let group of Object.keys(
        this.cache.data.layouts[result.name].bubbleSetStyle ?? {}
      )) {
        this.cache.data.layouts[result.name][`${group}Props`] = new Set();
        this.cache.data.layouts[result.name][`${group}ManualMembers`] = new Set();
      }

      // Switch to the new layout
      this.cache.uiComponents.buildDropdownOptions();
      document.getElementById('selectView').value = result.name;
      this.cache.data.selectedLayout = result.name;

      await this.cache.ui.showLoading(
        'Creating Workspace',
        `Applying ${result.templateType} layout`
      );
      // Pin the overlay up across the whole creation so the inner render's
      // #postRefresh hideLoading() can't drop it while the layout (possibly an
      // expensive off-thread worker), bubble-sync and hide-disconnected are
      // still running. Released right before the position tween, and in finally.
      this.cache.ui.holdLoading();

      // Clear the filter lock since this is a fresh template with no query
      this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY = false;

      // Clear selection FIRST before doing anything else
      await this.cache.sm.toggleSelectionForAllNodes(false);
      await this.cache.sm.toggleSelectionForAllEdges(false);

      // Update UI to show the new layout's filters and query
      this.cache.ui.buildFilterUI();
      this.cache.qm.updateQueryTextArea();
      this.cache.ui.updateFilterLockState();
      this.cache.ui.clearActivePropsCacheOnLayoutChange();

      // Clear bubble groups completely
      await this.cache.bs.clearBubbleSetInstanceMembers();
      this.cache.lastBubbleSetMembers.clear();
      for (let group of this.cache.bs.traverseBubbleSets()) {
        this.cache.lastBubbleSetMembers.set(group, new Set());
      }

      // Process filters to determine which nodes should be visible
      await this.cache.gcm.preRenderEvent();

      // Snapshot the on-screen (outgoing-workspace) positions so the new
      // template layout animates IN from them instead of snapping — same
      // effect as switching between existing workspaces. graphData is y-up
      // graphology, which is exactly what runLayoutTransition tweens toward.
      const fromPositions = new Map();
      this.cache.graphData?.forEachNode((id, attrs) => {
        if (Number.isFinite(attrs.x) && Number.isFinite(attrs.y)) {
          fromPositions.set(id, { x: attrs.x, y: attrs.y });
        }
      });

      // setLayout/layout (possibly the off-thread worker), the full render
      // pipeline and the position tween all run under one try so any failure —
      // including the layout worker rejecting — releases the loading hold,
      // drops the overlay and clears pendingLayoutTransition.
      try {
        // Apply the layout algorithm once
        await this.cache.graph.setLayout({
          type: result.templateType,
          ...this.cache.DEFAULTS.LAYOUT_INTERNALS[result.templateType],
        });
        await this.cache.graph.layout();

        // Persist the positions so they're stored permanently
        await this.cache.lm.persistNodePositions();

        // Restore the outgoing positions and hand the move to the animated
        // transition: render paints them in place (pendingLayoutTransition skips
        // the snap), then runLayoutTransition tweens to the persisted target.
        const animateNewWorkspace = fromPositions.size > 0;
        if (animateNewWorkspace) {
          for (const [id, p] of fromPositions) {
            if (this.cache.graphData.hasNode(id)) {
              this.cache.graphData.mergeNodeAttributes(id, { x: p.x, y: p.y });
            }
          }
          this.cache.graph.pendingLayoutTransition = true;
        }

        // Render with the full pipeline
        this.cache.EVENT_LOCKS.ONCE_AFTER_RENDER_COMPLETED = false;
        await this.cache.gcm.decideToRenderOrDraw(true);

        // Reset hide disconnected state for new workspace
        await this.cache.gcm.applyHideDisconnectedState();

        // Ensure bubble groups are properly cleared and synced for this new view
        this.cache.bubbleSetChanged = true;
        await this.cache.bs.updateBubbleSetIfChanged();

        // Update metrics and bubble group status
        await this.cache.metrics.updateMetricUI();
        this.cache.bs.renderGroupList();
        this.cache.bs.refreshBubbleStyleElements();

        // Graph mutations done — drop the overlay so the tween animates clear.
        this.cache.ui.releaseLoading();
        await this.cache.ui.hideLoading();

        // Tween the new layout in from the outgoing positions, once the overlay
        // has cleared (no-op when there was nothing on screen to animate from).
        if (animateNewWorkspace) {
          await this.cache.graph.runLayoutTransition(
            this.cache.data.layouts[result.name].positions
          );
        }

        this.cache.ui.info(`Created Workspace: ${result.name} (${result.templateType})`);
      } finally {
        // Defensive: release the hold + drop the overlay on any failure so a
        // half-created workspace never strands a blocked UI; clear the tween flag.
        this.cache.ui.releaseLoading();
        await this.cache.ui.hideLoading();
        if (this.cache.graph) this.cache.graph.pendingLayoutTransition = false;
      }
    }
  }

  /** Rename the current workspace (the Default workspace keeps its name). */
  async renameSelectedLayout() {
    const current = this.cache.data.selectedLayout;
    if (current === 'Default') {
      this.cache.ui.error('Cannot rename the Default workspace.');
      return;
    }

    const name = await Popup.prompt(`Rename workspace "${current}" to:`);
    if (!name || name === current) return;
    if (Object.keys(this.cache.data.layouts).includes(name)) {
      this.cache.ui.error(`Workspace with name "${name}" already exists.`);
      return;
    }

    this.cache.data.layouts[name] = this.cache.data.layouts[current];
    delete this.cache.data.layouts[current];
    this.cache.data.selectedLayout = name;
    this.cache.uiComponents.buildDropdownOptions();
    this.cache.rail?.refresh();
    this.cache.ui.info(`Renamed workspace "${current}" to "${name}"`);
  }

  async removeSelectedLayout() {
    // Protect the "Default" layout from deletion
    if (this.cache.data.selectedLayout === 'Default') {
      this.cache.ui.error('Cannot delete the Default workspace.');
      return;
    }

    const confirmed = await Popup.confirm(
      `Are you sure you want to delete view "${this.cache.data.selectedLayout}"?`
    );
    if (!confirmed) return false;

    delete this.cache.data.layouts[this.cache.data.selectedLayout];
    this.cache.uiComponents.buildDropdownOptions();

    // Switch back to Default layout after deletion
    document.getElementById('selectView').value = 'Default';
    await this.changeLayout();
  }

  async layoutSelectedNodes(action) {
    const cache = this.cache;
    if (cache.selectedNodes.length === 0) return;

    async function groupOrSpreadSelectedNodes(scale) {
      for (const node of await cache.sm.getSelectedNodes()) {
        const oldX = node.style.x;
        const oldY = node.style.y;

        node.style.x = origAvgX + (oldX - origAvgX) * scale;
        node.style.y = origAvgY + (oldY - origAvgY) * scale;
      }
    }

    // circle/force/random delegate to graphology layouts run on a throwaway
    // subgraph of the selection, then recentered on the selection's original
    // centroid. Replaces the former hand-rolled circle/physics/scatter geometry.
    async function applySubgraphLayout(type) {
      const nodes = await cache.sm.getSelectedNodes();
      if (nodes.length === 0) return;

      const selectedIds = new Set(nodes.map((n) => n.id));
      const edges = (await cache.graph.getEdgeData())
        .filter((e) => selectedIds.has(e.source) && selectedIds.has(e.target))
        .map((e) => ({ source: e.source, target: e.target }));

      const positions = layoutSelectionSubgraph(
        nodes.map((n) => ({ id: n.id, x: n.style.x, y: n.style.y, size: n.style.size })),
        edges,
        type,
        { x: origAvgX, y: origAvgY }
      );

      for (const node of nodes) {
        const pos = positions.get(node.id);
        if (pos) {
          node.style.x = pos.x;
          node.style.y = pos.y;
        }
      }
    }

    async function applyGridLayout() {
      const nodes = await cache.sm.getSelectedNodes();
      if (nodes.length === 0) return;

      const count = nodes.length;
      const columns = Math.ceil(Math.sqrt(count));
      const spacing = 100;

      const rows = Math.ceil(count / columns);
      const totalWidth = (columns - 1) * spacing;
      const totalHeight = (rows - 1) * spacing;

      let idx = 0;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
          if (idx >= count) break;
          const node = nodes[idx];
          node.style.x = origAvgX - totalWidth / 2 + col * spacing;
          node.style.y = origAvgY - totalHeight / 2 + row * spacing;
          idx++;
        }
      }
    }

    const sel = await cache.sm.getSelectedNodes();
    if (sel.length == 0) return;

    const coords = sel.map((n) => ({ x: n.style.x, y: n.style.y }));

    const origAvgX = coords.reduce((sum, pos) => sum + pos.x, 0) / coords.length;
    const origAvgY = coords.reduce((sum, pos) => sum + pos.y, 0) / coords.length;

    const eventLabels = {
      shrink: 'Shrink selected nodes toward their center',
      expand: 'Expand selected nodes outward from their center',
      circle: 'Arrange selected nodes evenly in a circular layout',
      force: 'Apply a force-directed layout to selected nodes',
      grid: 'Align selected nodes in a uniform grid layout',
      random: 'Distribute selected nodes randomly around their center',
    };

    const layoutActions = {
      shrink: () => groupOrSpreadSelectedNodes(0.5),
      expand: () => groupOrSpreadSelectedNodes(2),
      circle: () => applySubgraphLayout('circular'),
      force: () => applySubgraphLayout('force'),
      grid: () => applyGridLayout(),
      random: () => applySubgraphLayout('random'),
    };

    await layoutActions[action]();

    // Push the freshly mutated positions to the graph BEFORE anything reads it
    // back. getNodeData() (used by persistNodePositions) re-syncs nodeRef.style
    // from graphology, so persisting first would clobber these positions with
    // the pre-layout ones — that bug made every Arrange button a silent no-op.
    // `sel` holds the same node refs the layout fns just mutated.
    if (sel.length > 0) {
      await this.cache.graph.updateNodeData(
        sel.map((n) => ({ id: n.id, style: { x: n.style.x, y: n.style.y } }))
      );
    }

    await this.persistNodePositions();
    await this.handleLayoutChangeLoadingEvent(action, eventLabels[action]);
    this.cache.history?.commit(`Arrange selection (${action})`);
  }

  /**
   * Minimally spread overlapping nodes apart (noverlap anti-collision pass)
   * across ALL nodes of the current workspace. Deliberately ignores the
   * selection: overlap removal is global by nature — separating a selected
   * subset would just push nodes into their unselected neighbours.
   *
   * Runs directly on the live graphology model (cache.graphData, the same
   * instance the sigma adapter renders); its attribute merges trigger the
   * sigma refresh, and persistNodePositions() reads the moved positions back
   * through the adapter facade (graph.getNodeData syncs nodeRef styles).
   */
  async removeNodeOverlaps() {
    const graph = this.cache.graphData;
    if (!graph || graph.order < 2) return;
    applyNoverlap(graph);
    await this.persistNodePositions();
    await this.handleLayoutChangeLoadingEvent(
      'Remove overlaps',
      'Spread overlapping nodes apart minimally'
    );
    this.cache.history?.commit('Remove overlaps');
  }

  /**
   * Re-run a layout algorithm across the ENTIRE current workspace, recomputing
   * every node's position. Unlike layoutSelectedNodes (selection-scoped) and
   * removeNodeOverlaps (noverlap-only), this discards the current arrangement
   * and lays the whole graph out afresh with a chosen algorithm.
   *
   * Styles, filters, query and bubble-group membership are untouched — only
   * positions change. Mirrors the template branch of addLayout (setLayout →
   * layout → persist → animated transition) but stays on the current workspace
   * instead of creating a new one. The algorithm comes from the rail's Layout
   * menu, which marks the workspace's current type.
   */
  async relayoutWorkspace(layoutType) {
    const currentName = this.cache.data.selectedLayout;
    const currentLayout = this.cache.data.layouts[currentName];
    if (!currentLayout || !layoutType) return;

    const nodeCount = this.cache.graphData?.order ?? this.cache.nodeRef.size;

    // Chosen from the rail's Layout menu — the expensive-layout guard mirrors
    // the addLayout template branch.
    if (
      this.cache.DEFAULTS.EXPENSIVE_LAYOUTS.includes(layoutType) &&
      nodeCount > this.cache.DEFAULTS.LAYOUT_NODE_WARNING_THRESHOLD
    ) {
      const proceed = await Popup.confirm(
        `The "${layoutType}" layout is computationally intensive and may ` +
          `take several minutes on ${nodeCount.toLocaleString()} nodes. The UI stays ` +
          `blocked until it finishes. Continue?`
      );
      if (!proceed) {
        this.cache.ui.info('Re-layout canceled');
        return;
      }
    }

    await this.cache.ui.showLoading('Re-layouting Workspace', `Applying ${layoutType} layout`);
    // Pin the overlay up across the whole re-layout so the inner render's
    // hideLoading() can't drop it while the layout (possibly an expensive
    // off-thread worker) and bubble-sync are still running. Released right
    // before the position tween, and again in finally.
    this.cache.ui.holdLoading();

    // Snapshot the on-screen positions so the new layout animates IN from them
    // instead of snapping (same approach as the addLayout template branch).
    const fromPositions = new Map();
    this.cache.graphData?.forEachNode((id, attrs) => {
      if (Number.isFinite(attrs.x) && Number.isFinite(attrs.y)) {
        fromPositions.set(id, { x: attrs.x, y: attrs.y });
      }
    });

    try {
      await this.cache.graph.setLayout({
        type: layoutType,
        ...this.cache.DEFAULTS.LAYOUT_INTERNALS[layoutType],
      });
      await this.cache.graph.layout();

      // Remember the chosen type so the next re-layout (and reload) defaults to it.
      currentLayout.layoutType = layoutType;

      // Persist the freshly computed positions as this workspace's positions.
      await this.persistNodePositions();

      // Restore the outgoing positions and hand the move to the animated
      // transition: render paints them in place (pendingLayoutTransition skips
      // the snap), then runLayoutTransition tweens to the persisted target.
      const animate = fromPositions.size > 0;
      if (animate) {
        for (const [id, p] of fromPositions) {
          if (this.cache.graphData.hasNode(id)) {
            this.cache.graphData.mergeNodeAttributes(id, { x: p.x, y: p.y });
          }
        }
        this.cache.graph.pendingLayoutTransition = true;
      }

      this.cache.EVENT_LOCKS.ONCE_AFTER_RENDER_COMPLETED = false;
      await this.cache.gcm.decideToRenderOrDraw(true);

      // Bubble outlines hug node positions — re-sync them to the new layout.
      this.cache.bubbleSetChanged = true;
      await this.cache.bs.updateBubbleSetIfChanged();
      this.cache.bs.refreshBubbleStyleElements();

      // Graph mutations done — drop the overlay so the tween animates clear.
      this.cache.ui.releaseLoading();
      await this.cache.ui.hideLoading();

      if (animate) {
        await this.cache.graph.runLayoutTransition(currentLayout.positions);
      }

      this.cache.ui.info(`Re-layouted workspace: ${currentName} (${layoutType})`);
      this.cache.history?.commit(`Re-layout (${layoutType})`);
    } finally {
      // Defensive: release the hold + drop the overlay on any failure so a
      // half-applied re-layout never strands a blocked UI; clear the tween flag.
      this.cache.ui.releaseLoading();
      await this.cache.ui.hideLoading();
      if (this.cache.graph) this.cache.graph.pendingLayoutTransition = false;
    }
  }

  async getPositions() {
    const posCopy = [];
    for (const node of await this.cache.graph.getNodeData()) {
      posCopy.push({
        id: node.id,
        style: {
          x: node.style.x,
          y: node.style.y,
        },
      });
    }
    return posCopy;
  }

  async debugPositions() {
    for (const node of await this.getPositions()) {
      this.cache.ui.debug(`${node.id} | ${node.style.x} | ${node.style.y}`);
    }
  }

  async persistNodePositions() {
    this.cache.ui.debug('PERSISTING NODE POSITIONS ..');
    for (const node of await this.cache.graph.getNodeData()) {
      this.cache.data.layouts[this.cache.data.selectedLayout].positions.set(node.id, {
        style: { x: node.style.x, y: node.style.y },
      });
    }
  }

  createDefaultLayout(key, overridePositionsFromExcel = false) {
    const defLayout = {
      layoutType: key, // Store layout algorithm type for initial render only
      internals: null,
      positions: new Map(),
      filters: structuredClone(this.cache.data.filterDefaults),
      isCustom: true, // All layouts are position-based
      query: undefined,
      // How active filters combine (see updateQueryTextArea) and whether AND
      // requires complete cases. Persisted per view via the workspace JSON.
      filterJoinMode: 'OR',
      filterStrict: false,
      hideDisconnectedNodes: false,
      // Per-view styles
      nodeStyles: new Map(),
      edgeStyles: new Map(),
      // A new workspace starts with NO groups. Four always-present empty
        // groups were the main reason the feature read as decoration; the
        // Groups panel now shows an empty state that says what a group is.
        bubbleSetStyle: {},
      annotations: [],
    };

    if (overridePositionsFromExcel) {
      // applies given coordinates from Excel template; remaining positions will be force layouted
      for (const [nodeID, positions] of this.cache.nodePositionsFromExcelImport) {
        defLayout.positions.set(nodeID, { style: { x: positions.x, y: positions.y } });
      }
      defLayout.layoutType = this.cache.DEFAULTS.LAYOUT;
    }

    // Keyed off this layout's own style map: createDefaultLayout can run before
    // any layout is selected, so traverseBubbleSets() has nothing to describe.
    for (let group of Object.keys(defLayout.bubbleSetStyle ?? {})) {
      defLayout[`${group}Props`] = new Set();
    }

    return defLayout;
  }

  async nodePositionsAreInSync() {
    for (const node of await this.cache.graph.getNodeData()) {
      const existing = this.cache.data.layouts[this.cache.data.selectedLayout].positions?.get(
        node.id
      );
      if (!existing) continue;
      if (node.style.x !== existing.style.x || node.style.y !== existing.style.y) {
        return false;
      }
    }
    return true;
  }
}

export { GraphLayoutManager };
