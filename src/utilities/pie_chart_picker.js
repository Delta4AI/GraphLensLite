import { Popup } from "./popup.js";
import { buildCategoricalSlices, buildNumericSlices } from "../graph/pie_slices.js";

/**
 * Dialog that binds node properties to pie-chart slices (feature #1).
 *
 * Modes are kept separate by design: categorical slices weight every present
 * value equally, numeric slices weight by magnitude, and the two are not
 * comparable in one disc. So the picker offers a mode toggle + a multi-select
 * property list (filtered to that mode) + Select-all, then a color row per
 * slice source (per distinct value in categorical mode, per property in
 * numeric mode). Apply resolves per-node slices via the node-safe builders in
 * pie_slices.js and returns them keyed by node id.
 *
 * Returns (via pickPie) `{ mode, properties, colors, sliceByNode }` or null on
 * cancel. core.updateNodes bakes sliceByNode onto each node's style; the
 * graph_model maps style.pieSlices onto the @sigma/node-piechart program.
 */
class PieChartPicker {
  constructor(cache) {
    this.cache = cache;
    this.mode = "categorical"; // "categorical" | "numeric"
    this.selected = new Set(); // selected property ids (for the active mode)
    this.colors = new Map(); // categorical: value→hex; numeric: propId→hex
    this.resolvePromise = null;
    this.popup = null;
    this.dom = {};
  }

  get palette() {
    return this.cache.DEFAULTS.NODE.PIE.SLICE_PALETTE;
  }

  get missingColor() {
    return this.cache.DEFAULTS.NODE.PIE.DEFAULT_COLOR;
  }

  get maxSlices() {
    return this.cache.DEFAULTS.NODE.PIE.MAX_SLICES;
  }

