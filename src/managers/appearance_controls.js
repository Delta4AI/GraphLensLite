import {safePaint} from "../graph/shape_textures.js";
import {FONT_STYLES} from "../graph/label_renderers.js";
import {MIXED, STYLE_PROPERTIES, styleOverride, readProperty, sharedBy, colorBuckets, labelSource}
  from "./selection_style_values.js";

/**
 * The inspector's control primitives and the selection-bound appearance
 * controls: every builder that shows the selection's shared value or "Mixed"
 * and writes edits back through gcm.updateNodes / updateEdges. The card
 * layouts that arrange them live in ui_style_div.js.
 */

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

/** @param {(err: unknown) => void} report */
function setButtonFailureReporter(report) {
  reportButtonFailure = report;
}

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
  // The accessible name carries the section and sub-group too: "Color" alone
  // names six different edge controls ("Edge start arrow color" names one).
  const section = parent.dataset?.propSection;
  const fullName = [section, group?.toLowerCase(), text.toLowerCase()].filter(Boolean).join(" ");
  const label = document.createElement("label");
  label.className = "prop-label";
  label.id = `propLabel${++propRowSeq}`;
  label.textContent = text;
  if (tooltip) label.title = tooltip;
  const ctl = document.createElement("div");
  ctl.className = "prop-ctl";
  ctl.dataset.labelId = label.id;
  ctl.dataset.labelText = fullName.charAt(0).toUpperCase() + fullName.slice(1);
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

const FOLD_STORAGE_PREFIX = "gll.fold.";
let propFoldSeq = 0;

/**
 * A sub-group that folds to one line: a disclosure heading with a summary of
 * what the rows hold ("Label · Label, bottom, 12"), over a body the rows are
 * built into. Open or closed is remembered per viewer, by `key`.
 * @param {{open?: boolean, key?: string, summary?: (body: HTMLElement) => string}} [opts]
 *   `open` is the default before the viewer has chosen; `summary` is re-read on
 *   every selection refresh and after any edit inside the body.
 * @returns {HTMLDivElement} the body to build rows into
 */
function propFold(parent, text, {open = false, key = `${parent.dataset?.propSection ?? ""}.${text}`, summary} = {}) {
  const fold = document.createElement("div");
  fold.className = "prop-fold";
  const head = document.createElement("button");
  head.type = "button";
  head.className = "prop-subhead prop-fold-head";
  const chevron = document.createElement("span");
  chevron.className = "prop-fold-chevron";
  chevron.setAttribute("aria-hidden", "true");
  const title = document.createElement("span");
  title.textContent = text;
  const sum = document.createElement("span");
  sum.className = "prop-fold-summary";
  head.append(chevron, title, sum);
  const body = document.createElement("div");
  body.className = "prop-fold-body";
  body.id = `propFold${++propFoldSeq}`;
  head.setAttribute("aria-controls", body.id);
  if (parent.dataset?.propSection) body.dataset.propSection = parent.dataset.propSection;
  body.dataset.propGroup = text;
  fold.append(head, body);
  parent.appendChild(fold);

  const storageKey = FOLD_STORAGE_PREFIX + key;
  let stored = null;
  try { stored = localStorage.getItem(storageKey); } catch { /* storage blocked: use the default */ }
  fold.setOpen = (isOpen, remember = false) => {
    fold.classList.toggle("collapsed", !isOpen);
    head.setAttribute("aria-expanded", String(isOpen));
    chevron.textContent = isOpen ? "▾" : "▸";
    if (!remember) return;
    try { localStorage.setItem(storageKey, isOpen ? "1" : "0"); } catch { /* per-viewer nicety only */ }
  };
  fold.setOpen(stored === null ? open : stored === "1");
  head.addEventListener("click", () => fold.setOpen(fold.classList.contains("collapsed"), true));

  fold.updateSummary = () => {
    const text = summary?.(body) ?? "";
    sum.textContent = text ? `· ${text}` : "";
  };
  // An edit inside lands in its control first; read it once the handler ran.
  const later = () => setTimeout(fold.updateSummary, 0);
  body.addEventListener("change", later);
  body.addEventListener("click", later);
  return body;
}

/**
 * What a row shows, in words, for a fold's summary: the pressed segment, the
 * chosen option, the number, the text, on/off, or "Mixed".
 * @param {HTMLElement} root  a fold body
 * @param {string} name  the row's data-name ("Label size")
 */
