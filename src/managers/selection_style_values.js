/**
 * What the appearance editor shows for the current selection: one value when
 * every selected element agrees, MIXED when they differ. Pure — the DOM side
 * lives in ui_style_div.js.
 */

const MIXED = Symbol("mixed");

/**
 * Editor property name → where it lives on a node/edge. `type` reads the
 * element's shape/edge type instead of a style key. The property names are
 * internal identifiers (numeric_scale_picker.js switches on them too), not UI
 * copy, so they stay stable.
 */
const STYLE_PROPERTIES = {
  "Node Shape": { target: "node", key: "type" },
  "Node Size": { target: "node", key: "size" },
  "Node Border Size": { target: "node", key: "lineWidth" },
  "Node Fill Color": { target: "node", key: "fill" },
  "Node Border Color": { target: "node", key: "stroke" },
  "Node Opacity": { target: "node", key: "opacity" },
  "Node Label Font Size": { target: "node", key: "labelFontSize" },
  "Node Label Font Color": { target: "node", key: "labelFill" },
  "Node Label Background Color": { target: "node", key: "labelBackgroundFill", also: { labelBackground: true } },
  "Node Label Placement": { target: "node", key: "labelPlacement" },
  "Node Label Font Style": { target: "node", key: "labelFontStyle" },
  "Node Badge Font Size": { target: "node", key: "badgeFontSize" },
  "Node Badge Scale With Node": { target: "node", key: "badgeScaleWithNode" },
  "Edge Type": { target: "edge", key: "type" },
  "Edge Color": { target: "edge", key: "stroke" },
  "Edge Width": { target: "edge", key: "lineWidth" },
  "Edge Opacity": { target: "edge", key: "opacity" },
  "Edge Dash": { target: "edge", key: "lineDash" },
  "Edge Label Font Size": { target: "edge", key: "labelFontSize" },
  "Edge Label Offset X": { target: "edge", key: "labelOffsetX" },
  "Edge Label Offset Y": { target: "edge", key: "labelOffsetY" },
  "Edge Label Placement": { target: "edge", key: "labelPlacement" },
  "Edge Label Font Style": { target: "edge", key: "labelFontStyle" },
  "Edge Label Font Color": { target: "edge", key: "labelFill" },
  "Edge Label Background Color": { target: "edge", key: "labelBackgroundFill", also: { labelBackground: true } },
  "Edge Label Auto Rotate": { target: "edge", key: "labelAutoRotate" },
  "Edge Start Arrow": { target: "edge", key: "startArrow" },
  "Edge End Arrow": { target: "edge", key: "endArrow" },
  "Edge Start Arrow Size": { target: "edge", key: "startArrowSize" },
  "Edge End Arrow Size": { target: "edge", key: "endArrowSize" },
  "Edge Start Arrow Type": { target: "edge", key: "startArrowType" },
  "Edge End Arrow Type": { target: "edge", key: "endArrowType" },
  "Edge Start Arrow Color": { target: "edge", key: "startArrowColor" },
  "Edge Start Arrow Border Color": { target: "edge", key: "startArrowBorderColor" },
  "Edge Start Arrow Border Size": { target: "edge", key: "startArrowBorderSize" },
  "Edge End Arrow Color": { target: "edge", key: "endArrowColor" },
  "Edge End Arrow Border Color": { target: "edge", key: "endArrowBorderColor" },
  "Edge End Arrow Border Size": { target: "edge", key: "endArrowBorderSize" },
  "Edge Halo": { target: "edge", key: "halo" },
  "Edge Halo Width": { target: "edge", key: "haloLineWidth" },
  "Edge Halo Color": { target: "edge", key: "haloStroke" },
  "Edge Flow": { target: "edge", key: "flow" },
  "Edge Flow Type": { target: "edge", key: "flowType" },
  "Edge Flow Speed": { target: "edge", key: "flowSpeed" },
  "Edge Flow Color": { target: "edge", key: "flowStroke" },
  "Edge Flow Opacity": { target: "edge", key: "flowOpacity" },
  "Edge Flow Density": { target: "edge", key: "flowDensity" },
};

/** The overrides object gcm.updateNodes/updateEdges expects for one property. */
function styleOverride(property, value) {
  const spec = STYLE_PROPERTIES[property];
  if (!spec) throw new Error(`Unknown style property: ${property}`);
  if (spec.key === "type") return { type: value };
  return { style: { ...spec.also, [spec.key]: value } };
}

/** Read one property off a resolved {type, style} element (style.js *OrDefaults). */
function readProperty(resolved, key) {
  return key === "type" ? resolved.type : resolved.style?.[key];
}

/**
 * The single value every item shares, MIXED when they differ, undefined for an
 * empty list. null and undefined count as the same "unset" value.
 * @param {Array} items
 * @param {(item: any) => any} read
 */
function sharedBy(items, read) {
  if (items.length === 0) return undefined;
  const first = read(items[0]) ?? null;
  for (let i = 1; i < items.length; i++) {
    if ((read(items[i]) ?? null) !== first) return MIXED;
  }
  return first;
}

/** sharedBy over resolved {type, style} elements for one style key. */
function sharedValue(resolved, key) {
  return sharedBy(resolved, (r) => readProperty(r, key));
}

/**
 * Distinct values of one colour key with the ids that carry each, most common
 * first — the "In selection" row. Unset colours are left out: there is nothing
 * to recolour from.
 * @param {Array<{id: string, resolved: {style?: object}}>} entries
 * @returns {Array<{color: string, ids: string[]}>}
 */
function colorBuckets(entries, key) {
  const byColor = new Map();
  for (const { id, resolved } of entries) {
    const color = readProperty(resolved, key);
    if (color == null || color === "") continue;
    const normalized = String(color).toLowerCase();
    if (!byColor.has(normalized)) byColor.set(normalized, { color, ids: [] });
    byColor.get(normalized).ids.push(id);
  }
  return [...byColor.values()].sort((a, b) => b.ids.length - a.ids.length);
}

/**
 * Where an element's label text comes from: "id", "label", "none" (hidden by
 * the invisible character), or "custom".
 */
function labelSource(element, invisibleChar) {
  const text = element.style?.labelText;
  if (text === invisibleChar) return "none";
  if (text == null || text === element.label) return "label";
  if (text === element.id) return "id";
  return "custom";
}

export { MIXED, STYLE_PROPERTIES, styleOverride, readProperty, sharedBy, sharedValue, colorBuckets, labelSource };
