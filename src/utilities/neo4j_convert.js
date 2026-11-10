/**
 * Neo4j entities → the app's native `{nodes, edges, ...headers}` payload:
 * property coercion, per-label property groups, deterministic auto-colors,
 * and the property-key census the exclusion checklist is built from.
 */

import { StaticUtilities } from './static.js';
import { DEFAULTS, hslToHex, GOLDEN_ANGLE_DEG } from '../config.js';

const sanitizeForAST = StaticUtilities.sanitizeForAST;
// Edge strokes get this alpha suffix so auto-colored edges stay subordinate
// to nodes, matching the translucency of the default edge color.
const EDGE_COLOR_ALPHA = '90';
const EXAMPLE_MAX_LENGTH = 40;
// Arrays longer than this (e.g. embedding vectors) are deselected by default
// in the property checklist.
const LARGE_ARRAY_THRESHOLD = 32;

/**
 * Coerce a Neo4j property value into something the filter UI can handle.
 * Primitive arrays join with ' | ' — the app splits pipe-separated strings
 * into multi-value categoricals, so list properties stay filterable per value.
 */
function coerceValue(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  // Booleans become categorical 'true'/'false' strings. Raw booleans would be
  // classified as numeric by the importer (isNaN(true) === false) and end up
  // as degenerate [1,1] sliders whose BETWEEN condition never validates
  // (the query AST requires typeof 'number'), hiding every carrier under OR.
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return sanitizeForAST(value);
  if (Array.isArray(value) && value.every((v) => typeof v !== 'object' || v === null)) {
    return value.map((v) => sanitizeForAST(String(v))).join(' | ');
  }
  return sanitizeForAST(JSON.stringify(value));
}

/** @returns {string|null} a display type for a property value, null for empty values */
function describeType(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return 'list';
  const t = typeof value;
  if (t === 'number' || t === 'boolean') return t;
  if (t === 'object') return 'object';
  return 'text';
}

/**
 * Union of property keys per element kind, with display metadata for the
 * exclusion checklist: value type ('mixed' when inconsistent), up to two
 * distinct truncated example values, and large-array detection.
 *
 * @returns {Array<{kind: 'node'|'edge', key: string, type: string, examples: string[], largeArray: boolean}>}
 */
