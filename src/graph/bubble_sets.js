import {StaticUtilities} from "../utilities/static.js";
import {detectCommunities as computeCommunityAssignments} from "./communities.js";

class GraphBubbleSetManager {
  constructor(cache) {
    this.cache = cache;
    // Louvain detection prefs (transient UI state, not persisted/exported).
    // weightProperty: undefined until first resolved (then a numeric edge
    // prop hash, or null for topology-only); resolution: Louvain γ.
    this.communityOptions = { weightProperty: undefined, resolution: 1 };
    this.communityPopover = null;
    this.redrawBubbleSets = debounce(async () => {
      if (!this.cache.EVENT_LOCKS.ONCE_AFTER_RENDER_COMPLETED) return;
      if (this.cache.EVENT_LOCKS.BUBBLE_GROUP_REDRAW_RUNNING) return;

      this.cache.EVENT_LOCKS.BUBBLE_GROUP_REDRAW_RUNNING = true;
      try {
        for (const group of this.traverseBubbleSets()) {
          const cachedMembers = this.cache.lastBubbleSetMembers.get(group);
          if (cachedMembers?.size > 0) {
            this.cache.ui.debug(`Redrawing bubble set ${group} with ${cachedMembers.size} members ..`);
            await this.updateBubbleSet(group, []);
            await this.updateBubbleSet(group, Array.from(cachedMembers));
          }
        }
      } finally {
        this.cache.EVENT_LOCKS.BUBBLE_GROUP_REDRAW_RUNNING = false;
      }
    }, 50);
  }

  * traverseBubbleSets() {
    for (let group of Object.keys(this.cache.DEFAULTS.BUBBLE_GROUP_STYLE)) {
      yield group;
    }
  }

  async updateBubbleSetStyle(property, value) {
    const remainder = property.split('Bubble Set ')[1];
    const parts = remainder.split(' ');
    const group = parts[0];
    const propertyLabel = parts.slice(1).join(' ');

    const bStyle = this.cache.data.layouts[this.cache.data.selectedLayout].bubbleSetStyle[group];

    switch (propertyLabel) {
      case "Fill Color":
        bStyle.fill = value;
        bStyle.labelBackgroundFill = value;
        break;
      case "Fill Opacity":
        bStyle.fillOpacity = value;
        break;
      case "Stroke Color":
        bStyle.stroke = value;
        break;
      case "Stroke Opacity":
        bStyle.strokeOpacity = value;
        break;
      case "Label":
        bStyle.label = value;
        break;
      case "Label Text":
        bStyle.labelText = value;
        break;
      case "Label Background Color":
        bStyle.labelBackgroundFill = value;
        break;
      case "Label Background":
        bStyle.labelBackground = value;
        break;
      case "Label Fill Color":
        bStyle.labelFill = value;
        break;
      case "Label Font Size":
        bStyle.labelFontSize = value;
        break;
      case "Label Close To Path":
        bStyle.labelCloseToPath = value;
        break;
      case "Label Auto Rotate":
        bStyle.labelAutoRotate = value;
        break;
      case "Label Offset X":
        bStyle.labelOffsetX = value;
        break;
      case "Label Offset Y":
        bStyle.labelOffsetY = value;
        break;
      case "Label Placement":
        bStyle.labelPlacement = value;
        break;
      default:
        break;
    }
    await this.cache.INSTANCES.BUBBLE_GROUPS[group].update({ ...bStyle });
    await this.cache.gcm.decideToRenderOrDraw(true);
    this.refreshBubbleStyleElements();
  }

