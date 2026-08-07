import { attachGroupMenu } from './group_menu.js';
import { StaticUtilities } from '../utilities/static.js';

class DropdownChecklist {
  constructor(propID, cache) {
    this.propID = propID;
    this.cache = cache;
    this.categories = this.cache.data.filterDefaults.get(propID).categories;
    this.selectedCategories =
      this.cache.data.layouts[this.cache.data.selectedLayout].filters.get(propID).categories;
    this.isVisible = false;
    this.sortCategories();
    this.cache.propIDToDropdownChecklists.set(propID, this);
  }

  sortCategories() {
    const catArray = Array.isArray(this.categories)
      ? [...this.categories]
      : Array.from(this.categories);

    catArray.sort((a, b) => {
      // Category values normally arrive as strings, but hand-crafted JSON (or
      // historic files saved before rich-cell normalization) may carry other
      // types — coerce instead of crashing the whole filter panel.
      const getPriority = (val) => {
        const lower = String(val).toLowerCase();
        if (lower === "low") return 1;
        if (lower === "medium") return 2;
        if (lower === "high") return 3;
        return 0; // “other” values
      };
      const priorityA = getPriority(a);
      const priorityB = getPriority(b);

      if (priorityA === 0 && priorityB === 0) {
        // Both “other” values → alphabetical
        return String(a).localeCompare(String(b));
      }
      // Sort by priority ascending: 0 → “other”, 1 → “low”, 2 → “medium”, 3 → “high”
      return priorityA - priorityB;
    });

    this.categories = new Set(catArray);
  }

