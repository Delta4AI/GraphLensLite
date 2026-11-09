import {StaticUtilities} from "../utilities/static.js";
import {attachCommunityMenu} from "./community_menu.js";
import {BADGE_SLOTS, summarizeBadges} from "../graph/badges.js";
import {safePaint} from "../graph/shape_textures.js";
import {FONT_STYLES} from "../graph/label_renderers.js";
import {MIXED, STYLE_PROPERTIES, styleOverride, readProperty, sharedBy, colorBuckets, labelSource}
  from "./selection_style_values.js";

// ----------------------------------------------------------- DOM primitives
// The style div's generic control builders. They only ever needed their
// arguments, but lived as closures inside createStyleDiv — a 1556-line
// function whose single export made none of it importable or testable.

function createNewRow(parent) {
  const row = document.createElement("div");
  row.classList.add("card-row");
  parent.appendChild(row);
  return row;
}

function createLabel(labelText, tooltip = undefined) {
  if (labelText) {
    const label = document.createElement("label");
    label.textContent = labelText;
    label.className = "vr-label";
    label.id = labelText;
    if (tooltip) label.title = tooltip;
    return label;
  }
  return null;
}

function appendLabel(parent, labelText, tooltip = undefined, id = undefined, customCSSClass = undefined) {
  const label = createLabel(labelText, tooltip);
  if (id) label.id = id;
  if (customCSSClass) label.classList.add(customCSSClass);
  if (label) parent.appendChild(label);
}

function createSwitch(callback = undefined, inputId = undefined, enabledByDefault = false) {
  // A checkbox, like the appearance editor's on/off rows.
  const label = document.createElement('label');
  label.className = 'prop-check';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = enabledByDefault;

  if (callback) {
    input.addEventListener('change', callback);
  }

  if (inputId) {
    input.id = inputId;
    label.id = `${inputId}Label`;
  }

  label.append(input);

  label.setChecked = (checked) => {
    input.checked = checked;
  };

  label.toggle = () => {
    input.checked = !input.checked;
  };

  label.isChecked = () => input.checked;

  return label;
}

function createColorPicker(defaultColor, title) {
  const colorPicker = document.createElement("input");
  colorPicker.type = "color";
  colorPicker.classList.add("prop-color-input");
  colorPicker.value = defaultColor;
  colorPicker.title = title;
  return colorPicker;
}

// Where a failed button action goes. createStyleDiv points it at the UI's
// error toast; button actions are mostly async, and a dropped rejection
// would otherwise reach only the devtools console.
let reportButtonFailure = (err) => console.error(err);

function createButton(label, tooltip, callback, id = undefined) {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.title = tooltip;
  btn.classList.add("insp-btn");
  if (label === "Clear") btn.classList.add("red");
  if (id) {
    btn.id = id;
  } else {
    btn.id = label;
  }
  btn.onclick = () => {
    try {
      Promise.resolve(callback()).catch((err) => reportButtonFailure(err));
    } catch (err) {
      reportButtonFailure(err);
    }
  };
  return btn;
}

function appendButton(parent, label, tooltip, callback) {
  const btn = createButton(label, tooltip, callback);
  parent.appendChild(btn);
}

function createInput(widthInPx = 80, placeholder = undefined, title = undefined,
                     defaultValue = undefined, callback = undefined) {
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = placeholder;
  input.title = title;
  input.classList.add("style-input");
  input.style.width = `${widthInPx}px`;
  input.value = defaultValue || "";
  if (callback) {
    input.addEventListener("keypress", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        callback(input.value.trim());
      }
    });
  }
  return input;
}

// ------------------------------------------------------- property rows
// The appearance editor's row: a muted label column and a control column.
// Builders appended into the control column name their controls after the row
// label (nameControl), so a screen reader hears "Size, slider" rather than a
// bare "slider", and clicking the label focuses the first input.

let propRowSeq = 0;

/** @returns {HTMLDivElement} the control column to build into */
function propRow(parent, text, tooltip = undefined) {
  const row = document.createElement("div");
  row.className = "prop-row";
  // Under a sub-heading the bare label repeats ("Size" for node, label and
  // badge): the command palette indexes the row by this fuller name.
  const group = parent.dataset?.propGroup;
  row.dataset.name = group ? `${group} ${text.toLowerCase()}` : text;
  const label = document.createElement("label");
  label.className = "prop-label";
  label.id = `propLabel${++propRowSeq}`;
  label.textContent = text;
  if (tooltip) label.title = tooltip;
  const ctl = document.createElement("div");
  ctl.className = "prop-ctl";
  ctl.dataset.labelId = label.id;
  ctl.dataset.labelText = text;
  ctl.rowLabel = label;
  row.append(label, ctl);
  parent.appendChild(row);
  return ctl;
}

/** A sub-group heading inside a section ("Label", "Badges", "Arrows"). */
function propSubhead(parent, text) {
  const head = document.createElement("div");
  head.className = "prop-subhead";
  head.textContent = text;
  parent.appendChild(head);
  parent.dataset.propGroup = text;
}

/**
 * Give `control` an accessible name: the row label when built into a
 * propRow (with `suffix` appended for secondary controls, e.g. "hex"),
 * otherwise `fallback`.
 */
function nameControl(parent, control, fallback, suffix = "") {
  const rowText = parent.dataset?.labelText;
  if (rowText && !suffix) {
    control.setAttribute("aria-labelledby", parent.dataset.labelId);
    const label = parent.rowLabel;
    if (label && !label.htmlFor && /^(INPUT|SELECT)$/.test(control.tagName) && control.type !== "range") {
      control.id ||= `${label.id}Control`;
      label.htmlFor = control.id;
    }
    return;
  }
  control.setAttribute("aria-label", [rowText ?? fallback, suffix].filter(Boolean).join(" "));
}

/** The "Mixed" note shown beside a control whose selection disagrees. */
function createMixedTag() {
  const tag = document.createElement("span");
  tag.className = "prop-mixed";
  tag.textContent = "Mixed";
  tag.hidden = true;
  return tag;
}

// Colours come from loaded files: only plain colour syntax reaches CSS.
const TRANSPARENT = "#00000000";
const isUnsetColor = (c) => c == null || c === "" || String(c).toLowerCase() === TRANSPARENT;

/** "#RRGGBB" for <input type=color>, which takes nothing else; null if not hex. */
function toHex6(color) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(color ?? ""));
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((ch) => ch + ch).join("") : m[1];
  return `#${hex.toLowerCase()}`;
}

/** A swatch background for a mixed selection: up to five of its colours as slices. */
function mixedSwatchBackground(colors) {
  const paints = colors.slice(0, 5).map((c) => safePaint(c, "transparent"));
  if (paints.length < 2) return paints[0] ?? "transparent";
  const step = 100 / paints.length;
  return `conic-gradient(${paints.map((p, i) => `${p} ${i * step}% ${(i + 1) * step}%`).join(", ")})`;
}

// One badge per perimeter slot: Set fills (or replaces) the chosen slot on
// every selected node, and the list below shows what the selection carries
// so each slot can be edited or removed on its own.
/**
 * The node card's badge row and the per-slot list under it.
 * @returns {{refresh: () => void}} re-reads the selection (call on every
 *   selection change, so the list and the column choices describe the nodes
 *   the buttons act on)
 */