  refreshBubbleStyleElements() {
    let anyGroupActive = false;
    for (const group of this.traverseBubbleSets()) {
      const currentLayout = this.cache.data.layouts[this.cache.data.selectedLayout];
      const bubbleStyle = currentLayout.bubbleSetStyle[group];

      // Calculate actual members for this group in the current layout
      let actualMembers = new Set();

      // Add members from filter-based properties
      const propsInGroup = currentLayout[`${group}Props`] || new Set();
      for (let prop of propsInGroup) {
        let nodeIDsToBeGrouped = this.cache.propIDsToNodeIDsToBeShown.get(prop) || [];
        for (let nodeID of nodeIDsToBeGrouped) {
          actualMembers.add(nodeID);
        }
      }

      // Add members from manual group selection
      const manualMembers = currentLayout[`${group}ManualMembers`] || new Set();
      for (let nodeID of manualMembers) {
        if (this.cache.nodeRef.has(nodeID)) {
          actualMembers.add(nodeID);
        }
      }

      const hasActiveMembers = actualMembers.size > 0;
      if (hasActiveMembers) anyGroupActive = true;
      const labelConfigShouldBeEnabled = bubbleStyle.label;

      // toggle entire cards based on bubble group members
      const card = document.getElementById(`bubbleSetStyleCard${group}`);
      hasActiveMembers ? card.classList.remove("disabled") : card.classList.add("disabled");

      // Update UI inputs to match current view's bubble style
      const labelInput = document.querySelector(`input[placeholder*="${group} label text"]`);
      if (labelInput && bubbleStyle.labelText !== undefined) {
        labelInput.value = bubbleStyle.labelText;
      }

      // Sync color inputs by data-property attribute
      const syncColorInput = (prop, val) => {
        const el = card.querySelector(`input[data-property="Bubble Set ${group} ${prop}"]`);
        if (el && val != null) el.value = val;
      };
      syncColorInput("Fill Color", bubbleStyle.fill);
      syncColorInput("Stroke Color", bubbleStyle.stroke);
      syncColorInput("Label Background Color", bubbleStyle.labelBackgroundFill);
      syncColorInput("Label Fill Color", bubbleStyle.labelFill);

      // Sync slider inputs by data-property attribute
      const syncSliderInput = (prop, val) => {
        const container = card.querySelector(`[data-property="Bubble Set ${group} ${prop}"]`);
        if (!container || val === undefined) return;
        const slider = container.querySelector('input[type="range"]');
        const numInput = container.querySelector('input[type="number"]');
        if (slider) slider.value = val;
        if (numInput) numInput.value = val;
      };
      syncSliderInput("Label Font Size", bubbleStyle.labelFontSize);
      syncSliderInput("Label Offset X", bubbleStyle.labelOffsetX);
      syncSliderInput("Label Offset Y", bubbleStyle.labelOffsetY);

      // Sync switch inputs by data-property attribute
      const syncSwitch = (prop, val) => {
        const el = card.querySelector(`[data-property="Bubble Set ${group} ${prop}"]`);
        if (el && el.setChecked) el.setChecked(!!val);
      };
      syncSwitch("Label Close To Path", bubbleStyle.labelCloseToPath);
      syncSwitch("Label Auto Rotate", bubbleStyle.labelAutoRotate);

      // Sync dropdown by data-property attribute
      const placementDropdown = card.querySelector(`[data-property="Bubble Set ${group} Label Placement"]`);
      if (placementDropdown && bubbleStyle.labelPlacement) placementDropdown.value = bubbleStyle.labelPlacement;

      // toggle label-related properties
      for (const elem of card.querySelectorAll(".bubbleSetOptionalLabelConfig")) {
        labelConfigShouldBeEnabled ? elem.classList.remove("disabled") : elem.classList.add("disabled");
      }

      // override css properties to style round-button quadrants and tabs
      const fillColor = bubbleStyle.fill || this.cache.DEFAULTS.BUBBLE_GROUP_STYLE[group].fill;
      document.documentElement.style.setProperty(`--${group}-color`, fillColor);

      const tab = document.querySelector(`.bubble-set-tab[data-group="${group}"]`);
      if (tab) {
        tab.style.setProperty("--tab-color", fillColor);
        tab.style.setProperty("--tab-text-color", StaticUtilities.getReadableForegroundColor(fillColor));
      }
    }

    // Toggle the entire bubble sets card when no groups are active
    const outerCard = document.querySelector(".bubble-set-config-card-header");
    if (outerCard) {
      anyGroupActive ? outerCard.classList.remove("disabled") : outerCard.classList.add("disabled");
    }
  }

