import {bubbleGroupStyle} from "../config.js";
import {StaticUtilities} from "../utilities/static.js";
import {detectCommunities as computeCommunityAssignments} from "./communities.js";
import {clampPopoverLeft} from "../utilities/popover_position.js";
import {RailMenu, menuItem, menuSeparator} from "../managers/rail.js";

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

  /**
   * The current workspace's group keys, in creation order. A workspace owns its
   * own set — there is no global list and no fixed count. Every caller that
   * operates on a DIFFERENT layout must read that layout's `bubbleSetStyle`
   * directly instead (see io.parseLayouts, layout.createDefaultLayout).
   */
  * traverseBubbleSets() {
    const layout = this.cache.data?.layouts?.[this.cache.data?.selectedLayout];
    for (let group of Object.keys(layout?.bubbleSetStyle ?? {})) {
      yield group;
    }
  }

  /** @returns {object|undefined} the selected workspace, if there is one */
  #layout() {
    return this.cache.data?.layouts?.[this.cache.data?.selectedLayout];
  }

  /**
   * Mint an unused group key. `g1`, `g2`, … never collides with the legacy
   * `groupOne`–`groupFour` a pre-1.17 model carries, so old and new groups can
   * coexist in one workspace.
   */
  #freeGroupKey(layout) {
    let n = 1;
    while (layout.bubbleSetStyle[`g${n}`]) n++;
    return `g${n}`;
  }

  /**
   * Add a group to the current workspace.
   * @param {{name?: string, color?: string, fromProp?: string}} [options]
   *   `fromProp` seeds the group's property-derived membership with one filter.
   * @returns {string|null} the new group's key, or null with no workspace
   */
  createGroup({ name, color, fromProp } = {}) {
    const layout = this.#layout();
    if (!layout) {
      this.cache.ui.error('Load a graph first.');
      return null;
    }
    if (!layout.bubbleSetStyle) layout.bubbleSetStyle = {};

    const key = this.#freeGroupKey(layout);
    const index = Object.keys(layout.bubbleSetStyle).length;
    const style = bubbleGroupStyle(index, name);
    if (color) {
      style.fill = color;
      style.labelBackgroundFill = color;
    }

    layout.bubbleSetStyle[key] = style;
    layout[`${key}Props`] = new Set(fromProp ? [fromProp] : []);
    layout[`${key}ManualMembers`] = new Set();
    return key;
  }

  /**
   * Remove a group and every trace of it: its style, both membership stores,
   * the renderer's slot and the change-detection cache. Leaving any of them
   * behind would resurrect the group on the next load
   * (io.savedLayoutGroupKeys infers groups from stray `${group}Props` keys).
   * @param {string} group
   */
  async deleteGroup(group) {
    const layout = this.#layout();
    if (!layout?.bubbleSetStyle?.[group]) return;

    delete layout.bubbleSetStyle[group];
    delete layout[`${group}Props`];
    delete layout[`${group}ManualMembers`];
    delete this.cache.INSTANCES.BUBBLE_GROUPS[group];
    this.cache.lastBubbleSetMembers.delete(group);
    this.cache.graph?.bubbleLayer?.removeGroup(group);

    this.cache.bubbleSetChanged = true;
    await this.cache.graph?.draw();
    this.cache.history?.commit(`Delete bubble group (${group})`);
  }

  /** What to call a group in prose: its label, falling back to its key. */
  groupName(group) {
    return this.#layout()?.bubbleSetStyle?.[group]?.labelText || group;
  }

  /**
   * Create a group holding the current selection. The two-step "new empty
   * group, then add the selection" is the common case, so it gets one button.
   * @param {string} [name]
   */
  async createGroupFromSelection(name) {
    const selected = [...(this.cache.selectedNodes ?? [])];
    if (selected.length === 0) {
      this.cache.ui.warning('Select some nodes first, then create a group from them');
      return null;
    }
    const group = this.createGroup({ name });
    if (!group) return null;
    this.#layout()[`${group}ManualMembers`] = new Set(selected);
    this.selectedGroup = group;
    await this.afterMembershipChange(`New bubble group (${this.groupName(group)})`);
    this.cache.ui.info(
      `Created "${this.groupName(group)}" with ${selected.length} node${selected.length === 1 ? '' : 's'}`
    );
    return group;
  }

  /**
   * Single source of truth for a group's visible members in the current
   * layout: filter/property-based (${group}Props) UNION manual selection
   * (${group}ManualMembers), using the same visibility filter the outline
   * renderer applies. Every count shown to the user (status badge, styling
   * card enable state) and the rendered outline derive from THIS method, so
   * the displayed number can never drift from what is highlighted.
   * @param {string} group
   * @returns {Set<string>} visible node IDs
   */
  getEffectiveGroupMembers(group) {
    const currentLayout = this.cache.data.layouts[this.cache.data.selectedLayout];
    const members = new Set();

    // Filter/property-based members: resolved live from the active props.
    const propsInGroup = currentLayout[`${group}Props`] || new Set();
    for (const prop of propsInGroup) {
      const nodeIDs = this.cache.propIDsToNodeIDsToBeShown.get(prop) || [];
      for (const nodeID of nodeIDs) {
        if (!this.cache.hiddenDanglingNodeIDs.has(nodeID)) members.add(nodeID);
      }
    }

    // Manual selection members: only nodes still present and visible.
    const manualMembers = currentLayout[`${group}ManualMembers`];
    if (manualMembers) {
      for (const nodeID of manualMembers) {
        if (this.cache.nodeRef.has(nodeID) && !this.cache.hiddenDanglingNodeIDs.has(nodeID)) {
          members.add(nodeID);
        }
      }
    }

    return members;
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
      case "Padding":
        bStyle.padding = value;
        break;
      case "Corridor Width":
        bStyle.corridor = value;
        break;
      case "Avoidance":
        bStyle.avoidance = value;
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

  /**
   * Mirror the selected group's stored style onto the ONE settings pane below
   * the group list. There used to be a panel per group, built eagerly; with an
   * unbounded number of groups that is N × 20 rows of DOM for a pane showing
   * one group at a time, so the pane is built on demand for `selectedGroup`
   * and this only has to sync that one.
   */
  refreshBubbleStyleElements() {
    const card = document.getElementById('groupStylePanel');
    const group = this.selectedGroup;
    const bubbleStyle = this.#layout()?.bubbleSetStyle?.[group];
    if (!card || !bubbleStyle) {
      this.cache.ui?.syncOverlays?.();
      return;
    }

    // Same union the outline renders (see getEffectiveGroupMembers).
    const hasActiveMembers = this.getEffectiveGroupMembers(group).size > 0;
    hasActiveMembers ? card.classList.remove("disabled") : card.classList.add("disabled");

    const labelInput = card.querySelector(`input[data-property="Bubble Set ${group} Label Text"]`);
    if (labelInput && bubbleStyle.labelText !== undefined) labelInput.value = bubbleStyle.labelText;

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
    syncSliderInput("Padding", bubbleStyle.padding);
    syncSliderInput("Corridor Width", bubbleStyle.corridor);
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
    // Numeric 0/1 (legacy values > 0 read as ON) → checked state.
    syncSwitch("Avoidance", (bubbleStyle.avoidance ?? 1) > 0);

    // Sync dropdown by data-property attribute
    const placementDropdown = card.querySelector(`[data-property="Bubble Set ${group} Label Placement"]`);
    if (placementDropdown && bubbleStyle.labelPlacement) placementDropdown.value = bubbleStyle.labelPlacement;

    // toggle label-related properties
    for (const elem of card.querySelectorAll(".bubbleSetOptionalLabelConfig")) {
      bubbleStyle.label ? elem.classList.remove("disabled") : elem.classList.add("disabled");
    }

    // Membership changed, so the layer row's "N sets" is stale.
    this.cache.ui?.syncOverlays?.();
  }

  async updateBubbleSetIfChanged() {
    for (let group of this.traverseBubbleSets()) {
      // A group created at runtime has no baseline yet — the fixed four were
      // always pre-seeded here by layout creation, which is no longer true.
      // "Never drawn" is an empty set, so the first real membership is a change.
      let lastSetMembers = this.cache.lastBubbleSetMembers.get(group) ?? new Set();
      let newSetMembers = this.getEffectiveGroupMembers(group);

      if (!StaticUtilities.setsAreEqual(lastSetMembers, newSetMembers)) {
        await this.updateBubbleSet(group, newSetMembers);
        this.cache.lastBubbleSetMembers.set(group, newSetMembers);
        this.cache.bubbleSetChanged = true;
      }
    }
  }

  /**
   * The renderer handle for a group, created on first use. Groups now arrive
   * after graph build — from a load or from createGroup — so binding them all
   * up front at graph-build time is no longer possible; materialising
   * here removes the ordering question entirely (the layer does the same with
   * its own per-group state, see bubble_layer #groupState).
   */
  #groupInstance(group) {
    this.cache.INSTANCES.BUBBLE_GROUPS[group] ??=
      this.cache.graph.getPluginInstance(`bubbleSetPlugin-${group}`);
    return this.cache.INSTANCES.BUBBLE_GROUPS[group];
  }

  async updateBubbleSet(group, members) {
    let empty = !members || (members instanceof Set ? members.size === 0 : members.length === 0);
    const membersAsArray = members instanceof Set ? [...members] : members;

    const avoidMembers = empty ? [] : this.getAvoidMembers(members);

    if (StaticUtilities.arraysAreEqual(membersAsArray, [...this.#groupInstance(group).members.keys()])) {
      this.cache.ui.debug("BUBBLE GROUPS IN SYNC - SKIPPING UPDATE");
      return;
    }

    const bubbleStyle = this.cache.data.layouts[this.cache.data.selectedLayout].bubbleSetStyle[group];

    await this.#groupInstance(group).update({
      ...bubbleStyle,
      members: empty ? [] : membersAsArray,
      avoidMembers: avoidMembers,
      fillOpacity: empty ? 0 : bubbleStyle.fillOpacity,
      strokeOpacity: empty ? 0 : bubbleStyle.strokeOpacity,
      label: empty ? false : bubbleStyle.label,
    });
    await this.#groupInstance(group).drawBubbleSets();
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

  /**
   * The choreography every membership change runs: repaint the group UI, then
   * resync and redraw the outlines, then commit one undo step. Four call sites
   * used to inline their own copy of it and drift.
   * @param {string} label undo-stack label
   */
  async afterMembershipChange(label) {
    this.syncGroupRows();
    this.renderGroupList();
    this.refreshBubbleStyleElements();
    this.cache.uiComponents?.refreshGroupChips?.();

    this.cache.bubbleSetChanged = true;
    await this.updateBubbleSetIfChanged();
    await this.cache.graph?.draw();
    // Force bubble set redraw to fix positioning
    await this.redrawBubbleSets();
    this.cache.history?.commit(label);
  }

  /**
   * Membership of `group` relative to the current selection: none, some or all.
   * Drives the group row's ＋/－ button and the group menu's ✓ / – marks.
   * @returns {'none'|'some'|'all'}
   */
  selectionMembership(group) {
    const manualMembers = this.#layout()?.[`${group}ManualMembers`] ?? new Set();
    const selected = [...(this.cache.selectedNodes ?? [])];
    if (selected.length === 0) return 'none';
    let inGroup = 0;
    for (const nodeId of selected) if (manualMembers.has(nodeId)) inGroup++;
    if (inGroup === 0) return 'none';
    return inGroup === selected.length ? 'all' : 'some';
  }

  async toggleSelectedNodesInManualGroup(group) {
    const layout = this.#layout();
    if (!layout) return;
    if (!layout[`${group}ManualMembers`]) layout[`${group}ManualMembers`] = new Set();

    const manualMembers = layout[`${group}ManualMembers`];
    const selectedNodeIds = [...this.cache.selectedNodes];

    if (selectedNodeIds.length === 0) {
      this.cache.ui.warning("No nodes selected");
      return;
    }

    const name = layout.bubbleSetStyle?.[group]?.labelText || group;
    const allInGroup = selectedNodeIds.every(nodeId => manualMembers.has(nodeId));

    if (allInGroup) {
      selectedNodeIds.forEach(nodeId => manualMembers.delete(nodeId));
      // A removed node that ALSO matches one of the group's filters comes
      // straight back through the property layer. Nothing can stop that, so
      // say it rather than let the click look like a no-op.
      const stillIn = this.getEffectiveGroupMembers(group);
      const returning = selectedNodeIds.filter((id) => stillIn.has(id)).length;
      this.cache.ui.info(
        `Removed ${selectedNodeIds.length} node(s) from "${name}"` +
          (returning ? `; ${returning} still match its filters` : '')
      );
    } else {
      selectedNodeIds.forEach(nodeId => manualMembers.add(nodeId));
      this.cache.ui.info(`Added ${selectedNodeIds.length} node(s) to "${name}"`);
    }

    await this.afterMembershipChange(`Bubble group membership (${name})`);
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

    const wanted = Math.max(2, Math.round(options.groupCount ?? this.communityOptions.groupCount ?? 4));

    // Detection needs somewhere to put its results, and groups no longer
    // pre-exist. Mint throwaway keys to compute against, then keep only the
    // ones a community actually landed in.
    const currentLayout = this.#layout();
    if (!currentLayout) return;
    const created = [];
    for (let i = 0; i < wanted; i++) {
      const key = this.createGroup({ name: `Community ${i + 1}` });
      if (key) created.push(key);
    }

    const result = computeCommunityAssignments(this.cache, created, { weightProperty, resolution });

    if (!result) {
      for (const key of created) this.#dropGroupState(key);
      this.cache.ui.warning("Community detection needs at least one visible edge");
      return;
    }

    // Auto-grouping ADDS groups now instead of overwriting the fixed four, so
    // nothing the user built is destroyed and there is nothing to confirm.
    for (const group of created) {
      currentLayout[`${group}ManualMembers`] = result.assignments.get(group) ?? new Set();
    }
    // A run that found fewer communities than asked leaves empty groups behind;
    // an empty group is clutter, not a result.
    for (const group of created) {
      if ((currentLayout[`${group}ManualMembers`]?.size ?? 0) === 0) this.#dropGroupState(group);
    }

    await this.afterMembershipChange('Auto-group');

    const assigned = created.filter((g) => currentLayout.bubbleSetStyle[g]).length;
    const weightLabel = weightProperty
      ? (this.getNumericEdgeProperties().find((p) => p.propHash === weightProperty)?.label ?? "edge weight")
      : "topology";
    this.cache.ui.info(
      `Detected ${result.communityCount} communities ` +
      `(weight: ${weightLabel}, resolution ${resolution}, modularity ${result.modularity.toFixed(2)}); ` +
      `created ${assigned} group${assigned === 1 ? '' : 's'}`
    );
  }

  /** Forget a group without the redraw/commit deleteGroup does (bulk paths). */
  #dropGroupState(group) {
    const layout = this.#layout();
    if (!layout) return;
    delete layout.bubbleSetStyle[group];
    delete layout[`${group}Props`];
    delete layout[`${group}ManualMembers`];
    delete this.cache.INSTANCES.BUBBLE_GROUPS[group];
    this.cache.lastBubbleSetMembers.delete(group);
    this.cache.graph?.bubbleLayer?.removeGroup(group);
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

    // Open first so offsetWidth is measurable, then anchor below the button
    // and clamp to the viewport so the right edge never truncates.
    popover.classList.add("open");
    const rect = anchor.getBoundingClientRect();
    popover.style.top = `${rect.bottom + 6}px`;
    popover.style.left = `${clampPopoverLeft(rect.left, popover.offsetWidth, window.innerWidth)}px`;

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

    // How many groups to create -------------------------------------------
    // Used to be fixed at 4 because that was all there were. Now it is the
    // number of NEW groups the run adds; existing ones are left alone.
    const countRow = document.createElement("label");
    countRow.className = "community-popover-row";
    countRow.textContent = "Groups";
    const countInput = document.createElement("input");
    countInput.type = "number";
    countInput.min = "2";
    countInput.max = "50";
    countInput.step = "1";
    countInput.className = "community-popover-count";
    countInput.value = String(this.communityOptions.groupCount ?? 4);
    countInput.title = "How many of the largest communities to turn into groups";
    countInput.addEventListener("change", () => {
      const n = Math.min(50, Math.max(2, Math.round(Number(countInput.value) || 4)));
      this.communityOptions.groupCount = n;
      countInput.value = String(n);
    });
    countRow.appendChild(countInput);
    popover.appendChild(countRow);

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

  /**
   * Mirror the live selection onto each group row's primary button. Runs from
   * selection.updateSelectedNodesAndEdges — the ONE point where
   * cache.selectedNodes is authoritative. An earlier hook (updateSelectedState)
   * reads a stale selection and the labels desync; that was a real bug once.
   */
  syncGroupRows() {
    for (const btn of document.querySelectorAll('.group-row-toggle')) {
      const group = btn.dataset.group;
      const count = this.cache.selectedNodes?.length ?? this.cache.selectedNodes?.size ?? 0;
      const state = this.selectionMembership(group);
      const name = this.#layout()?.bubbleSetStyle?.[group]?.labelText || group;

      btn.disabled = count === 0;
      btn.classList.toggle('remove', state === 'all');
      if (count === 0) {
        btn.textContent = '＋';
        btn.title = 'Select nodes first, then add them to this group';
      } else if (state === 'all') {
        btn.textContent = `－ ${count}`;
        btn.title = `Remove the ${count} selected node(s) from "${name}"`;
      } else {
        btn.textContent = `＋ ${count}`;
        btn.title =
          state === 'some'
            ? `Add the rest of the selection to "${name}" (some are already in it)`
            : `Add the ${count} selected node(s) to "${name}"`;
      }
      btn.setAttribute('aria-label', btn.title);
    }
  }

  /**
   * Which filters feed a group's property-derived membership, in readable form.
   * @returns {string[]}
   */
  #groupFilterNames(group) {
    const props = this.#layout()?.[`${group}Props`] ?? new Set();
    return [...props].map((propID) =>
      StaticUtilities.decodePropHashId(propID).filter(Boolean).join(' › ')
    );
  }

  /**
   * Paint the Groups list under Overlays › Groups. One row per group: colour,
   * editable name, live count, the selection toggle, and a ⋯ menu. Rebuilt
   * whole — the list is a handful of rows and diffing it would be more code
   * than redrawing it.
   */
  renderGroupList() {
    const list = document.getElementById('groupList');
    if (!list) return;
    const layout = this.#layout();
    const groups = [...this.traverseBubbleSets()];

    list.replaceChildren();
    list.classList.toggle('is-empty', groups.length === 0);

    if (groups.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'group-empty';
      empty.textContent =
        'No groups yet. A group draws a coloured bubble around the nodes you put in it.';
      list.appendChild(empty);
      this.#syncGroupStylePanel(null);
      return;
    }

    for (const group of groups) {
      list.appendChild(this.#buildGroupRow(group, layout));
    }
    if (!groups.includes(this.selectedGroup)) this.selectedGroup = groups[0];
    this.#syncGroupStylePanel(this.selectedGroup);
    this.syncGroupRows();
  }

  #buildGroupRow(group, layout) {
    const style = layout.bubbleSetStyle[group];
    const name = style.labelText || group;
    const count = this.getEffectiveGroupMembers(group).size;

    const row = document.createElement('div');
    row.className = 'group-row';
    row.dataset.group = group;
    if (group === this.selectedGroup) row.classList.add('active');
    row.addEventListener('click', (e) => {
      if (e.target.closest('button, input')) return;
      this.selectedGroup = group;
      this.renderGroupList();
    });

    const swatch = document.createElement('input');
    swatch.type = 'color';
    swatch.className = 'group-swatch';
    swatch.value = /^#[0-9a-f]{6}$/i.test(style.fill) ? style.fill : '#403C53';
    swatch.title = `Fill colour of "${name}"`;
    swatch.setAttribute('aria-label', `Fill colour of "${name}"`);
    swatch.addEventListener('change', async () => {
      await this.updateBubbleSetStyle(`Bubble Set ${group} Fill Color`, swatch.value);
      this.renderGroupList();
    });

    // The row name IS labelText, the string painted on the hull, so the list
    // and the canvas cannot disagree about what a group is called.
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'group-name';
    nameInput.value = name;
    nameInput.title = 'Rename this group (this is the label drawn on the bubble)';
    nameInput.setAttribute('aria-label', `Name of group "${name}"`);
    nameInput.addEventListener('change', async () => {
      await this.updateBubbleSetStyle(`Bubble Set ${group} Label Text`, nameInput.value.trim());
      this.renderGroupList();
    });

    const countEl = document.createElement('span');
    countEl.className = 'group-count';
    countEl.textContent = `${count} node${count === 1 ? '' : 's'}`;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'group-row-toggle';
    toggle.dataset.group = group;
    toggle.addEventListener('click', () => this.toggleSelectedNodesInManualGroup(group));

    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'group-row-more';
    more.textContent = '⋯';
    more.title = `More actions for "${name}"`;
    more.setAttribute('aria-label', more.title);
    this.#attachRowMenu(more, group);

    const head = document.createElement('div');
    head.className = 'group-row-head';
    head.append(swatch, nameInput, countEl, toggle, more);
    row.appendChild(head);

    // The second line is the thing the old UI never admitted: a group can be
    // fed by a live filter AND by a hand-picked node set at the same time.
    const filters = this.#groupFilterNames(group);
    const manualCount = layout[`${group}ManualMembers`]?.size ?? 0;
    if (filters.length > 0) {
      const source = document.createElement('div');
      source.className = 'group-row-source';
      source.textContent =
        `⚙ ${filters.join(', ')}` + (manualCount ? ` · +${manualCount} manual` : '');
      source.title =
        'Filter-driven membership updates as you change those filters; ' +
        'manually added nodes stay until you remove them.';
      row.appendChild(source);
    }

    return row;
  }

  #attachRowMenu(anchor, group) {
    const menu = new RailMenu(anchor, (el) => {
      const layout = this.#layout();
      const name = layout?.bubbleSetStyle?.[group]?.labelText || group;
      const hasProps = (layout?.[`${group}Props`]?.size ?? 0) > 0;
      const hasManual = (layout?.[`${group}ManualMembers`]?.size ?? 0) > 0;

      el.appendChild(
        menuItem({
          icon: '◈',
          label: 'Select members',
          disabled: this.getEffectiveGroupMembers(group).size === 0,
          title: `Select every node in "${name}"`,
          onClick: () => {
            menu.close();
            this.cache.sm.selectNodes([...this.getEffectiveGroupMembers(group)]);
          },
        })
      );
      el.appendChild(
        menuItem({
          icon: '⧉',
          label: 'Duplicate',
          title: `Copy "${name}" and its membership into a new group`,
          onClick: async () => {
            menu.close();
            await this.duplicateGroup(group);
          },
        })
      );
      el.appendChild(menuSeparator());
      if (hasManual) {
        el.appendChild(
          menuItem({
            icon: '−',
            label: 'Clear manual nodes',
            title: 'Drop the hand-picked nodes, keep the filter-driven ones',
            onClick: async () => {
              menu.close();
              layout[`${group}ManualMembers`].clear();
              await this.afterMembershipChange(`Clear manual nodes (${name})`);
            },
          })
        );
      }
      if (hasProps) {
        el.appendChild(
          menuItem({
            icon: '⚙',
            label: 'Detach filter',
            title: 'Drop the filter-driven members, keep the hand-picked ones',
            onClick: async () => {
              menu.close();
              this.clearGroupPropAssignments(group);
              await this.afterMembershipChange(`Detach filter (${name})`);
            },
          })
        );
      }
      el.appendChild(
        menuItem({
          icon: '✕',
          label: 'Delete group',
          title: `Remove "${name}" entirely`,
          onClick: async () => {
            menu.close();
            await this.deleteGroup(group);
            this.renderGroupList();
            this.refreshBubbleStyleElements();
            this.cache.uiComponents?.refreshGroupChips?.();
            this.cache.ui.info(`Deleted group "${name}"`);
          },
        })
      );
    });
  }

  /** Copy a group's style and both membership stores into a new group. */
  async duplicateGroup(group) {
    const layout = this.#layout();
    const style = layout?.bubbleSetStyle?.[group];
    if (!style) return;
    const key = this.createGroup({ name: `${style.labelText || group} copy` });
    if (!key) return;
    layout.bubbleSetStyle[key] = { ...style, labelText: layout.bubbleSetStyle[key].labelText };
    layout[`${key}Props`] = new Set(layout[`${group}Props`] ?? []);
    layout[`${key}ManualMembers`] = new Set(layout[`${group}ManualMembers`] ?? []);
    this.selectedGroup = key;
    await this.afterMembershipChange(`Duplicate bubble group (${group})`);
  }

  /** Ask the styling card to (re)build its panel for the selected group. */
  #syncGroupStylePanel(group) {
    this.cache.ui?.buildGroupStylePanel?.(group);
  }

  /**
   * Remove all filter/property-based assignments for a group from the current
   * layout. `${group}Props` is the single store, so the filter-panel buttons
   * read the cleared state on their next build.
   * @param {string} group
   * @returns {boolean} true if any prop assignment was actually cleared
   */
  clearGroupPropAssignments(group) {
    const currentLayout = this.cache.data.layouts[this.cache.data.selectedLayout];
    const propsInGroup = currentLayout[`${group}Props`];
    if (!propsInGroup || propsInGroup.size === 0) return false;

    propsInGroup.clear();
    return true;
  }

  async clearManualGroup(group) {
    const manualMembers = this.cache.data.layouts[this.cache.data.selectedLayout][`${group}ManualMembers`];
    if (manualMembers) manualMembers.clear();
    // A group's count spans both sources, so clearing it clears both.
    this.clearGroupPropAssignments(group);

    await this.afterMembershipChange(`Clear bubble group (${group})`);
  }

  cleanupManualGroupMembers() {
    // Remove nodes from manual groups that are no longer visible (filtered out)
    for (let group of this.traverseBubbleSets()) {
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

    this.renderGroupList();
  }

  async clearAllManualGroups() {
    // Clear every group's contribution from both sources (manual + props).
    for (let group of this.traverseBubbleSets()) {
      const manualMembers = this.cache.data.layouts[this.cache.data.selectedLayout][`${group}ManualMembers`];
      if (manualMembers) {
        manualMembers.clear();
      }
      this.clearGroupPropAssignments(group);
    }

    await this.afterMembershipChange('Clear all bubble groups');
    this.cache.ui.info('Cleared all bubble groups');
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