import {StaticUtilities} from "../utilities/static.js";
import {DropdownChecklist, InvertibleRangeSlider} from "./ui_components.js";
import {createStyleDiv} from "./ui_style_div.js";
import {Popup} from "../utilities/popup.js";

class UIManager {
  constructor(cache, debugEnabled = false) {
    this.cache = cache;
    this.debugEnabled = debugEnabled;
    this.bottomBarHeight = null;
  }

  setDataSourceLabel(text) {
    const label = document.getElementById('dataSourceLabel');
    if (label) {
      label.textContent = text;
      label.title = text;
    }
  }

  async showLoading(header, text = "") {
    const overlay = document.getElementById('loadingOverlay');
    overlay.style.display = 'flex';
    overlay.style.opacity = '1';

    document.getElementById('loadingHeader').textContent = header;
    document.getElementById('loadingText').textContent = text;

    let logInfo = header;
    if (text) logInfo += `: ${text}`;
    this.debug(logInfo);

    // Force reflow
    overlay.getBoundingClientRect();

    await new Promise(resolve => requestAnimationFrame(resolve));

    // Wait for next frame to ensure the UI has updated
    return new Promise(resolve => requestAnimationFrame(resolve));
  }

  async hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    overlay.style.opacity = '0';

    // Wait for the opacity transition to complete
    await new Promise(resolve => {
      const transitionDuration = getComputedStyle(overlay).transitionDuration;
      const durationInMs = parseFloat(transitionDuration) * (transitionDuration.includes('ms') ? 1 : 1000);
      setTimeout(resolve, durationInMs);
    });