function createNodeBadgeControls(cache, parent, listParent) {
  const sourceSelect = document.createElement("select");
  sourceSelect.className = "prop-select";
  sourceSelect.title = "Badge text: typed here, or each node's value in a column.";
  sourceSelect.setAttribute("aria-label", "Badge text source");
  parent.appendChild(sourceSelect);

  const badgeInput = createInput(90, "Badge text",
    "The text of the badge to set on the selected nodes.", undefined, undefined);
  badgeInput.classList.add("prop-text");
  badgeInput.style.width = "";
  badgeInput.setAttribute("aria-label", "Badge text");
  parent.appendChild(badgeInput);

  const badgeColorPicker = createColorPicker(cache.DEFAULTS.NODE.BADGE.COLOR, "Set the color of the badge.");
  badgeColorPicker.className = "prop-color-input";
  badgeColorPicker.setAttribute("aria-label", "Badge color");
  parent.appendChild(badgeColorPicker);

  const placementSelect = document.createElement("select");
  placementSelect.className = "prop-select";
  placementSelect.title = "Where on the node's edge the badge sits. Each spot holds one badge.";
  placementSelect.setAttribute("aria-label", "Badge position");
  for (const slot of BADGE_SLOTS) {
    const option = document.createElement("option");
    option.value = slot;
    option.textContent = slot.replace("-", " ");
    placementSelect.appendChild(option);
  }
  placementSelect.value = "top-right";
  parent.appendChild(placementSelect);

  const syncSourceInput = () => {
    badgeInput.hidden = sourceSelect.value !== "";
  };
  sourceSelect.addEventListener("change", syncSourceInput);

  const insp = (btn) => {
    btn.className = btn.classList.contains("red") ? "insp-btn red" : "insp-btn";
    return btn;
  };
  parent.appendChild(insp(createButton("Set", "Set this badge on the selected nodes, replacing any badge already in that spot.",
    async () => {
      const property = sourceSelect.value || undefined;
      const text = badgeInput.value.trim();
      if (!property && !text) {
        cache.ui.error("Type the badge text, or pick a column to take it from.");
        return;
      }
      await cache.gcm.updateNodes({}, ["badge_set"], {
        badge: {placement: placementSelect.value, color: badgeColorPicker.value, text, property},
      });
    }, "badgeSetBtn")));
  parent.appendChild(insp(createButton("Clear", "Remove every badge from the selected nodes.",
    async () => await cache.gcm.updateNodes({}, ["badge_clear"]), "badgeClearBtn")));

  const list = document.createElement("div");
  list.className = "badge-list";
  listParent.appendChild(list);

  const columnName = (propId) => StaticUtilities.decodePropHashId(propId).at(-1);

  function refreshColumnOptions(nodes) {
    const filters = cache.data?.layouts?.[cache.data.selectedLayout]?.filters;
    const columns = new Set();
    for (const node of nodes) {
      node.features?.forEach((propId) => {
        if (!filters?.get(propId)?.unusable) columns.add(propId);
      });
    }
    const previous = sourceSelect.value;
    sourceSelect.replaceChildren(new Option("Custom text", ""));
    const nameCounts = new Map();
    for (const propId of columns) {
      const name = columnName(propId);
      nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    }
    for (const propId of [...columns].sort((a, b) => columnName(a).localeCompare(columnName(b)))) {
      const name = columnName(propId);
      // Two groups can share a column name; only then is the group shown.
      const clash = nameCounts.get(name) > 1;
      const option = new Option(clash ? `${name} (${StaticUtilities.decodePropHashId(propId).at(-2)})` : name, propId);
      option.title = propId;
      sourceSelect.appendChild(option);
    }
    sourceSelect.value = columns.has(previous) ? previous : "";
    syncSourceInput();
  }

  function editSlot(entry) {
    placementSelect.value = entry.slot;
    if (entry.colors[0]) badgeColorPicker.value = entry.colors[0];
    if (entry.property && [...sourceSelect.options].some((o) => o.value === entry.property)) {
      sourceSelect.value = entry.property;
    } else {
      sourceSelect.value = "";
      badgeInput.value = entry.texts.length === 1 ? entry.texts[0] : "";
    }
    syncSourceInput();
    (badgeInput.hidden ? sourceSelect : badgeInput).focus();
  }

  function renderList(nodes) {
    const entries = summarizeBadges(nodes.map((node) => node.style));
    list.replaceChildren();
    list.hidden = entries.length === 0;
    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "badge-list-row";

      const swatch = document.createElement("span");
      swatch.className = "badge-list-swatch";
      // Colours come from the loaded file: only plain colour syntax reaches CSS.
      swatch.style.background = entry.colors.length === 1 ? safePaint(entry.colors[0], "transparent") : "transparent";
      if (entry.colors.length > 1) swatch.classList.add("mixed");
      swatch.setAttribute("role", "img");
      swatch.setAttribute("aria-label", entry.colors.length > 1 ? "mixed colours" : `colour ${entry.colors[0]}`);
      swatch.title = entry.colors.join(", ");

      const slot = document.createElement("span");
      slot.className = "badge-list-slot";
      slot.textContent = entry.slot.replace("-", " ");

      const text = document.createElement("span");
      text.className = "badge-list-text";
      if (entry.property) {
        text.textContent = `from ${columnName(entry.property)}`;
      } else if (entry.texts.length === 1) {
        text.textContent = `“${entry.texts[0]}”`;
      } else {
        text.textContent = `${entry.texts.length} different texts`;
      }
      text.title = entry.texts.join("\n");

      const count = document.createElement("span");
      count.className = "badge-list-count";
      count.textContent = nodes.length > 1 ? `${entry.nodes}/${nodes.length}` : "";
      count.title = `${entry.nodes} of the ${nodes.length} selected nodes have a badge here`;

      const edit = createButton("✎", "Load this badge into the controls above to change it, then press Set.",
        () => editSlot(entry), `badgeEdit-${entry.slot}`);
      const remove = createButton("×", "Remove this badge from the selected nodes.",
        async () => await cache.gcm.updateNodes({}, ["badge_remove"], {badge: {placement: entry.slot}}),
        `badgeRemove-${entry.slot}`);
      remove.classList.add("red");
      const slotName = entry.slot.replace("-", " ");
      edit.setAttribute("aria-label", `Edit the ${slotName} badge`);
      remove.setAttribute("aria-label", `Remove the ${slotName} badge`);

      row.append(swatch, slot, text, count, edit, remove);
      list.appendChild(row);
    }
  }

  const refresh = () => {
    // selectedNodes starts as a Set and becomes an array once something is selected.
    const nodes = [...(cache.selectedNodes ?? [])]
      .map((id) => cache.nodeRef.get(id))
      .filter(Boolean);
    refreshColumnOptions(nodes);
    renderList(nodes);
  };
  refresh();
  return { refresh };
}

