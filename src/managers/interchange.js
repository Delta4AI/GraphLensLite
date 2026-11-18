/**
 * The format-neutral half of GraphML and CX2 interchange (graphml.js, cx2.js).
 *
 * Import: `GraphImport` collects nodes, edges and typed attributes from a
 * parsed file and produces the same `{nodes, edges, nodeDataHeaders,
 * edgeDataHeaders}` shape the Excel importer hands to `preProcessData`.
 * Export: `interchangeGraph` flattens the loaded graph into named, typed
 * columns a writer can serialize.
 */
import { CFG, UNSAFE_OBJECT_KEYS } from '../config.js';
import { EXCEL_NODE_PROPERTIES, EXCEL_EDGE_PROPERTIES, decodeKey } from './excel_schema.js';

/**
 * Files above this size are refused before they are read. Parsing builds the
 * whole DOM or JSON tree first, so this cap bounds memory before any count
 * can be taken.
 */
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
/** Nodes plus edges a single file may carry. */
const MAX_IMPORT_ELEMENTS = 500_000;
/** Declared node (or edge) attributes a file may carry. */
const MAX_DECLARED_ATTRIBUTES = 1_000;
/** Attribute values across all elements, defaults included. */
const MAX_ATTRIBUTE_VALUES = 5_000_000;
/** Coordinates beyond this are treated as unusable (they break the layout maths). */
const MAX_COORDINATE = 1e9;
/** The separator inside GLL property ids (`section::group::key`). */
const PROP_ID_SEPARATOR = '::';
/** GLL splits categorical cells on this; list attributes are joined with it. */
const LIST_SEPARATOR = '|';

const columnApplier = (table, column) => table.find((p) => p.column === column).apply;
const applyNodeLabel = columnApplier(EXCEL_NODE_PROPERTIES, 'Label');
const applyNodeDescription = columnApplier(EXCEL_NODE_PROPERTIES, 'Description');
const applyNodeX = columnApplier(EXCEL_NODE_PROPERTIES, 'X Coordinate');
const applyNodeY = columnApplier(EXCEL_NODE_PROPERTIES, 'Y Coordinate');
const applyEdgeLabel = columnApplier(EXCEL_EDGE_PROPERTIES, 'Label');
const applyEdgeDescription = columnApplier(EXCEL_EDGE_PROPERTIES, 'Description');
const applyEdgeEndArrow = columnApplier(EXCEL_EDGE_PROPERTIES, 'End Arrow');

const formatCount = (n) => n.toLocaleString('en');

const isBlank = (value) => value === null || value === undefined || String(value).trim() === '';

/** A file value as a coordinate, or NaN when it is missing, not a number or out of range. */
function toCoordinate(value) {
  if (isBlank(value) || typeof value === 'boolean') return NaN;
  const n = Number(value);
  return Math.abs(n) <= MAX_COORDINATE ? n : NaN;
}

function checkImportSize(length) {
  if (length > MAX_IMPORT_BYTES) {
    throw new Error(
      `The file is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB, the most Graph Lens Lite opens.`
    );
  }
}

function checkElementCount(count) {
  if (count > MAX_IMPORT_ELEMENTS) {
    throw new Error(
      `The file holds more than ${formatCount(MAX_IMPORT_ELEMENTS)} nodes and edges, ` +
        'the most Graph Lens Lite opens.'
    );
  }
}

function checkAttributeValues(count) {
  if (count > MAX_ATTRIBUTE_VALUES) {
    throw new Error(
      `The file holds more than ${formatCount(MAX_ATTRIBUTE_VALUES)} attribute values, ` +
        'the most Graph Lens Lite opens.'
    );
  }
}

/** @param {string} domain "node" or "edge" */
function checkDeclaredAttributes(count, domain) {
  if (count > MAX_DECLARED_ATTRIBUTES) {
    throw new Error(
      `The file declares ${formatCount(count)} ${domain} attributes; ` +
        `Graph Lens Lite reads at most ${formatCount(MAX_DECLARED_ATTRIBUTES)}.`
    );
  }
}