  appendTo(parent) {
    this.container = document.createElement('div');
    this.container.id = this.propID + '-dropdown';
    this.container.className = 'dropdown-check-list';
    this.container.tabIndex = 100;

    // Create the anchor (visible clickable part)
    this.anchor = document.createElement('h5');
    this.anchor.className = 'anchor purple round-border';
    this.anchor.textContent = `${this.selectedCategories.size}/${this.categories.size} selected`;
    this.anchor.id = this.propID + '-dropdown-anchor';
    this.container.appendChild(this.anchor);

    // Create the unordered list (dropdown items)
    this.itemsList = document.createElement('ul');
    this.itemsList.className = 'items';

    // add buttons on top
    this.buttonContainer = document.createElement('div');
    this.buttonContainer.className = 'dropdown-buttons';

    this.selectAllButton = document.createElement('button');
    this.selectAllButton.textContent = 'Select All';

    this.deselectAllButton = document.createElement('button');
    this.deselectAllButton.textContent = 'Deselect All';

    this.buttonContainer.appendChild(this.selectAllButton);
    this.buttonContainer.appendChild(this.deselectAllButton);

    this.itemsList.appendChild(this.buttonContainer);

    // Add the options as checkboxes
    this.categories.forEach((option) => {
      const listItem = document.createElement('li');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = option;
      checkbox.checked = this.selectedCategories.has(option);
      checkbox.className = 'hidden-checkbox';
      checkbox.addEventListener('change', async (ev) => await this.handleSelection(ev));

      const customCheckbox = document.createElement('span');
      customCheckbox.className = 'custom-checkbox';

      checkbox.addEventListener('change', () => {
        checkbox.checked
          ? customCheckbox.classList.add('checked')
          : customCheckbox.classList.remove('checked');
      });

      // Set initial state
      if (checkbox.checked) customCheckbox.classList.add('checked');

      const label = document.createElement('label');
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
      await this.cache.fm.handleFilterEvent(
        `${ev.target.checked ? 'Showing' : 'Hiding'} Elements`,
        `Nodes and related edges for ${this.propID} ${ev.target.value}`,
        this.propID
      );
      // this.cache.ui.debug(`${this.propID} ${ev.target.value} ${ev.target.checked}`);
    } catch (err) {
      this.cache.ui.error(`Failed to handle category selection: ${err.message}`);
    }
  }

  appendListeners() {
    const updateDropdownPosition = () => {
      // Temporarily make the dropdown visible to calculate its height
      this.itemsList.style.visibility = 'hidden';
      this.itemsList.style.display = 'block';

      const dropdownHeight = this.itemsList.offsetHeight;
      this.itemsList.style.display = '';
      this.itemsList.style.visibility = '';

      const { left, top, maxHeight } = StaticUtilities.computeDropdownPlacement({
        anchorRect: this.anchor.getBoundingClientRect(),
        dropdownHeight,
        viewportHeight: window.innerHeight,
      });

      this.itemsList.style.left = `${left}px`;
      this.itemsList.style.top = `${top}px`;

      // Cap height and scroll only when even the chosen side is too small.
      if (maxHeight != null) {
        this.itemsList.style.maxHeight = `${maxHeight}px`;
        this.itemsList.style.overflowY = 'auto';
      } else {
        this.itemsList.style.maxHeight = '';
        this.itemsList.style.overflowY = '';
      }
    };

    this.anchor.addEventListener('click', () => {
      this.isVisible = !this.isVisible;
      if (this.isVisible) {
        updateDropdownPosition();
        document.addEventListener('scroll', updateDropdownPosition, true);
        this.container.classList.add('visible');
      } else {
        this.container.classList.remove('visible');
        document.removeEventListener('scroll', updateDropdownPosition, true);
      }
    });

    // button callbacks
    this.selectAllButton.addEventListener('click', async () => await this.selectAllCategories());
    this.deselectAllButton.addEventListener(
      'click',
      async () => await this.deselectAllCategories()
    );

    // Handle clicks outside the dropdown to close it
    document.addEventListener('click', (event) => {
      if (!this.container.contains(event.target)) {
        this.isVisible = false;
        this.container.classList.remove('visible');
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
    checkbox.nextElementSibling.classList.add('checked');
    this.anchor.textContent = `${this.selectedCategories.size}/${this.categories.size} selected`;
  }

  async selectAllCategories(skipFilterEvent = false) {
    try {
      this.categories.forEach((category) => this.selectedCategories.add(category)); // Add all categories
      this.updateCheckboxStates(true);
      if (!skipFilterEvent) {
        await this.cache.fm.handleFilterEvent(
          'Showing Elements',
          `Nodes and related edges for ${this.propID}`,
          this.propID
        );
      }
    } catch (err) {
      this.cache.ui.error(`Failed to select all categories: ${err.message}`);
    }
  }

  async deselectAllCategories(skipFilterEvent = false) {
    try {
      this.categories.forEach((category) => this.selectedCategories.delete(category)); // Clear all categories
      this.updateCheckboxStates(false);
      if (!skipFilterEvent) {
        await this.cache.fm.handleFilterEvent(
          'Hiding Elements',
          `Nodes and related edges for ${this.propID}`,
          this.propID
        );
      }
    } catch (err) {
      this.cache.ui.error(`Failed to deselect all categories: ${err.message}`);
    }
  }

  updateCheckboxStates(selectAll) {
    Array.from(this.itemsList.querySelectorAll("input[type='checkbox']")).forEach((checkbox) => {
      checkbox.checked = selectAll; // Update checkbox state
      selectAll
        ? checkbox.nextElementSibling.classList.add('checked')
        : checkbox.nextElementSibling.classList.remove('checked');
    });
    this.anchor.textContent = `${this.selectedCategories.size}/${this.categories.size} selected`; // Update anchor text
  }
}

/**
 * Three-state Any / True / False segment for boolean-classified properties
 * (§6.1). State lives in the layout filter's `categories` Set (mutated in
 * place, like DropdownChecklist): Any = {'true','false'}, True = {'true'},
 * False = {'false'} — so query generation, narrowing checks, and JSON
 * persistence reuse the categorical machinery unchanged.
 */
class BooleanToggle {
  static STATES = [
    ['any', 'Any', ['true', 'false']],
    ['true', 'True', ['true']],
    ['false', 'False', ['false']],
  ];

  constructor(propID, cache) {
    this.propID = propID;
    this.cache = cache;
    this.selectedCategories =
      this.cache.data.layouts[this.cache.data.selectedLayout].filters.get(propID).categories;
    this.cache.propIDToBooleanToggles.set(propID, this);
  }

  state() {
    const hasTrue = this.selectedCategories.has('true');
    const hasFalse = this.selectedCategories.has('false');
    if (hasTrue && !hasFalse) return 'true';
    if (hasFalse && !hasTrue) return 'false';
    return 'any';
  }

  appendTo(parent) {
    this.container = document.createElement('div');
    this.container.id = this.propID + '-bool-toggle';
    this.container.className = 'filter-join-toggle filter-bool-toggle';
    this.container.setAttribute('role', 'group');
    this.container.setAttribute('aria-label', 'Filter by boolean value');
    this.segments = new Map();

    for (const [key, label] of BooleanToggle.STATES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'filter-join-segment';
      btn.textContent = label;
      btn.title = `Show elements where this property is ${key === 'any' ? 'true or false' : key}`;
      btn.addEventListener('click', async () => await this.handleSelection(key));
      this.segments.set(key, btn);
      this.container.appendChild(btn);
    }

    this.updateSegments();
    parent.appendChild(this.container);
  }

  // Interface parity with DropdownChecklist / InvertibleRangeSlider —
  // BooleanToggle wires its listeners in appendTo.
  appendListeners() {}

  updateSegments() {
    if (!this.segments) return; // not rendered (e.g. sync before appendTo)
    const current = this.state();
    for (const [key, btn] of this.segments.entries()) {
      const active = key === current;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
  }

  #setState(key) {
    const values = BooleanToggle.STATES.find(([k]) => k === key)[2];
    this.selectedCategories.clear();
    for (const value of values) this.selectedCategories.add(value);
    this.updateSegments();
  }

  async handleSelection(key) {
    if (this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY) return;
    if (key === this.state()) return;
    this.#setState(key);
    await this.cache.fm.handleFilterEvent(
      'Filtering Elements',
      `${this.propID} is ${key === 'any' ? 'true or false' : key}`
    );
  }

  // Sync from a manual query (no filter event — the query drives rendering).
  // Called once per IS TRUE / IS FALSE leaf; two leaves for the same property
  // union to Any. resetToAny() runs before each sync pass, so the sequence
  // any → first leaf narrows → second leaf widens back is always correct.
  applyFromQuery(value) {
    const current = this.state();
    if (current === 'any') {
      this.#setState(value);
    } else if (current !== value) {
      this.#setState('any');
    }
  }

  resetToAny() {
    this.#setState('any');
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
    this.allInteger =
      StaticUtilities.isInteger(this.sliderMin) &&
      StaticUtilities.isInteger(this.sliderMax) &&
      !defaultFilterData.hasFloatValues;
    // Integer columns step by whole units (discrete counts). Float columns use
    // "any" — a continuous control with no value grid, so the column max (and
    // any high-decimal value) stays exactly selectable via both the slider and
    // the number box, at any column magnitude. A fixed absolute step floored
    // the reachable max below the true max and broke selection of the top node.
    this.stepSize = this.allInteger ? this.cache.CFG.FILTER_STEP_SIZE_INTEGER : 'any';
    // One fixed box width per slider, sized to the widest value it can show.
    // Sizing the box to the CURRENT value made the track (a flex sibling)
    // shrink and grow mid-drag, so the thumb jumped under the cursor — worst
    // near 0 on float columns, where "0" ↔ "0.050" oscillated every frame.
    // The endpoints bound every in-range value's formatted length: the sign
    // comes from min, integer digits from the larger magnitude, and decimals
    // are fixed-width. +1 because `size` counts average character widths and
    // digits are narrower than average, so an exact count clips the last glyph.
    this.boxSize = Math.max(
      3,
      String(this.formatThreshold(this.sliderMin)).length + 1,
      String(this.formatThreshold(this.sliderMax)).length + 1
    );
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
  }

  readCurrentFilterSettings() {
    if (!this.cache.data.layouts[this.cache.data.selectedLayout].filters.has(this.propID)) {
      this.currentMin = 0;
      this.currentMax = 1;
      this.isInverted = false;
    } else {
      let filterData = this.cache.data.layouts[this.cache.data.selectedLayout].filters.get(
        this.propID
      );
      this.currentMin = filterData.lowerThreshold;
      this.currentMax = filterData.upperThreshold;
      this.isInverted = filterData.isInverted;
    }
  }

  writeCurrentFilterSettings() {
    if (this.cache.data.layouts[this.cache.data.selectedLayout].filters.has(this.propID)) {
      let filterData = this.cache.data.layouts[this.cache.data.selectedLayout].filters.get(
        this.propID
      );
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
  }

  /**
   * Rounded for display; the raw value comes back while the box has focus.
   * Float columns pad integer-valued numbers to the same fixed precision
   * ("0" → "0.000") so a slider's two boxes always read — and measure — alike.
   */
  formatThreshold(value) {
    const precision = this.cache.CFG.FILTER_VISUAL_FLOAT_PRECISION;
    return this.allInteger
      ? StaticUtilities.formatNumber(value, precision)
      : parseFloat(value).toFixed(precision);
  }

  createSliderInput(id, initialValue, relatedSliderId, readExact) {
    const input = document.createElement('input');
    input.id = id;
    input.size = this.boxSize;
    input.value = this.formatThreshold(initialValue);
    // A column of raw floats ("-51.82279968") is what made this row need a
    // line of its own. Rounded at rest, exact the moment you go to edit it —
    // nothing is hidden and the true value stays reachable. The exact value
    // comes from the widget's own state rather than the range input, which
    // holds the same number but only as a string the browser may re-round.
    // Growing for the exact value is safe here: focus never coincides with a
    // thumb drag, so the track can't shift under the cursor.
    input.addEventListener('focus', () => {
      const exact = String(readExact());
      input.value = exact;
      input.size = Math.max(this.boxSize, exact.length + 1);
      input.select();
    });
    // Enter and blur apply the same way: a typed number that stays on screen
    // but never reaches the filter is the one outcome nobody can read.
    const applyTyped = () => {
      if (this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY) return;
      const typed = parseFloat(input.value);
      // Non-numeric text has no value to apply — the caller restores the real
      // one rather than rendering "NaN". Silently, until now: the invalid text
      // stayed on screen, the filter never moved, and only a blur put it back.
      if (isNaN(typed)) {
        if (input.value.trim() !== '') {
          this.cache.ui.warning(`"${input.value.trim()}" is not a number — threshold unchanged.`);
        }
        return;
      }
      // Equal once rounded means nothing changed at display precision. Skipping
      // keeps a plain focus-and-leave (and a blur right after Enter) from
      // re-firing the filter or rounding the exact value down behind the user.
      if (this.formatThreshold(typed) === this.formatThreshold(readExact())) return;
      // Out of range is corrected rather than silently reverted, matching what
      // setTo() does for the same value arriving from a query.
      const clamped = Math.min(Math.max(typed, this.sliderMin), this.sliderMax);
      if (clamped !== typed) {
        this.cache.ui.warning(
          `Threshold for ${this.propID} corrected to ${this.formatThreshold(clamped)} (from ${typed})`
        );
      }
      const sliderElem = document.getElementById(relatedSliderId);
      sliderElem.value = clamped;
      sliderElem.dispatchEvent(new Event('input'));
      sliderElem.dispatchEvent(new Event('change'));
    };
    input.addEventListener('blur', () => {
      applyTyped();
      input.value = this.formatThreshold(readExact());
      input.size = this.boxSize;
    });
    input.addEventListener('keydown', (ev) => {
      if (this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY) {
        ev.preventDefault();
        return;
      }
      if (ev.key === 'Enter') applyTyped();
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
      // A numeric property whose only value is min === max has no range to
      // filter, so a slider (and its exact-value inputs) would be inert. Show a
      // compact read-only badge with the value instead; nothing is rendered for
      // Details mode to reveal, so it stays a plain checkmark + value.
      parent.appendChild(this.createSingleValueIndicator());
      return false;
    }
    this.isValidSlider = true;

    const div = document.createElement('div');
    div.innerHTML = this.createDivInnerHTML();
    const slider = div.firstElementChild;
    slider.style.width = '100%';
    slider.title = `Set the thresholds for the numeric property: ${StaticUtilities.formatPropsAsTree(this.propID)}\n---\n  - Move handles to set min/max (≥ min ∧ ≤ max).\n  - Swap handles to invert (≤ min ∨ ≥ max).\n  - Double-click to reset.`;

    // The exact-value boxes sit at the two ends of the track, on the slider's
    // own line. They used to be a second row under it, while a pair of
    // position:fixed bubbles showed the SAME two numbers on hover — one value,
    // drawn twice, one of the copies needing hover/scroll/resize listeners to
    // stay pinned. Merging them halves the row height (~40px to ~22px) and
    // deletes the whole fixed-positioning apparatus.
    const row = document.createElement('div');
    row.className = 'filter-range-row';
    this.inputStart = this.createSliderInput(
      this.sliderIdStartInput,
      this.currentMin,
      this.sliderIdStart,
      () => this.currentMin
    );
    this.inputStart.title = 'Lower threshold — type an exact value and press Enter';
    this.inputStart.setAttribute('aria-label', `${this.propLabel()} — lower threshold`);
    this.inputEnd = this.createSliderInput(
      this.sliderIdEndInput,
      this.currentMax,
      this.sliderIdEnd,
      () => this.currentMax
    );
    this.inputEnd.title = 'Upper threshold — type an exact value and press Enter';
    this.inputEnd.setAttribute('aria-label', `${this.propLabel()} — upper threshold`);
    row.append(this.inputStart, slider, this.inputEnd);

    parent.appendChild(row);
    this.rangeRow = row;
  }

  /** Bare property name, for the inputs' accessible names. */
  propLabel() {
    return StaticUtilities.decodePropHashId(this.propID).slice(-1)[0];
  }

  createSingleValueIndicator() {
    const badge = document.createElement('span');
    badge.className = 'filter-single-value';
    const value = StaticUtilities.formatNumber(
      this.sliderMin,
      this.cache.CFG.FILTER_VISUAL_FLOAT_PRECISION
    );
    const check = document.createElement('span');
    check.className = 'filter-single-value-check';
    check.textContent = '✓';
    check.setAttribute('aria-hidden', 'true');
    const valueSpan = document.createElement('span');
    valueSpan.textContent = value;
    badge.append(check, valueSpan);
    badge.title = `Single value (${value}) for ${StaticUtilities.formatPropsAsTree(this.propID)} — toggle this property to include or exclude nodes that have it; there is just no range to narrow.`;
    return badge;
  }

  createDivInnerHTML() {
    // Both thumbs are bare range inputs; without a name a screen reader
    // announces two anonymous sliders and no way to tell them apart.
    const prop = StaticUtilities.escapeHtml(
      StaticUtilities.decodePropHashId(this.propID).slice(-1)[0]
    );
    return `
      <div slider id="${this.sliderId}">
        <div>
          <div id="${this.inverseLeftId}" inverse-left style="width:${this.calcPercentage(this.currentMin)}%;"></div>
          <div id="${this.inverseRightId}" inverse-right style="width:${100 - this.calcPercentage(this.currentMax)}%;"></div>
          <div id="${this.rangeId}" range style="left:${this.calcPercentage(this.currentMin)}%; 
                 right:${100 - this.calcPercentage(this.currentMax)}%;"></div>
          <span id="${this.thumbStartId}" thumb style="left:${this.calcPercentage(this.currentMin)}%;"></span>
          <span id="${this.thumbEndId}" thumb style="left:${this.calcPercentage(this.currentMax)}%;"></span>
        </div>
        <input type="range" tabindex="0" value="${this.currentMin}" max="${this.sliderMax}" min="${this.sliderMin}"
          step="${this.stepSize}" id="${this.sliderIdStart}" aria-label="${prop} — lower threshold" />
        <input type="range" tabindex="0" value="${this.currentMax}" max="${this.sliderMax}" min="${this.sliderMin}"
          step="${this.stepSize}" id="${this.sliderIdEnd}" aria-label="${prop} — upper threshold" />
      </div>
    `;
  }

  appendListeners() {
    if (!this.isValidSlider) return;
    this.getDOMReferences();

    this.slider.addEventListener('dblclick', () => {
      this.reset();
      this.sliderEnd.dispatchEvent(new Event('change'));
    });

    this.sliderStart.addEventListener('input', () => {
      if (this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY) return;
      this.handleThresholdOnInputEvent(true);
    });
    this.sliderStart.addEventListener('change', async () => {
      if (this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY) return;
      try {
        this.writeCurrentFilterSettings();
        await this.cache.fm.handleFilterEvent(
          'Filtering',
          `Applying lower threshold ${this.sliderStart.value} for ${this.propID}`,
          this.propID
        );
      } catch (err) {
        this.cache.ui.error(`Failed to apply lower threshold: ${err.message}`);
      }
    });
    this.sliderEnd.addEventListener('input', () => {
      if (this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY) return;
      this.handleThresholdOnInputEvent(false);
    });
    this.sliderEnd.addEventListener('change', async () => {
      if (this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY) return;
      try {
        this.writeCurrentFilterSettings();
        await this.cache.fm.handleFilterEvent(
          'Filtering',
          `Applying upper threshold ${this.sliderEnd.value} for ${this.propID}`,
          this.propID
        );
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
      this.inverseRight.style.width = 100 - rightWidth + '%';
      this.range.style.left = '50%';
      this.inverseLeft.style.backgroundColor = '#C33D35';
      this.inverseRight.style.backgroundColor = '#C33D35';
      // Inverted means sliderStart holds the HIGHER value, so its box belongs
      // at the right-hand end of the track. Each box still drives its own
      // handle; only the visual order swaps, which is what the retired bubbles
      // used their own `flipped` class for.
      this.rangeRow?.classList.add('flipped');
      this.inputStart.classList.add('red');
      this.inputEnd.classList.add('red');
    } else {
      const leftPos = this.calcPercentage(isLower ? primaryValue : secondaryValue);
      const rightPos = 100 - this.calcPercentage(isLower ? secondaryValue : primaryValue);
      this.range.style.left = leftPos + '%';
      this.range.style.width = 100 - leftPos - rightPos + '%';
      this.inverseLeft.style.width = leftPos + '%';
      this.inverseRight.style.width = rightPos + '%';
      this.inverseLeft.style.backgroundColor = 'grey';
      this.inverseRight.style.backgroundColor = 'grey';
      this.rangeRow?.classList.remove('flipped');
      this.inputStart.classList.remove('red');
      this.inputEnd.classList.remove('red');
    }

    const box = isLower ? this.sliderStartInput : this.sliderEndInput;
    if (isLower) {
      this.thumbStart.style.left = this.calcPercentage(primaryValue) + '%';
      this.currentMin = primaryValue;
    } else {
      this.thumbEnd.style.left = this.calcPercentage(primaryValue) + '%';
      this.currentMax = primaryValue;
    }
    // Never overwrite the box being typed into; its own blur reformats it.
    if (box && document.activeElement !== box) {
      box.value = this.formatThreshold(primaryValue);
    }
  }

  setTo(min, max, inverted) {
    const clampedMin = Math.min(Math.max(min, this.sliderMin), this.sliderMax);
    const clampedMax = Math.min(Math.max(max, this.sliderMin), this.sliderMax);

    if (!inverted && min > max) {
      this.cache.ui.error(
        `Cannot set min threshold to ${min} and max threshold to ${max} for ${this.propID}`
      );
      return;
    }
    if (inverted && max < min) {
      this.cache.ui.error(
        `Cannot set threshold to LOWER THAN ${min} OR GREATER THAN ${max} for inverted ${this.propID}`
      );
      return;
    }

    if (min < this.sliderMin) {
      this.cache.ui.warning(
        `Minimum threshold for ${this.propID} corrected to ${clampedMin} (from ${min})`
      );
    }
    if (max > this.sliderMax) {
      this.cache.ui.warning(
        `Maximum threshold for ${this.propID} corrected to ${clampedMax} (from ${max})`
      );
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
    let selectViewOptions = Object.keys(this.cache.data.layouts).map((key) => {
      let selected = this.cache.data.selectedLayout === key ? 'selected' : '';
      return `<option value="${key}" ${selected}>${key}</option>`;
    });
    selectViewDropdown.innerHTML = selectViewOptions.join('');
  }

  createSectionToggleButton(enable, section, subSection = null) {
    const btn = document.createElement('button');
    btn.className = 'small-btn toggle-section-btn ml-1';
    if (subSection) btn.classList.add('extra-small');
    btn.textContent = enable ? '✔' : '✗';
    btn.title = `${enable ? 'Enable' : 'Disable'} all filters for the ${
      subSection
        ? 'group: ' + '\n └─ ' + section + '\n        └─ ' + subSection
        : 'section: ' + '\n └─ ' + section
    }`;
    // The rendered text is a bare ✔/✗ glyph, so the group has to be spelled out
    // for screen readers — and for the command palette, which indexes controls
    // by their accessible name.
    btn.setAttribute(
      'aria-label',
      `${enable ? 'Enable' : 'Disable'} all filters: ${subSection ? `${section} › ${subSection}` : section}`
    );
    btn.onclick = async () => {
      subSection
        ? await this.cache.ui.toggleSubSection(enable, section, subSection)
        : await this.cache.ui.toggleSection(enable, section);
    };
    return btn;
  }

  createSectionResetButton(section, subSection = undefined) {
    const btn = document.createElement('button');
    btn.className = 'small-btn toggle-section-btn ml-1';
    if (subSection) btn.classList.add('extra-small');
    btn.textContent = '⟳';
    btn.title = `Reset all filters for the ${
      subSection
        ? 'group to their default values: ' + '\n └─ ' + section + '\n        └─ ' + subSection
        : 'section to their default values: ' + '\n └─ ' + section
    }`;
    btn.setAttribute(
      'aria-label',
      `Reset all filters: ${subSection ? `${section} › ${subSection}` : section}`
    );
    btn.onclick = async () => {
      await this.cache.fm.resetFilters(section, subSection);
    };
    return btn;
  }

  /**
   * The per-filter-row group control. One dot that opens the shared group
   * checklist, replacing a 2×2 quadrant pie that could only ever address four
   * groups and never said which four.
   *
   * ponytail: at 18px in `filter-row-col3` the dot shows ONE colour plus a ring
   * meaning "and others" — N colours are not legible at this size, and a conic
   * pie would just rebuild the wedges this replaced. Exact membership is in the
   * tooltip and the menu. Give it more room and it could show a colour stack.
   *
   * @param {string} propID
   */
  createGroupChip(propID) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'group-chip';
    chip.dataset.prop = propID;

    attachGroupMenu(chip, this.cache, () => ({
      isChecked: (group) => this.#propsOf(group).has(propID),
      onToggle: async (group) => {
        const props = this.#propsOf(group);
        props.has(propID) ? props.delete(propID) : props.add(propID);
        this.refreshGroupChips();
        await this.cache.gcm.decideToRenderOrDraw();
        // Awaited: unawaited, a rejection here was an unhandled promise with no
        // error toast, and rapid toggles interleaved redraw and history.commit.
        await this.cache.bs.afterMembershipChange(`Bubble group membership (${group})`);
      },
      onNew: async () => {
        const label = this.#groupNameForProp(propID);
        const group = this.cache.bs.createGroup({ name: label, fromProp: propID });
        if (!group) return;
        this.cache.bs.tuneGroupGeometry?.(group);
        this.refreshGroupChips();
        await this.cache.gcm.decideToRenderOrDraw();
        await this.cache.bs.afterMembershipChange(`New bubble group (${label})`);
        const count = this.cache.bs.getEffectiveGroupMembers(group).size;
        this.cache.ui.info(
          `Created group "${label}" (${count} node${count === 1 ? '' : 's'}) — ` +
            `style it under Overlays › Groups`
        );
      },
      newLabel: 'New group from this filter',
      emptyHint: 'A group draws a coloured bubble around the nodes you put in it.',
    }));

    this.paintGroupChip(chip);
    return chip;
  }

  /** "Node filters › Topology › degree" — the full path, for tooltips. */
  #readableProp(propID) {
    const [section, subSection, prop] = StaticUtilities.decodePropHashId(propID);
    return [section, subSection, prop].filter(Boolean).join(' › ');
  }

  /**
   * The same path without its section. A group made from a filter is named
   * with this: the section is always "Node filters"/"Edge filters", which is
   * noise inside a group list where every entry would carry it.
   */
  #groupNameForProp(propID) {
    const [, subSection, prop] = StaticUtilities.decodePropHashId(propID);
    return [subSection, prop].filter(Boolean).join(' › ') || propID;
  }

  /** `${group}Props` for the selected workspace, the single membership store. */
  #propsOf(group) {
    const layout = this.cache.data.layouts[this.cache.data.selectedLayout];
    if (!layout[`${group}Props`]) layout[`${group}Props`] = new Set();
    return layout[`${group}Props`];
  }

  /**
   * Paint one chip from current membership: hairline when unassigned, the
   * group's colour when in one, plus a ring when in several. The full list of
   * groups goes in the accessible name, which is where it stays legible.
   */
  paintGroupChip(chip) {
    const propID = chip.dataset.prop;
    const styles =
      this.cache.data?.layouts?.[this.cache.data?.selectedLayout]?.bubbleSetStyle ?? {};
    const inGroups = [];
    for (const group of this.cache.bs.traverseBubbleSets()) {
      if (this.#propsOf(group).has(propID)) inGroups.push(group);
    }

    chip.classList.toggle('assigned', inGroups.length > 0);
    chip.classList.toggle('multi', inGroups.length > 1);
    chip.style.removeProperty('--chip-color');
    chip.style.removeProperty('--chip-border');
    if (inGroups.length > 0) {
      // Fill AND stroke, so the chip is a miniature of the bubble it stands
      // for rather than a flat dot that only carries half the group's look.
      const style = styles[inGroups[0]] ?? {};
      chip.style.setProperty('--chip-color', style.fill ?? 'currentColor');
      chip.style.setProperty('--chip-border', style.stroke || style.fill || 'currentColor');
    }

    const names = inGroups.map((g) => styles[g]?.labelText || g);
    const readable = this.#readableProp(propID);
    chip.title = names.length
      ? `Assign nodes matching ${readable} to a group — currently in ${names.join(', ')}`
      : `Assign nodes matching ${readable} to a group`;
    chip.setAttribute('aria-label', chip.title);
  }

  /**
   * Repaint every chip in the filter panel. Membership changes from four other
   * places (the group list, clears, auto-detect, undo), and rebuilding the
   * whole filter UI to reflect a colour is far more than the change deserves.
   */
  refreshGroupChips() {
    for (const chip of document.querySelectorAll('#filterContainer .group-chip')) {
      this.paintGroupChip(chip);
    }
  }

  buildToolTipText(nodeOrEdgeID, isEdge) {
    function initAndAddHeader() {
      const hasLabel = item.label && item.label !== item.id;
      const title = StaticUtilities.escapeHtml(hasLabel ? item.label : item.id);
      const subtitle = hasLabel
        ? `<div class="tooltip-header-id">ID: ${StaticUtilities.escapeHtml(item.id)}</div>`
        : '';

      return `<div class="tooltip-header">
      <div class="tooltip-header-text">
        <span class="purple">${isEdge ? 'Edge' : 'Node'}</span>
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
        tooltip += `<p class="tooltip-description">${StaticUtilities.escapeHtml(item.description)}</p>`;
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
      </div>`;
      }
    }

    const item = isEdge
      ? this.cache.edgeRef.get(nodeOrEdgeID)
      : this.cache.nodeRef.get(nodeOrEdgeID);
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
      let sectionObj = structuredData.find((s) => s.section === secName);
      if (!sectionObj) {
        sectionObj = { section: secName, subSections: [] };
        structuredData.push(sectionObj);
      }
      let subObj = sectionObj.subSections.find((sub) => sub.name === subName);
      if (!subObj) {
        subObj = { name: subName, props: [] };
        sectionObj.subSections.push(subObj);
      }
      subObj.props.push({ key: prop, value: val });
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
        blocks.push({ type: 'section', text: s.section });
        for (const sb of s.subSections) {
          blocks.push({ type: 'subSection', section: s.section, text: sb.name, props: sb.props });
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
          if (block.type === 'section') {
            // Close a list if it's open before starting a new section
            if (startedList) {
              tooltip += `</ul>`;
              startedList = false;
            }
          } else if (block.type === 'subSection') {
            if (startedList) {
              tooltip += `</ul>`;
              startedList = false;
            }
            tooltip += `<h5 class="tooltip-sub-section">${StaticUtilities.escapeHtml(block.text)}</h5><ul>`;
            startedList = true;
            // Properties for this subSection
            for (const propItem of block.props) {
              const key = StaticUtilities.escapeHtml(propItem.key);
              const value = StaticUtilities.escapeHtml(propItem.value);
              tooltip += `<li>${key}: <span class="red"><b>${value}</b></span></li>`;
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

    const input = this.cache.uiComponents.createCheckboxInput(
      propID,
      this.cache.data.layouts[this.cache.data.selectedLayout].filters.get(propID).active
    );
    const customCheckbox = this.cache.uiComponents.createCustomCheckbox(propID);
    const actionButton = this.cache.uiComponents.createAddToQueryButton(propID);
    const displayField = document.createElement('span');
    displayField.className = 'checkboxLabel';
    displayField.textContent = prop;
    // No own title: the label clamps at two lines, but the wrapper tooltip
    // (getCheckboxTT) already ends its └─ tree with the full property name —
    // a second title here would swap tooltips mid-row.

    const updateCheckbox = () => {
      customCheckbox.textContent = input.checked ? '✔' : '';
      wrapper.title = this.cache.uiComponents.getCheckboxTT(input.checked, propID);
    };
    updateCheckbox();

    input.addEventListener('change', updateCheckbox);
    wrapper.addEventListener('change', async () => {
      if (this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY) return;
      try {
        this.cache.data.layouts[this.cache.data.selectedLayout].filters.get(propID).active =
          input.checked;
        input.checked ? this.cache.activeProps.add(propID) : this.cache.activeProps.delete(propID);
        let status = input.checked ? 'Showing' : 'Hiding';
        await this.cache.fm.handleFilterEvent(
          `${status} Elements`,
          `Nodes and related edges for ${propID}`
        );
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
    customCheckbox.className = 'checkbox checkbox-green';
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
      const boolToggle = this.cache.propIDToBooleanToggles.get(propID);

      let queryFragment;
      if (boolToggle) {
        // Same shape the query generator emits for a boolean filter
        // (query.js): "Any" is both leaves ORed, not a missing condition.
        const state = boolToggle.state();
        queryFragment =
          state === 'any'
            ? `(${propID} IS TRUE) OR (${propID} IS FALSE)`
            : `${propID} IS ${state === 'true' ? 'TRUE' : 'FALSE'}`;
      } else if (slider) {
        if (this.cache.CFG.QUERY_BTN_USE_CURRENT_FILTER) {
          queryFragment = slider.isInverted
            ? `${propID} LOWER THAN ${slider.currentMax} OR GREATER THAN ${slider.currentMin}`
            : `${propID} BETWEEN ${slider.currentMin} AND ${slider.currentMax}`;
        } else {
          queryFragment = `(${propID} BETWEEN ${slider.sliderMin} AND ${slider.sliderMax}`;
        }
      } else if (dropdown) {
        if (this.cache.CFG.QUERY_BTN_USE_CURRENT_FILTER) {
          queryFragment = `${propID} IN [${[...dropdown.selectedCategories].map((cat) => StaticUtilities.escapeQueryValue(cat)).join(',')}]`;
        } else {
          queryFragment = `${propID} IN [${[...dropdown.categories].map((cat) => StaticUtilities.escapeQueryValue(cat)).join(',')}]`;
        }
      }

      if (this.cache.data.layouts[this.cache.data.selectedLayout]['query'] === undefined) {
        this.cache.qm.handleQueryValidationEvent(true);
      }

      if (!this.cache.query.text.textContent.trim()) {
        this.cache.data.layouts[this.cache.data.selectedLayout]['query'] = `(${queryFragment})`;
      } else {
        this.cache.data.layouts[this.cache.data.selectedLayout]['query'] +=
          ` OR (${queryFragment})`;
      }
      this.cache.qm.updateQueryTextArea();
    });

    return actionButton;
  }

  getCheckboxTT(enable, propID) {
    return `Click to ${enable ? 'hide' : 'show'} elements with the property:${StaticUtilities.formatPropsAsTree(propID)}`;
  }

  /** An active-but-unnarrowed filter under AND: on, dimmed, and constraining
   * nothing. The normal "click to hide elements" reads as a lie there. */
  getInertCheckboxTT(propID) {
    return `Not narrowed, so under AND it excludes nothing — narrow it, or switch to OR:${StaticUtilities.formatPropsAsTree(propID)}`;
  }

  createAddOrRemoveToSelectionGroup(propID) {
    const group = document.createElement('div');
    group.classList.add('pm-group');

    const addBtn = this.createAddOrRemoveToSelectionButton(propID, true);
    const removeBtn = this.createAddOrRemoveToSelectionButton(propID, false);

    group.appendChild(addBtn);
    group.appendChild(removeBtn);
    return group;
  }

  createAddOrRemoveToSelectionButton(propID, shouldAdd) {
    const btn = document.createElement('button');
    btn.classList.add('plus-minus-button');
    btn.textContent = shouldAdd ? '+' : '-';
    btn.title = shouldAdd ? 'Add to selection' : 'Remove from selection';
    btn.addEventListener('click', async () => {
      try {
        if (!this.cache.graph) {
          this.cache.ui.warning('Please wait for graph to initialize');
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

export { BooleanToggle, DropdownChecklist, InvertibleRangeSlider, UIComponentManager };
