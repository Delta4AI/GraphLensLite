import {Popup} from "../utilities/popup.js";
import {applyNoverlap} from "./layout_algorithms.js";

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

  async changeLayout() {
    this.cache.data.selectedLayout = document.getElementById('selectView').value;
    await this.cache.ui.showLoading("Switching Workspace", this.cache.data.selectedLayout);
    // Pin the overlay up across the whole switch so the inner render's
    // #postRefresh hideLoading() can't drop it before bubble-sync and
    // hide-disconnected finish. Released right before the position tween (which
    // is meant to animate with the overlay clear) and again in finally.
    this.cache.ui.holdLoading();
    await new Promise(resolve => requestAnimationFrame(resolve));

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
      if (currentLayout["query"]) {
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
      this.cache.bs.updateManualGroupStatus();
      this.cache.bs.updateManualGroupButtonState();
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

      this.cache.ui.info(`Switched to workspace: ${this.cache.data.selectedLayout}`);
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

      nodeUpdates.push({id: nodeID, type: newType, style: newStyle});

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

      edgeUpdates.push({id: edgeID, type: newType, style: newStyle});

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
      this.cache.ui.info("Creating workspace canceled");
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
          style: structuredClone(node.style)
        });
      }

      const edgeStyles = new Map();
      for (const [edgeID, edge] of this.cache.edgeRef.entries()) {
        edgeStyles.set(edgeID, {
          type: edge.type,
          style: structuredClone(edge.style)
        });
      }

      this.cache.data.layouts[result.name] = {
        internals: null,
        layoutType: currentLayout.layoutType,  // inherit origin type for re-layout default
        positions: structuredClone(currentLayout.positions),
        filters: structuredClone(currentLayout.filters),
        isCustom: true,
        hideDisconnectedNodes: currentLayout.hideDisconnectedNodes || false,
        // Capture complete current visual state
        nodeStyles: nodeStyles,
        edgeStyles: edgeStyles,
        bubbleSetStyle: structuredClone(currentLayout.bubbleSetStyle),
      };

      // Copy query if it exists
      if (currentLayout["query"]) {
        this.cache.data.layouts[result.name]["query"] = currentLayout["query"];
      }

      // Copy bubble group props and manual members
      for (let group of this.cache.bs.traverseBubbleSets()) {
        this.cache.data.layouts[result.name][`${group}Props`] = structuredClone(currentLayout[`${group}Props`]);
        this.cache.data.layouts[result.name][`${group}ManualMembers`] = structuredClone(currentLayout[`${group}ManualMembers`] || new Set());
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
            `blocked until it finishes. Continue?`,
        );
        if (!proceed) {
          this.cache.ui.info("Creating workspace canceled");
          return;
        }
      }

      // Create the layout structure first
      this.cache.data.layouts[result.name] = {
        internals: null,
        layoutType: result.templateType,  // remember origin type for re-layout default
        positions: new Map(),  // Will be filled after layout
        filters: structuredClone(this.cache.data.filterDefaults),  // Reset to defaults
        isCustom: true,  // All layouts are custom (position-based)
        query: undefined,  // No query
        hideDisconnectedNodes: false,
        // Start with default styles
        nodeStyles: new Map(),
        edgeStyles: new Map(),
        bubbleSetStyle: structuredClone(this.cache.DEFAULTS.BUBBLE_GROUP_STYLE),
      };

      // Initialize empty bubble group props (no groups selected)
      for (let group of this.cache.bs.traverseBubbleSets()) {
        this.cache.data.layouts[result.name][`${group}Props`] = new Set();
        this.cache.data.layouts[result.name][`${group}ManualMembers`] = new Set();
      }

      // Switch to the new layout
      this.cache.uiComponents.buildDropdownOptions();
      document.getElementById('selectView').value = result.name;
      this.cache.data.selectedLayout = result.name;

      await this.cache.ui.showLoading("Creating Workspace", `Applying ${result.templateType} layout`);
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
        await this.cache.graph.setLayout({type: result.templateType, ...this.cache.DEFAULTS.LAYOUT_INTERNALS[result.templateType]});
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
        this.cache.bs.updateManualGroupStatus();
        this.cache.bs.updateManualGroupButtonState();
        this.cache.bs.refreshBubbleStyleElements();

        // Graph mutations done — drop the overlay so the tween animates clear.
        this.cache.ui.releaseLoading();
        await this.cache.ui.hideLoading();

        // Tween the new layout in from the outgoing positions, once the overlay
        // has cleared (no-op when there was nothing on screen to animate from).
        if (animateNewWorkspace) {
          await this.cache.graph.runLayoutTransition(this.cache.data.layouts[result.name].positions);
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

  async removeSelectedLayout() {
    // Protect the "Default" layout from deletion
    if (this.cache.data.selectedLayout === "Default") {
      this.cache.ui.error("Cannot delete the Default workspace.");
      return;
    }

    const confirmed = await Popup.confirm(`Are you sure you want to delete view "${this.cache.data.selectedLayout}"?`);
    if (!confirmed) return false;

    delete this.cache.data.layouts[this.cache.data.selectedLayout];
    this.cache.uiComponents.buildDropdownOptions();

    // Switch back to Default layout after deletion
    document.getElementById('selectView').value = "Default";
    await this.changeLayout();
  }

  async getPos() {
    const zoom = await this.cache.graph.getZoom();
    const pos = await this.cache.graph.getPosition();
    console.log(`Zoom: ${zoom}`);
    console.log(`Position: ${pos}`);
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

    async function arrangeNodesInCircle(radius) {
      const numNodes = cache.selectedNodes.length;
      let angleStep = (2 * Math.PI) / numNodes;

      let i = 0;
      for (const node of await cache.sm.getSelectedNodes()) {
        const angle = i * angleStep;
        node.style.x = origAvgX + radius * Math.cos(angle);
        node.style.y = origAvgY + radius * Math.sin(angle);
        i++;
      }
    }

    async function applyForceLayout(iterations) {
      // -----------------------------
      // Updated parameters
      // -----------------------------
      const INITIAL_TEMPERATURE = 2.0;     // Starting "temperature" for the cooling factor
      const COOLING_FACTOR = 0.98;    // Slower cooling to allow more spreading
      const GRAVITY_STRENGTH = 0.00001; // Reduced gravity so nodes aren't pulled too close
      const MAX_DISPLACEMENT = 50;      // Higher limit on movement per iteration or remove if needed

      const REPULSION = 20000;        // Strong repulsion to push nodes apart
      const SPRING_LENGTH = 300;         // Ideal distance between connected nodes
      const SPRING_STRENGTH = 0.005;        // Reduced tension to allow more space

      // -----------------------------
      // Larger initial placement range
      // -----------------------------
      const nodes = await cache.sm.getSelectedNodes();
      for (const node of nodes) {
        node.style.x = Math.random() * 1000 - 500;  // Range: [-500, 500]
        node.style.y = Math.random() * 1000 - 500;  // Range: [-500, 500]
      }

      // -----------------------------
      // Main iteration
      // -----------------------------
      let temperature = INITIAL_TEMPERATURE;
      for (let i = 0; i < iterations; i++) {
        // 1) Repulsion between every pair of nodes
        for (let a = 0; a < nodes.length; a++) {
          for (let b = a + 1; b < nodes.length; b++) {
            const dx = nodes[b].style.x - nodes[a].style.x;
            const dy = nodes[b].style.y - nodes[a].style.y;
            const dist = Math.sqrt(dx * dx + dy * dy) + 0.01; // Avoid dividing by zero

            const force = REPULSION / (dist * dist); // 1 / distance^2
            const fx = force * (dx / dist);
            const fy = force * (dy / dist);

            // Apply forces (scaled by temperature)
            nodes[a].style.x -= fx * temperature;
            nodes[a].style.y -= fy * temperature;
            nodes[b].style.x += fx * temperature;
            nodes[b].style.y += fy * temperature;
          }
        }

        // 2) Spring forces (edges)
        for (const edge of await cache.graph.getEdgeData()) {
          const {source, target} = edge;
          if (cache.selectedNodes.includes(source) && cache.selectedNodes.includes(target)) {
            const nodeA = nodes.find((n) => n.id === source);
            const nodeB = nodes.find((n) => n.id === target);
            if (nodeA && nodeB) {
              const dx = nodeB.style.x - nodeA.style.x;
              const dy = nodeB.style.y - nodeA.style.y;
              const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;

              // (currentDistance - idealDistance)
              const force = (dist - SPRING_LENGTH) * SPRING_STRENGTH;
              const fx = force * (dx / dist);
              const fy = force * (dy / dist);

              // Apply (scaled by temperature)
              nodeA.style.x += fx * temperature;
              nodeA.style.y += fy * temperature;
              nodeB.style.x -= fx * temperature;
              nodeB.style.y -= fy * temperature;
            }
          }
        }

        // 3) Gravity / Centering
        // With reduced gravity, nodes won't cluster too tightly
        for (const node of nodes) {
          node.style.x += -node.style.x * GRAVITY_STRENGTH * temperature;
          node.style.y += -node.style.y * GRAVITY_STRENGTH * temperature;
        }

        // 4) Limit maximum displacement (optional)
        // Increase or remove if you don't want clamping
        for (const node of nodes) {
          const dist = Math.sqrt(node.style.x * node.style.x + node.style.y * node.style.y);
          if (dist > MAX_DISPLACEMENT) {
            const ratio = MAX_DISPLACEMENT / dist;
            node.style.x *= ratio;
            node.style.y *= ratio;
          }
        }

        // 5) Cool down temperature for next iteration
        temperature *= COOLING_FACTOR;
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

    async function applyRandomLayout() {
      const nodes = await cache.sm.getSelectedNodes();
      if (nodes.length < 2) return;

      // ALWAYS use the fixed original bounding‐box:
      const centerX = origCenterX;
      const centerY = origCenterY;
      const width = origWidth;
      const height = origHeight;

      // If you really want rotation (see note below), be aware a rotated
      // rectangle has a larger AABB—but we’re not recomputing the AABB,
      // so the outer box stays fixed at origWidth × origHeight.
      const angle = Math.random() * 2 * Math.PI;

      // Pick two anchors to go to two opposite corners of the ROTATED rectangle
      // (but the *axis‐aligned* bounding-box of that rotated rectangle is still
      // held “virtually” at origWidth×origHeight; we do not “re‐read” min/max from it).
      const [anchor1, anchor2] = getRandomElements(nodes, 2);

      // Rotate those two anchors to the “corners” of a width×height box at random angle:
      // corner1 ( +width/2, +height/2 ) after rotation; corner2 ( -width/2, -height/2 ).
      anchor1.style.x = centerX + (width / 2) * Math.cos(angle) - (height / 2) * Math.sin(angle);
      anchor1.style.y = centerY + (width / 2) * Math.sin(angle) + (height / 2) * Math.cos(angle);

      anchor2.style.x = centerX - (width / 2) * Math.cos(angle) + (height / 2) * Math.sin(angle);
      anchor2.style.y = centerY - (width / 2) * Math.sin(angle) - (height / 2) * Math.cos(angle);

      // Now scatter the rest uniformly inside that same rotated box:
      for (const node of nodes) {
        if (node === anchor1 || node === anchor2) continue;

        // pick a random (u,v) in [–0.5..+0.5] × [–0.5..+0.5]
        const u = Math.random() - 0.5;
        const v = Math.random() - 0.5;

        // scale to [–width/2..+width/2], [–height/2..+height/2]
        const dx = u * width;
        const dy = v * height;

        // rotate (dx,dy) around origin by “angle”
        node.style.x = centerX + dx * Math.cos(angle) - dy * Math.sin(angle);
        node.style.y = centerY + dx * Math.sin(angle) + dy * Math.cos(angle);
      }
    }

    function getRandomElements(array, n) {
      const shuffled = [...array];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled.slice(0, n);
    }

    const sel = await cache.sm.getSelectedNodes();
    if (sel.length == 0) return;

    const coords = sel.map(n => ({x: n.style.x, y: n.style.y}));

    const origAvgX = coords.reduce((sum, pos) => sum + pos.x, 0) / coords.length;
    const origAvgY = coords.reduce((sum, pos) => sum + pos.y, 0) / coords.length;
    const origMinX = Math.min(...coords.map((pos) => pos.x));
    const origMaxX = Math.max(...coords.map((pos) => pos.x));
    const origMinY = Math.min(...coords.map((pos) => pos.y));
    const origMaxY = Math.max(...coords.map((pos) => pos.y));

    const origCenterX = (origMinX + origMaxX) / 2;
    const origCenterY = (origMinY + origMaxY) / 2;
    const origWidth = origMaxX - origMinX;
    const origHeight = origMaxY - origMinY;


    const eventLabels = {
      "shrink": "Shrink selected nodes toward their center",
      "expand": "Expand selected nodes outward from their center",
      "circle": "Arrange selected nodes evenly in a circular layout",
      "force": "Apply a force-directed layout to selected nodes",
      "grid": "Align selected nodes in a uniform grid layout",
      "random": "Distribute selected nodes randomly while preserving the original layout bounds"
    };

    const layoutActions = {
      "shrink": () => groupOrSpreadSelectedNodes(0.5),
      "expand": () => groupOrSpreadSelectedNodes(2),
      "circle": () => arrangeNodesInCircle(100),
      "force": () => applyForceLayout(150),
      "grid": () => applyGridLayout(),
      "random": () => applyRandomLayout(),
    }

    await layoutActions[action]();
    await this.persistNodePositions();

    // Push new positions to G6 — without this, mutated node.style.x/y on cached
    // refs don't reach the graph's internal data store, so the layout only
    // becomes visible once the selection state changes and forces a re-read.
    const movedNodes = await cache.sm.getSelectedNodes();
    if (movedNodes.length > 0) {
      await this.cache.graph.updateNodeData(
        movedNodes.map(n => ({id: n.id, style: {x: n.style.x, y: n.style.y}}))
      );
    }

    await this.handleLayoutChangeLoadingEvent(action, eventLabels[action]);
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
    await this.handleLayoutChangeLoadingEvent("Remove overlaps",
      "Spread overlapping nodes apart minimally");
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
   * instead of creating a new one. Defaults the picker to the workspace's
   * original layout type so it doubles as "redo the layout I started with".
   */
  async relayoutWorkspace() {
    const currentName = this.cache.data.selectedLayout;
    const currentLayout = this.cache.data.layouts[currentName];
    if (!currentLayout) return;

    const nodeCount = this.cache.graphData?.order ?? this.cache.nodeRef.size;
    const result = await Popup.layoutSelectDialog(this.cache.DEFAULTS.LAYOUT_INTERNALS, {
      defaultType: currentLayout.layoutType || this.cache.DEFAULTS.LAYOUT,
      hasPositions: currentLayout.positions?.size > 0,
      nodeCount,
      expensiveLayouts: this.cache.DEFAULTS.EXPENSIVE_LAYOUTS,
      warningThreshold: this.cache.DEFAULTS.LAYOUT_NODE_WARNING_THRESHOLD,
    });
    if (!result) {
      this.cache.ui.info("Re-layout canceled");
      return;
    }

    const layoutType = result.templateType;

    await this.cache.ui.showLoading("Re-layouting Workspace", `Applying ${layoutType} layout`);
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
        fromPositions.set(id, {x: attrs.x, y: attrs.y});
      }
    });

    try {
      await this.cache.graph.setLayout({type: layoutType, ...this.cache.DEFAULTS.LAYOUT_INTERNALS[layoutType]});
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
            this.cache.graphData.mergeNodeAttributes(id, {x: p.x, y: p.y});
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
          y: node.style.y
        }
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
    this.cache.ui.debug("PERSISTING NODE POSITIONS ..");
    for (const node of await this.cache.graph.getNodeData()) {
      this.cache.data.layouts[this.cache.data.selectedLayout].positions.set(node.id, {style: {x: node.style.x, y: node.style.y}});
    }
  }

  createDefaultLayout(key, overridePositionsFromExcel = false) {
    const defLayout = {
      layoutType: key,  // Store layout algorithm type for initial render only
      internals: null,
      positions: new Map(),
      filters: structuredClone(this.cache.data.filterDefaults),
      isCustom: true,  // All layouts are position-based
      query: undefined,
      hideDisconnectedNodes: false,
      // Per-view styles
      nodeStyles: new Map(),
      edgeStyles: new Map(),
      bubbleSetStyle: structuredClone(this.cache.DEFAULTS.BUBBLE_GROUP_STYLE),
    };

    if (overridePositionsFromExcel) {
      // applies given coordinates from Excel template; remaining positions will be force layouted
      for (const [nodeID, positions] of this.cache.nodePositionsFromExcelImport) {
        defLayout.positions.set(nodeID, {style: {x: positions.x, y: positions.y}});
      }
      defLayout.layoutType = this.cache.DEFAULTS.LAYOUT;
    }

    for (let group of this.cache.bs.traverseBubbleSets()) {
      defLayout[`${group}Props`] = new Set();
    }

    return defLayout;
  }

  async nodePositionsAreInSync() {
    for (const node of await this.cache.graph.getNodeData()) {
      const existing = this.cache.data.layouts[this.cache.data.selectedLayout].positions?.get(node.id);
      if (!existing) continue;
      if (node.style.x !== existing.style.x || node.style.y !== existing.style.y) {
        return false;
      }
    }
    return true;
  }
}

export {GraphLayoutManager}