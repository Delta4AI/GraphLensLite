import {StaticUtilities} from "../utilities/static.js";

class GraphBubbleSetManager {
  constructor(cache) {
    this.cache = cache;
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
          // Explicitly exclude dummy node
          if (nodeID !== this.cache.CFG.INVISIBLE_DUMMY_NODE.id) {
            actualMembers.add(nodeID);
          }
        }
      }

      // Add members from manual group selection
      const manualMembers = currentLayout[`${group}ManualMembers`] || new Set();
      for (let nodeID of manualMembers) {
        // Explicitly exclude dummy node
        if (nodeID !== this.cache.CFG.INVISIBLE_DUMMY_NODE.id && this.cache.nodeRef.has(nodeID)) {
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
          // Explicitly exclude dummy node and hidden dangling nodes
          if (nodeID !== this.cache.CFG.INVISIBLE_DUMMY_NODE.id &&
              !this.cache.hiddenDanglingNodeIDs.has(nodeID)) {
            newSetMembers.add(nodeID);
          }
        }
      }

      // Add members from manual group selection
      const manualMembers = this.cache.data.layouts[this.cache.data.selectedLayout][`${group}ManualMembers`];
      if (manualMembers && manualMembers.size > 0) {
        for (let nodeID of manualMembers) {
          // Only add if node is still visible (not filtered out), and explicitly exclude dummy node and hidden dangling nodes
          if (nodeID !== this.cache.CFG.INVISIBLE_DUMMY_NODE.id &&
              this.cache.nodeRef.has(nodeID) &&
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
    // Ensure dummy node is never included in members
    const filteredMembers = members instanceof Set
      ? new Set([...members].filter(id => id !== this.cache.CFG.INVISIBLE_DUMMY_NODE.id))
      : [...members].filter(id => id !== this.cache.CFG.INVISIBLE_DUMMY_NODE.id);

    let empty = !filteredMembers || (filteredMembers instanceof Set ? filteredMembers.size === 0 : filteredMembers.length === 0);
    const membersAsArray = filteredMembers instanceof Set ? [...filteredMembers] : filteredMembers;

    const avoidMembers = empty ? [] : this.getAvoidMembers(filteredMembers);

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
    if (this.cache.CFG.APPLY_BUBBLE_SET_HOTFIX && this.cache.CFG.AVOID_MEMBERS_IN_BUBBLE_GROUPS) return [];

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
    // Filter out dummy node from selected nodes
    const selectedNodeIds = [...this.cache.selectedNodes].filter(nodeId =>
      nodeId !== this.cache.CFG.INVISIBLE_DUMMY_NODE.id
    );

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

      // Filter out nodes that are no longer visible (filtered out) and explicitly exclude dummy node
      const visibleMembers = [...manualMembers].filter(nodeId =>
        nodeId !== this.cache.CFG.INVISIBLE_DUMMY_NODE.id &&
        this.cache.nodeRef.has(nodeId) &&
        this.cache.propIDsToNodeIDsToBeShown.size === 0 ||
        [...this.cache.propIDsToNodeIDsToBeShown.values()].some(set => set.has(nodeId))
      );

      if (visibleMembers.length > 0) {
        const color = this.cache.data.layouts[this.cache.data.selectedLayout].bubbleSetStyle[group].fill;
        activeGroups.push(`<span style="color: ${color}; font-weight: bold;">●${visibleMembers.length}</span>`);
      }
    }

    // Show/hide elements based on active groups
    if (activeGroups.length > 0) {
      statusSpan.innerHTML = activeGroups.join(' ');
      statusSpan.style.display = 'inline';
      if (clearButton) clearButton.style.display = 'inline';
      if (separator) separator.style.display = 'inline-block';
    } else {
      statusSpan.innerHTML = '';
      statusSpan.style.display = 'none';
      if (clearButton) clearButton.style.display = 'none';
      if (separator) separator.style.display = 'none';
    }
  }

  cleanupManualGroupMembers() {
    // Remove nodes from manual groups that are no longer visible (filtered out) or are the dummy node
    for (let group of Object.keys(this.cache.DEFAULTS.BUBBLE_GROUP_STYLE)) {
      const manualMembers = this.cache.data.layouts[this.cache.data.selectedLayout][`${group}ManualMembers`];

      if (manualMembers && manualMembers.size > 0) {
        const toRemove = [];
        for (let nodeId of manualMembers) {
          // Check if node is filtered out (not visible) or is the dummy node
          if (nodeId === this.cache.CFG.INVISIBLE_DUMMY_NODE.id || !this.cache.nodeRef.has(nodeId)) {
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