    overlay.style.display = 'none';
    this.refreshUI();
  }

  refreshUI() {
    if (!this.cache.initialized) return;

    this.toggleStyleElementsThatRequireAtLeastOneVisibleNode(this.cache.nodeIDsToBeShown.size > 0);
    this.toggleStyleElementsThatRequireAtLeastOneVisibleEdge(this.cache.edgeIDsToBeShown.size > 0);
    this.toggleStyleElementsThatRequireAtLeastOneVisibleNodeOrEdge(this.cache.nodeIDsToBeShown.size > 0 || this.cache.edgeIDsToBeShown.size > 0);

    document.getElementById("visibleNodes").innerHTML = `${this.cache.nodeIDsToBeShown.size - this.cache.hiddenDanglingNodeIDs.size}`;
    document.getElementById("totalNodes").innerHTML = `${this.cache.data.nodes.length}`;
    document.getElementById("visibleEdges").innerHTML = `${this.cache.edgeIDsToBeShown.size - this.cache.hiddenDanglingEdgeIDs.size}`;
    document.getElementById("totalEdges").innerHTML = `${this.cache.data.edges.length}`;

    this.cache.bs.refreshBubbleStyleElements();
  }

  toggleStyleElementsThatRequireAtLeastOneSelectedNode(enable) {
    this.toggleDisabledElements([
      "Node Configuration", "Expand Edges", "Reduce Edges", "Expand Neighbors", "Reduce Neighbors",
      "deselectNodesBtn", "focusNodesBtn"
    ], enable);
  }

  toggleStyleElementsThatRequireAtLeastOneSelectedEdge(enable) {
    this.toggleDisabledElements(["Edge Configuration", "deselectEdgesBtn", "focusEdgesBtn"], enable);
  }

  toggleStyleElementsThatRequireAtLeastOneSelectedNodeOrEdge(enable) {
    this.toggleDisabledElements(["resetSelectedElementsStyleBtn"], enable);
  }

  toggleStyleElementsThatRequireAtLeastOneVisibleNode(enable) {
    this.toggleDisabledElements(["selectByNodeIDsInput", "Node IDs", "selectByNodeIDsSwitch",
      "selectByNodeIDsSwitchLabel", "selectByNodeIDsButton"], enable);
  }

  toggleStyleElementsThatRequireAtLeastOneVisibleEdge(enable) {
    this.toggleDisabledElements(["selectByEdgeIDsInput", "Edge IDs", "selectByEdgeIDsSwitch",
      "selectByEdgeIDsSwitchLabel", "selectByEdgeIDsButton"], enable);
  }

  toggleStyleElementsThatRequireAtLeastOneVisibleNodeOrEdge(enable) {
    this.toggleDisabledElements(["Select Elements"], enable);
  }

  toggleStyleElementsThatRequireMoreThanOneSelectedNode(enable) {
    this.toggleDisabledElements(["Arrange Selection"], enable);
  }

  toggleDisabledElements(headingLabels, enable) {
    for (let elemID of headingLabels) {
      const elem = document.getElementById(elemID);
      if (elem) {
        enable ? elem.classList.remove("disabled") : elem.classList.add("disabled");
      } else {
        this.debug("Element not found: " + elemID);
      }
    }
  }


  logMessage(text, colorClass, bold = false, iconPrefix = "") {
    const timestamp = StaticUtilities.getTimestamp();

    const container = document.getElementById('sidebarStatusContainer');
    container.style.height = "8%";

    const p = document.createElement('p');
    p.style.margin = "0 0 1px 0";

    const spanTime = document.createElement('span');
    spanTime.textContent = `${timestamp} | `;
    spanTime.classList.add("grey");
    p.appendChild(spanTime);

    if (iconPrefix) {
      const spanIcon = document.createElement('span');
      spanIcon.textContent = iconPrefix;
      spanIcon.classList.add("mr");
      p.appendChild(spanIcon);
    }

    const spanText = document.createElement('span');
    spanText.classList.add(colorClass);
    spanText.style.fontWeight = bold ? "bold" : "normal";
    spanText.textContent = text;
    p.appendChild(spanText);

    container.appendChild(p);
    container.scrollTop = container.scrollHeight;
  }

  info(message) {
    this.logMessage(message, "black", false);
  }

  warning(message) {
    this.logMessage(message, "dark-orange", false, "⚠️");
  }

  error(message) {
    this.logMessage(message, "red", true, "⛔");
  }

  success(message) {
    this.logMessage(message, "green", false);
  }

  debug(message) {
    console.log(`${StaticUtilities.getTimestamp(true)} | ${message}`);
    if (this.debugEnabled) {
      this.logMessage(message, "grey", false);
    }
  }

  toggleQueryEditor() {
    const queryBtn = document.getElementById("queryToggleBtn");
    const dataBtn = document.getElementById("dataToggleBtn");
    const shouldEnable = !queryBtn.classList.contains("highlight");

    if (shouldEnable) {
      this.showEditor('query');
      queryBtn.classList.add("highlight");
      dataBtn.classList.remove("highlight");
    } else {
      this.hideBottomBar();
      queryBtn.classList.remove("highlight");
    }

    // Wait for CSS transition to complete (300ms) before resizing graph canvas
    setTimeout(() => {
      if (this.cache.graph) {
        this.cache.graph.resize();
      }
    }, 300);
  }

  async closeBottomBar() {
    const queryBtn = document.getElementById("queryToggleBtn");
    const dataBtn = document.getElementById("dataToggleBtn");

    if (dataBtn.classList.contains("highlight")) {
      await this.toggleDataEditor();
      return;
    }

    if (queryBtn.classList.contains("highlight")) {
      this.toggleQueryEditor();
      return;
    }

    const bottomBar = document.getElementById("bottomBar");
    if (bottomBar.classList.contains("active")) {
      this.hideBottomBar();
      setTimeout(() => {
        if (this.cache.graph) {
          this.cache.graph.resize();
        }
      }, 300);
    }
  }

  async toggleDataEditor() {
    const queryBtn = document.getElementById("queryToggleBtn");
    const dataBtn = document.getElementById("dataToggleBtn");
    const shouldEnable = !dataBtn.classList.contains("highlight");

    if (shouldEnable) {
      await this.showLoading("Data Editor", "Loading Data Editor ..");
      this.showEditor('data');
      dataBtn.classList.add("highlight");
      queryBtn.classList.remove("highlight");
    } else {
      await this.showLoading("Data Editor", "Closing Data Editor ..");
      this.hideBottomBar();
      dataBtn.classList.remove("highlight");
    }

    await this.hideLoading();

    // Wait for CSS transition to complete (300ms) before resizing graph canvas
    setTimeout(() => {
      if (this.cache.graph) {
        this.cache.graph.resize();
      }
    }, 300);
  }

  async reloadApp() {
    if (!this.cache.initialized) return;

    const confirmed = await Popup.confirm('Reload the application and start from scratch?');
    if (confirmed) {
      location.reload();
    }
  }

  showEditor(editorType) {
    const mainContent = document.getElementById("mainContent");
    const bottomBar = document.getElementById("bottomBar");
    const queryEditor = document.getElementById("queryEditor");
    const dataEditor = document.getElementById("dataEditor");
    const queryButtons = document.querySelector(".query-buttons");
    const dataButtons = document.querySelector(".data-buttons");
    const queryToggleButtons = document.querySelectorAll('.add-to-query-button');
    const headerText = document.getElementById("bottomBarHeaderText");
    const helpBtn = document.getElementById("bottomBarHelpBtn");

    if (this.bottomBarHeight) {
      const mainHeight = window.innerHeight - this.bottomBarHeight;
      bottomBar.style.height = this.bottomBarHeight + 'px';
      mainContent.style.height = mainHeight + 'px';
    } else {
      mainContent.style.height = "65%";
      bottomBar.style.height = "35%";
    }
    bottomBar.classList.add("active");

    if (editorType === 'query') {
      queryEditor.style.display = "block";
      dataEditor.style.display = "none";
      queryButtons.style.display = "flex";
      dataButtons.style.display = "none";
      queryToggleButtons.forEach(btn => btn.classList.add("show"));
      headerText.textContent = "Query Editor";
      helpBtn.onclick = () => this.cache.qm.showQueryHelp();
      helpBtn.title = "Display query editor help";
    } else if (editorType === 'data') {
      queryEditor.style.display = "none";
      dataEditor.style.display = "block";
      queryButtons.style.display = "none";
      dataButtons.style.display = "flex";
      queryToggleButtons.forEach(btn => btn.classList.remove("show"));
      headerText.textContent = "Data Editor";
      helpBtn.onclick = () => this.cache.dataTable.help();
      helpBtn.title = "Display data editor help";
    }
  }

  hideBottomBar() {
    const mainContent = document.getElementById("mainContent");
    const bottomBar = document.getElementById("bottomBar");
    const queryToggleButtons = document.querySelectorAll('.add-to-query-button');

    mainContent.style.height = "100%";
    bottomBar.style.height = "0";
    bottomBar.classList.remove("active");
    queryToggleButtons.forEach(btn => btn.classList.remove("show"));
  }

  makeBottomBarResizable() {
    const bottomBar = document.getElementById('bottomBar');
    const mainContent = document.getElementById('mainContent');
    const resizeHandle = bottomBar.querySelector('.resize-handle');
    let isResizing = false;
    let startY = 0;
    let startHeight = 0;
    let shadowBar = null;

    function createShadowBar() {
      if (shadowBar) return shadowBar;

      shadowBar = document.createElement('div');
      shadowBar.classList.add("resize-shadow-bar");
      document.body.appendChild(shadowBar);
      return shadowBar;
    }

    resizeHandle.addEventListener('mousedown', (e) => {
      if (!bottomBar.classList.contains('active')) return;

      isResizing = true;
      startY = e.clientY;
      startHeight = parseInt(document.defaultView.getComputedStyle(bottomBar).height, 10);

      createShadowBar();
      shadowBar.style.display = 'block';
      shadowBar.style.bottom = startHeight + 'px';
      shadowBar.style.height = startHeight + 'px';

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      e.preventDefault();

      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ns-resize';
    });

    function handleMouseMove(e) {
      if (!isResizing || !bottomBar.classList.contains('active')) return;

      const dy = startY - e.clientY;
      const newHeight = startHeight + dy;
      const minHeight = 50;
      const maxHeight = window.innerHeight * 0.5;
      const clampedHeight = Math.min(Math.max(newHeight, minHeight), maxHeight);

      shadowBar.style.bottom = '0px';
      shadowBar.style.height = clampedHeight + 'px';
    }

    const handleMouseUp = (e) => {
      if (!isResizing) return;

      isResizing = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      const dy = startY - e.clientY;
      const newHeight = startHeight + dy;
      const minHeight = 50;
      const maxHeight = window.innerHeight * 0.5;
      const finalHeight = Math.min(Math.max(newHeight, minHeight), maxHeight);

      if (finalHeight !== startHeight) {
        const viewportHeight = window.innerHeight;
        const newMainHeight = viewportHeight - finalHeight;

        bottomBar.style.height = finalHeight + 'px';
        mainContent.style.height = newMainHeight + 'px';
        this.bottomBarHeight = finalHeight;

        // Resize graph canvas after manual resize (no transition, resize immediately)
        if (this.cache.graph) {
          this.cache.graph.resize();
        }
      }

      shadowBar.style.display = 'none';
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }

    window.addEventListener('beforeunload', () => {
      if (shadowBar && shadowBar.parentNode) {
        shadowBar.parentNode.removeChild(shadowBar);
      }
    });
  }

  async toggleEditMode() {
    const editBtn = document.getElementById("editBtn");
    if (!editBtn) return;
    let editModeActive = editBtn.classList.contains("active");
    editModeActive ? editBtn.classList.remove("active") : editBtn.classList.add("active");

    this.handleEditModeUIChanges();
  }

  toggleStylingPanel() {
    const rightSidebar = document.getElementById("rightSidebar");
    const styleBtn = document.getElementById("styleToggleBtn");
    const outerGraphContainer = document.getElementById("outerGraphContainer");
    const isActive = rightSidebar.classList.contains("active");

    if (isActive) {
      rightSidebar.classList.remove("active");
      styleBtn.classList.remove("highlight");
      outerGraphContainer.classList.remove("styling-panel-active");
    } else {
      rightSidebar.classList.add("active");
      styleBtn.classList.add("highlight");
      outerGraphContainer.classList.add("styling-panel-active");
    }

    // Wait for CSS transition to complete (300ms) before resizing graph canvas
    setTimeout(() => {
      if (this.cache.graph) {
        this.cache.graph.resize();
      }
    }, 300);
  }

  toggleSelectionEditor() {
    const container = document.getElementById("selectedElementsContainer");
    const panel = document.getElementById("selectionEditorPanel");
    const toggleBtn = document.getElementById("selectionEditorToggleBtn");
    if (!container || !panel || !toggleBtn) return;

    const isExpanded = container.classList.toggle("expanded");
    toggleBtn.textContent = isExpanded ? "▴" : "▾";
    toggleBtn.title = isExpanded ? "Collapse selection editor" : "Expand selection editor";
    toggleBtn.setAttribute("aria-expanded", isExpanded ? "true" : "false");
  }

  async toggleLassoSelection() {
    const lassoWrapper = document.getElementById("lassoWrapper");
    let lassoIsActive = lassoWrapper.classList.contains("active");
    lassoIsActive ? lassoWrapper.classList.remove("active") : lassoWrapper.classList.add("active");

    const clickAndDragBehaviors = [
      this.cache.gcm.BEHAVIOURS.DRAG_CANVAS,
      this.cache.gcm.BEHAVIOURS.DRAG_ELEMENT
    ];

    if (!this.cache.CFG.DISABLE_HOVER_EFFECT) {
      clickAndDragBehaviors.push(this.cache.gcm.BEHAVIOURS.HOVER_ACTIVATE);
    }

    const lassoBehaviors = [
      this.cache.gcm.BEHAVIOURS.LASSO_SELECT,
    ];

    if (!this.cache.CFG.APPLY_BUBBLE_SET_HOTFIX || (this.cache.CFG.APPLY_BUBBLE_SET_HOTFIX && !this.cache.CFG.DISABLE_HOVER_EFFECT)) {
      lassoBehaviors.push(this.cache.gcm.BEHAVIOURS.CLICK_SELECT);
    }

    let behaviors = await this.cache.graph.getBehaviors()
      .filter(b => ![
        ...clickAndDragBehaviors.map(b => b.type),
        ...lassoBehaviors.map(b => b.type)
      ].includes(b.type));

    lassoIsActive ? this.info("Switched to click and drag mode") : this.info("Switched to lasso selection mode");

    await this.cache.graph.setBehaviors([...behaviors, ...lassoIsActive ? clickAndDragBehaviors : lassoBehaviors]);
    await this.cache.graph.updatePlugin({key: 'tooltip', enable: lassoIsActive});
  }

  async toggleHoverEffect(btn) {
    const isCurrentlyEnabled = !this.cache.CFG.DISABLE_HOVER_EFFECT;

    if (isCurrentlyEnabled) {
      this.cache.CFG.DISABLE_HOVER_EFFECT = true;
      btn.classList.remove("green", "highlight");
      btn.classList.add("red");
      btn.title = "Enable hover highlight effect (H)";
      const behaviors = await this.cache.graph.getBehaviors();
      const filtered = behaviors.filter(b => b.type !== this.cache.gcm.BEHAVIOURS.HOVER_ACTIVATE.type);
      await this.cache.graph.setBehaviors(filtered);

      // Clear any lingering highlight/dim states from the hover behavior
      const stateMap = {};
      for (const node of this.cache.graph.getNodeData()) {
        const states = await this.cache.graph.getElementState(node.id);
        const cleaned = states.filter(s => s !== "highlight" && s !== "dim");
        if (cleaned.length !== states.length) stateMap[node.id] = cleaned;
      }
      for (const edge of this.cache.graph.getEdgeData()) {
        const states = await this.cache.graph.getElementState(edge.id);
        const cleaned = states.filter(s => s !== "highlight" && s !== "dim");
        if (cleaned.length !== states.length) stateMap[edge.id] = cleaned;
      }
      if (Object.keys(stateMap).length > 0) {
        await this.cache.graph.setElementState(stateMap);
      }

      this.info("Hover highlight effect disabled");
    } else {
      this.cache.CFG.DISABLE_HOVER_EFFECT = false;
      btn.classList.remove("red");
      btn.classList.add("green", "highlight");
      btn.title = "Disable hover highlight effect (H)";
      const behaviors = await this.cache.graph.getBehaviors();
      behaviors.push(this.cache.gcm.BEHAVIOURS.HOVER_ACTIVATE);
      await this.cache.graph.setBehaviors(behaviors);
      this.info("Hover highlight effect enabled");
    }
  }

  updateHoverToggleButton() {
    const btn = document.getElementById("hoverToggleBtn");
    if (!btn) return;
    if (this.cache.CFG.DISABLE_HOVER_EFFECT) {
      btn.classList.remove("green", "highlight");
      btn.classList.add("red");
      btn.title = "Enable hover highlight effect (H)";
    } else {
      btn.classList.remove("red");
      btn.classList.add("green", "highlight");
      btn.title = "Disable hover highlight effect (H)";
    }
  }

  handleEditModeUIChanges() {
    const editBtn = document.getElementById("editBtn");
    if (!editBtn) return;
    const editModeActive = editBtn.classList.contains("active");

    editModeActive ? editBtn.classList.add("highlight") : editBtn.classList.remove("highlight");

    // handle all edit elements
    const editElements = document.querySelectorAll('.show-on-edit, .show-on-edit-full-width');
    editElements.forEach(el => {
      editModeActive ? el.classList.add("show") : el.classList.remove("show");
      el.style.height = editModeActive ? `${el.scrollHeight}px` : "0";
    });

    const hideOnEditElements = document.querySelectorAll('.hide-on-edit');
    hideOnEditElements.forEach(el => {
      el.style.display = editModeActive ? "none" : "";
    });

    // 'collapse' all open style rows
    if (!editModeActive) {
      const styleRows = document.querySelectorAll('.style-row');
      styleRows.forEach(row => {
        row.classList.remove("show");
      });
    }

    // handle filter row layouts
    const filterRows = document.querySelectorAll('.filter-row');
    filterRows.forEach(row => {
      const sliderCol = row.querySelector(".filter-row-col2");
      const hasRangeSlider = sliderCol.querySelector(".hide-on-edit");
      if (hasRangeSlider) {
        sliderCol.style.display = editModeActive ? "flex" : "";
        sliderCol.style.alignItems = editModeActive ? "center" : "";
        sliderCol.style.gap = editModeActive ? "4px" : "";
      } else {
        sliderCol.style.display = "";
        sliderCol.style.alignItems = "";
        sliderCol.style.gap = "";
      }
    });
  }

  buildUI() {
    this.cache.query.text = document.getElementById("queryTextArea");
    this.cache.query.overlay = document.getElementById("queryOverlay");
    this.cache.query.caret = document.getElementById("queryCaret");
    this.cache.query.editorDiv = document.getElementById("queryEditor");

    this.cache.query.sizeObserver = new ResizeObserver(() => requestAnimationFrame(() => this.cache.qm.validateAlignment()))
    this.cache.query.sizeObserver.observe(this.cache.query.editorDiv);

    this.cache.query.text.addEventListener("scroll", () => {
      this.cache.query.overlay.scrollTop = this.cache.query.text.scrollTop;
      this.cache.query.overlay.scrollLeft = this.cache.query.text.scrollLeft;
    });

    this.cache.uiComponents.buildDropdownOptions();

    const div = document.getElementById("metricsContainer");
    div.innerHTML = "";
    div.appendChild(this.cache.metrics.buildMetricUI());

    // Initialize manual bubble group button
    const manualButtonContainer = document.getElementById("manualBubbleGroupButtonContainer");
    manualButtonContainer.innerHTML = "";
    manualButtonContainer.appendChild(this.cache.uiComponents.createManualBubbleGroupButton());

    this.buildFilterUI();

    this.buildStylingPanelUI();

    document.getElementById("resetSelectedElementsStyleBtn").title = this.cache.CFG.RESET_SELECTION_BUTTON_RESETS_POSITIONS
      ? "Reset the visual appearance and positions of the selected elements to their defaults"
      : "Reset the visual appearance of the selected elements to their defaults";

    this.showUI(true);

    this.cache.query.lastGoodWidth = this.cache.query.editorDiv.offsetWidth;
    this.cache.qm.validateAlignment();
  }

  buildFilterUI() {
    const div = document.getElementById("filterContainer");
    const editBtn = document.getElementById("editBtn");
    div.innerHTML = "";

    // Re-append editBtn if it exists
    if (editBtn) {
      div.appendChild(editBtn);
    }

    // Always create lock status bar, show/hide based on lock state
    const statusBar = this.createFilterLockStatusBar();
    statusBar.id = 'filterLockStatusBar';
    statusBar.style.display = this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY ? 'flex' : 'none';
    div.appendChild(statusBar);

    // Add/remove locked class on container
    if (this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY) {
      div.classList.add('locked');
    } else {
      div.classList.remove('locked');
    }

    let sectionsCreated = new Set();
    let subSectionsCreated = new Set();
    const sortedPropIDs = this.cache.CFG.SORT_FILTERS ?
      [...this.cache.data.layouts[this.cache.data.selectedLayout].filters.keys()].sort() :
      [...this.cache.data.layouts[this.cache.data.selectedLayout].filters.keys()];

    for (let propID of sortedPropIDs) {
      let [section, subSection, prop] = StaticUtilities.decodePropHashId(propID);
      let isCategoricalProperty = this.cache.data.filterDefaults.get(propID).isCategory;
      if (!sectionsCreated.has(section)) {
        if (sectionsCreated.size > 0) div.appendChild(document.createElement("hr"));
        const headerDiv = document.createElement("div");
        headerDiv.className = "header-card";
        const header = document.createElement("h4");
        header.textContent = section;
        header.className = "m-0 white";
        headerDiv.appendChild(header);
        headerDiv.appendChild(this.cache.uiComponents.createSectionToggleButton(false, section));
        headerDiv.appendChild(this.cache.uiComponents.createSectionResetButton(section));
        headerDiv.appendChild(this.cache.uiComponents.createSectionToggleButton(true, section));
        div.appendChild(headerDiv);
        div.appendChild(document.createElement("br"));
        sectionsCreated.add(section);
      }
      if (!subSectionsCreated.has(`${section}::${subSection}`)) {
        const subHeaderDiv = document.createElement("div");
        subHeaderDiv.className = "sub-header-card";
        const subHeader = document.createElement("h5");
        subHeader.textContent = subSection;
        subHeader.className = "m-0 inline";
        subHeaderDiv.appendChild(subHeader);
        subHeaderDiv.appendChild(this.cache.uiComponents.createSectionToggleButton(false, section, subSection));
        subHeaderDiv.appendChild(this.cache.uiComponents.createSectionResetButton(section, subSection));
        subHeaderDiv.appendChild(this.cache.uiComponents.createSectionToggleButton(true, section, subSection));
        div.appendChild(subHeaderDiv);
        subSectionsCreated.add(`${section}::${subSection}`);
      }
      const row = document.createElement('div');
      row.className = "filter-row";
      const col1 = document.createElement('div');
      col1.className = "filter-row-col1";
      col1.appendChild(this.cache.uiComponents.createCheckbox(propID, prop));
      row.appendChild(col1);
      const col2 = document.createElement('div');
      col2.className = "filter-row-col2";
      row.appendChild(col2);

      const sliderOrDropdown = isCategoricalProperty
        ? new DropdownChecklist(propID, this.cache)
        : new InvertibleRangeSlider(propID, this.cache);

      sliderOrDropdown.appendTo(col2);
      const col3 = document.createElement('div');
      col3.className = "filter-row-col3";
      if (this.cache.nodeExclusiveProps.has(propID) || this.cache.mixedProps.has(propID)) {
        col3.appendChild(this.cache.uiComponents.createCircleGroupButtonWithQuadrants(propID));
      } else {
        const placeHolder = document.createElement('div');
        placeHolder.style.width = "18px";
        col3.appendChild(placeHolder);
      }
      col3.appendChild(this.cache.uiComponents.createAddOrRemoveToSelectionGroup(propID));
      row.appendChild(col3);
      div.append(row);
      sliderOrDropdown.appendListeners();
    }

    this.manageDynamicWidgets();
    this.handleEditModeUIChanges();
    this.cache.qm.updateQueryTextArea();
  }

  showUI(show) {
    const landing = document.getElementById('landingPage');
    if (landing) {
      if (show) landing.classList.add('hidden');
      else landing.classList.remove('hidden');
    }

    document.querySelectorAll('.showOnLoad').forEach((element) => {
      element.style.opacity = show ? "1" : "0";
      element.style.pointerEvents = show ? "auto" : "none";
    });

    document.querySelectorAll('.hideOnLoad').forEach((element) => {
      element.style.opacity = show ? "0" : "1";
      element.style.pointerEvents = show ? "none" : "auto";
      element.style.height = show ? "0" : "auto";
    });

    const appHeader = document.getElementById('appHeader');
    if (appHeader) {
      if (show) {
        appHeader.classList.remove('disabled-header');
        appHeader.classList.add('compact-header');
        appHeader.title = 'Click to reload application';
      } else {
        appHeader.classList.add('disabled-header');
        appHeader.classList.remove('compact-header');
        appHeader.title = '';
      }
    }
  }

  uncheckAllCheckboxes() {
    for (const propID of this.cache.propIDs) {
      this.checkCheckbox(propID, false);
    }
  }

  checkCheckbox(propID, enable = true) {
    const checkbox = document.getElementById(`filter-${propID}-checkbox`);
    const span = document.getElementById(`filter-${propID}-checkbox-inner`);
    const wrapper = document.getElementById(`filter-${propID}-checkbox-wrapper`);

    checkbox.checked = enable;
    this.cache.data.layouts[this.cache.data.selectedLayout].filters.get(propID).active = enable;

    enable ? this.cache.activeProps.add(propID) : this.cache.activeProps.delete(propID);
    span.textContent = enable ? '✔' : '';
    wrapper.title = this.cache.uiComponents.getCheckboxTT(enable, propID);
  }

  manageDynamicWidgets() {
    let isCustomLayout = this.cache.data.layouts[this.cache.data.selectedLayout].isCustom;
    let removeLayoutBtnCls = document.getElementById("removeSelectedLayoutButton").classList;

    isCustomLayout ? removeLayoutBtnCls.remove("disabled") : removeLayoutBtnCls.add("disabled");
  }

  async toggleSection(enable, section) {
    this.toggleCheckboxesForSetOfPropIDs(enable, section);
    await this.cache.fm.handleFilterEvent(`${enable ? 'Showing' : 'Hiding'} Elements`, `Nodes and related edges for ${section}`);
  }

  async toggleSubSection(enable, section, subSection) {
    this.toggleCheckboxesForSetOfPropIDs(enable, section + "::" + subSection);
    await this.cache.fm.handleFilterEvent(`${enable ? 'Showing' : 'Hiding'} Elements`, `Nodes and related edges for ${section} ${subSection}`);
  }

  toggleCheckboxesForSetOfPropIDs(enable, propIDPrefixToSearchFor) {
    const setOfPropIDs = [...this.cache.propToNodes.keys(), ...this.cache.propToEdgeIDs.keys()]
      .filter(propID => propID.startsWith(propIDPrefixToSearchFor));
    for (let propID of setOfPropIDs) {
      let checkbox = document.getElementById(`filter-${propID}-checkbox`);
      let wrapper = document.getElementById(`filter-${propID}-checkbox-wrapper`);
      let inner = document.getElementById(`filter-${propID}-checkbox-inner`);
      checkbox.checked = enable;
      this.cache.data.layouts[this.cache.data.selectedLayout].filters.get(propID).active = enable;
      enable ? this.cache.activeProps.add(propID) : this.cache.activeProps.delete(propID);
      wrapper.title = this.cache.uiComponents.getCheckboxTT(enable, propID);
      inner.textContent = enable ? '✔' : '';
    }
  }

  clearActivePropsCacheOnLayoutChange() {
  this.cache.activeProps = new Set();
  for (const [key, value] of this.cache.data.layouts[this.cache.data.selectedLayout].filters.entries()) {
    if (value.active) {
      this.cache.activeProps.add(key);
    }
  }
}

  createFilterLockStatusBar() {
    const statusBar = document.createElement('div');
    statusBar.className = 'filter-lock-status-bar';
    statusBar.innerHTML = `
      <div class="filter-lock-message">
        <span class="filter-lock-icon">🔒</span>
        <span>Filters locked | Query manually edited</span>
      </div>
      <button class="filter-unlock-btn" onclick="cache.ui.unlockFiltersAndResetQuery()">
        Reset
      </button>
    `;
    return statusBar;
  }

  updateFilterLockState() {
    const statusBar = document.getElementById('filterLockStatusBar');
    const container = document.getElementById('filterContainer');

    if (statusBar && container) {
      const isLocked = this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY;

      if (isLocked) {
        statusBar.style.display = 'flex';
        container.classList.add('locked');
      } else {
        statusBar.style.display = 'none';
        container.classList.remove('locked');
      }

      // Disable/enable all range inputs programmatically to fully prevent interaction
      const rangeInputs = container.querySelectorAll('input[type="range"]');
      rangeInputs.forEach(input => {
        input.disabled = isLocked;
      });

      // Disable/enable number inputs
      const numberInputs = container.querySelectorAll('input[type="number"]');
      numberInputs.forEach(input => {
        input.disabled = isLocked;
      });
    }
  }

  async unlockFiltersAndResetQuery() {
    this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY = false;
    this.cache.qm.resetQuery();
    this.updateFilterLockState(); // Update UI without full rebuild

    // Apply the reset query without re-locking
    this.cache.EVENT_LOCKS.QUERY_UPDATE_EVENT = true;
    try {
      await this.cache.fm.handleFilterEvent("Resetting Query", "Syncing filters with UI state", null, false);
    } finally {
      this.cache.EVENT_LOCKS.QUERY_UPDATE_EVENT = false;
    }
  }

  buildStylingPanelUI() {
    const content = document.getElementById("stylingPanelContent");
    content.innerHTML = "";
    content.appendChild(createStyleDiv(this.cache));
    this.mountSelectionEditorCards();
  }

  mountSelectionEditorCards() {
    const selectionPanel = document.getElementById("selectionEditorPanel");
    if (!selectionPanel) return;

    selectionPanel.innerHTML = "";
    ["Focus Elements", "Select Elements", "Arrange Selection"].forEach((cardId) => {
      const card = document.getElementById(cardId);
      if (card) selectionPanel.appendChild(card);
    });
  }
}

export {UIManager};