  /** @returns {Promise<{mode, properties, colors, sliceByNode}|null>} */
  async pickPie() {
    if (this.cache.selectedNodes.length === 0) {
      this.cache.ui.warning("Select at least one node before mapping pie slices.");
      return null;
    }
    this.mode = "categorical";
    this.selected = new Set();
    this.colors = new Map();
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      const content = this.buildContent();
      this.popup = new Popup(content, {
        title: "Map Properties to Pie Slices",
        width: "480px",
        showFullscreenButton: false,
        closeOnClickOutside: false,
        onClose: () => {
          if (this.resolvePromise) {
            this.resolvePromise(null);
            this.resolvePromise = null;
          }
          this.popup = null;
        },
      });
      this.renderProperties();
    });
  }

  buildContent() {
    const container = document.createElement("div");

    // ----- mode toggle (segmented control) --------------------------------
    const modeRow = document.createElement("div");
    modeRow.className = "pie-mode-toggle";
    this.dom.modeButtons = {};
    for (const [value, label] of [["categorical", "Categorical"], ["numeric", "Numeric"]]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pie-mode-btn";
      btn.textContent = label;
      btn.setAttribute("aria-pressed", String(value === this.mode));
      if (value === this.mode) btn.classList.add("active");
      btn.addEventListener("click", () => {
        if (this.mode === value) return;
        this.mode = value;
        this.selected = new Set();
        this.colors = new Map();
        for (const [v, b] of Object.entries(this.dom.modeButtons)) {
          const on = v === value;
          b.classList.toggle("active", on);
          b.setAttribute("aria-pressed", String(on));
        }
        this.renderHint();
        this.renderProperties();
      });
      this.dom.modeButtons[value] = btn;
      modeRow.appendChild(btn);
    }
    container.appendChild(modeRow);

    const hint = document.createElement("p");
    hint.className = "picker-info picker-info-summary pie-hint";
    this.dom.hint = hint;
    container.appendChild(hint);

    // ----- property multi-select ------------------------------------------
    const propLabel = document.createElement("div");
    propLabel.className = "pie-section-label";
    propLabel.textContent = "Properties";
    container.appendChild(propLabel);

    const selectAllRow = document.createElement("label");
    selectAllRow.className = "pie-selectall-row";
    const selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    selectAll.addEventListener("change", () => {
      const props = this.availableProperties();
      this.selected = selectAll.checked ? new Set(props) : new Set();
      this.renderProperties();
    });
    const selectAllText = document.createElement("span");
    selectAllText.textContent = "Select all";
    selectAllRow.append(selectAll, selectAllText);
    this.dom.selectAll = selectAll;
    container.appendChild(selectAllRow);

    const propList = document.createElement("div");
    propList.className = "pie-prop-list";
    this.dom.propList = propList;
    container.appendChild(propList);

    // ----- slice colors + cap counter -------------------------------------
    const colorLabelRow = document.createElement("div");
    colorLabelRow.className = "pie-section-label pie-colors-label";
    const colorLabelText = document.createElement("span");
    colorLabelText.textContent = "Slice colors";
    const sliceCount = document.createElement("span");
    sliceCount.className = "pie-slice-count";
    this.dom.sliceCount = sliceCount;
    colorLabelRow.append(colorLabelText, sliceCount);
    this.dom.colorLabelRow = colorLabelRow;
    container.appendChild(colorLabelRow);

    const colorSection = document.createElement("div");
    colorSection.className = "pie-color-list picker-category-container";
    this.dom.colorSection = colorSection;
    container.appendChild(colorSection);

    // ----- footer ----------------------------------------------------------
    const footer = document.createElement("div");
    footer.className = "p-footer";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "p-button p-button-secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = () => this.cancel();
    const applyBtn = document.createElement("button");
    applyBtn.className = "p-button p-button-primary disabled";
    applyBtn.textContent = "Apply";
    applyBtn.onclick = () => this.apply();
    this.dom.applyButton = applyBtn;
    footer.append(cancelBtn, applyBtn);
    container.appendChild(footer);

    this.renderHint();
    return container;
  }

  /** Update the mode explanation, including the hard slice cap. */
  renderHint() {
    if (!this.dom.hint) return;
    this.dom.hint.textContent =
      this.mode === "categorical"
        ? `One equal slice per distinct value. Up to ${this.maxSlices} slices per node.`
        : `One slice per property, sized by its value. Up to ${this.maxSlices} slices per node.`;
  }

  /** Layout filters keyed by property id. */
  get filters() {
    return this.cache.data.layouts[this.cache.data.selectedLayout].filters;
  }

  /**
   * Property ids carried by the selected nodes that match the active mode:
   * categorical mode → filters flagged isCategory; numeric mode → the rest.
   * @returns {string[]} sorted property ids
   */
  availableProperties() {
    const filters = this.filters;
    const wantCategory = this.mode === "categorical";
    const available = new Set();
    for (const nodeId of this.cache.selectedNodes) {
      const node = this.cache.nodeRef.get(nodeId);
      node?.features.forEach((propId) => {
        const filter = filters.get(propId);
        if (filter && Boolean(filter.isCategory) === wantCategory) available.add(propId);
      });
    }
    return Array.from(available).sort();
  }

  /** Distinct categorical values the selected nodes carry across `props`. */
  distinctValues(props) {
    const values = new Set();
    for (const nodeId of this.cache.selectedNodes) {
      const node = this.cache.nodeRef.get(nodeId);
      for (const prop of props) {
        const raw = node?.featureValues.get(prop);
        if (raw === undefined) continue;
        const items = raw instanceof Set ? raw : [raw];
        for (const v of items) {
          const value = String(v).trim();
          if (value !== "") values.add(value);
        }
      }
    }
    return Array.from(values).sort();
  }

  /** Strip the section/subsection hash prefix for a readable label. */
  displayName(propId) {
    return propId.includes("::") ? propId.split("::").pop() : propId;
  }

  renderProperties() {
    const props = this.availableProperties();
    const list = this.dom.propList;
    list.innerHTML = "";

    if (props.length === 0) {
      const empty = document.createElement("p");
      empty.className = "pie-empty";
      empty.textContent = `No ${this.mode} properties on the selected nodes.`;
      list.appendChild(empty);
    }

    for (const prop of props) {
      const row = document.createElement("label");
      row.className = "pie-prop-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = this.selected.has(prop);
      cb.addEventListener("change", () => {
        if (cb.checked) this.selected.add(prop);
        else this.selected.delete(prop);
        this.syncSelectAll(props);
        this.renderColors();
      });
      const text = document.createElement("span");
      text.textContent = this.displayName(prop);
      row.append(cb, text);
      list.appendChild(row);
    }

    this.syncSelectAll(props);
    this.renderColors();
  }

  syncSelectAll(props) {
    const all = props.length > 0 && props.every((p) => this.selected.has(p));
    if (this.dom.selectAll) {
      this.dom.selectAll.checked = all;
      this.dom.selectAll.indeterminate = !all && this.selected.size > 0;
    }
  }

  /** Render one editable color swatch per slice source for the current mode. */
  renderColors() {
    const section = this.dom.colorSection;
    section.innerHTML = "";
    const selectedProps = Array.from(this.selected);

    let sources; // ordered list of {key, label}
    if (this.mode === "categorical") {
      sources = this.distinctValues(selectedProps).map((v) => ({ key: v, label: v }));
    } else {
      sources = selectedProps.map((p) => ({ key: p, label: this.displayName(p) }));
    }

    // Assign palette colors to any source that doesn't have one yet.
    sources.forEach((src, i) => {
      if (!this.colors.has(src.key)) {
        this.colors.set(src.key, this.palette[i % this.palette.length] ?? this.missingColor);
      }
    });

    // The cap is PER NODE, not per legend. A categorical legend can list many
    // values, but each node only draws the ones it carries — so what matters
    // is the most slices any single node will end up with. (Numeric: every
    // node gets one slice per selected property, so it equals the prop count.)
    const maxPerNode = this.maxSlicesPerNode(selectedProps);
    const over = maxPerNode > this.maxSlices;

    if (this.dom.sliceCount) {
      this.dom.sliceCount.textContent = `${maxPerNode} / ${this.maxSlices} per node`;
      this.dom.sliceCount.classList.toggle("over", over);
      this.dom.sliceCount.title = over
        ? `A node carries up to ${maxPerNode} values; only the first ${this.maxSlices} wedges render on nodes that exceed the cap.`
        : "Most wedges any single node will show.";
    }

    if (over) {
      const warn = document.createElement("p");
      warn.className = "pie-cap-warning";
      warn.textContent = `A node carries up to ${maxPerNode} values — only the first ${this.maxSlices} wedges render on nodes that exceed ${this.maxSlices}.`;
      section.appendChild(warn);
    }

    // In numeric mode the slots fill in property order for every node, so any
    // property past the cap never renders → mark it dropped. In categorical
    // mode the legend is a union across nodes and no single value is
    // universally dropped (truncation is per node), so nothing is marked.
    const markDropped = this.mode === "numeric";
    sources.forEach((src, i) => {
      const dropped = markDropped && i >= this.maxSlices;
      const row = document.createElement("div");
      row.className = "picker-category-row pie-color-row";
      if (dropped) row.classList.add("pie-color-row--dropped");
      const label = document.createElement("span");
      label.textContent = dropped ? `${src.label} (not shown)` : src.label;
      const color = document.createElement("input");
      color.type = "color";
      color.className = "picker-color-swatch";
      color.value = this.colors.get(src.key);
      color.addEventListener("input", (e) => this.colors.set(src.key, e.target.value));
      row.append(label, color);
      section.appendChild(row);
    });

    const canApply = selectedProps.length > 0 && sources.length > 0;
    this.dom.applyButton.classList.toggle("disabled", !canApply);
  }

  /**
   * The most slices any single selected node will render for the current mode
   * and property selection — the figure the per-node 6-wedge cap applies to.
   * Categorical: the largest distinct-value count on any one node. Numeric:
   * one slice per selected property (constant across nodes).
   *
   * @param {string[]} selectedProps
   * @returns {number}
   */
  maxSlicesPerNode(selectedProps) {
    if (selectedProps.length === 0) return 0;
    if (this.mode === "numeric") return selectedProps.length;
    let max = 0;
    for (const nodeId of this.cache.selectedNodes) {
      const node = this.cache.nodeRef.get(nodeId);
      if (node) max = Math.max(max, this.nodeDistinctValues(node, selectedProps).length);
    }
    return max;
  }

  /** Resolve per-node slices and close. */
  apply() {
    const properties = Array.from(this.selected);
    if (properties.length === 0) return;

    const sliceByNode = new Map();
    let overflow = false;

    for (const nodeId of this.cache.selectedNodes) {
      const node = this.cache.nodeRef.get(nodeId);
      if (!node) continue;

      let slices;
      if (this.mode === "categorical") {
        const values = this.nodeDistinctValues(node, properties);
        slices = buildCategoricalSlices(values, this.colors, this.missingColor);
      } else {
        const valueByProp = new Map(
          properties.map((p) => [p, Number(node.featureValues.get(p))]),
        );
        slices = buildNumericSlices(properties, valueByProp, this.colors, this.missingColor);
      }
      if (slices.length > this.maxSlices) overflow = true;
      sliceByNode.set(nodeId, slices);
    }

    if (overflow) {
      this.cache.ui.warning(
        `Some nodes have more than ${this.maxSlices} slices; extra slices are not drawn.`,
      );
    }

    if (this.resolvePromise) {
      this.resolvePromise({ mode: this.mode, properties, colors: this.colors, sliceByNode });
      this.resolvePromise = null;
    }
    this.close();
  }

  /** A single node's distinct categorical values across `props` (in value order). */
  nodeDistinctValues(node, props) {
    const seen = new Set();
    for (const prop of props) {
      const raw = node.featureValues.get(prop);
      if (raw === undefined) continue;
      const items = raw instanceof Set ? raw : [raw];
      for (const v of items) {
        const value = String(v).trim();
        if (value !== "") seen.add(value);
      }
    }
    return Array.from(seen);
  }

  cancel() {
    if (this.resolvePromise) {
      this.resolvePromise(null);
      this.resolvePromise = null;
    }
    this.close();
  }

  close() {
    if (this.popup) {
      this.popup.close();
      this.popup = null;
    }
  }
}

export { PieChartPicker };