/**
 * Convert a file value to the kind its attribute declares. `kind` is
 * 'number' | 'boolean' | 'string' | 'list'; null means undeclared (keep as is).
 * @returns {{ok: boolean, value: *}} ok=false: the value did not fit its kind
 *   and comes back as text
 */
function coerceValue(value, kind) {
  if (kind === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) return { ok: true, value };
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
    return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, value: String(value) };
  }
  if (kind === 'boolean') {
    if (typeof value === 'boolean') return { ok: true, value };
    const text = String(value).trim().toLowerCase();
    if (text === 'true' || text === '1') return { ok: true, value: true };
    if (text === 'false' || text === '0') return { ok: true, value: false };
    return { ok: false, value: String(value) };
  }
  if (kind === 'list') {
    if (!Array.isArray(value)) return { ok: false, value: String(value) };
    return { ok: true, value: value.filter((v) => !isBlank(v)).map(String).join(LIST_SEPARATOR) };
  }
  if (kind === 'string') return { ok: true, value: String(value) };
  if (Array.isArray(value)) return coerceValue(value, 'list');
  if (value !== null && typeof value === 'object') return { ok: false, value: JSON.stringify(value) };
  return { ok: true, value };
}

/** Collects one imported graph; `result()` returns the preProcessData input. */
class GraphImport {
  constructor() {
    this.nodes = [];
    this.edges = [];
    this.nodeIDs = new Set();
    this.edgeIDs = new Set();
    /** `source::target` → the last suffix handed out for it. */
    this.edgeSuffixes = new Map();
    this.nodeHeaders = new Map();
    this.edgeHeaders = new Map();
    this.counts = new Map();
    this.renamed = new Set();
    this.valueCount = 0;
  }

  /** Count one occurrence of something the import could not carry over. */
  note(what, by = 1) {
    this.counts.set(what, (this.counts.get(what) ?? 0) + by);
  }

  /**
   * @param {*} rawId
   * @param {{label?: *, description?: *, x?: number, y?: number}} fields
   * @param {Iterable<[string, *]>} props attribute name → value
   * @param {string} where position of the element in the file, for errors
   */
  addNode(rawId, fields, props, where) {
    if (isBlank(rawId)) throw new Error(`${where} has no id.`);
    const id = String(rawId);
    // Node ids become object keys (saved positions, styles).
    if (UNSAFE_OBJECT_KEYS.has(id)) throw new Error(`${where} has the reserved id "${id}".`);
    if (this.nodeIDs.has(id)) throw new Error(`Node id "${id}" appears more than once.`);
    this.nodeIDs.add(id);

    const node = { id, style: {}, D4Data: { [CFG.EXCEL_NODE_HEADER]: {} } };
    if (!isBlank(fields.label)) applyNodeLabel(node, String(fields.label));
    if (!isBlank(fields.description)) applyNodeDescription(node, String(fields.description));
    if (fields.x !== undefined || fields.y !== undefined) {
      const x = toCoordinate(fields.x);
      const y = toCoordinate(fields.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        applyNodeX(node, x);
        applyNodeY(node, y);
      } else {
        this.note('coordinate');
      }
    }
    this.#addProps(node.D4Data[CFG.EXCEL_NODE_HEADER], props, this.nodeHeaders);
    this.nodes.push(node);
  }

  /**
   * Edge ids follow the Excel importer (`source::target`); a parallel edge
   * gets a numbered suffix so it is drawn instead of overwriting its sibling.
   */
  addEdge(rawSource, rawTarget, fields, props, where) {
    if (isBlank(rawSource) || isBlank(rawTarget)) {
      throw new Error(`${where} is missing its source or target.`);
    }
    const source = String(rawSource);
    const target = String(rawTarget);
    for (const end of [source, target]) {
      if (!this.nodeIDs.has(end)) throw new Error(`${where} points to node "${end}", which is not in the file.`);
    }
    const id = this.#uniqueEdgeId(`${source}${PROP_ID_SEPARATOR}${target}`);

    const edge = { id, source, target, style: {}, D4Data: { [CFG.EXCEL_EDGE_HEADER]: {} } };
    if (!isBlank(fields.label)) applyEdgeLabel(edge, String(fields.label));
    if (!isBlank(fields.description)) applyEdgeDescription(edge, String(fields.description));
    if (fields.directed) applyEdgeEndArrow(edge, true);
    this.#addProps(edge.D4Data[CFG.EXCEL_EDGE_HEADER], props, this.edgeHeaders);
    this.edges.push(edge);
  }