function rowValue(root, name) {
  const ctl = root.querySelector(`.prop-row[data-name="${name}"] > .prop-ctl`);
  if (!ctl) return "";
  if (ctl.querySelector(".prop-mixed:not([hidden])")) return "Mixed";
  const pressed = ctl.querySelector('.prop-seg > button[aria-pressed="true"]');
  if (pressed) return pressed.textContent;
  const text = ctl.querySelector(".prop-text");
  if (text?.value) return `“${text.value}”`;
  const select = ctl.querySelector("select");
  if (select) return select.selectedOptions[0]?.textContent ?? "";
  const number = ctl.querySelector(".style-input-sm");
  if (number) return number.value || (number.placeholder === "—" ? "" : number.placeholder);
  const box = ctl.querySelector('input[type="checkbox"]');
  if (box) return box.indeterminate ? "Mixed" : box.checked ? "on" : "off";
  const hex = ctl.querySelector(".color-hex");
  if (hex) return hex.value || hex.placeholder;
  return "";
}

/**
 * Give `control` an accessible name: the row label when built into a
 * propRow (with `suffix` appended for secondary controls, e.g. "hex"),
 * otherwise `fallback`.
 */
function nameControl(parent, control, fallback, suffix = "") {
  const rowText = parent.dataset?.labelText;
  if (rowText && !suffix) {
    control.setAttribute("aria-label", rowText);
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
const HEX_COLOR = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** Anything the browser parses as a colour; hex only where CSS.supports is missing (jsdom). */
const isColor = (value) => (globalThis.CSS?.supports ? CSS.supports("color", value) : HEX_COLOR.test(value));
const isUnsetColor = (c) => c == null || c === "" || String(c).toLowerCase() === TRANSPARENT;

/** "#RRGGBB" for <input type=color>, which takes nothing else; null if not hex. */
function toHex6(color) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(color ?? ""));
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((ch) => ch + ch).join("") : m[1];
  return `#${hex.toLowerCase()}`;
}

// How many of a mixed selection's colours the swatch shows as slices.
const MAX_SWATCH_SLICES = 5;
// <input type=color> needs some #rrggbb even when the value is mixed or unset.
const PICKER_FALLBACK = "#000000";

/** A swatch background for a mixed selection: its most common colours as slices. */
function mixedSwatchBackground(colors) {
  const paints = colors.slice(0, MAX_SWATCH_SLICES).map((c) => safePaint(c, "transparent"));
  if (paints.length < 2) return paints[0] ?? "transparent";
  const step = 100 / paints.length;
  return `conic-gradient(${paints.map((p, i) => `${p} ${i * step}% ${(i + 1) * step}%`).join(", ")})`;
}

/**
 * Builders bound to the current selection. Each control registers a binding;
 * refreshStyleControls re-reads the selection into all of them.
 */
