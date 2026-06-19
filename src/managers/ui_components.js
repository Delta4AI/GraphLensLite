import {DEFAULTS} from "../config.js";
import {StaticUtilities} from "../utilities/static.js";

class DropdownChecklist {
  constructor(propID, cache) {
    this.propID = propID;
    this.cache = cache;
    this.categories = this.cache.data.filterDefaults.get(propID).categories;
    this.selectedCategories = this.cache.data.layouts[this.cache.data.selectedLayout].filters.get(propID).categories;
    this.isVisible = false;
    this.sortCategories();
    this.cache.propIDToDropdownChecklists.set(propID, this);
  }

  sortCategories() {
    const catArray = Array.isArray(this.categories)
      ? [...this.categories]
      : Array.from(this.categories);

    catArray.sort((a, b) => {
      const getPriority = (val) => {
        const lower = val.toLowerCase();
        if (lower === "low") return 1;
        if (lower === "medium") return 2;
        if (lower === "high") return 3;
        return 0; // “other” values
      };
      const priorityA = getPriority(a);
      const priorityB = getPriority(b);

      if (priorityA === 0 && priorityB === 0) {
        // Both “other” values → alphabetical
        return a.localeCompare(b);
      }
      // Sort by priority ascending: 0 → “other”, 1 → “low”, 2 → “medium”, 3 → “high”
      return priorityA - priorityB;
    });

    this.categories = new Set(catArray);
  }

  appendTo(parent) {
    this.container = document.createElement("div");
    this.container.id = this.propID + "-dropdown";
    this.container.className = "dropdown-check-list";
    this.container.tabIndex = 100;

    // Create the anchor (visible clickable part)
    this.anchor = document.createElement("h5");
    this.anchor.className = "anchor purple round-border";
    this.anchor.textContent = `${this.selectedCategories.size}/${this.categories.size} selected`;
    this.anchor.id = this.propID + "-dropdown-anchor";
    this.container.appendChild(this.anchor);

    // Create the unordered list (dropdown items)
    this.itemsList = document.createElement("ul");
    this.itemsList.className = "items";

    // add buttons on top
    this.buttonContainer = document.createElement("div");
    this.buttonContainer.className = "dropdown-buttons";

    this.selectAllButton = document.createElement("button");
    this.selectAllButton.textContent = "Select All";

    this.deselectAllButton = document.createElement("button");
    this.deselectAllButton.textContent = "Deselect All";

    this.buttonContainer.appendChild(this.selectAllButton);
    this.buttonContainer.appendChild(this.deselectAllButton);

    this.itemsList.appendChild(this.buttonContainer);

    // Add the options as checkboxes
    this.categories.forEach(option => {
      const listItem = document.createElement("li");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = option;
      checkbox.checked = this.selectedCategories.has(option);
      checkbox.className = "hidden-checkbox";
      checkbox.addEventListener("change", async (ev) => await this.handleSelection(ev));

      const customCheckbox = document.createElement("span");
      customCheckbox.className = "custom-checkbox";

      checkbox.addEventListener("change", () => {
        checkbox.checked ? customCheckbox.classList.add("checked") : customCheckbox.classList.remove("checked");
      });

      // Set initial state
      if (checkbox.checked) customCheckbox.classList.add("checked");

      const label = document.createElement("label");
      label.textContent = option;
      label.prepend(customCheckbox);
      label.prepend(checkbox);

      listItem.appendChild(label);
      this.itemsList.appendChild(listItem);
    });

    this.container.appendChild(this.itemsList);

    parent.appendChild(this.container);
  }

  async handleSelection(ev) {
    if (this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY) {
      ev.preventDefault();
      return;
    }
    try {
      ev.target.checked
        ? this.selectedCategories.add(ev.target.value)
        : this.selectedCategories.delete(ev.target.value);
      this.anchor.textContent = `${this.selectedCategories.size}/${this.categories.size} selected`;
      await this.cache.fm.handleFilterEvent(ev.target.checked ? "Showing" : "Hiding" + " Elements",
        `Nodes and related edges for ${this.propID} ${ev.target.value}`, this.propID);
      // this.cache.ui.debug(`${this.propID} ${ev.target.value} ${ev.target.checked}`);
    } catch (err) {
      this.cache.ui.error(`Failed to handle category selection: ${err.message}`);
    }
  }