function createStyleDiv(cache) {
  reportButtonFailure = (err) => cache.ui.error(`That did not work: ${err?.message ?? err}`);
  const root = document.createElement("div");

  function createCard(label, parent = undefined, additionalCSSClass = undefined) {
    const card = document.createElement("div");
    card.classList.add("card-labeled");
    if (additionalCSSClass) card.classList.add(additionalCSSClass);
    card.dataset.label = label;
    card.id = label;
    if (parent) {
      parent.appendChild(card);
    } else {
      root.appendChild(card);
    }
    return card;
  }

  // ---------------------------------------------- selection ↔ control sync
  // Every control bound to a node/edge style property registers here, so a
  // selection change can show what the selection actually carries: one value
  // when the selected elements agree, "Mixed" when they differ.
  const bindings = [];

  /**
   * @param {string} property  key of STYLE_PROPERTIES, or a custom target via `read`
   * @param {(value: any, entries: Array) => void} apply  MIXED, the shared value,
   *   or undefined when nothing of that kind is selected
   * @param {{target?: "node"|"edge", read?: (entry) => any, fallback?: any}} [opts]
   */
  function bind(property, apply, {target, read, fallback} = {}) {
    const spec = STYLE_PROPERTIES[property];
    if (!spec && !read) return; // Bubble Set rows etc. are not selection styles
    bindings.push({
      target: target ?? spec.target,
      // An element missing the key everywhere (labelFontStyle is never
      // resolved by style.js) reads as the builder's default, so "unset" and
      // "explicitly default" don't show up as Mixed.
      read: read ?? ((entry) => {
        const resolved = readProperty(entry.resolved, spec.key);
        return resolved !== undefined ? resolved : entry.raw.style?.[spec.key] ?? fallback;
      }),
      apply,
    });
  }

  function selectedEntries(ids, ref, resolve) {
    const entries = [];
    for (const id of ids ?? []) {
      const raw = ref?.get(id);
      if (raw) entries.push({id, raw, resolved: resolve(raw)});
    }
    return entries;
  }

  /** Re-read the selection into every bound control. selection.js calls it on every change. */
  function refreshStyleControls() {
    const nodes = selectedEntries(cache.selectedNodes, cache.nodeRef,
      (n) => cache.style.getNodeStyleOrDefaults(n));
    const edges = selectedEntries(cache.selectedEdges, cache.edgeRef,
      (e) => cache.style.getEdgeStyleOrDefaults(e));
    for (const binding of bindings) {
      const entries = binding.target === "node" ? nodes : edges;
      binding.apply(sharedBy(entries, binding.read), entries);
    }
    const setCount = (id, n) => {
      // The cards are re-parented into the inspector (ui.js CARD_MOUNTS), out of root.
      const el = document.getElementById(id);
      if (el) el.textContent = n ? String(n) : "";
    };
    setCount("styleNodeCount", nodes.length);
    setCount("styleEdgeCount", edges.length);
  }

  async function handleStyleChangeEvent(property, value) {
    if (property.startsWith("Bubble Set")) {
      await cache.bs.updateBubbleSetStyle(property, value);
      return;
    }

    const commands = [];
    if (value === "set_continuous_color_scale") {
      commands.push("set_continuous_color_scale");
      cache.picker.currentProperty = property;
    }
    if (value === "set_numeric_scale") {
      commands.push("set_numeric_scale");
    }

    // The scale sentinels ride in the override and are swapped for each
    // element's mapped value by replaceColorScale/replaceNumericScale.
    const overrides = styleOverride(property, value);
    if (STYLE_PROPERTIES[property].target === "node") {
      await cache.gcm.updateNodes(overrides, commands);
    } else {
      await cache.gcm.updateEdges(overrides, commands);
    }
    refreshStyleControls();
  }

  /** Map by data: the button that replaced the bare ∿ / gradient swatch. */
  function createMapButton(parent, property, title, sentinel) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "insp-btn prop-map-btn";
    btn.textContent = "Map…";
    btn.title = title;
    btn.dataset.property = property;
    nameControl(parent, btn, property, "— map by data");
    btn.onclick = () => {
      if (sentinel === "set_numeric_scale") cache.numericPicker.currentProperty = property;
      Promise.resolve(handleStyleChangeEvent(property, sentinel)).catch(reportButtonFailure);
    };
    parent.appendChild(btn);
    return btn;
  }

  function createBooleanControls(parent, property, tooltip = undefined, text = undefined) {
    const wrap = document.createElement("label");
    wrap.className = "prop-check";
    const box = document.createElement("input");
    box.type = "checkbox";
    if (tooltip) wrap.title = tooltip;
    nameControl(parent, box, property);
    box.onchange = () => {
      box.indeterminate = false;
      Promise.resolve(handleStyleChangeEvent(property, box.checked)).catch(reportButtonFailure);
    };
    wrap.appendChild(box);
    if (text) wrap.append(` ${text}`);
    parent.appendChild(wrap);
    bind(property, (value) => {
      box.indeterminate = value === MIXED;
      box.checked = value !== MIXED && !!value;
    }, {fallback: false});
    return box;
  }

  function createCategoricalControls(parent, property, defaultValue, listOfValues, tooltip = undefined) {
    const dropdown = document.createElement("select");
    dropdown.className = "prop-select";
    nameControl(parent, dropdown, property);
    if (tooltip) dropdown.title = tooltip;

    // Shown only while the selection disagrees; never pickable.
    const mixedOption = new Option("Mixed", "");
    mixedOption.disabled = true;
    mixedOption.hidden = true;
    dropdown.appendChild(mixedOption);
    for (const value of listOfValues) {
      dropdown.appendChild(new Option(value, value));
    }
    dropdown.onchange = () => {
      mixedOption.hidden = true;
      Promise.resolve(handleStyleChangeEvent(property, dropdown.value)).catch(reportButtonFailure);
    };

    dropdown.value = defaultValue;
    parent.appendChild(dropdown);
    bind(property, (value) => {
      mixedOption.hidden = value !== MIXED;
      dropdown.value = value === MIXED ? "" : value ?? defaultValue;
    }, {fallback: defaultValue});
    return dropdown;
  }

  /**
   * Segmented control: one pressed button per value. Used for short enums
   * (shape, edge type, font style) where every option fits on the row.
   * @param {Array<{value: string, text: string, label?: string}>} options
   */
  function createSegmentedControls(parent, property, defaultValue, options, {onPick, read, target} = {}) {
    const group = document.createElement("div");
    group.className = "prop-seg";
    group.setAttribute("role", "group");
    nameControl(parent, group, property);
    const buttons = new Map();
    for (const {value, text, label} of options) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = text;
      btn.setAttribute("aria-pressed", "false");
      if (label) {
        btn.setAttribute("aria-label", label);
        btn.title = label;
      }
      btn.onclick = () => {
        const pick = onPick ?? ((v) => handleStyleChangeEvent(property, v));
        Promise.resolve(pick(value)).catch(reportButtonFailure);
      };
      buttons.set(value, btn);
      group.appendChild(btn);
    }
    const mixedTag = createMixedTag();
    parent.append(group, mixedTag);
    bind(property, (value) => {
      mixedTag.hidden = value !== MIXED;
      const shown = value === MIXED ? undefined : value ?? defaultValue;
      for (const [v, btn] of buttons) btn.setAttribute("aria-pressed", String(v === shown));
    }, {fallback: defaultValue, target, read});
    return group;
  }

  function createNumericalSlider(parent, property, defaultValue, sliderParams = {
    min: 0,
    max: 100,
    step: 1
  }, tooltip = undefined, enableNumericScale = true) {
    const useFloat =
      !Number.isInteger(sliderParams.min) ||
      !Number.isInteger(sliderParams.max) ||
      !Number.isInteger(sliderParams.step);

    function parseValue(val) {
      return useFloat ? parseFloat(val) : parseInt(val, 10);
    }

    const typedDefaultValue = parseValue(defaultValue);

    const container = document.createElement("div");
    container.className = "style-slider-container";
    container.dataset.property = property;
    if (tooltip) container.title = tooltip;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = sliderParams.min;
    slider.max = sliderParams.max;
    slider.step = sliderParams.step;
    slider.value = typedDefaultValue;
    slider.classList.add("style-slider");
    nameControl(parent, slider, property);

    const valueInput = document.createElement("input");
    valueInput.type = "number";
    valueInput.step = sliderParams.step;
    valueInput.value = typedDefaultValue;
    valueInput.classList.add("style-input-sm");
    nameControl(parent, valueInput, property, "value");

    const showValue = (value) => {
      const mixed = value === MIXED;
      slider.classList.toggle("is-mixed", mixed);
      if (mixed) {
        slider.setAttribute("aria-valuetext", "Mixed");
        valueInput.value = "";
        valueInput.placeholder = "Mixed";
      } else {
        slider.removeAttribute("aria-valuetext");
        slider.value = value;
        valueInput.value = value;
        valueInput.placeholder = "";
      }
    };

    // One commit per gesture: dragging only previews the number, release
    // applies — each style change re-renders and records one undo step.
    const commit = (raw) => {
      const value = parseValue(raw);
      if (Number.isNaN(value)) return; // a cleared "Mixed" field applies nothing
      showValue(value);
      Promise.resolve(handleStyleChangeEvent(property, value)).catch(reportButtonFailure);
    };
    slider.oninput = () => {
      slider.classList.remove("is-mixed");
      slider.removeAttribute("aria-valuetext");
      valueInput.value = slider.value;
      valueInput.placeholder = "";
    };
    slider.onchange = () => commit(slider.value);
    valueInput.onchange = () => commit(valueInput.value);

    container.append(slider, valueInput);
    parent.appendChild(container);

    if (enableNumericScale) {
      createMapButton(parent, property,
        `Map by data: scale ${property} from a numeric property's values (e.g. larger nodes for higher degree)`,
        "set_numeric_scale");
    }
    bind(property, (value) => showValue(value === undefined || value === null ? typedDefaultValue : value),
      {fallback: typedDefaultValue});
    return container;
  }

  // What an unset colour means for the rows where unset is not "none".
  const UNSET_COLOR_TEXT = {
    "Edge Start Arrow Color": "Edge color",
    "Edge End Arrow Color": "Edge color",
    "Edge Flow Color": "Auto",
  };

  function createColorControls(parent, property, defaultColor, colors, continuousScaleBtn = true, customCSSClass = undefined) {
    const unsetText = UNSET_COLOR_TEXT[property] ?? "None";

    // The well is the native picker under a painted swatch: <input type=color>
    // can only show one #rrggbb, so mixed and unset are painted by the wrapper.
    const well = document.createElement("span");
    well.className = "color-well";
    const colorPicker = createColorPicker(toHex6(defaultColor) ?? "#000000",
      `Pick ${property} for the selected elements.`);
    colorPicker.className = "color-well-input";
    nameControl(parent, colorPicker, property, "— pick colour");
    well.appendChild(colorPicker);

    const colorInput = document.createElement("input");
    colorInput.type = "text";
    colorInput.classList.add("style-input", "color-hex");
    colorInput.dataset.property = property;
    colorInput.title = `Type a hex colour (e.g. #C33D35, or #C33D3580 with alpha) and press Enter.`;
    nameControl(parent, colorInput, property, "hex");

    if (customCSSClass) [well, colorInput].forEach((el) => el.classList.add(customCSSClass));

    const paintWell = (value, entries) => {
      well.classList.remove("is-mixed", "is-unset");
      if (value === MIXED) {
        const key = STYLE_PROPERTIES[property]?.key;
        const shades = key ? colorBuckets(entries ?? [], key).map((b) => b.color) : [];
        well.style.background = mixedSwatchBackground(shades);
        well.classList.add("is-mixed");
        colorInput.value = "";
        colorInput.placeholder = "Mixed";
      } else if (isUnsetColor(value)) {
        well.style.background = "";
        well.classList.add("is-unset");
        colorInput.value = "";
        colorInput.placeholder = unsetText;
      } else {
        well.style.background = safePaint(value, "transparent");
        colorInput.value = value;
        colorInput.placeholder = "";
        const hex = toHex6(value);
        if (hex) colorPicker.value = hex;
      }
    };

    let lastCommitted = null;
    const commit = (value) => {
      const trimmed = String(value).trim();
      if (!trimmed || trimmed === lastCommitted) return;
      lastCommitted = trimmed;
      paintWell(trimmed);
      Promise.resolve(handleStyleChangeEvent(property, trimmed)).catch(reportButtonFailure);
    };

    colorPicker.oninput = () => {
      well.classList.remove("is-mixed", "is-unset");
      well.style.background = colorPicker.value;
      colorInput.value = colorPicker.value;
    };
    colorPicker.onchange = () => commit(colorPicker.value);
    colorInput.addEventListener("focus", () => { lastCommitted = colorInput.value.trim(); });
    colorInput.addEventListener("change", () => commit(colorInput.value));
    colorInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit(colorInput.value);
      }
    });

    parent.append(well, colorInput);

    const palette = Object.entries(colors);
    if (palette.length) {
      const swatches = document.createElement("div");
      swatches.className = "style-color-button-container";
      for (const [name, value] of palette) {
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.className = "style-color-button prop-swatch";
        if (isUnsetColor(value)) swatch.classList.add("is-unset");
        else swatch.style.backgroundColor = value;
        swatch.title = `${name} (${value})`;
        nameControl(parent, swatch, property, name);
        swatch.onclick = () => {
          lastCommitted = null;
          commit(value);
        };
        if (customCSSClass) swatch.classList.add(customCSSClass);
        swatches.appendChild(swatch);
      }
      parent.appendChild(swatches);
    }

    if (continuousScaleBtn) {
      createMapButton(parent, property,
        `Map by data: colour ${property} on a gradient or by category from a property's values`,
        "set_continuous_color_scale");
    }

    // bubble_sets.refreshBubbleStyleElements writes the hex field directly
    // (after a load or ✨ Re-tune); this repaints the well to match.
    colorInput.syncWell = () => paintWell(colorInput.value || null);

    paintWell(defaultColor);
    bind(property, (value, entries) => {
      lastCommitted = null;
      paintWell(value === undefined ? defaultColor : value, entries);
    }, {fallback: null});
  }

  /**
   * The "In selection" row (after Figma's Selection colors): while a colour is
   * mixed, list each distinct colour with how many elements carry it; picking
   * a new colour for one recolours just those elements.
   */
  function createSelectionColorsRow(parentCard, property, noun) {
    const MAX_CHIPS = 8;
    const {target, key} = STYLE_PROPERTIES[property];
    const ctl = propRow(parentCard, "In selection",
      `Each ${noun.slice(0, -1)} colour in the selection. Click one to recolour only those ${noun}.`);
    const row = ctl.parentElement;
    row.classList.add("prop-row-selection-colors");
    row.hidden = true;

    const chips = document.createElement("div");
    chips.className = "prop-chips";
    const more = document.createElement("span");
    more.className = "prop-more";
    // One shared picker; it opens for whichever chip was clicked.
    const picker = document.createElement("input");
    picker.type = "color";
    picker.className = "prop-chip-picker";
    picker.tabIndex = -1;
    picker.setAttribute("aria-hidden", "true");
    let pending = null;
    picker.onchange = () => {
      if (!pending) return;
      const ids = pending;
      pending = null;
      const update = target === "node"
        ? cache.gcm.updateNodes(styleOverride(property, picker.value), [], {ids})
        : cache.gcm.updateEdges(styleOverride(property, picker.value), [], {ids});
      Promise.resolve(update).then(refreshStyleControls).catch(reportButtonFailure);
    };
    ctl.append(chips, more, picker);

    bind(property, (value, entries) => {
      const buckets = value === MIXED ? colorBuckets(entries, key) : [];
      row.hidden = buckets.length < 2;
      chips.replaceChildren();
      for (const bucket of buckets.slice(0, MAX_CHIPS)) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "prop-chip";
        const dot = document.createElement("i");
        dot.style.background = safePaint(bucket.color, "transparent");
        const count = document.createElement("span");
        count.textContent = String(bucket.ids.length);
        chip.append(dot, count);
        chip.title = `${bucket.color} — ${bucket.ids.length} ${noun}. Click to recolour them.`;
        chip.setAttribute("aria-label", `Recolour the ${bucket.ids.length} ${noun} coloured ${bucket.color}`);
        chip.onclick = () => {
          pending = bucket.ids;
          picker.value = toHex6(bucket.color) ?? "#000000";
          if (typeof picker.showPicker === "function") picker.showPicker();
          else picker.click();
        };
        chips.appendChild(chip);
      }
      const hidden = buckets.length - MAX_CHIPS;
      more.textContent = hidden > 0 ? `+${hidden} more` : "";
    });
  }

  /**
   * Label text: a custom-text field plus ID / Label / None, pressed by where
   * the selection's labels come from now.
   */
  function createLabelControls(parent, property, isNode = null) {
    const noun = isNode ? "nodes" : "edges";
    const target = isNode ? "node" : "edge";
    const update = (overrides, commands) => (isNode
      ? cache.gcm.updateNodes(overrides, commands)
      : cache.gcm.updateEdges(overrides, commands));
    const run = async (overrides, commands) => {
      await update(overrides, commands);
      refreshStyleControls();
    };

    const labelInput = createInput(120, "Custom text",
      `Type a label for the selected ${noun} and press Enter.`, undefined,
      (text) => run({style: {label: true, labelText: text}}));
    labelInput.classList.add("prop-text");
    labelInput.style.width = "";
    nameControl(parent, labelInput, property);
    parent.appendChild(labelInput);

    const sources = [
      {value: "id", text: "ID", label: `Label the selected ${noun} with their IDs`},
      {value: "label", text: "Label", label: `Label the selected ${noun} with their predefined labels`},
      {value: "none", text: "None", label: `Hide the labels of the selected ${noun}`},
    ];
    const pick = async (source) => {
      labelInput.value = "";
      if (source === "id") return run(undefined, ["label_set_to_id"]);
      if (source === "label") return run(undefined, ["label_set_to_label"]);
      return run({style: {label: true, labelText: cache.CFG.INVISIBLE_CHAR}});
    };
    const sourceProperty = `${isNode ? "Node" : "Edge"} Label Source`;
    createSegmentedControls(parent, sourceProperty, undefined, sources, {
      onPick: pick,
      target,
      read: (entry) => labelSource(entry.raw, cache.CFG.INVISIBLE_CHAR),
    });

    bind(sourceProperty, (value, entries) => {
      const custom = value === "custom" ? sharedBy(entries, (e) => e.raw.style?.labelText) : undefined;
      labelInput.value = typeof custom === "string" ? custom : "";
      labelInput.placeholder = value === MIXED || custom === MIXED ? "Mixed" : "Custom text";
    }, {target, read: (entry) => labelSource(entry.raw, cache.CFG.INVISIBLE_CHAR)});
  }

  const SHAPE_NAMES = {circle: "Circle", diamond: "Diamond", hexagon: "Hexagon", rect: "Square", triangle: "Triangle", star: "Star"};

  function createNodeShapeControls(parent) {
    const options = Object.entries(cache.DEFAULTS.STYLES.NODE_FORM)
      .map(([glyph, value]) => ({value, text: glyph, label: SHAPE_NAMES[value] ?? value}));
    createSegmentedControls(parent, "Node Shape", cache.DEFAULTS.NODE.TYPE, options);
  }

  function createEdgeTypeControls(parent) {
    const options = cache.DEFAULTS.STYLES.EDGE_TYPES.map((value) => ({value, text: value}));
    createSegmentedControls(parent, "Edge Type", cache.DEFAULTS.EDGE.TYPE, options);
  }

  const FONT_STYLE_OPTIONS = FONT_STYLES.map((value) => ({
    value,
    text: {normal: "Normal", bold: "B", italic: "I", "bold italic": "BI"}[value] ?? value,
    label: value[0].toUpperCase() + value.slice(1),
  }));

  // Two cards, split by what they need to already have: "Select Elements"
  // *creates* a selection out of the visible graph (rail ◈ menu), while
  // "Act on Selection" *grows or walks* one you already have, so it lives in
  // the inspector's selection context next to the thing it operates on.
  function createActOnSelectionCard() {
    const actDiv = createCard("Act on Selection", undefined, "flat-card");

    // The ids are what ui.js gates on (toggleDisabledElements), so they keep
    // the full names while the row label carries the noun.
    const edges = propRow(actDiv, "Edges");
    propButton(edges, "Expand", "Add all edges connected to the currently selected nodes to the selection",
      async () => await cache.sm.toggleSelectionByNeighbors("expand-edges"), "Expand Edges");
    propButton(edges, "Reduce", "Remove edges that do not connect two selected nodes",
      async () => await cache.sm.toggleSelectionByNeighbors("reduce-edges"), "Reduce Edges");

    const neighbors = propRow(actDiv, "Neighbors");
    propButton(neighbors, "Expand",
      "Add all directly connected neighbor nodes (and their edges) to the current selection",
      async () => await cache.sm.toggleSelectionByNeighbors("expand-neighbors"), "Expand Neighbors");
    propButton(neighbors, "Reduce",
      "Remove the outermost layer of selected neighbor nodes (and their edges) from the selection",
      async () => await cache.sm.toggleSelectionByNeighbors("reduce-neighbors"), "Reduce Neighbors");

    propButton(propRow(actDiv, "Path"), "Shortest path",
      "Add the shortest path connecting the two selected nodes — its nodes and the edges between them — to the selection.\nComputed on the visible graph, so it honours active filters.\nRequires exactly two selected nodes.",
      async () => await cache.sm.selectShortestPathBetweenSelected(), "Shortest Path");
    for (const btn of actDiv.querySelectorAll("button")) {
      btn.setAttribute("aria-label", btn.id.replace(/ (\w)/, (_, c) => ` ${c.toLowerCase()}`));
    }
  }

  function createSelectCard() {
    const selDiv = createCard("Select Elements", undefined, "flat-card");

    const nodes = propRow(selDiv, "Nodes");
    propButton(nodes, "All", "Select all visible nodes",
      async () => await cache.sm.toggleSelectionForAllNodes(true), "All Nodes").setAttribute("aria-label", "All nodes");
    propButton(nodes, "None", "Deselect all visible nodes",
      async () => await cache.sm.toggleSelectionForAllNodes(false), "No Nodes").setAttribute("aria-label", "No nodes");
    const edges = propRow(selDiv, "Edges");
    propButton(edges, "All", "Select all visible edges",
      async () => await cache.sm.toggleSelectionForAllEdges(true), "All Edges").setAttribute("aria-label", "All edges");
    propButton(edges, "None", "Deselect all visible edges",
      async () => await cache.sm.toggleSelectionForAllEdges(false), "No Edges").setAttribute("aria-label", "No edges");

    // One grid for all lookup rows, so labels of different widths still line
    // the inputs and buttons up in columns.
    const lookups = document.createElement("div");
    lookups.className = "select-lookup";
    selDiv.appendChild(lookups);
    appendLookupRow(lookups, {
      label: "Node IDs",
      noun: "node IDs",
      idPrefix: "selectByNodeIDs",
      placeholder: cache.data?.nodes?.slice(0, 2).map(n => n.id).join(',') || 'Node1,Node2',
      apply: (value, add) => cache.sm.addNodeOrEdgeIDsToSelectionWrapper(value, true, add),
    });
    appendLookupRow(lookups, {
      label: "Edge IDs",
      noun: "edge IDs (SourceID::TargetID)",
      idPrefix: "selectByEdgeIDs",
      placeholder: cache.data?.edges?.slice(0, 2).map(e => e.id).join(',') || 'Node1::Node2,Node1::Node3',
      apply: (value, add) => cache.sm.addNodeOrEdgeIDsToSelectionWrapper(value, false, add),
    });
    if (cache.nodeLabels.length > 0) {
      appendLookupRow(lookups, {
        label: "Node Labels",
        noun: "node labels",
        idPrefix: "selectByNodeLabels",
          placeholder: cache.nodeLabels.slice(0, 2).join(','),
        apply: (value, add) => cache.sm.addNodeOrEdgeLabelsToSelectionWrapper(value, true, add),
      });
    }
    if (cache.edgeLabels.length > 0) {
      appendLookupRow(lookups, {
        label: "Edge Labels",
        noun: "edge labels",
        idPrefix: "selectByEdgeLabels",
          placeholder: cache.edgeLabels.slice(0, 2).join(','),
        apply: (value, add) => cache.sm.addNodeOrEdgeLabelsToSelectionWrapper(value, false, add),
      });
    }
  }

  // A row that looks elements up by a typed list: Enter or "＋ Add" puts them
  // in the selection, "− Remove" takes them out. Two verbs instead of one
  // button plus a mode switch, whose state also silently decided what Enter did.
  function appendLookupRow(parent, { label, noun, idPrefix, placeholder, apply }) {
    const row = document.createElement("div");
    row.className = "select-lookup-row";
    parent.appendChild(row);
    const tooltip = `Comma-separated ${noun}. Enter adds them to the selection.`;
    const labelEl = document.createElement("label");
    labelEl.className = "prop-label";
    labelEl.id = label; // ui.js gates "Node IDs" / "Edge IDs" by this id
    labelEl.textContent = label;
    labelEl.title = tooltip;
    row.appendChild(labelEl);
    const input = createInput(undefined, placeholder, tooltip, undefined, (value) => apply(value, true));
    input.style.width = ""; // the grid column sizes it
    input.id = `${idPrefix}Input`;
    labelEl.htmlFor = input.id;
    row.appendChild(input);
    for (const add of [true, false]) {
      const btn = createButton(
        add ? "＋ Add" : "− Remove",
        add ? `Add these ${noun} to the selection` : `Remove these ${noun} from the selection`,
        async () => {
          const value = input.value.trim();
          if (value) await apply(value, add);
        },
        `${idPrefix}${add ? "Add" : "Remove"}Button`
      );
      row.appendChild(btn);
    }
  }

  function createArrangeNodesCard() {
    const arrDiv = createCard("Arrange Selection", undefined, "flat-card");
    const arrange = (mode) => async () => await cache.lm.layoutSelectedNodes(mode);

    const spacing = propRow(arrDiv, "Spacing");
    propButton(spacing, "Shrink", "Move nodes closer together, halving their distance to the center.", arrange("shrink"));
    propButton(spacing, "Expand", "Move nodes farther apart, doubling their distance to the center.", arrange("expand"));
    const layout = propRow(arrDiv, "Layout");
    propButton(layout, "Circle", "Arrange nodes evenly in a circular layout around the center.", arrange("circle"));
    propButton(layout, "Force", "Apply a force-directed layout to the selected nodes.", arrange("force"));
    propButton(layout, "Grid", "Apply a uniform grid layout to the selected nodes.", arrange("grid"));
    propButton(layout, "Random",
      "Apply a random layout to the selected nodes while preserving the original layout bonds.", arrange("random"));
  }

  /** An inspector-style button built through createButton (keeps its failure reporting). */
  function propButton(parent, label, tooltip, callback, id = undefined) {
    const btn = createButton(label, tooltip, callback, id);
    btn.className = "insp-btn";
    parent.appendChild(btn);
    return btn;
  }

  function createNodeConfigCard() {
    const nodeDiv = createCard("Node Configuration", undefined, "appearance-card");
    const D = cache.DEFAULTS;

    createNodeShapeControls(propRow(nodeDiv, "Shape"));
    const pie = propRow(nodeDiv, "Pie chart",
      "Draw the selected nodes as pie charts of their categorical or numeric properties.");
    propButton(pie, "Pie…",
      "Render the selected nodes as pie charts: map categorical values (equal slices) or numeric properties (sized slices) to wedges.",
      async () => {
        await cache.gcm.updateNodes({}, ["set_pie_chart"]);
        refreshStyleControls();
      });
    propButton(pie, "Clear pie", "Remove pie-chart rendering and restore the nodes' shape.",
      async () => await cache.gcm.updateNodes({}, ["clear_pie_chart"]));

    createNumericalSlider(propRow(nodeDiv, "Size"), "Node Size", D.NODE.SIZE, {min: 10, max: 50, step: 1});
    createColorControls(propRow(nodeDiv, "Fill color"), "Node Fill Color", D.NODE.FILL_COLOR, D.STYLES.NODE_COLORS);
    createSelectionColorsRow(nodeDiv, "Node Fill Color", "nodes");
    createNumericalSlider(propRow(nodeDiv, "Border width", "Width of the selected nodes' border."),
      "Node Border Size", D.NODE.LINE_WIDTH, {min: 1, max: 10, step: 1});
    createColorControls(propRow(nodeDiv, "Border color"), "Node Border Color", D.NODE.STROKE_COLOR,
      D.STYLES.NODE_BORDER_COLORS);
    const opacityHint =
      "Transparency of the selected nodes (1 = opaque, 0 = invisible). Composes with the fill/border color's own alpha.";
    createNumericalSlider(propRow(nodeDiv, "Opacity", opacityHint), "Node Opacity", D.NODE.OPACITY,
      {min: 0, max: 1, step: 0.05});

    propSubhead(nodeDiv, "Label");
    createLabelControls(propRow(nodeDiv, "Text"), "Node Label", true);
    createNumericalSlider(propRow(nodeDiv, "Size", "Font size of the selected nodes' labels."),
      "Node Label Font Size", D.NODE.LABEL.FONT_SIZE, {min: 10, max: 30, step: 1});
    createCategoricalControls(propRow(nodeDiv, "Position", "Where the label sits relative to the node."),
      "Node Label Placement", D.NODE.LABEL.PLACEMENT, D.STYLES.NODE_LABEL_PLACEMENTS);
    createSegmentedControls(propRow(nodeDiv, "Style"), "Node Label Font Style", "normal", FONT_STYLE_OPTIONS);
    createColorControls(propRow(nodeDiv, "Color", "Text color of the selected nodes' labels."),
      "Node Label Font Color", D.NODE.LABEL.FOREGROUND_COLOR, D.STYLES.NODE_LABEL_COLORS);
    createColorControls(propRow(nodeDiv, "Background", "Background color behind the selected nodes' labels."),
      "Node Label Background Color", D.NODE.LABEL.BACKGROUND_COLOR, D.STYLES.NODE_LABEL_BACKGROUND_COLORS);

    propSubhead(nodeDiv, "Badges");
    // selection.js refreshes it on every selection change.
    cache.ui.refreshBadgeControls = createNodeBadgeControls(cache,
      propRow(nodeDiv, "Add", "Set a badge on the selected nodes, one per spot on the node's edge."), nodeDiv).refresh;
    const badgeSize = propRow(nodeDiv, "Size", "Font size (and pill size) of the selected nodes' badges.");
    createNumericalSlider(badgeSize, "Node Badge Font Size", D.NODE.BADGE.FONT_SIZE, {min: 4, max: 32, step: 1});
    createBooleanControls(propRow(nodeDiv, "Scale",
      "Scale badges proportionally with each node's size (relative to the default node size)."),
    "Node Badge Scale With Node", undefined, "With node size");
  }

  function createEdgeConfigCard() {
    const edgeDiv = createCard("Edge Configuration", undefined, "appearance-card");
    const D = cache.DEFAULTS;
    const E = D.EDGE;

    createEdgeTypeControls(propRow(edgeDiv, "Type", "Geometric type of the selected edges."));
    createNumericalSlider(propRow(edgeDiv, "Width"), "Edge Width", E.LINE_WIDTH, {min: 0.1, max: 10.0, step: 0.1});
    createNumericalSlider(propRow(edgeDiv, "Dash", "Dash length of the selected edges; 0 is a solid line."),
      "Edge Dash", E.LINE_DASH, {min: 0, max: 40, step: 1});
    createColorControls(propRow(edgeDiv, "Color"), "Edge Color", E.COLOR, D.STYLES.EDGE_COLORS);
    createSelectionColorsRow(edgeDiv, "Edge Color", "edges");
    createNumericalSlider(propRow(edgeDiv, "Opacity",
      "Transparency of the selected edges (1 = opaque, 0 = invisible). Composes with the edge color's own alpha."),
    "Edge Opacity", E.OPACITY, {min: 0, max: 1, step: 0.05});

    propSubhead(edgeDiv, "Label");
    createLabelControls(propRow(edgeDiv, "Text"), "Edge Label");
    createNumericalSlider(propRow(edgeDiv, "Size", "Font size of the selected edges' labels."),
      "Edge Label Font Size", E.LABEL.FONT_SIZE, {min: 10, max: 30, step: 1});
    createCategoricalControls(propRow(edgeDiv, "Position", "Where along the edge the label sits."),
      "Edge Label Placement", E.LABEL.PLACEMENT, D.STYLES.EDGE_LABEL_PLACEMENTS);
    createSegmentedControls(propRow(edgeDiv, "Style"), "Edge Label Font Style", "normal", FONT_STYLE_OPTIONS);
    createBooleanControls(propRow(edgeDiv, "Rotate", "Turn the label to follow the edge's direction."),
      "Edge Label Auto Rotate", undefined, "Follow edge");
    createNumericalSlider(propRow(edgeDiv, "Offset X", "Label offset along the X-axis."),
      "Edge Label Offset X", E.LABEL.OFFSET_X, {min: -100, max: 100, step: 1}, undefined, false);
    createNumericalSlider(propRow(edgeDiv, "Offset Y", "Label offset along the Y-axis."),
      "Edge Label Offset Y", E.LABEL.OFFSET_Y, {min: -100, max: 100, step: 1}, undefined, false);
    createColorControls(propRow(edgeDiv, "Color", "Text color of the selected edges' labels."),
      "Edge Label Font Color", E.LABEL.FOREGROUND_COLOR, D.STYLES.EDGE_LABEL_COLORS);
    createColorControls(propRow(edgeDiv, "Background", "Background color behind the selected edges' labels."),
      "Edge Label Background Color", E.LABEL.BACKGROUND_COLOR, D.STYLES.EDGE_LABEL_BACKGROUND_COLORS);

    const typeHint =
      "Marker shape: arrow/rect/diamond/circle encode direction, tee (⊣) encodes inhibition.";
    for (const [end, Key, size, type, borderSize] of [
      ["start", "Start", E.ARROWS.START_SIZE, E.ARROWS.START_TYPE, E.ARROWS.START_BORDER_SIZE],
      ["end", "End", E.ARROWS.END_SIZE, E.ARROWS.END_TYPE, E.ARROWS.END_BORDER_SIZE],
    ]) {
      propSubhead(edgeDiv, `${Key} arrow`);
      createBooleanControls(propRow(edgeDiv, "Show", `Draw a marker at the ${end} of the selected edges.`),
        `Edge ${Key} Arrow`, undefined, `${Key} arrow`);
      createCategoricalControls(propRow(edgeDiv, "Shape", typeHint), `Edge ${Key} Arrow Type`, type,
        D.STYLES.EDGE_ARROW_TYPES);
      createNumericalSlider(propRow(edgeDiv, "Size", `Size of the ${end} marker.`), `Edge ${Key} Arrow Size`, size,
        {min: 4, max: 40, step: 1});
      createColorControls(propRow(edgeDiv, "Color", `Fill color of the ${end} marker. Unset inherits the edge color.`),
        `Edge ${Key} Arrow Color`, E.COLOR, D.STYLES.EDGE_ARROW_COLORS);
      createColorControls(propRow(edgeDiv, "Border", `Outline color of the ${end} marker. None for no border.`),
        `Edge ${Key} Arrow Border Color`, E.HALO.COLOR, D.STYLES.EDGE_ARROW_BORDER_COLORS);
      createNumericalSlider(propRow(edgeDiv, "Border width",
        `Thickness of the ${end} marker border in px. 0 = auto (scales with the arrow).`),
      `Edge ${Key} Arrow Border Size`, borderSize, {min: 0, max: 20, step: 1});
    }

    propSubhead(edgeDiv, "Halo");
    createBooleanControls(propRow(edgeDiv, "Show", "Draw a halo around the selected edges."),
      "Edge Halo", undefined, "Halo");
    createColorControls(propRow(edgeDiv, "Color"), "Edge Halo Color", E.HALO.COLOR, D.STYLES.EDGE_COLORS);
    createNumericalSlider(propRow(edgeDiv, "Width"), "Edge Halo Width", E.HALO.WIDTH, {min: 1, max: 30, step: 1});

    propSubhead(edgeDiv, "Flow");
    createBooleanControls(propRow(edgeDiv, "Show",
      "Animate a directional flow along the selected edges (source → target)."), "Edge Flow", undefined, "Flow");
    createCategoricalControls(propRow(edgeDiv, "Type",
      "dash = marching dashes, pulse = travelling dots, comet = fading tails, chevron = travelling arrows."),
    "Edge Flow Type", E.FLOW.TYPE, D.STYLES.EDGE_FLOW_TYPES);
    createNumericalSlider(propRow(edgeDiv, "Speed", "Speed multiplier for the flow animation."),
      "Edge Flow Speed", E.FLOW.SPEED, {min: 0.2, max: 5, step: 0.2});
    // Unset (FLOW.COLOR null) derives a lighter shade of the edge color.
    createColorControls(propRow(edgeDiv, "Color", "Color of the flow overlay. Unset derives it from the edge color."),
      "Edge Flow Color", E.FLOW.COLOR, D.STYLES.EDGE_COLORS);
    createNumericalSlider(propRow(edgeDiv, "Opacity", "Opacity of the flow overlay."),
      "Edge Flow Opacity", E.FLOW.OPACITY, {min: 0.1, max: 1, step: 0.05});
    createNumericalSlider(propRow(edgeDiv, "Density",
      "Pattern spacing multiplier — higher spreads the dashes/dots further apart."),
    "Edge Flow Density", E.FLOW.DENSITY, {min: 0.5, max: 3, step: 0.25});
  }

  // The Groups overlay card. The four fixed style tabs are gone: a workspace
  // holds any number of groups, so the card is a LIST (bubble_sets.renderGroupList
  // paints it) over one settings pane that is rebuilt for whichever row is
  // selected. Building a pane per group would be N x ~20 rows of DOM for a
  // surface that only ever shows one.
  function createBubbleSetConfigCard() {
    const bubbleDiv = createCard("Bubble Sets", undefined, "bubble-set-config-card-header");

    // What a group IS comes before the buttons that make one.
    const note = document.createElement("p");
    note.className = "insp-note";
    note.textContent =
      "Coloured bubbles drawn around nodes you group together. A group can be fed " +
      "by a filter (it then follows that filter) or by a selection, or both.";
    bubbleDiv.appendChild(note);

    // Creation verbs sit ABOVE the list: they answer "how do I get one", which
    // is the question the empty state asks and the question a user returning to
    // add another asks. "Clear all" is destructive and goes below, on its own —
    // it has no business sitting in a row of ＋ buttons.
    const tools = document.createElement("div");
    tools.className = "insp-groups";

    const newBtn = document.createElement("button");
    newBtn.id = "newGroupBtn";
    newBtn.className = "insp-btn";
    newBtn.textContent = "＋ New group";
    newBtn.title = "Create an empty group, then add nodes to it from a selection or a filter";
    newBtn.onclick = async () => {
      const group = cache.bs.createGroup();
      if (!group) return;
      cache.bs.selectedGroup = group;
      await cache.bs.afterMembershipChange("New bubble group");
      cache.ui.info(`Created "${cache.bs.groupName(group)}" — add nodes to it from a selection or a filter`);
    };
    tools.appendChild(newBtn);

    const fromSelBtn = document.createElement("button");
    fromSelBtn.id = "newGroupFromSelectionBtn";
    fromSelBtn.className = "insp-btn";
    fromSelBtn.textContent = "＋ From selection";
    fromSelBtn.title = "Create a group holding the currently selected nodes";
    fromSelBtn.onclick = () => cache.bs.createGroupFromSelection();
    tools.appendChild(fromSelBtn);

    const detectBtn = document.createElement("button");
    detectBtn.id = "detectCommunitiesBtn";
    detectBtn.className = "insp-btn";
    detectBtn.textContent = "🧩 Auto-detect";
    detectBtn.title =
      "Auto-group by community (Louvain): pick edge weighting, resolution and how " +
      "many groups to create. Adds new groups; existing ones are left alone.";
    // A RailMenu, so Escape, aria-expanded, close-on-scroll and focus restore
    // come with it (see managers/community_menu.js). It attaches its own click
    // handler; the assignment below keeps the "is it wired" check meaningful for
    // the card's tests and mirrors the other buttons here.
    detectBtn.onclick = null;
    attachCommunityMenu(detectBtn, cache.bs);
    tools.appendChild(detectBtn);

    bubbleDiv.appendChild(tools);

    // One row per group, plus the empty state. Filled by renderGroupList.
    const list = document.createElement("div");
    list.id = "groupList";
    list.className = "group-list";
    bubbleDiv.appendChild(list);

    const footer = document.createElement("div");
    footer.className = "group-list-footer";
    const clearBtn = document.createElement("button");
    clearBtn.id = "clearManualGroupsBtn";
    clearBtn.className = "insp-btn red";
    clearBtn.textContent = "Empty all groups";
    clearBtn.title =
      "Remove every node from every group. The groups themselves stay — " +
      "delete one from its ⋯ menu.";
    clearBtn.onclick = () => cache.bs.clearAllManualGroups();
    footer.appendChild(clearBtn);
    bubbleDiv.appendChild(footer);

    // Settings for the open row. group_list re-parents this ONE element into
    // whichever row is expanded; #groupStylePanelHome is where it waits when
    // none is, so a list rebuild can never destroy it.
    const panelHome = document.createElement("div");
    panelHome.id = "groupStylePanelHome";
    const panel = document.createElement("div");
    panel.id = "groupStylePanel";
    panel.className = "group-style-panel";
    panelHome.appendChild(panel);
    bubbleDiv.appendChild(panelHome);
  }

  /**
   * Build the style controls for ONE group into `#groupStylePanel`. Called
   * whenever the selected row changes, so the pane always describes exactly the
   * group whose row is highlighted.
   * @param {string|null} group  null clears the pane (no groups exist)
   */
  function buildGroupStylePanel(group) {
    const panel = document.getElementById("groupStylePanel");
    if (!panel) return;
    panel.replaceChildren();
    const bs = cache.data?.layouts?.[cache.data?.selectedLayout]?.bubbleSetStyle?.[group];
    if (!bs) return;

    const optionalCSSClass = "bubbleSetOptionalLabelConfig";
    // No heading: the pane sits inside the group's own row, which already
    // carries its name, colour and count.
    const name = bs.labelText || group;

    // Fill Color
    const rowFillColor = propRow(panel, "Fill color");
    createColorControls(rowFillColor, `Bubble Set ${group} Fill Color`, bs.fill, [], false);

    // Fill Opacity
    const rowFillOpacity = propRow(panel, "Fill opacity");
    createNumericalSlider(rowFillOpacity, `Bubble Set ${group} Fill Opacity`, bs.fillOpacity,
      {min: 0, max: 1, step: 0.01}, `Define the fill opacity of "${name}".`, false);

    // Stroke Color
    const rowStrokeColor = propRow(panel, "Stroke color");
    createColorControls(rowStrokeColor, `Bubble Set ${group} Stroke Color`, bs.stroke, [], false);

    // Stroke Opacity
    const rowStrokeOpacity = propRow(panel, "Stroke opacity");
    createNumericalSlider(rowStrokeOpacity, `Bubble Set ${group} Stroke Opacity`, bs.strokeOpacity,
      {min: 0, max: 1, step: 0.01}, `Define the stroke opacity of "${name}".`, false);

    // Padding (node influence field multiplier)
    const rowPadding = propRow(panel, "Padding",
      "How far the bubble body extends past its member nodes — lower for a tighter hug, higher for more breathing room.");
    createNumericalSlider(rowPadding, `Bubble Set ${group} Padding`, bs.padding ?? 1,
      {min: 0.01, max: 3, step: 0.01},
      `How far "${name}" extends past its member nodes.`, false);

    // Corridor Width (virtual-edge influence field multiplier)
    const rowCorridor = propRow(panel, "Corridor",
      "Thickness of the connecting arms that reach outlying member nodes.");
    createNumericalSlider(rowCorridor, `Bubble Set ${group} Corridor Width`, bs.corridor ?? 1,
      {min: 0.01, max: 3, step: 0.01},
      `Thickness of "${name}"'s connecting arms to outlying members.`, false);

    // Avoidance (non-member field on/off; persisted numeric 0/1 for
    // JSON back-compat — legacy saved values > 0 read as ON)
    const rowAvoidance = propRow(panel, "Avoid nodes",
      "Steer the hull around nodes that are not in the group and carve holes for enclosed ones. " +
      "Two overlapping groups with this on will each route around the other's nodes.");
    const avoidanceSwitch = createSwitch(async () => {
      await cache.bs.updateBubbleSetStyle(`Bubble Set ${group} Avoidance`, avoidanceSwitch.isChecked() ? 1 : 0);
    }, undefined, (bs.avoidance ?? 1) > 0);
    avoidanceSwitch.dataset.property = `Bubble Set ${group} Avoidance`;
    // The row label is a separate element, so name the checkbox directly.
    avoidanceSwitch.querySelector("input").setAttribute("aria-label", `Avoid other nodes ("${name}")`);
    rowAvoidance.appendChild(avoidanceSwitch);

    // Label (toggle + text input)
    propSubhead(panel, "Label");
    const rowLabel = propRow(panel, "Text", "Show the group's name on its outline.");
    const enableTextSwitch = createSwitch(async () => {
      await cache.bs.updateBubbleSetStyle(`Bubble Set ${group} Label`, enableTextSwitch.isChecked());
    }, undefined, bs.label);
    enableTextSwitch.dataset.property = `Bubble Set ${group} Label`;
    enableTextSwitch.querySelector("input").setAttribute("aria-label", `Show the label for "${name}"`);
    rowLabel.appendChild(enableTextSwitch);
    const labelInput = createInput(120, "label text",
      "The text drawn on the bubble. This is the same name the group list shows.",
      bs.labelText, async () => {
        await cache.bs.updateBubbleSetStyle(`Bubble Set ${group} Label Text`, labelInput.value.trim());
        cache.bs.renderGroupList();
      });
    labelInput.dataset.property = `Bubble Set ${group} Label Text`;
    labelInput.classList.add(optionalCSSClass, "prop-text");
    labelInput.style.width = "";
    rowLabel.appendChild(labelInput);

    // Label Background (toggle + color)
    const rowLabelBg = propRow(panel, "Background");
    rowLabelBg.parentElement.classList.add(optionalCSSClass);
    const enableBackgroundSwitch = createSwitch(async () => {
      await cache.bs.updateBubbleSetStyle(`Bubble Set ${group} Label Background`, enableBackgroundSwitch.isChecked());
    }, undefined, bs.labelBackground);
    enableBackgroundSwitch.dataset.property = `Bubble Set ${group} Label Background`;
    enableBackgroundSwitch
      .querySelector("input")
      .setAttribute("aria-label", `Draw a background plate behind the "${name}" label`);
    rowLabelBg.appendChild(enableBackgroundSwitch);
    createColorControls(rowLabelBg, `Bubble Set ${group} Label Background Color`,
      bs.labelBackgroundFill || bs.fill, [], false);

    // Label Fill Color
    const rowLabelFill = propRow(panel, "Color");
    rowLabelFill.parentElement.classList.add(optionalCSSClass);
    createColorControls(rowLabelFill, `Bubble Set ${group} Label Fill Color`, bs.labelFill, [], false);

    // Label Font Size
    const rowFontSize = propRow(panel, "Size");
    rowFontSize.parentElement.classList.add(optionalCSSClass);
    createNumericalSlider(rowFontSize, `Bubble Set ${group} Label Font Size`, bs.labelFontSize,
      {min: 6, max: 36, step: 1}, `Define the label font size for "${name}".`, false);

    // Label Placement
    const rowPlacement = propRow(panel, "Position");
    rowPlacement.parentElement.classList.add(optionalCSSClass);
    const placementDropdown = document.createElement("select");
    placementDropdown.className = "prop-select";
    placementDropdown.dataset.property = `Bubble Set ${group} Label Placement`;
    placementDropdown.setAttribute("aria-label", `Label placement for "${name}"`);
    ['left', 'right', 'top', 'bottom', 'center'].forEach(v => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      placementDropdown.appendChild(opt);
    });
    placementDropdown.value = bs.labelPlacement;
    placementDropdown.onchange = async () => {
      await cache.bs.updateBubbleSetStyle(`Bubble Set ${group} Label Placement`, placementDropdown.value);
    };
    rowPlacement.appendChild(placementDropdown);

    const rowFontStyle = propRow(panel, "Style");
    rowFontStyle.parentElement.classList.add(optionalCSSClass);
    const fontStyleDropdown = document.createElement("select");
    fontStyleDropdown.className = "prop-select";
    fontStyleDropdown.dataset.property = `Bubble Set ${group} Label Font Style`;
    fontStyleDropdown.setAttribute("aria-label", `Label font style for "${name}"`);
    for (const v of FONT_STYLES) fontStyleDropdown.appendChild(new Option(v, v));
    fontStyleDropdown.value = bs.labelFontStyle ?? "normal";
    fontStyleDropdown.onchange = async () => {
      await cache.bs.updateBubbleSetStyle(`Bubble Set ${group} Label Font Style`, fontStyleDropdown.value);
    };
    rowFontStyle.appendChild(fontStyleDropdown);

    // Label Close To Path
    const rowClosePath = propRow(panel, "Hug outline", "Keep the label close to the outline's path.");
    rowClosePath.parentElement.classList.add(optionalCSSClass);
    const closeToPathSwitch = createSwitch(async () => {
      await cache.bs.updateBubbleSetStyle(`Bubble Set ${group} Label Close To Path`, closeToPathSwitch.isChecked());
    }, undefined, bs.labelCloseToPath);
    closeToPathSwitch.dataset.property = `Bubble Set ${group} Label Close To Path`;
    rowClosePath.appendChild(closeToPathSwitch);

    // Label Auto Rotate
    const rowAutoRotate = propRow(panel, "Rotate", "Turn the label to follow the outline.");
    rowAutoRotate.parentElement.classList.add(optionalCSSClass);
    const autoRotateSwitch = createSwitch(async () => {
      await cache.bs.updateBubbleSetStyle(`Bubble Set ${group} Label Auto Rotate`, autoRotateSwitch.isChecked());
    }, undefined, bs.labelAutoRotate);
    autoRotateSwitch.dataset.property = `Bubble Set ${group} Label Auto Rotate`;
    rowAutoRotate.appendChild(autoRotateSwitch);

    // Label Offset X
    const rowOffsetX = propRow(panel, "Offset X");
    rowOffsetX.parentElement.classList.add(optionalCSSClass);
    createNumericalSlider(rowOffsetX, `Bubble Set ${group} Label Offset X`, bs.labelOffsetX,
      {min: -50, max: 50, step: 1}, `Define the label X offset for "${name}".`, false);

    // Label Offset Y
    const rowOffsetY = propRow(panel, "Offset Y");
    rowOffsetY.parentElement.classList.add(optionalCSSClass);
    createNumericalSlider(rowOffsetY, `Bubble Set ${group} Label Offset Y`, bs.labelOffsetY,
      {min: -50, max: 50, step: 1}, `Define the label Y offset for "${name}".`, false);

    // Dragging the label on the canvas moves it in graph space; this puts it
    // back on its outline (the offsets above stay as they are).
    const rowResetPosition = propRow(panel, "Dragged",
      "Drag the label on the canvas to place it; the Offset X/Y sliders above nudge it without dragging.",
      undefined, optionalCSSClass);
    const resetPosition = createButton("Reset",
      `Put the label of "${name}" back on its outline after dragging it.`,
      async () => await cache.bs.setLabelShift(group, 0, 0), `bubbleLabelShiftReset-${group}`);
    resetPosition.setAttribute("aria-label", `Reset the dragged label position of "${name}"`);
    rowResetPosition.appendChild(resetPosition);

    // createSwitch knows nothing of its row: name any checkbox left unnamed after the row label.
    for (const box of panel.querySelectorAll('.prop-check input:not([aria-label])')) {
      const label = box.closest(".prop-row")?.querySelector(".prop-label");
      if (label) box.setAttribute("aria-labelledby", label.id);
    }
  }

  // Turn a config card into a collapsible section: replace the floating
  // `::before` title with a real clickable header (so the panel reads as a
  // set of foldable sections instead of one tall wall of controls).
  //
  // `title` renames the header without touching data-label (the lookup key
  // other modules, the palette breadcrumb and the tests all use). `overlay`
  // names a UIManager.OVERLAYS layer and turns the header into a layer row:
  // a switch for the layer beside the disclosure for its parameters, so the
  // one row owns both. The disclosure gets its own accessible name ("…
  // settings") because the switch already answers to the plain one.
  function makeCollapsible(label, startCollapsed = false, {title = label, overlay, countId} = {}) {
    const card = root.querySelector(`[data-label="${label}"]`);
    if (!card) return;
    card.classList.add("card-collapsible");

    const bar = document.createElement("div");
    bar.className = "card-collapse-bar";
    if (overlay) card.classList.add("layer-card");

    if (overlay) {
      const sw = document.createElement("button");
      sw.type = "button";
      sw.id = `overlaySwitch${overlay[0].toUpperCase()}${overlay.slice(1)}`;
      sw.className = "layer-switch";
      sw.setAttribute("role", "switch");
      sw.setAttribute("aria-checked", "false");
      sw.setAttribute("aria-label", title);
      // syncOverlays swaps this out for a reason while the layer has nothing to
      // draw, and back in when it does, so it has to exist to be restored.
      sw.title = `Show or hide ${title.toLowerCase()} on the graph`;
      sw.addEventListener("click", () => cache.ui.toggleOverlay(overlay));
      bar.appendChild(sw);
    }

    const header = document.createElement("button");
    header.type = "button";
    header.className = "card-collapse-header";
    header.setAttribute("aria-expanded", startCollapsed ? "false" : "true");
    if (overlay) header.setAttribute("aria-label", `${title} settings`);

    const titleSpan = document.createElement("span");
    titleSpan.className = "card-collapse-title";
    titleSpan.textContent = title;
    header.appendChild(titleSpan);

    if (countId) {
      const count = document.createElement("span");
      count.className = "layer-count";
      count.id = countId;
      header.appendChild(count);
    }

    const chevron = document.createElement("span");
    chevron.className = "card-collapse-chevron";
    chevron.textContent = startCollapsed ? "▸" : "▾";
    header.appendChild(chevron);

    header.addEventListener("click", () => {
      const collapsed = card.classList.toggle("collapsed");
      chevron.textContent = collapsed ? "▸" : "▾";
      header.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });

    bar.appendChild(header);
    card.insertBefore(bar, card.firstChild);
    if (startCollapsed) card.classList.add("collapsed");
  }

  // Workspace-level density-heatmap overlay (heatmap_layer.js). NOT a
  // per-selection style: the controls drive the live layer's runtime
  // settings directly, are never persisted into layout styles, and reset
  // with the adapter on a data reload. Sliders update on `input` (live
  // preview while dragging is the point of these knobs), unlike the
  // persisted style sliders which commit on `change`.
  function createHeatmapConfigCard() {
    const card = createCard("Density Heatmap");
    const layer = () => cache.graph?.heatmapLayer;
    const D = cache.DEFAULTS.HEATMAP;
    // Build-time fallback for the (startup) window where no adapter exists
    // yet — mirrors heatmap_layer.js defaultSettings().
    const settings = () =>
      layer()?.settings ?? {
        opacity: D.OPACITY,
        intensity: D.INTENSITY,
        gamma: D.GAMMA,
        threshold: D.THRESHOLD,
        bandwidthScale: D.BANDWIDTH_SCALE,
        ramp: D.RAMP,
        fadeGraph: D.FADE_GRAPH,
      };
    const syncFns = [];
    const syncControls = () => syncFns.forEach((fn) => fn());

    function appendHeatmapSlider(parent, key, { min, max, step }, tooltip) {
      const container = document.createElement("div");
      container.className = "style-slider-container";
      if (tooltip) container.title = tooltip;

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = min;
      slider.max = max;
      slider.step = step;
      slider.classList.add("style-slider");

      const valueInput = document.createElement("input");
      valueInput.type = "number";
      valueInput.min = min;
      valueInput.max = max;
      valueInput.step = step;
      valueInput.classList.add("style-input-sm");

      const apply = (raw) => {
        const value = parseFloat(raw);
        if (!Number.isFinite(value)) return;
        layer()?.updateSettings({ [key]: value });
      };
      slider.oninput = () => {
        valueInput.value = slider.value;
        apply(slider.value);
      };
      valueInput.onchange = () => {
        slider.value = valueInput.value;
        apply(valueInput.value);
      };

      const sync = () => {
        slider.value = String(settings()[key]);
        valueInput.value = String(settings()[key]);
      };
      sync();
      syncFns.push(sync);

      container.appendChild(slider);
      container.appendChild(valueInput);
      parent.appendChild(container);
    }

    // On/off is the switch in this card's own header (makeCollapsible's
    // `overlay`), so the row owns both halves of the overlay.
    //
    // min/max are UI guardrails, not physical limits: intensity beyond 0.5
    // saturates with 2 overlaps, contrast beyond 2 crushes everything but
    // peaks, and a threshold above 0.5 hides all but the densest cores.
    const sliders = [
      ["Fade graph", "fadeGraph", { min: 0, max: 1, step: 0.05 },
        "Fade nodes toward transparent so the density field reads through. Past 40% the two "
        + "big occluders — labels and edges — drop out entirely, leaving the field and the node "
        + "positions. Selected and hovered elements keep their normal treatment."],
      ["Intensity", "intensity", { min: 0.05, max: 0.5, step: 0.01 },
        "Per-node splat strength — how quickly overlapping nodes climb the color ramp."],
      ["Opacity", "opacity", { min: 0.1, max: 1, step: 0.05 },
        "Overall transparency of the heatmap layer."],
      ["Radius", "bandwidthScale", { min: 0.25, max: 3, step: 0.05 },
        "Splat radius, as a multiple of the auto-derived bandwidth."],
      ["Contrast", "gamma", { min: 0.3, max: 2, step: 0.05 },
        "Density exponent: lower boosts faint regions, higher emphasizes dense peaks."],
      ["Threshold", "threshold", { min: 0, max: 0.5, step: 0.01 },
        "Density floor: clears everything below it, so only overlapping nodes show. "
        + "A single node peaks at the Intensity value — set this just above it to hide isolated nodes."],
    ];
    for (const [label, key, params, tooltip] of sliders) {
      appendHeatmapSlider(propRow(card, label, tooltip), key, params, tooltip);
    }

    const rowRamp = propRow(card, "Colors", "Color ramp the density maps through.");
    const rampSelect = document.createElement("select");
    rampSelect.className = "prop-select";
    rampSelect.title = "Color ramp the density maps through.";
    for (const name of Object.keys(D.RAMPS)) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name.charAt(0).toUpperCase() + name.slice(1);
      rampSelect.appendChild(option);
    }
    rampSelect.value = settings().ramp;
    rampSelect.onchange = () => layer()?.updateSettings({ ramp: rampSelect.value });
    rowRamp.appendChild(rampSelect);
    syncFns.push(() => { rampSelect.value = settings().ramp; });

    const rowReset = propRow(card, "Defaults");
    appendButton(rowReset, "Reset", "Restore the heatmap appearance defaults.", () => {
      layer()?.resetSettings();
      syncControls();
    });
    // No greying while the overlay is off: the switch sits in this card's own
    // header, so the relationship needs no explaining, and pre-tuning before
    // switching on is legitimate.
  }

  createSelectCard();
  createActOnSelectionCard();
  createArrangeNodesCard();
  createNodeConfigCard();
  createEdgeConfigCard();
  createBubbleSetConfigCard();
  createHeatmapConfigCard();

  // Node stays open (most common); Edge is the largest section so it starts
  // folded. The two overlay cards are the layer stack's settings-bearing rows:
  // both fold, and both carry their own switch (see makeCollapsible's
  // `overlay`), which is what keeps on/off and parameters in one place.
  makeCollapsible("Node Configuration", false, {title: "Nodes", countId: "styleNodeCount"});
  makeCollapsible("Edge Configuration", true, {title: "Edges", countId: "styleEdgeCount"});
  makeCollapsible("Bubble Sets", true, {
    title: "Groups",
    overlay: "groups",
    countId: "overlayCountGroups",
  });
  makeCollapsible("Density Heatmap", true, {
    title: "Density heatmap",
    overlay: "heatmap",
  });

  // The group settings pane is rebuilt whenever the selected row changes, long
  // after this builder has returned, so hand the closure to the UI manager
  // rather than making bubble_sets reach back into this module.
  cache.ui.buildGroupStylePanel = buildGroupStylePanel;
  cache.ui.refreshStyleControls = refreshStyleControls;

  return root;
}

export {
  createStyleDiv,
  createNewRow,
  createLabel,
  appendLabel,
  createSwitch,
  createButton,
  createInput,
  createColorPicker,
}
