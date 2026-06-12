/**
 * Node-safe pie-slice model for @sigma/node-piechart (no DOM/WebGL — vitest
 * covers it, and graph_model.js may depend on it).
 *
 * The piechart program is created with a FIXED number of slices; slice K reads
 * its angle from the per-node `pieValueK` attribute and its color from
 * `pieColorK` (see sigma_adapter.buildProgramRegistry). So the app's job is two
 * pure steps:
 *   1. turn a node's chosen properties into an ordered [{value, color}] list
 *      (buildCategoricalSlices / buildNumericSlices), and
 *   2. flatten that list onto the fixed pieValueK/pieColorK slots, padding the
 *      unused tail with value 0 + a transparent color so it collapses to
 *      nothing (pieAttributesFromSlices).
 *
 * Categorical slices are equal-weight (presence = 1) so the disc splits evenly
 * across the values a node carries; numeric slices weight by magnitude.
 */

// Unused slots: zero angle + transparent so the program draws nothing for them.
const TRANSPARENT = "#00000000";

/**
 * Equal-weight slices for the distinct categorical values a node carries
 * across the selected properties. Order is preserved (caller controls it);
 * empty/nullish values are skipped. Each present value contributes one slice.
 *
 * @param {Iterable<string>} distinctValues  the node's values (already deduped)
 * @param {Map<string, string>|Record<string, string>} valueColors  value → hex
 * @param {string} missingColor  fallback when a value has no assigned color
 * @returns {Array<{value: number, color: string}>}
 */
function buildCategoricalSlices(distinctValues, valueColors, missingColor) {
  const lookup = valueColors instanceof Map ? valueColors : new Map(Object.entries(valueColors ?? {}));
  const slices = [];
  for (const raw of distinctValues ?? []) {
    if (raw === null || raw === undefined) continue;
    const value = String(raw).trim();
    if (value === "") continue;
    slices.push({ value: 1, color: lookup.get(value) ?? missingColor });
  }
  return slices;
}

/**
 * Magnitude-weighted slices: one slice per selected numeric property, angle
 * proportional to that property's value on the node. Non-finite or negative
 * values are clamped to 0 (a zero-angle, invisible slice) rather than dropped,
 * so the slice order stays aligned with the property order and the legend.
 *
 * @param {Array<string>} orderedProps  selected property ids, in legend order
 * @param {Map<string, number>|Record<string, number>} valueByProp  prop → value
 * @param {Map<string, string>|Record<string, string>} propColors  prop → hex
 * @param {string} missingColor  fallback when a property has no assigned color
 * @returns {Array<{value: number, color: string}>}
 */
function buildNumericSlices(orderedProps, valueByProp, propColors, missingColor) {
  const values = valueByProp instanceof Map ? valueByProp : new Map(Object.entries(valueByProp ?? {}));
  const colors = propColors instanceof Map ? propColors : new Map(Object.entries(propColors ?? {}));
  const slices = [];
  for (const prop of orderedProps ?? []) {
    const raw = Number(values.get(prop));
    const value = Number.isFinite(raw) && raw > 0 ? raw : 0;
    slices.push({ value, color: colors.get(prop) ?? missingColor });
  }
  return slices;
}

/**
 * Flatten an ordered slice list onto the program's fixed pieValueK/pieColorK
 * slots. Returns `type: "pie"` so the renderer routes the node to the piechart
 * program. Slices beyond `maxSlices` are dropped (the picker warns before this
 * point — see DEFAULTS.NODE.PIE.MAX_SLICES); the unused tail gets value 0 and a
 * transparent color so old/larger pies never leave ghost wedges after a change.
 *
 * @param {Array<{value: number, color: string}>} slices
 * @param {number} maxSlices  program slice count (DEFAULTS.NODE.PIE.MAX_SLICES)
 * @param {string} defaultColor  fallback for a present slice missing a color
 * @returns {{type: "pie"} & Record<string, number|string>}
 */
function pieAttributesFromSlices(slices, maxSlices, defaultColor) {
  const effective = Array.isArray(slices) ? slices.slice(0, maxSlices) : [];
  const attrs = { type: "pie" };
  for (let k = 0; k < maxSlices; k++) {
    const slice = effective[k];
    if (slice) {
      const value = Number.isFinite(slice.value) && slice.value > 0 ? slice.value : 0;
      attrs[`pieValue${k}`] = value;
      attrs[`pieColor${k}`] = slice.color || defaultColor;
    } else {
      attrs[`pieValue${k}`] = 0;
      attrs[`pieColor${k}`] = TRANSPARENT;
    }
  }
  return attrs;
}

export { buildCategoricalSlices, buildNumericSlices, pieAttributesFromSlices };