  appendListeners() {
    const updateDropdownPosition = () => {
      // Temporarily make the dropdown visible to calculate its height
      this.itemsList.style.visibility = "hidden";
      this.itemsList.style.display = "block";

      const dropdownHeight = this.itemsList.offsetHeight;
      this.itemsList.style.display = "";
      this.itemsList.style.visibility = "";

      const anchorRect = this.anchor.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const availableHeight = viewportHeight - anchorRect.bottom;

      // Set position of the dropdown
      this.itemsList.style.top = `${anchorRect.bottom}px`;
      this.itemsList.style.left = `${anchorRect.left - 3}px`;

      // Make the dropdown scrollable if there's not enough space
      if (dropdownHeight > availableHeight) {
        this.itemsList.style.maxHeight = `${availableHeight}px`;
        this.itemsList.style.overflowY = "auto";
      } else {
        this.itemsList.style.maxHeight = "";
        this.itemsList.style.overflowY = "";
      }
    };

    this.anchor.addEventListener("click", () => {
      this.isVisible = !this.isVisible;
      if (this.isVisible) {
        updateDropdownPosition();
        document.addEventListener("scroll", updateDropdownPosition, true);
        this.container.classList.add("visible");
      } else {
        this.container.classList.remove("visible");
        document.removeEventListener("scroll", updateDropdownPosition, true);
      }
    });

    // button callbacks
    this.selectAllButton.addEventListener("click", async () => await this.selectAllCategories());
    this.deselectAllButton.addEventListener("click", async () => await this.deselectAllCategories());

    // Handle clicks outside the dropdown to close it
    document.addEventListener("click", (event) => {
      if (!this.container.contains(event.target)) {
        this.isVisible = false;
        this.container.classList.remove("visible");
      }
    });
  }

  selectCategory(category) {
    if (!this.categories.has(category)) {
      this.cache.ui.warning(`Category "${category}" does not exist for ${this.propID}`);
      return;
    }

    this.selectedCategories.add(category);

    const checkbox = this.itemsList.querySelector(
      `input[type="checkbox"][value="${CSS.escape(category)}"]`
    );
    checkbox.checked = true;
    checkbox.nextElementSibling.classList.add("checked");
    this.anchor.textContent = `${this.selectedCategories.size}/${this.categories.size} selected`;
  }

  async selectAllCategories(skipFilterEvent = false) {
    try {
      this.categories.forEach(category => this.selectedCategories.add(category)); // Add all categories
      this.updateCheckboxStates(true);
      if (!skipFilterEvent) {
        await this.cache.fm.handleFilterEvent("Showing Elements", `Nodes and related edges for ${this.propID}`, this.propID);
      }
    } catch (err) {
      this.cache.ui.error(`Failed to select all categories: ${err.message}`);
    }
  }

  async deselectAllCategories(skipFilterEvent = false) {
    try {
      this.categories.forEach(category => this.selectedCategories.delete(category)); // Clear all categories
      this.updateCheckboxStates(false);
      if (!skipFilterEvent) {
        await this.cache.fm.handleFilterEvent("Hiding Elements", `Nodes and related edges for ${this.propID}`, this.propID);
      }
    } catch (err) {
      this.cache.ui.error(`Failed to deselect all categories: ${err.message}`);
    }
  }

  updateCheckboxStates(selectAll) {
    Array.from(this.itemsList.querySelectorAll("input[type='checkbox']")).forEach(checkbox => {
      checkbox.checked = selectAll; // Update checkbox state
      selectAll
        ? checkbox.nextElementSibling.classList.add("checked")
        : checkbox.nextElementSibling.classList.remove("checked");
    });
    this.anchor.textContent = `${this.selectedCategories.size}/${this.categories.size} selected`; // Update anchor text
  }

}

class InvertibleRangeSlider {
  constructor(propID, cache) {
    this.propID = propID;
    this.cache = cache;
    const defaultFilterData = structuredClone(this.cache.data.filterDefaults.get(propID));
    this.readCurrentFilterSettings();
    this.sliderMin = defaultFilterData.lowerThreshold;
    this.sliderMax = defaultFilterData.upperThreshold;
    const allInteger = StaticUtilities.isInteger(this.sliderMin) && StaticUtilities.isInteger(this.sliderMax) && !defaultFilterData.hasFloatValues;
    // Integer columns step by whole units (discrete counts). Float columns use
    // "any" — a continuous control with no value grid, so the column max (and
    // any high-decimal value) stays exactly selectable via both the slider and
    // the number box, at any column magnitude. A fixed absolute step floored
    // the reachable max below the true max and broke selection of the top node.
    this.stepSize = allInteger ? this.cache.CFG.FILTER_STEP_SIZE_INTEGER : "any";
    this.initializeIds();
    this.inputStart = null;
    this.inputEnd = null;
    this.cache.propIDToInvertibleRangeSliders.set(propID, this);
  }

  initializeIds() {
    this.sliderId = `filter-${this.propID}-slider`;
    this.sliderIdStart = `${this.sliderId}-start`;
    this.sliderIdStartInput = `${this.sliderId}-start-input`;
    this.sliderIdEnd = `${this.sliderId}-end`;
    this.sliderIdEndInput = `${this.sliderId}-end-input`;
    this.inverseLeftId = `${this.sliderId}-inverse-left`;
    this.inverseRightId = `${this.sliderId}-inverse-right`;
    this.rangeId = `${this.sliderId}-range`;
    this.thumbStartId = `${this.sliderId}-thumb-start`;
    this.thumbEndId = `${this.sliderId}-thumb-end`;
    this.labelStartId = `${this.sliderIdStart}-label`;
    this.labelEndId = `${this.sliderIdEnd}-label`;
  }