  /**
   * Resumes from the last suffix of this base, so N parallel edges cost N
   * steps rather than N²/2; the loop only probes on a rare cross-collision
   * (node "a" with "b::2" against node "a::b" with "2").
   */
  #uniqueEdgeId(base) {
    let n = this.edgeSuffixes.get(base) ?? 1;
    let id = n === 1 ? base : `${base}${PROP_ID_SEPARATOR}${n}`;
    while (this.edgeIDs.has(id)) id = `${base}${PROP_ID_SEPARATOR}${++n}`;
    this.edgeSuffixes.set(base, n);
    this.edgeIDs.add(id);
    return id;
  }

  #addProps(target, props, headers) {
    for (const [rawName, value] of props) {
      if (isBlank(value)) continue;
      let name = rawName;
      if (name.includes(PROP_ID_SEPARATOR)) {
        this.renamed.add(name);
        name = name.replaceAll(PROP_ID_SEPARATOR, ':');
      }
      // Brackets name the property group, as in the Excel template; anything
      // unbracketed lands in the catch-all group, as an Excel header would.
      const decoded = decodeKey(name, CFG.EXCEL_UNCATEGORIZED_SUBHEADER);
      if (!decoded || decoded.key === '') {
        this.note('refused');
        continue;
      }
      checkAttributeValues(++this.valueCount);
      const { subGroup, key } = decoded;
      target[subGroup] ??= {};
      target[subGroup][key] = value;
      headers.set(`${subGroup}${PROP_ID_SEPARATOR}${key}`, { subGroup, key });
    }
  }

  /** Plain-language lines for what the import changed or left out. */
  notices() {
    const lines = [];
    if (this.renamed.size > 0) {
      const names = [...this.renamed].map((name) => `"${name}"`).join(', ');
      lines.push(`"::" is reserved in property names and was replaced by ":" in ${names}.`);
    }
    if (this.counts.has('refused')) {
      lines.push(`${this.counts.get('refused')} values with a reserved or empty property name were not loaded.`);
    }
    if (this.counts.has('coordinate')) {
      lines.push(
        `${this.counts.get('coordinate')} nodes have an incomplete, non-numeric or out-of-range ` +
          'position and were placed by the layout instead.'
      );
    }
    if (this.counts.has('mismatch')) {
      lines.push(
        `${this.counts.get('mismatch')} values did not match their declared type and were loaded as text.`
      );
    }
    return lines;
  }

  result() {
    if (this.nodes.length === 0) throw new Error('The file contains no nodes.');
    return {
      nodes: this.nodes,
      edges: this.edges,
      nodeDataHeaders: [...this.nodeHeaders.values()],
      edgeDataHeaders: [...this.edgeHeaders.values()],
    };
  }
}

// ----------------------------------------------------------------- export

/**
 * A value that survives a trip through Number unchanged. Text such as "007",
 * "0x1F", "1e3" or a 20-digit id slides as a number in GLL but would be
 * rewritten by the conversion, so it is exported as text.
 */
function isCanonicalNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;
  const n = Number(value);
  return Number.isFinite(n) && String(n) === value.trim();
}

/** Column type of a set of GLL values: 'boolean' | 'long' | 'double' | 'string'. */
function inferColumnType(values) {
  if (values.length === 0) return 'string';
  const isBool = (v) => typeof v === 'boolean' || /^(true|false)$/i.test(String(v).trim());
  if (values.every(isBool)) return 'boolean';
  if (!values.every(isCanonicalNumber)) return 'string';
  return values.every((v) => Number.isInteger(Number(v))) ? 'long' : 'double';
}

function typedValue(value, type) {
  if (type === 'boolean') return typeof value === 'boolean' ? value : /^true$/i.test(String(value).trim());
  if (type === 'long' || type === 'double') return Number(value);
  return String(value);
}