  async updateBubbleSetIfChanged() {
    for (let group of this.traverseBubbleSets()) {
      let propsInGroup = this.cache.data.layouts[this.cache.data.selectedLayout][`${group}Props`];

      let lastSetMembers = this.cache.lastBubbleSetMembers.get(group);
      let newSetMembers = new Set();

      // Add members from filter-based properties
      for (let prop of propsInGroup) {
        let nodeIDsToBeGrouped = this.cache.propIDsToNodeIDsToBeShown.get(prop) || [];
        for (let nodeID of nodeIDsToBeGrouped) {
          // Exclude hidden dangling nodes
          if (!this.cache.hiddenDanglingNodeIDs.has(nodeID)) {
            newSetMembers.add(nodeID);
          }
        }
      }

      // Add members from manual group selection
      const manualMembers = this.cache.data.layouts[this.cache.data.selectedLayout][`${group}ManualMembers`];
      if (manualMembers && manualMembers.size > 0) {
        for (let nodeID of manualMembers) {
          // Only add if node is still visible (not filtered out or hidden dangling)
          if (this.cache.nodeRef.has(nodeID) &&
              !this.cache.hiddenDanglingNodeIDs.has(nodeID)) {
            newSetMembers.add(nodeID);
          }
        }
      }

      if (!StaticUtilities.setsAreEqual(lastSetMembers, newSetMembers)) {
        await this.updateBubbleSet(group, newSetMembers);
        this.cache.lastBubbleSetMembers.set(group, newSetMembers);
        this.cache.bubbleSetChanged = true;
      }
    }
  }

  async updateBubbleSet(group, members) {
    let empty = !members || (members instanceof Set ? members.size === 0 : members.length === 0);
    const membersAsArray = members instanceof Set ? [...members] : members;

    const avoidMembers = empty ? [] : this.getAvoidMembers(members);

    if (StaticUtilities.arraysAreEqual(membersAsArray, [...this.cache.INSTANCES.BUBBLE_GROUPS[group].members.keys()])) {
      this.cache.ui.debug("BUBBLE GROUPS IN SYNC - SKIPPING UPDATE");
      return;
    }

    const bubbleStyle = this.cache.data.layouts[this.cache.data.selectedLayout].bubbleSetStyle[group];

    await this.cache.INSTANCES.BUBBLE_GROUPS[group].update({
      ...bubbleStyle,
      members: empty ? [] : membersAsArray,
      avoidMembers: avoidMembers,
      fillOpacity: empty ? 0 : bubbleStyle.fillOpacity,
      strokeOpacity: empty ? 0 : bubbleStyle.strokeOpacity,
      label: empty ? false : bubbleStyle.label,
    });
    await this.cache.INSTANCES.BUBBLE_GROUPS[group].drawBubbleSets();
  }

  getAvoidMembers(members) {
    // Flag is set by io.preProcessData when the network exceeds
    // MAX_NODES_BEFORE_DISABLING_AVOID_MEMBERS_IN_BUBBLE_GROUPS: outlines
    // then may span across non-members (bubblesets-js virtual-edge routing
    // around obstacles is O(members × avoid) — see the threshold comment in
    // config.js for the measured budget).
    if (this.cache.CFG.AVOID_MEMBERS_IN_BUBBLE_GROUPS) return [];

    const checkMembership = members instanceof Set
      ? (nodeID) => members.has(nodeID)
      : (nodeID) => members.includes(nodeID);

    return [...this.cache.nodeRef.keys()].filter(nodeID => !checkMembership(nodeID));
  }