  readCurrentFilterSettings() {
    if (!this.cache.data.layouts[this.cache.data.selectedLayout].filters.has(this.propID)) {
      this.currentMin = 0;
      this.currentMax = 1;
      this.isInverted = false;
    } else {
      let filterData = this.cache.data.layouts[this.cache.data.selectedLayout].filters.get(this.propID);
      this.currentMin = filterData.lowerThreshold;
      this.currentMax = filterData.upperThreshold;
      this.isInverted = filterData.isInverted;
    }
  }

  writeCurrentFilterSettings() {
    if (this.cache.data.layouts[this.cache.data.selectedLayout].filters.has(this.propID)) {
      let filterData = this.cache.data.layouts[this.cache.data.selectedLayout].filters.get(this.propID);
      filterData.lowerThreshold = this.currentMin;
      filterData.upperThreshold = this.currentMax;
      filterData.isInverted = this.isInverted;
    }
  }

  calcPercentage(value) {
    return ((value - this.sliderMin) / (this.sliderMax - this.sliderMin)) * 100;
  }

  getDOMReferences() {
    this.slider = document.getElementById(this.sliderId);
    this.sliderStart = document.getElementById(this.sliderIdStart);
    this.sliderStartInput = document.getElementById(this.sliderIdStartInput);
    this.sliderEnd = document.getElementById(this.sliderIdEnd);
    this.sliderEndInput = document.getElementById(this.sliderIdEndInput);
    this.inverseLeft = document.getElementById(this.inverseLeftId);
    this.inverseRight = document.getElementById(this.inverseRightId);
    this.range = document.getElementById(this.rangeId);
    this.thumbStart = document.getElementById(this.thumbStartId);
    this.thumbEnd = document.getElementById(this.thumbEndId);
    this.labelStart = document.getElementById(this.labelStartId);
    this.labelEnd = document.getElementById(this.labelEndId);
    // The value bubbles ([sign]) and their track parent — positioned with
    // position:fixed (see positionSigns) so they can extend past the sidebar's
    // clipped edges into the canvas; z-index alone cannot escape overflow.
    this.signLeft = this.labelStart ? this.labelStart.parentElement : null;
    this.signRight = this.labelEnd ? this.labelEnd.parentElement : null;
    this.track = this.range ? this.range.parentElement : null;
  }

  // Pins the hover value bubbles to the track ends in viewport coordinates so
  // they render above everything and are not clipped by the sidebar's
  // overflow. Recomputed on hover and on scroll/resize while hovered.
  positionSigns() {
    if (!this.track || !this.signLeft || !this.signRight) return;
    const r = this.track.getBoundingClientRect();
    if (r.width === 0) return; // not laid out yet
    const midY = r.top + r.height / 2;
    const lw = this.signLeft.offsetWidth, lh = this.signLeft.offsetHeight;
    const rw = this.signRight.offsetWidth, rh = this.signRight.offsetHeight;
    this.signLeft.style.top = `${midY - lh / 2}px`;
    this.signLeft.style.left = `${Math.max(2, r.left - lw - 8)}px`;
    this.signRight.style.top = `${midY - rh / 2}px`;
    this.signRight.style.left = `${Math.min(window.innerWidth - rw - 2, r.right + 8)}px`;
  }

  createSliderInput(id, initialValue, relatedSliderId) {
    const input = document.createElement("input");
    input.id = id;
    input.value = initialValue;
    input.addEventListener('keydown', (ev) => {
      if (this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY) {
        ev.preventDefault();
        return;
      }
      if (ev.key === 'Enter') {
        let newValue = parseFloat(input.value);
        const sliderElem = document.getElementById(relatedSliderId);
        if (isNaN(newValue) || newValue < this.sliderMin || newValue > this.sliderMax) {
          input.value = sliderElem.value;
        } else {
          sliderElem.value = newValue;
          sliderElem.dispatchEvent(new Event("input"));
          sliderElem.dispatchEvent(new Event("change"));
        }
      }
    });
    return input;
  }

  reset() {
    // Reset to min/max values in non-inverted state
    this.setTo(this.sliderMin, this.sliderMax, false);

    this.isInverted = false;
    this.currentMin = this.sliderMin;
    this.currentMax = this.sliderMax;
    this.writeCurrentFilterSettings();
  }

  appendTo(parent) {
    if (this.cache.CFG.HIDE_SLIDERS_WITH_SAME_MIN_MAX_VALUES && this.sliderMin === this.sliderMax) {
      parent.appendChild(document.createElement("span"));
      return false;
    }
    this.isValidSlider = true;

    const div = document.createElement("div");
    div.innerHTML = this.createDivInnerHTML();
    const slider = div.firstElementChild;
    slider.style.width = '100%';
    slider.title = `Set the thresholds for the numeric property: ${StaticUtilities.formatPropsAsTree(this.propID)}\n---\n  - Move handles to set min/max (≥ min ∧ ≤ max).\n  - Swap handles to invert (≤ min ∨ ≥ max).\n  - Double-click to reset.`;

    // Min/max number boxes are always visible directly under the slider, so
    // exact thresholds can be typed without a hidden "edit mode". They stay in
    // sync with the handles via handleThresholdOnInputEvent (writes their values).
    const inputRow = document.createElement('div');
    inputRow.className = 'filter-input-row';
    this.inputStart = this.createSliderInput(this.sliderIdStartInput, this.currentMin, this.sliderIdStart);
    this.inputStart.title = "Lower threshold — type an exact value and press Enter";
    this.inputEnd = this.createSliderInput(this.sliderIdEndInput, this.currentMax, this.sliderIdEnd);
    this.inputEnd.title = "Upper threshold — type an exact value and press Enter";
    inputRow.appendChild(this.inputStart);
    inputRow.appendChild(this.inputEnd);

    parent.appendChild(slider);
    parent.appendChild(inputRow);
  }