function collectPropertyKeys(nodes, relationships) {
  const collect = (elements, kind) => {
    const byKey = new Map();
    for (const element of elements) {
      for (const [key, value] of Object.entries(element.properties ?? {})) {
        const type = describeType(value);
        if (type === null) continue; // null-valued: coerceValue drops these anyway
        let entry = byKey.get(key);
        if (!entry) {
          entry = { kind, key, types: new Set(), examples: [], largeArray: false };
          byKey.set(key, entry);
        }
        entry.types.add(type);
        if (Array.isArray(value) && value.length > LARGE_ARRAY_THRESHOLD) {
          entry.largeArray = true;
        }
        if (entry.examples.length < 2) {
          const short = StaticUtilities.truncate(coerceValue(value), EXAMPLE_MAX_LENGTH);
          if (short !== '' && !entry.examples.includes(short)) entry.examples.push(short);
        }
      }
    }
    return [...byKey.values()]
      .map(({ types, ...rest }) => ({
        ...rest,
        type: types.size === 1 ? [...types][0] : 'mixed',
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  };
  return [...collect(nodes, 'node'), ...collect(relationships, 'edge')];
}

/**
 * Most specific label of a node. Class-hierarchy tooling (neomodel-style)
 * stores the full ancestor chain as labels with the leaf class last
 * (e.g. Entity:AddOnCat:Cell → Cell), so the last entry is the primary one.
 * The complete label set stays filterable via the `Neo4j > Labels` category.
 */
function primaryLabel(node) {
  const labels = node.labels ?? [];
  return labels.length ? labels[labels.length - 1] : 'Node';
}

/** Pick a display label for a node from conventional name properties. */
function nodeDisplayLabel(node) {
  const props = node.properties ?? {};
  const candidate = props.name ?? props.title ?? props.label ?? props.id;
  if (candidate !== undefined && candidate !== null && candidate !== '') {
    return String(candidate);
  }
  return `${primaryLabel(node)} ${node.id}`;
}

/**
 * Deterministic categorical color: the app's brand palette first, then a
 * golden-angle hue walk so any number of categories stays distinguishable.
 */
function categoryColor(index) {
  const palette = DEFAULTS.NODE.PIE.SLICE_PALETTE;
  if (index < palette.length) return palette[index];
  return hslToHex((index * GOLDEN_ANGLE_DEG) % 360, 0.55, 0.55);
}

/**
 * Edge palette: the node palette contains pale tones (#EFB0AA, #8CA6D9) that
 * vanish at EDGE_COLOR_ALPHA against a light background. Edges instead walk
 * the golden-angle hue wheel at mid lightness, which stays legible over both
 * light and dark themes (stored styles are static hexes — they cannot adapt
 * to a theme switch). Offset from blue so index 0 differs from the node red.
 */
function edgeCategoryColor(index) {
  return hslToHex((210 + index * GOLDEN_ANGLE_DEG) % 360, 0.55, 0.45);
}

/**
 * Map each category to a color, or null when there are fewer than two
 * categories (a single category carries no visual information — keep the
 * app defaults). Categories are sorted so colors are deterministic.
 *
 * @param {string[]} categories
 * @param {(index: number) => string} [colorFn]
 * @returns {Map<string, string>|null}
 */
function buildCategoryColors(categories, colorFn = categoryColor) {
  const unique = [...new Set(categories)].sort();
  if (unique.length < 2) return null;
  return new Map(unique.map((category, index) => [category, colorFn(index)]));
}

/**
 * Convert collected Neo4j entities into the app's native payload.
 * Properties are grouped by the element's primary label / relationship type;
 * a `Neo4j` group carries `Labels` / `Type` so they stay filterable.
 *
 * @param {object[]} nodes
 * @param {object[]} relationships
 * @param {{excludedNodeProps?: Set<string>, excludedEdgeProps?: Set<string>}} [options]
 * @returns {{nodes: object[], edges: object[], nodeDataHeaders: object[], edgeDataHeaders: object[]}}
 */
function toAppFormat(nodes, relationships, options = {}) {
  const excludedNodeProps = options.excludedNodeProps ?? new Set();
  const excludedEdgeProps = options.excludedEdgeProps ?? new Set();
  const nodeHeaders = new Map();
  const edgeHeaders = new Map();

  const addHeader = (headers, subGroup, key) => {
    headers.set(`${subGroup}::${key}`, { subGroup, key });
  };

  const buildFilters = (properties, subGroup, excluded, headers) => {
    const filters = {};
    for (const [rawKey, raw] of Object.entries(properties ?? {})) {
      if (excluded.has(rawKey)) continue;
      const value = coerceValue(raw);
      if (value === undefined) continue;
      const key = sanitizeForAST(rawKey);
      filters[key] = value;
      addHeader(headers, subGroup, key);
    }
    return filters;
  };

  const nodeColors = buildCategoryColors(nodes.map((n) => sanitizeForAST(primaryLabel(n))));
  const edgeColors = buildCategoryColors(
    relationships.map((r) => sanitizeForAST(r.type || 'Relationship')),
    edgeCategoryColor,
  );

  const appNodes = nodes.map((node) => {
    const subGroup = sanitizeForAST(primaryLabel(node));
    // No synthetic type property — the per-label property groups and the
    // auto-coloring already carry the entity type.
    const filters = {
      [subGroup]: buildFilters(node.properties, subGroup, excludedNodeProps, nodeHeaders),
    };
    return {
      id: node.id,
      label: nodeDisplayLabel(node),
      ...(nodeColors ? { style: { fill: nodeColors.get(subGroup) } } : {}),
      D4Data: { 'Node filters': filters },
    };
  });

  const appEdges = relationships.map((rel) => {
    const subGroup = sanitizeForAST(rel.type || 'Relationship');
    const filters = {
      [subGroup]: buildFilters(rel.properties, subGroup, excludedEdgeProps, edgeHeaders),
    };
    return {
      id: rel.id,
      source: rel.startNode,
      target: rel.endNode,
      label: rel.type,
      ...(edgeColors
        ? { style: { stroke: `${edgeColors.get(subGroup)}${EDGE_COLOR_ALPHA}` } }
        : {}),
      D4Data: { 'Edge filters': filters },
    };
  });

  return {
    nodes: appNodes,
    edges: appEdges,
    nodeDataHeaders: [...nodeHeaders.values()],
    edgeDataHeaders: [...edgeHeaders.values()],
  };
}

export {
  collectPropertyKeys,
  toAppFormat,
  coerceValue,
  nodeDisplayLabel,
  primaryLabel,
  categoryColor,
  edgeCategoryColor,
  buildCategoryColors,
  LARGE_ARRAY_THRESHOLD,
};