  async clearBubbleSetInstanceMembers() {
    for (const group of this.traverseBubbleSets()) {
      await this.cache.INSTANCES.BUBBLE_GROUPS[group].update({
        members: [],
        fillOpacity: 0,
        strokeOpacity: 0,
        label: false,
      });
      await this.cache.INSTANCES.BUBBLE_GROUPS[group].drawBubbleSets();
    }
  }

  async toggleSelectedNodesInManualGroup(group) {
    if (!this.cache.data.layouts[this.cache.data.selectedLayout][`${group}ManualMembers`]) {
      this.cache.data.layouts[this.cache.data.selectedLayout][`${group}ManualMembers`] = new Set();
    }

    const manualMembers = this.cache.data.layouts[this.cache.data.selectedLayout][`${group}ManualMembers`];
    const selectedNodeIds = [...this.cache.selectedNodes];

    if (selectedNodeIds.length === 0) {
      this.cache.ui.warning("No nodes selected");
      return;
    }

    // Check if all selected nodes are already in the group
    const allInGroup = selectedNodeIds.every(nodeId => manualMembers.has(nodeId));

    if (allInGroup) {
      // Remove all selected nodes from the group
      selectedNodeIds.forEach(nodeId => manualMembers.delete(nodeId));
      this.cache.ui.info(`Removed ${selectedNodeIds.length} node(s) from manual ${group}`);
    } else {
      // Add all selected nodes to the group
      selectedNodeIds.forEach(nodeId => manualMembers.add(nodeId));
      this.cache.ui.info(`Added ${selectedNodeIds.length} node(s) to manual ${group}`);
    }

    // Update the quadrant button visual state
    this.updateManualGroupButtonState();

    // Update status display
    this.updateManualGroupStatus();

    // Refresh bubble style UI elements (activate/deactivate configuration cards)
    this.refreshBubbleStyleElements();

    // Mark bubble sets as changed and redraw (don't re-layout)
    this.cache.bubbleSetChanged = true;
    await this.updateBubbleSetIfChanged();
    await this.cache.graph.draw();

    // Force bubble set redraw to fix positioning
    await this.redrawBubbleSets();
  }

  /**
   * Enumerate numeric edge properties available as Louvain edge weights.
   * Source of truth is cache.data.filterDefaults (the same registry the
   * filter UI uses): edge section, not categorical, finite min/max.
   * @returns {Array<{propHash: string, prop: string, label: string}>}
   */
  getNumericEdgeProperties() {
    const props = [];
    const filterDefaults = this.cache.data?.filterDefaults;
    if (!filterDefaults) return props;
    for (const [propHash, def] of filterDefaults) {
      const [section, subSection, prop] = StaticUtilities.decodePropHashId(propHash);
      if (section !== this.cache.CFG.EXCEL_EDGE_HEADER) continue;
      if (def.isCategory) continue;
      if (!Number.isFinite(def.lowerThreshold) || !Number.isFinite(def.upperThreshold)) continue;
      props.push({ propHash, prop, label: subSection ? `${subSection} › ${prop}` : prop });
    }
    return props;
  }