  createDivInnerHTML() {
    return `
      <div slider id="${this.sliderId}">
        <div>
          <div id="${this.inverseLeftId}" inverse-left style="width:${this.calcPercentage(this.currentMin)}%;"></div>
          <div id="${this.inverseRightId}" inverse-right style="width:${100 - this.calcPercentage(this.currentMax)}%;"></div>
          <div id="${this.rangeId}" range style="left:${this.calcPercentage(this.currentMin)}%; 
                 right:${100 - this.calcPercentage(this.currentMax)}%;"></div>
          <span id="${this.thumbStartId}" thumb style="left:${this.calcPercentage(this.currentMin)}%;"></span>
          <span id="${this.thumbEndId}" thumb style="left:${this.calcPercentage(this.currentMax)}%;"></span>
          <div sign class="left">
            <span id="${this.labelStartId}">${StaticUtilities.formatNumber(this.currentMin, this.cache.CFG.FILTER_VISUAL_FLOAT_PRECISION)}</span>
          </div>
          <div sign class="right">
            <span id="${this.labelEndId}">${StaticUtilities.formatNumber(this.currentMax, this.cache.CFG.FILTER_VISUAL_FLOAT_PRECISION)}</span>
          </div>
        </div>
        <input type="range" tabindex="0" value="${this.currentMin}" max="${this.sliderMax}" min="${this.sliderMin}" 
          step="${this.stepSize}" id="${this.sliderIdStart}" />
        <input type="range" tabindex="0" value="${this.currentMax}" max="${this.sliderMax}" min="${this.sliderMin}" 
          step="${this.stepSize}" id="${this.sliderIdEnd}" />
      </div>
    `;
  }

  appendListeners() {
    if (!this.isValidSlider) return;
    this.getDOMReferences();

    // Position the fixed value bubbles on hover; keep them pinned while the
    // sidebar scrolls or the window resizes during the hover.
    const reposition = () => this.positionSigns();
    this.slider.addEventListener('mouseenter', () => {
      this.positionSigns();
      window.addEventListener('scroll', reposition, true);
      window.addEventListener('resize', reposition);
    });
    this.slider.addEventListener('mouseleave', () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    });

    this.slider.addEventListener('dblclick', () => {
      this.reset();
      this.sliderEnd.dispatchEvent(new Event('change'));
    });

    this.sliderStart.addEventListener("input", () => {
      if (this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY) return;
      this.handleThresholdOnInputEvent(true);
    });
    this.sliderStart.addEventListener("change", async () => {
      if (this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY) return;
      try {
        this.writeCurrentFilterSettings();
        await this.cache.fm.handleFilterEvent("Filtering",
          `Applying lower threshold ${this.sliderStart.value} for ${this.propID}`, this.propID);
      } catch (err) {
        this.cache.ui.error(`Failed to apply lower threshold: ${err.message}`);
      }
    });
    this.sliderEnd.addEventListener("input", () => {
      if (this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY) return;
      this.handleThresholdOnInputEvent(false);
    });
    this.sliderEnd.addEventListener("change", async () => {
      if (this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY) return;
      try {
        this.writeCurrentFilterSettings();
        await this.cache.fm.handleFilterEvent("Filtering",
          `Applying upper threshold ${this.sliderEnd.value} for ${this.propID}`, this.propID);
      } catch (err) {
        this.cache.ui.error(`Failed to apply upper threshold: ${err.message}`);
      }
    });