/**
 * Attribute names for GLL columns: the bare key when its group is the
 * catch-all one and the name is free, else
 * `key [group]` — which the importers decode back into the same group.
 */
function nameColumns(columns, reserved, plainGroups) {
  const used = new Set(reserved);
  return columns.map(({ subGroup, key }) => {
    const plain = plainGroups.has(subGroup) && !key.includes('[') ? key : null;
    const name = plain && !used.has(plain) ? plain : `${key} [${subGroup}]`;
    used.add(name);
    return { subGroup, key, name };
  });
}

function typedColumns(elements, section, columns) {
  return columns.map((column) => {
    const values = elements
      .map((el) => el.D4Data?.[section]?.[column.subGroup]?.[column.key])
      .filter((v) => !isBlank(v));
    return { ...column, type: inferColumnType(values) };
  });
}

function columnValues(element, section, columns) {
  const values = [];
  for (const column of columns) {
    const raw = element.D4Data?.[section]?.[column.subGroup]?.[column.key];
    if (!isBlank(raw)) values.push([column, typedValue(raw, column.type)]);
  }
  return values;
}

/**
 * GLL draws direction as arrows. One arrow is a direction (a start arrow alone
 * points target → source, so the ends are swapped); both or none are not.
 */
function edgeDirection(edge) {
  const end = edge.style?.endArrow === true;
  const start = edge.style?.startArrow === true;
  const reversed = start && !end;
  return {
    source: String(reversed ? edge.target : edge.source),
    target: String(reversed ? edge.source : edge.target),
    directed: start !== end,
  };
}

function nodePosition(node, positions) {
  const style = positions?.get(node.id)?.style ?? node.style;
  return Number.isFinite(style?.x) && Number.isFinite(style?.y) ? { x: style.x, y: style.y } : null;
}

/**
 * The loaded graph as typed columns, ready for a writer.
 *
 * @param {object} source
 * @param {object[]} source.nodes GLL nodes (`cache.data.nodes` or importer output)
 * @param {object[]} source.edges GLL edges
 * @param {{subGroup: string, key: string}[]} source.nodeColumns
 * @param {{subGroup: string, key: string}[]} source.edgeColumns
 * @param {Map} [source.positions] the workspace's `positions` (id → {style:{x,y}})
 * @param {{node: string[], edge: string[]}} reserved names the writer uses itself
 */
function interchangeGraph(source, reserved) {
  const plainGroups = new Set([CFG.EXCEL_UNCATEGORIZED_SUBHEADER]);
  const nodeSection = CFG.EXCEL_NODE_HEADER;
  const edgeSection = CFG.EXCEL_EDGE_HEADER;
  const nodeColumns = typedColumns(
    source.nodes,
    nodeSection,
    nameColumns(source.nodeColumns ?? [], reserved.node, plainGroups)
  );
  const edgeColumns = typedColumns(
    source.edges,
    edgeSection,
    nameColumns(source.edgeColumns ?? [], reserved.edge, plainGroups)
  );
  return {
    nodeColumns,
    edgeColumns,
    nodes: source.nodes.map((node) => ({
      id: String(node.id),
      label: node.label,
      description: node.description,
      position: nodePosition(node, source.positions),
      values: columnValues(node, nodeSection, nodeColumns),
    })),
    edges: source.edges.map((edge) => ({
      ...edgeDirection(edge),
      label: edge.label,
      description: edge.description,
      values: columnValues(edge, edgeSection, edgeColumns),
    })),
  };
}

/** What an export carried, for the message after it. */
function exportSummary(graph) {
  return {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    unplaced: graph.nodes.filter((node) => !node.position).length,
    directed: graph.edges.filter((edge) => edge.directed).length,
  };
}

export {
  GraphImport,
  exportSummary,
  coerceValue,
  checkImportSize,
  checkElementCount,
  checkDeclaredAttributes,
  checkAttributeValues,
  interchangeGraph,
  isBlank,
  toCoordinate,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ELEMENTS,
  MAX_DECLARED_ATTRIBUTES,
  MAX_ATTRIBUTE_VALUES,
};