function createAppearanceControls(cache) {
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
    const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;
    for (const fold of document.querySelectorAll(".prop-fold")) fold.updateSummary?.();
    setCount("actSelectionCount", nodes.length + edges.length
      ? `${plural(nodes.length, "node")} · ${plural(edges.length, "edge")}` : "");
  }

  /** gcm.updateNodes or updateEdges, by the property's target. */
  function updateTarget(target, overrides, commands = [], ...options) {
    return target === "node"
      ? cache.gcm.updateNodes(overrides, commands, ...options)
      : cache.gcm.updateEdges(overrides, commands, ...options);
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
    await updateTarget(STYLE_PROPERTIES[property].target, styleOverride(property, value), commands);
    refreshStyleControls();
  }

  /**
   * Map by data: the row's cell in the card's Map column (the column header
   * labels it; the button's own name says "map by data").
   */
  function createMapButton(parent, property, title, sentinel) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "prop-map-btn";
    btn.textContent = "◇";
    btn.title = title;
    btn.dataset.property = property;
    nameControl(parent, btn, property, "— map by data");
    btn.onclick = () => {
      if (sentinel === "set_numeric_scale") cache.numericPicker.currentProperty = property;
      Promise.resolve(handleStyleChangeEvent(property, sentinel)).catch(reportButtonFailure);
    };
    // The row's third column when built into a propRow; inline otherwise.
    const row = parent.parentElement?.classList.contains("prop-row") ? parent.parentElement : parent;
    row.appendChild(btn);
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
      btn.dataset.value = value;
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
    mixedTag.id = `${group.getAttribute("aria-labelledby") ?? property.replace(/\W+/g, "")}Mixed`;
    parent.append(group, mixedTag);
    bind(property, (value) => {
      mixedTag.hidden = value !== MIXED;
      // Toggled, not left in place: a describedby target is read even while hidden.
      if (value === MIXED) group.setAttribute("aria-describedby", mixedTag.id);
      else group.removeAttribute("aria-describedby");
      // Nothing selected (undefined) or mixed: no segment is the value.
      const shown = value === MIXED || value === undefined ? undefined : value ?? defaultValue;
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

    let shown = typedDefaultValue;
    const showValue = (value) => {
      shown = value;
      if (value === undefined) {
        // Nothing of this kind selected: no value, not a made-up default.
        slider.classList.remove("is-mixed");
        slider.value = typedDefaultValue;
        valueInput.value = "";
        valueInput.placeholder = "—";
        return;
      }
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
      if (value === shown) return; // already the selection's value: no extra undo step
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
    // Escape restores the shown value; commit's `value === shown` guard keeps
    // the change event that may follow from writing anything.
    valueInput.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      showValue(shown);
    });

    container.append(slider, valueInput);
    parent.appendChild(container);

    if (enableNumericScale) {
      createMapButton(parent, property,
        `Map by data: scale ${property} from a numeric property's values (e.g. larger nodes for higher degree)`,
        "set_numeric_scale");
    }
    bind(property, (value) => showValue(value === null ? typedDefaultValue : value),
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
    const colorPicker = createColorPicker(toHex6(defaultColor) ?? PICKER_FALLBACK,
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

    const pickerName = colorPicker.getAttribute("aria-label");
    let shown = defaultColor; // what the field shows when nothing is being typed
    let shownEntries = [];
    const paintWell = (value, entries = shownEntries) => {
      shown = value;
      shownEntries = entries;
      well.classList.remove("is-mixed", "is-unset");
      colorInput.classList.remove("is-invalid");
      colorInput.removeAttribute("aria-invalid");
      // The native input cannot say "mixed" or "none"; its name has to.
      colorPicker.setAttribute("aria-label", value === MIXED ? `${pickerName}, currently mixed`
        : isUnsetColor(value) ? `${pickerName}, currently ${unsetText.toLowerCase()}` : pickerName);
      if (value === undefined) {
        // Nothing of this kind selected: show no value rather than a default.
        well.style.background = "";
        well.classList.add("is-unset");
        colorInput.value = "";
        colorInput.placeholder = "—";
      } else if (value === MIXED) {
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
      if (!isColor(trimmed)) {
        colorInput.classList.add("is-invalid");
        colorInput.setAttribute("aria-invalid", "true");
        cache.ui.error(`"${trimmed}" is not a colour. Type a hex code like #C33D35, or press Esc to undo the typing.`);
        return;
      }
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
      } else if (event.key === "Escape") {
        // Back out of the typing: restore what the selection carries, apply nothing.
        event.preventDefault();
        paintWell(shown);
        // The blur that follows must not commit the restored text.
        lastCommitted = colorInput.value.trim();
      }
    });
    colorInput.addEventListener("input", () => {
      colorInput.classList.remove("is-invalid");
      colorInput.removeAttribute("aria-invalid");
    });

    parent.append(well, colorInput);

    const palette = Object.entries(colors);
    if (palette.length) {
      // The palette always starts its own line, so every colour row wraps alike.
      const lineBreak = document.createElement("span");
      lineBreak.className = "prop-break";
      parent.appendChild(lineBreak);
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
      paintWell(value, entries);
    }, {fallback: null});
  }

  /**
   * The "In selection" row (after Figma's Selection colors): while a colour is
   * mixed, one strip of the selection's colours, each segment as wide as its
   * share and labelled with its count; picking a new colour for a segment
   * recolours just those elements.
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
    chips.className = "prop-share";
    let expanded = false;
    const more = document.createElement("button");
    more.type = "button";
    more.className = "insp-btn prop-more";
    more.onclick = () => {
      expanded = true;
      refreshStyleControls();
      chips.children[MAX_CHIPS]?.focus();
    };
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
      const update = updateTarget(target, styleOverride(property, picker.value), [], {ids});
      Promise.resolve(update).then(() => {
        refreshStyleControls();
        // The clicked chip was rebuilt away; keep keyboard focus in the row.
        const next = row.hidden ? document.querySelector(`.color-hex[data-property="${property}"]`)
          : chips.firstElementChild;
        next?.focus();
      }).catch(reportButtonFailure);
    };
    ctl.append(chips, more, picker);

    bind(property, (value, entries) => {
      const buckets = value === MIXED ? colorBuckets(entries, key) : [];
      row.hidden = buckets.length < 2;
      if (row.hidden) expanded = false;
      chips.replaceChildren();
      for (const bucket of expanded ? buckets : buckets.slice(0, MAX_CHIPS)) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "prop-chip";
        // Width by share; CSS keeps every segment a 24px target.
        chip.style.flexGrow = String(bucket.ids.length);
        const dot = document.createElement("i");
        dot.style.background = safePaint(bucket.color, "transparent");
        const count = document.createElement("span");
        count.textContent = String(bucket.ids.length);
        chip.append(dot, count);
        chip.title = `${bucket.color} — ${bucket.ids.length} ${noun}. Click to recolour them.`;
        chip.setAttribute("aria-label", `Recolour the ${bucket.ids.length} ${noun} coloured ${bucket.color}`);
        chip.onclick = () => {
          pending = bucket.ids;
          picker.value = toHex6(bucket.color) ?? PICKER_FALLBACK;
          if (typeof picker.showPicker === "function") picker.showPicker();
          else picker.click();
        };
        chips.appendChild(chip);
      }
      const hidden = expanded ? 0 : buckets.length - MAX_CHIPS;
      more.hidden = hidden <= 0;
      more.textContent = `Show ${hidden} more`;
    });
  }

  /**
   * Label text: a custom-text field plus ID / Label / None, pressed by where
   * the selection's labels come from now.
   */
  function createLabelControls(parent, property, isNode = null) {
    const noun = isNode ? "nodes" : "edges";
    const target = isNode ? "node" : "edge";
    const readSource = (entry) => labelSource(entry.raw, cache.CFG.INVISIBLE_CHAR);
    const run = async (overrides, commands) => {
      await updateTarget(target, overrides, commands);
      refreshStyleControls();
    };

    let committedText = "";
    const commitText = (text) => {
      if (!text || text === committedText) return;
      committedText = text;
      return run({style: {label: true, labelText: text}});
    };
    const labelInput = createInput(120, "Custom text",
      `Type a label for the selected ${noun}; Enter or leaving the field applies it.`, undefined,
      (text) => Promise.resolve(commitText(text)).catch(reportButtonFailure));
    labelInput.addEventListener("focus", () => { committedText = labelInput.value.trim(); });
    labelInput.addEventListener("change", () => {
      Promise.resolve(commitText(labelInput.value.trim())).catch(reportButtonFailure);
    });
    labelInput.classList.add("prop-text");
    labelInput.style.width = "";
    nameControl(parent, labelInput, property);
    parent.appendChild(labelInput);

    const sources = [
      {value: "id", text: "ID", label: `ID: label the selected ${noun} with their IDs`},
      {value: "label", text: "Label", label: `Label: use the selected ${noun}' predefined labels`},
      {value: "none", text: "None", label: `None: hide the labels of the selected ${noun}`},
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
      read: readSource,
    });

    bind(sourceProperty, (value, entries) => {
      const custom = value === "custom" ? sharedBy(entries, (e) => e.raw.style?.labelText) : undefined;
      labelInput.value = typeof custom === "string" ? custom : "";
      labelInput.placeholder = value === MIXED || custom === MIXED ? "Mixed" : "Custom text";
    }, {target, read: readSource});
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
    // Visible text first (WCAG 2.5.3), then what it means.
    label: {normal: "Normal", bold: "B (bold)", italic: "I (italic)", "bold italic": "BI (bold italic)"}[value] ?? value,
  }));

  return {
    handleStyleChangeEvent,
    refreshStyleControls,
    createBooleanControls,
    createCategoricalControls,
    createSegmentedControls,
    createNumericalSlider,
    createColorControls,
    createSelectionColorsRow,
    createLabelControls,
    createNodeShapeControls,
    createEdgeTypeControls,
    FONT_STYLE_OPTIONS,
  };
}

export {
  createAppearanceControls,
  setButtonFailureReporter,
  createButton,
  createInput,
  createColorPicker,
  propRow,
  propSubhead,
  propFold,
  rowValue,
  nameControl,
};