    // initially dispatch input event once to match slider visuals to the current state
    this.sliderStart.dispatchEvent(new Event('input'));
    this.sliderEnd.dispatchEvent(new Event('input'));
  }

  handleThresholdOnInputEvent(isLower) {
    const primarySlider = isLower ? this.sliderStart : this.sliderEnd;
    const secondarySlider = isLower ? this.sliderEnd : this.sliderStart;
    const primaryValue = parseFloat(primarySlider.value);
    const secondaryValue = parseFloat(secondarySlider.value);

    this.isInverted = isLower ? primaryValue > secondaryValue : primaryValue < secondaryValue;

    if (this.isInverted) {
      this.range.style.width = '0%';
      const leftWidth = this.calcPercentage(isLower ? secondaryValue : primaryValue);
      const rightWidth = this.calcPercentage(isLower ? primaryValue : secondaryValue);
      this.inverseLeft.style.width = leftWidth + '%';
      this.inverseRight.style.width = (100 - rightWidth) + '%';
      this.range.style.left = '50%';
      this.inverseLeft.style.backgroundColor = '#C33D35';
      this.inverseRight.style.backgroundColor = '#C33D35';
      if (isLower) {
        this.labelEnd.innerHTML = StaticUtilities.formatNumber(primaryValue, this.cache.CFG.FILTER_VISUAL_FLOAT_PRECISION);
        this.labelStart.innerHTML = StaticUtilities.formatNumber(secondaryValue, this.cache.CFG.FILTER_VISUAL_FLOAT_PRECISION);
      } else {
        this.labelStart.innerHTML = StaticUtilities.formatNumber(primaryValue, this.cache.CFG.FILTER_VISUAL_FLOAT_PRECISION);
        this.labelEnd.innerHTML = StaticUtilities.formatNumber(secondaryValue, this.cache.CFG.FILTER_VISUAL_FLOAT_PRECISION);
      }

      this.labelStart.parentElement.classList.add("flipped");
      this.labelEnd.parentElement.classList.add("flipped");

      this.inputStart.classList.add("red");
      this.inputEnd.classList.add("red");
    } else {
      const leftPos = this.calcPercentage(isLower ? primaryValue : secondaryValue);
      const rightPos = 100 - this.calcPercentage(isLower ? secondaryValue : primaryValue);
      this.range.style.left = leftPos + '%';
      this.range.style.width = (100 - leftPos - rightPos) + '%';
      this.inverseLeft.style.width = leftPos + '%';
      this.inverseRight.style.width = rightPos + '%';
      this.inverseLeft.style.backgroundColor = 'grey';
      this.inverseRight.style.backgroundColor = 'grey';
      if (isLower) {
        this.labelStart.innerHTML = StaticUtilities.formatNumber(primaryValue, this.cache.CFG.FILTER_VISUAL_FLOAT_PRECISION);
        this.labelEnd.innerHTML = StaticUtilities.formatNumber(secondaryValue, this.cache.CFG.FILTER_VISUAL_FLOAT_PRECISION);
      } else {
        this.labelStart.innerHTML = StaticUtilities.formatNumber(secondaryValue, this.cache.CFG.FILTER_VISUAL_FLOAT_PRECISION);
        this.labelEnd.innerHTML = StaticUtilities.formatNumber(primaryValue, this.cache.CFG.FILTER_VISUAL_FLOAT_PRECISION);
      }

      this.labelStart.parentElement.classList.remove("flipped");
      this.labelEnd.parentElement.classList.remove("flipped");

      this.inputStart.classList.remove("red");
      this.inputEnd.classList.remove("red");
    }

    if (isLower) {
      this.thumbStart.style.left = this.calcPercentage(primaryValue) + '%';
      this.sliderStartInput.value = primaryValue;
      this.currentMin = primaryValue;
    } else {
      this.thumbEnd.style.left = this.calcPercentage(primaryValue) + '%';
      this.sliderEndInput.value = primaryValue;
      this.currentMax = primaryValue;
    }
  }

  setTo(min, max, inverted) {
    const clampedMin = Math.min(Math.max(min, this.sliderMin), this.sliderMax);
    const clampedMax = Math.min(Math.max(max, this.sliderMin), this.sliderMax);

    if (!inverted && min > max) {
      this.cache.ui.error(`Cannot set min threshold to ${min} and max threshold to ${max} for ${this.propID}`);
      return;
    }
    if (inverted && max < min) {
      this.cache.ui.error(`Cannot set threshold to LOWER THAN ${min} OR GREATER THAN ${max} for inverted ${this.propID}`);
      return;
    }

    if (min < this.sliderMin) {
      this.cache.ui.warning(`Minimum threshold for ${this.propID} corrected to ${clampedMin} (from ${min})`);
    }
    if (max > this.sliderMax) {
      this.cache.ui.warning(`Maximum threshold for ${this.propID} corrected to ${clampedMax} (from ${max})`);
    }

    this.sliderStart.value = inverted ? clampedMax : clampedMin;
    this.sliderEnd.value = inverted ? clampedMin : clampedMax;

    this.handleThresholdOnInputEvent(true);
    this.handleThresholdOnInputEvent(false);

    this.writeCurrentFilterSettings();
  }
}

class UIComponentManager {
  constructor(cache) {
    this.cache = cache;
  }

  buildDropdownOptions() {
    let selectViewDropdown = document.getElementById('selectView');
    let selectViewOptions = Object.keys(this.cache.data.layouts).map(key => {
      let selected = this.cache.data.selectedLayout === key ? "selected" : "";
      return `<option value="${key}" ${selected}>${key}</option>`;
    });
    selectViewDropdown.innerHTML = selectViewOptions.join("");
  }

  createSectionToggleButton(enable, section, subSection = null) {
    const btn = document.createElement("button");
    btn.className = "small-btn toggle-section-btn ml-1";
    if (subSection) btn.classList.add("extra-small");
    btn.textContent = enable ? "✔" : "✗";
    btn.title = `${enable ? 'Enable' : 'Disable'} all filters for the ${subSection
      ? 'group: ' + "\n └─ " + section + "\n        └─ " + subSection
      : 'section: ' + "\n └─ " + section}`;
    btn.onclick = async () => {
      subSection ? await this.cache.ui.toggleSubSection(enable, section, subSection) : await this.cache.ui.toggleSection(enable, section);
    };
    return btn;
  }