  // Default weight: STRING's "Combined Score" when present, else topology-only
  // (null) so generic graphs keep the original unweighted behaviour.
  #defaultWeightProperty(numericProps) {
    const combined = numericProps.find((p) => /combined\s*score/i.test(p.prop));
    return combined ? combined.propHash : null;
  }

  async detectCommunities(options = {}) {
    const weightProperty = options.weightProperty !== undefined
      ? options.weightProperty
      : (this.communityOptions.weightProperty ?? null);
    const resolution = options.resolution ?? this.communityOptions.resolution ?? 1;

    const groups = [...this.traverseBubbleSets()];
    const result = computeCommunityAssignments(this.cache, groups, { weightProperty, resolution });

    if (!result) {
      this.cache.ui.warning("Community detection needs at least one visible edge");
      return;
    }

    // Replace the manual members of all groups for the current layout with
    // the detected communities (largest community → first group).
    const currentLayout = this.cache.data.layouts[this.cache.data.selectedLayout];
    for (const group of groups) {
      currentLayout[`${group}ManualMembers`] = result.assignments.get(group) ?? new Set();
    }

    // Same post-change choreography as toggleSelectedNodesInManualGroup
    this.updateManualGroupButtonState();
    this.updateManualGroupStatus();
    this.refreshBubbleStyleElements();

    this.cache.bubbleSetChanged = true;
    await this.updateBubbleSetIfChanged();
    await this.cache.graph.draw();
    await this.redrawBubbleSets();

    const assignedText = result.communityCount <= groups.length
      ? `all ${result.communityCount}`
      : `largest ${groups.length}`;
    const weightLabel = weightProperty
      ? (this.getNumericEdgeProperties().find((p) => p.propHash === weightProperty)?.label ?? "edge weight")
      : "topology";
    this.cache.ui.info(
      `Detected ${result.communityCount} communities ` +
      `(weight: ${weightLabel}, resolution ${resolution}, modularity ${result.modularity.toFixed(2)}); ` +
      `assigned ${assignedText} to bubble groups`
    );
  }

  /**
   * Toggle the Louvain configurator anchored to the 🧩 button: pick a numeric
   * edge property to weight by (or topology-only) and the resolution, then run
   * detection. Built lazily and repopulated on each open so it reflects the
   * currently loaded data.
   */
  toggleCommunityDetectionPopover() {
    if (this.communityPopover && this.communityPopover.classList.contains("open")) {
      this.#closeCommunityDetectionPopover();
      return;
    }
    this.#openCommunityDetectionPopover();
  }

  #closeCommunityDetectionPopover() {
    this.communityPopover?.classList.remove("open");
    if (this._communityOutsideHandler) {
      document.removeEventListener("pointerdown", this._communityOutsideHandler, true);
      this._communityOutsideHandler = null;
    }
  }

  #openCommunityDetectionPopover() {
    const anchor = document.getElementById("detectCommunitiesBtn");
    if (!anchor) return;

    const numericProps = this.getNumericEdgeProperties();
    // Resolve the default weight on first open, and re-default whenever the
    // stored property is gone (data was reloaded) so the dropdown selection
    // and the stored option never drift out of sync.
    const stored = this.communityOptions.weightProperty;
    const storedExists = stored === null || numericProps.some((p) => p.propHash === stored);
    if (stored === undefined || !storedExists) {
      this.communityOptions.weightProperty = this.#defaultWeightProperty(numericProps);
    }

    const popover = this.#ensureCommunityDetectionPopover();
    this.#populateCommunityDetectionPopover(numericProps);

    // Anchor below the button, clamped to the viewport's right edge.
    const rect = anchor.getBoundingClientRect();
    popover.style.top = `${rect.bottom + 6}px`;
    popover.style.left = `${Math.min(rect.left, window.innerWidth - 260)}px`;
    popover.classList.add("open");

    // Close on outside click (capture so it beats inner handlers).
    this._communityOutsideHandler = (e) => {
      if (!popover.contains(e.target) && e.target !== anchor) this.#closeCommunityDetectionPopover();
    };
    document.addEventListener("pointerdown", this._communityOutsideHandler, true);
  }

  #ensureCommunityDetectionPopover() {
    if (this.communityPopover) return this.communityPopover;
    const popover = document.createElement("div");
    popover.className = "community-detection-popover";
    popover.id = "communityDetectionPopover";
    document.body.appendChild(popover);
    this.communityPopover = popover;
    return popover;
  }

  #populateCommunityDetectionPopover(numericProps) {
    const popover = this.communityPopover;
    popover.replaceChildren();

    const title = document.createElement("div");
    title.className = "community-popover-title";
    title.textContent = "Detect communities (Louvain)";
    popover.appendChild(title);

    // Weight dropdown ------------------------------------------------------
    const weightLabel = document.createElement("label");
    weightLabel.className = "community-popover-row";
    weightLabel.textContent = "Weight by";
    const weightSelect = document.createElement("select");
    weightSelect.className = "community-popover-select";
    const topoOpt = document.createElement("option");
    topoOpt.value = "";
    topoOpt.textContent = "Unweighted (topology)";
    weightSelect.appendChild(topoOpt);
    for (const p of numericProps) {
      const opt = document.createElement("option");
      opt.value = p.propHash;
      opt.textContent = p.label;
      weightSelect.appendChild(opt);
    }
    weightSelect.value = this.communityOptions.weightProperty ?? "";
    weightSelect.addEventListener("change", (e) => {
      this.communityOptions.weightProperty = e.target.value || null;
    });
    weightLabel.appendChild(weightSelect);
    popover.appendChild(weightLabel);

    // Resolution slider ----------------------------------------------------
    const resRow = document.createElement("label");
    resRow.className = "community-popover-row";
    const resText = document.createElement("span");
    const setResText = (v) => { resText.textContent = `Resolution: ${Number(v).toFixed(2)}`; };
    setResText(this.communityOptions.resolution);
    const resSlider = document.createElement("input");
    resSlider.type = "range";
    resSlider.min = "0.25";
    resSlider.max = "4";
    resSlider.step = "0.05";
    resSlider.value = String(this.communityOptions.resolution);
    resSlider.className = "community-popover-slider";
    resSlider.addEventListener("input", (e) => {
      this.communityOptions.resolution = parseFloat(e.target.value);
      setResText(e.target.value);
    });
    resRow.append(resText, resSlider);
    popover.appendChild(resRow);

    // Detect button --------------------------------------------------------
    const detectBtn = document.createElement("button");
    detectBtn.className = "community-popover-detect nw-button";
    detectBtn.textContent = "Detect";
    detectBtn.addEventListener("click", async () => {
      this.#closeCommunityDetectionPopover();
      await this.detectCommunities();
    });
    popover.appendChild(detectBtn);
  }

  updateManualGroupButtonState() {
    const button = document.getElementById('manualBubbleGroupButton');
    if (!button) return;

    const selectedNodeIds = new Set(this.cache.selectedNodes);

    for (let [group, quadrantPosition] of Object.entries(this.cache.DEFAULTS.BUBBLE_GROUP_QUADRANT_POSITIONS)) {
      const manualMembers = this.cache.data.layouts[this.cache.data.selectedLayout][`${group}ManualMembers`] || new Set();
      const quadrant = button.querySelector(`.quadrant.${quadrantPosition}.manual`);

      if (quadrant) {
        // Check if any selected node is in this manual group
        const hasAnyMember = selectedNodeIds.size > 0 &&
                              [...selectedNodeIds].some(nodeId => manualMembers.has(nodeId));

        if (hasAnyMember) {
          quadrant.classList.add("active");
        } else {
          quadrant.classList.remove("active");
        }
      }
    }
  }

  updateManualGroupStatus() {
    const statusSpan = document.getElementById('manualBubbleGroupStatus');
    const clearButton = document.getElementById('clearManualGroupsBtn');
    const separator = document.getElementById('manualGroupSeparator');
    if (!statusSpan) return;

    const activeGroups = [];

    for (let [group, quadrantPosition] of Object.entries(this.cache.DEFAULTS.BUBBLE_GROUP_QUADRANT_POSITIONS)) {
      const manualMembers = this.cache.data.layouts[this.cache.data.selectedLayout][`${group}ManualMembers`] || new Set();

      // Filter out nodes that are no longer visible (filtered out)
      const visibleMembers = [...manualMembers].filter(nodeId =>
        this.cache.nodeRef.has(nodeId) &&
        (this.cache.propIDsToNodeIDsToBeShown.size === 0 ||
          [...this.cache.propIDsToNodeIDsToBeShown.values()].some(set => set.has(nodeId)))
      );

      if (visibleMembers.length > 0) {
        const color = this.cache.data.layouts[this.cache.data.selectedLayout].bubbleSetStyle[group].fill;
        activeGroups.push(this.buildManualGroupBadge(group, visibleMembers.length, color));
      }
    }

    // Show/hide elements based on active groups
    if (activeGroups.length > 0) {
      statusSpan.replaceChildren(...activeGroups);
      statusSpan.style.display = 'inline-flex';
      if (clearButton) clearButton.style.display = 'inline-flex';
      if (separator) separator.style.display = 'inline-block';
      // A group now exists worth styling — surface the Bubble Sets card.
      this.cache.ui?.expandStylingCard?.('Bubble Sets');
    } else {
      statusSpan.replaceChildren();
      statusSpan.style.display = 'none';
      if (clearButton) clearButton.style.display = 'none';
      if (separator) separator.style.display = 'none';
    }
  }

  // One clickable badge per active group: shows the colored ●count and clears
  // just that group on click (✕ revealed on hover). Lets users drop a single
  // group without nuking all of them via "Clear all".
  buildManualGroupBadge(group, count, color) {
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'manual-group-badge';
    badge.style.color = color;
    badge.title = `Clear this group (${count} node${count === 1 ? '' : 's'})`;
    const dot = document.createElement('span');
    dot.textContent = `●${count}`;
    const x = document.createElement('span');
    x.className = 'mg-badge-x';
    x.textContent = '✕';
    badge.append(dot, x);
    badge.addEventListener('click', () => this.clearManualGroup(group));
    return badge;
  }

  async clearManualGroup(group) {
    const manualMembers = this.cache.data.layouts[this.cache.data.selectedLayout][`${group}ManualMembers`];
    if (manualMembers) manualMembers.clear();

    this.updateManualGroupButtonState();
    this.updateManualGroupStatus();

    this.cache.bubbleSetChanged = true;
    await this.updateBubbleSetIfChanged();
    await this.cache.graph.draw();
  }

  cleanupManualGroupMembers() {
    // Remove nodes from manual groups that are no longer visible (filtered out)
    for (let group of Object.keys(this.cache.DEFAULTS.BUBBLE_GROUP_STYLE)) {
      const manualMembers = this.cache.data.layouts[this.cache.data.selectedLayout][`${group}ManualMembers`];

      if (manualMembers && manualMembers.size > 0) {
        const toRemove = [];
        for (let nodeId of manualMembers) {
          if (!this.cache.nodeRef.has(nodeId)) {
            toRemove.push(nodeId);
          }
        }

        toRemove.forEach(nodeId => manualMembers.delete(nodeId));
      }
    }

    this.updateManualGroupStatus();
  }

  async clearAllManualGroups() {
    // Clear all manual bubble groups
    for (let group of Object.keys(this.cache.DEFAULTS.BUBBLE_GROUP_STYLE)) {
      const manualMembers = this.cache.data.layouts[this.cache.data.selectedLayout][`${group}ManualMembers`];
      if (manualMembers) {
        manualMembers.clear();
      }
    }

    // Update UI
    this.updateManualGroupButtonState();
    this.updateManualGroupStatus();

    // Mark bubble sets as changed and redraw (don't re-layout)
    this.cache.bubbleSetChanged = true;
    await this.updateBubbleSetIfChanged();
    await this.cache.graph.draw();

    // Force bubble set redraw to fix positioning
    await this.redrawBubbleSets();

    this.cache.ui.info('Cleared all manual bubble groups');
  }
}

const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

export { GraphBubbleSetManager };