  createSectionResetButton(section, subSection = undefined) {
    const btn = document.createElement("button");
    btn.className = "small-btn toggle-section-btn ml-1";
    if (subSection) btn.classList.add("extra-small");
    btn.textContent = "⟳";
    btn.title = `Reset all filters for the ${subSection
      ? 'group to their default values: ' + "\n └─ " + section + "\n        └─ " + subSection
      : 'section to their default values: ' + "\n └─ " + section}`;
    btn.onclick = async () => {
      await this.cache.fm.resetFilters(section, subSection);
    };
    return btn;
  }

  createCircleGroupButtonWithQuadrants(propID) {
    const circleButton = document.createElement('div');
    circleButton.className = `circle-button`;

    for (let [group, quadrantPosition] of Object.entries(DEFAULTS.BUBBLE_GROUP_QUADRANT_POSITIONS)) {
      const quadrant = document.createElement('button');
      quadrant.classList.add("quadrant");
      quadrant.classList.add(quadrantPosition);
      this.cache.data.layouts[this.cache.data.selectedLayout].filters.get(propID)[`${group}Members`].size === 0 ? quadrant.classList.remove("active") : quadrant.classList.add("active");

      quadrant.addEventListener('click', async () => {
        try {
          let shouldShowRemove = quadrant.classList.contains("active");
          let members = this.cache.data.layouts[this.cache.data.selectedLayout].filters.get(propID)[`${group}Members`];

          if (shouldShowRemove) {
            this.cache.data.layouts[this.cache.data.selectedLayout][`${group}Props`].delete(propID);
            quadrant.title = `Remove ${propID} from ${group}.`;
            members.delete(propID);
            quadrant.classList.remove("active");
            await this.cache.gcm.decideToRenderOrDraw();
          } else {
            this.cache.data.layouts[this.cache.data.selectedLayout][`${group}Props`].add(propID);
            quadrant.title = `Highlight ${propID} and add to bubble-group (${group})`;
            members.add(propID);
            quadrant.classList.add("active");
            await this.cache.gcm.decideToRenderOrDraw();
          }
        } catch (err) {
          this.cache.ui.error(`Failed to update bubble set group: ${err.message}`);
        }
      });

      quadrant.title = `Highlight ${propID} and add to bubble-group (${group})`;
      circleButton.appendChild(quadrant);
    }

    return circleButton;
  }

  createManualBubbleGroupButton() {
    const circleButton = document.createElement('div');
    circleButton.className = `circle-button-compact`;
    circleButton.id = 'manualBubbleGroupButton';

    for (let [group, quadrantPosition] of Object.entries(DEFAULTS.BUBBLE_GROUP_QUADRANT_POSITIONS)) {
      const quadrant = document.createElement('button');
      quadrant.classList.add("quadrant");
      quadrant.classList.add(quadrantPosition);
      quadrant.classList.add("manual");
      quadrant.classList.add("compact");

      quadrant.addEventListener('click', async () => {
        try {
          await this.cache.bs.toggleSelectedNodesInManualGroup(group);
        } catch (err) {
          this.cache.ui.error(`Failed to update manual bubble group: ${err.message}`);
        }
      });

      quadrant.title = `Toggle selected nodes in manual ${group}`;
      circleButton.appendChild(quadrant);
    }

    return circleButton;
  }

  buildToolTipText(nodeOrEdgeID, isEdge) {
    function initAndAddHeader() {
      const hasLabel = item.label && item.label !== item.id;
      const title = hasLabel ? item.label : item.id;
      const subtitle = hasLabel ? `<div class="tooltip-header-id">ID: ${item.id}</div>` : '';

      return `<div class="tooltip-header">
      <div class="tooltip-header-text">
        <span class="purple">${isEdge ? "Edge" : "Node"}</span>
        <div class="tooltip-header-label">
          <div class="tooltip-header-title">${title}</div>
          ${subtitle}
        </div>
      </div>
      <div class="tooltip-header-actions">
        <!-- no inline onclick: tooltip HTML is sanitized at display time;
             InteractionManager handles these via a delegated listener -->
        <button class="tooltip-expand-btn">⛶</button>
        <button class="tooltip-close-btn">×</button>
      </div>
    </div>
    <div class="tooltip-content">`;
    }

    function addDescription() {
      if (item.description) {
        tooltip += `<p class="tooltip-description">${item.description}</p>`;
      }
    }

    function addMetric() {
      if (!isEdge) {
        tooltip += `<div class="tooltip-metric-wrapper purple">
        <hr>
        <h5 class="tooltip-sub-section red-background">
          📊 <span class="tooltip-metric-header"></span>
        </h5>
        <p class="tooltip-metric-content"></p>
      </div>`
      }
    }

    const item = isEdge ? this.cache.edgeRef.get(nodeOrEdgeID) : this.cache.nodeRef.get(nodeOrEdgeID);
    let tooltip = initAndAddHeader();
    addDescription();
    addMetric();

    if (!item.D4Data) return tooltip;

    const sortedPropIDs = this.cache.CFG.SORT_TOOLTIPS
      ? [...this.cache.data.filterDefaults.keys()].sort()
      : [...this.cache.data.filterDefaults.keys()];

    // ------------------
    // 1) Collect data into a structure grouped by (section, subSection)
    // ------------------
    const structuredData = [];

    /**
     * Ensures a section object and subSection array exist, then pushes a property item.
     */
    function pushSubSectionProperty(secName, subName, prop, val) {
      let sectionObj = structuredData.find(s => s.section === secName);
      if (!sectionObj) {
        sectionObj = {section: secName, subSections: []};
        structuredData.push(sectionObj);
      }
      let subObj = sectionObj.subSections.find(sub => sub.name === subName);
      if (!subObj) {
        subObj = {name: subName, props: []};
        sectionObj.subSections.push(subObj);
      }
      subObj.props.push({key: prop, value: val});
    }

    // Gather valid properties, grouped
    for (const propID of sortedPropIDs) {
      const [section, subSection, property] = StaticUtilities.decodePropHashId(propID);
      const rawValue = item.D4Data?.[section]?.[subSection]?.[property];
      if (rawValue === undefined) continue;
      if (this.cache.CFG.TOOLTIP_HIDE_NULL_VALUES && rawValue === 0) continue;

      const displayValue = isNaN(rawValue)
        ? rawValue
        : StaticUtilities.formatNumber(rawValue, this.cache.CFG.FILTER_VISUAL_FLOAT_PRECISION);

      pushSubSectionProperty(section, subSection, property, displayValue);
    }

    // ------------------
    // 2) Sort properties within each subSection if needed (SORT_TOOLTIPS)
    // ------------------
    function sortProps() {
      for (const sec of structuredData) {
        for (const sub of sec.subSections) {
          sub.props.sort((a, b) => a.key.localeCompare(b.key));
        }
      }
    }

    if (this.cache.CFG.SORT_TOOLTIPS) sortProps();

    // ------------------
    // 3) Flatten each {section, subSections} into an array while preserving order
    // ------------------
    function flattenBlocks() {
      const blocks = [];
      for (const s of structuredData) {
        blocks.push({type: "section", text: s.section});
        for (const sb of s.subSections) {
          blocks.push({type: "subSection", section: s.section, text: sb.name, props: sb.props});
        }
      }
      return blocks;
    }


    const orderedBlocks = flattenBlocks();

    // If we have nothing to show, return the basic tooltip
    if (orderedBlocks.length === 0) return tooltip;

    // ------------------
    // 4) Distribute these blocks into columns, left to right, preserving order
    // ------------------
    const columns = [];
    const columnSize = Math.ceil(orderedBlocks.length / this.cache.CFG.TOOLTIP_MAX_COLUMNS);

    for (let i = 0; i < this.cache.CFG.TOOLTIP_MAX_COLUMNS; i++) {
      const start = i * columnSize;
      const end = start + columnSize;
      columns.push(orderedBlocks.slice(start, end));
    }

    // ------------------
    // 5) Build the tooltip HTML
    // ------------------
    function buildColumns() {

      tooltip += `<hr><div class="tooltip-columns">`;

      for (const col of columns) {
        tooltip += `<div class="tooltip-column">`;

        let startedList = false;
        for (const block of col) {
          if (block.type === "section") {
            // Close a list if it's open before starting a new section
            if (startedList) {
              tooltip += `</ul>`;
              startedList = false;
            }
          } else if (block.type === "subSection") {
            if (startedList) {
              tooltip += `</ul>`;
              startedList = false;
            }
            tooltip += `<h5 class="tooltip-sub-section">${block.text}</h5><ul>`;
            startedList = true;
            // Properties for this subSection
            for (const propItem of block.props) {
              tooltip += `<li>${propItem.key}: <span class="red"><b>${propItem.value}</b></span></li>`;
            }
          }
        }

        if (startedList) {
          tooltip += `</ul>`;
        }
        tooltip += `</div>`;
      }

      tooltip += `</div>`;
    }

    buildColumns();
    tooltip += '</div>';
    return tooltip;
  }

  createCheckbox(propID, prop) {
    const container = this.cache.uiComponents.createCheckboxContainer(propID);
    const wrapper = document.createElement('label');
    wrapper.className = 'checkboxWrapper';
    wrapper.id = `filter-${propID}-checkbox-wrapper`;

    const input = this.cache.uiComponents.createCheckboxInput(propID, this.cache.data.layouts[this.cache.data.selectedLayout].filters.get(propID).active);
    const customCheckbox = this.cache.uiComponents.createCustomCheckbox(propID);
    const actionButton = this.cache.uiComponents.createAddToQueryButton(propID);
    const displayField = document.createElement("span");
    displayField.className = 'checkboxLabel';
    displayField.textContent = prop;

    const updateCheckbox = () => {
      customCheckbox.textContent = input.checked ? '✔' : '';
      wrapper.title = this.cache.uiComponents.getCheckboxTT(input.checked, propID);
    };
    updateCheckbox();

    input.addEventListener('change', updateCheckbox);
    wrapper.addEventListener('change', async () => {
      if (this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY) return;
      try {
        this.cache.data.layouts[this.cache.data.selectedLayout].filters.get(propID).active = input.checked;
        input.checked ? this.cache.activeProps.add(propID) : this.cache.activeProps.delete(propID);
        let status = input.checked ? "Showing" : "Hiding";
        await this.cache.fm.handleFilterEvent(`${status} Elements`, `Nodes and related edges for ${propID}`);
      } catch (err) {
        this.cache.ui.error(`Failed to toggle filter: ${err.message}`);
      }
    });

    wrapper.append(input, customCheckbox);
    container.append(wrapper, actionButton, displayField);

    input.checked ? this.cache.activeProps.add(propID) : this.cache.activeProps.delete(propID);

    return container;
  }

  createCheckboxContainer(propID) {
    const container = document.createElement('div');
    container.className = 'checkboxContainer';
    container.id = `filter-${propID}-container`;
    return container;
  }

  createCheckboxInput(propID, initialState) {
    const input = document.createElement('input');
    input.id = `filter-${propID}-checkbox`;
    input.type = 'checkbox';
    input.checked = initialState;
    input.className = 'hidden-checkbox';
    return input;
  }

  createCustomCheckbox(propID) {
    const customCheckbox = document.createElement('span');
    customCheckbox.id = `filter-${propID}-checkbox-inner`;
    customCheckbox.className = "checkbox checkbox-green";
    return customCheckbox;
  }

  createAddToQueryButton(propID) {
    const actionButton = document.createElement('button');
    actionButton.className = 'add-to-query-button';
    actionButton.textContent = '📝';
    actionButton.title = `Add ${propID} to the query`;

    actionButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const slider = this.cache.propIDToInvertibleRangeSliders.get(propID);
      const dropdown = this.cache.propIDToDropdownChecklists.get(propID);

      let queryFragment;
      if (slider) {
        if (this.cache.CFG.QUERY_BTN_USE_CURRENT_FILTER) {
          queryFragment = slider.isInverted
            ? `${propID} LOWER THAN ${slider.currentMax} OR GREATER THAN ${slider.currentMin}`
            : `${propID} BETWEEN ${slider.currentMin} AND ${slider.currentMax}`;
        } else {
          queryFragment = `(${propID} BETWEEN ${slider.sliderMin} AND ${slider.sliderMax}`;
        }
      } else if (dropdown) {
        if (this.cache.CFG.QUERY_BTN_USE_CURRENT_FILTER) {
          queryFragment = `${propID} IN [${[...dropdown.selectedCategories].map(cat => StaticUtilities.escapeQueryValue(cat)).join(",")}]`
        } else {
          queryFragment = `${propID} IN [${[...dropdown.categories].map(cat => StaticUtilities.escapeQueryValue(cat)).join(",")}]`
        }
      }

      if (this.cache.data.layouts[this.cache.data.selectedLayout]["query"] === undefined) {
        this.cache.qm.handleQueryValidationEvent(true);
      }

      if (!this.cache.query.text.textContent.trim()) {
        this.cache.data.layouts[this.cache.data.selectedLayout]["query"] = `(${queryFragment})`;
      } else {
        this.cache.data.layouts[this.cache.data.selectedLayout]["query"] += ` OR (${queryFragment})`;
      }
      this.cache.qm.updateQueryTextArea();
    });

    return actionButton;
  }

  getCheckboxTT(enable, propID) {
    return `Click to ${enable ? 'hide' : 'show'} elements with the property:${StaticUtilities.formatPropsAsTree(propID)}`;
  }

  createAddOrRemoveToSelectionGroup(propID) {
    const group = document.createElement("div");
    group.classList.add("pm-group");

    const addBtn = this.createAddOrRemoveToSelectionButton(propID, true);
    const removeBtn = this.createAddOrRemoveToSelectionButton(propID, false);

    group.appendChild(addBtn);
    group.appendChild(removeBtn);
    return group;
  }

  createAddOrRemoveToSelectionButton(propID, shouldAdd) {
    const btn = document.createElement("button");
    btn.classList.add("plus-minus-button");
    btn.textContent = shouldAdd ? "+" : "-";
    btn.title = shouldAdd ? "Add to selection" : "Remove from selection";
    btn.addEventListener("click", async () => {
      try {
        if (!this.cache.graph) {
          this.cache.ui.warning("Please wait for graph to initialize");
          return;
        }

        const nodeIDs = this.cache.propIDsToNodeIDsToBeShown.get(propID) || [];
        if (nodeIDs.size > 0) {
          const nodes = this.cache.graph.getNodeData([...nodeIDs]);
          await this.cache.sm.updateSelectedState(nodes, shouldAdd);
        }

        const edgeIDs = this.cache.propIDsToEdgeIDsToBeShown.get(propID) || [];
        if (edgeIDs.size > 0) {
          const edges = this.cache.graph.getEdgeData([...edgeIDs]);
          await this.cache.sm.updateSelectedState(edges, shouldAdd);
        }
      } catch (err) {
        this.cache.ui.error(`Failed to update selection: ${err.message}`);
      }
    });
    return btn;
  }
}

export {DropdownChecklist, InvertibleRangeSlider, UIComponentManager};
