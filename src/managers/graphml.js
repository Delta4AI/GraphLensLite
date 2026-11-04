/**
 * GraphML import and export — the XML format Cytoscape, Gephi, yEd, NetworkX
 * and igraph all read and write.
 * Spec: http://graphml.graphdrawing.org/specification.html
 *
 * Import keeps nodes, edges and their typed `<key>` attributes, node labels
 * (`label`, else `name`, else a yEd node label), positions (`x`/`y` keys or
 * yEd geometry) and edge direction. Nested graphs, hyperedges and ports have
 * no GLL counterpart and are reported, not loaded.
 */
import {
  GraphImport,
  coerceValue,
  checkImportSize,
  checkElementCount,
  checkDeclaredAttributes,
  checkAttributeValues,
  interchangeGraph,
  isBlank,
  MAX_IMPORT_ELEMENTS,
} from './interchange.js';

const FORMAT_NAME = 'GraphML';
const GRAPHML_NS = 'http://graphml.graphdrawing.org/xmlns';
const GRAPHML_XSD = 'http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd';
// Entity declarations are how "billion laughs" files expand to gigabytes;
// GraphML never needs them, so any DTD is refused before parsing. A DTD can
// only stand in the prolog, before the root element, so only that is searched
// (a "<!DOCTYPE" inside a CDATA value or comment further down is just text).
const DTD_PATTERN = /<!(DOCTYPE|ENTITY)/i;
const ROOT_START = /<([\w.-]+:)?graphml[\s>/]/;
// Counted on the raw text so an oversized file is refused before the DOM is built.
const ELEMENT_START = /<([\w.-]+:)?(node|edge)[\s>/]/g;
const MAX_MESSAGE_CHARS = 200;
const MAX_NAME_CHARS = 40;
const KEY_KINDS = { boolean: 'boolean', int: 'number', long: 'number', float: 'number', double: 'number', string: 'string' };
const NODE_BUILTINS = ['label', 'description', 'x', 'y'];
const EDGE_BUILTINS = ['label', 'description'];

const childElements = (el, name) => [...el.children].filter((child) => child.localName === name);

/** Matches of a global `pattern`, counting stops just past `limit`. */
function countUpTo(text, pattern, limit) {
  let count = 0;
  pattern.lastIndex = 0;
  while (count <= limit && pattern.exec(text)) count++;
  return count;
}

function parseRoot(text) {
  checkImportSize(text.length);
  const rootAt = text.search(ROOT_START);
  if (DTD_PATTERN.test(rootAt === -1 ? text : text.slice(0, rootAt))) {
    throw new Error(
      'The file declares a DTD or entities (<!DOCTYPE …>), which Graph Lens Lite does not load ' +
        'for safety. Remove that declaration and open the file again.'
    );
  }
  checkElementCount(countUpTo(text, ELEMENT_START, MAX_IMPORT_ELEMENTS));
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const parserError = doc.getElementsByTagName('parsererror')[0];
  if (parserError) {
    const detail = parserError.textContent.trim().slice(0, MAX_MESSAGE_CHARS);
    throw new Error(`The file is not well-formed XML (${detail}).`);
  }
  const root = doc.documentElement;
  if (root.localName !== 'graphml') {
    const name = root.localName.slice(0, MAX_NAME_CHARS);
    throw new Error(`This is not a GraphML file: it starts with <${name}> instead of <graphml>.`);
  }
  return root;
}

/** `<key>` declarations by id. A yEd graphics key has no attr.name. */
function readKeys(root) {
  const keys = new Map();
  for (const key of childElements(root, 'key')) {
    const id = key.getAttribute('id');
    if (!id) continue;
    const yfiles = key.getAttribute('yfiles.type');
    const type = (key.getAttribute('attr.type') ?? 'string').toLowerCase();
    const defaultEl = childElements(key, 'default')[0];
    keys.set(id, {
      domain: key.getAttribute('for') ?? 'all',
      name: key.getAttribute('attr.name') ?? (yfiles ? null : id),
      kind: KEY_KINDS[type] ?? 'string',
      yfiles,
      default: defaultEl ? defaultEl.textContent : null,
    });
  }
  for (const domain of ['node', 'edge']) {
    const declared = [...keys.values()].filter((key) => key.domain === domain || key.domain === 'all');
    checkDeclaredAttributes(declared.length, domain);
  }
  return keys;
}

function typed(text, kind, importer) {
  if (kind === 'string') return text;
  const { ok, value } = coerceValue(text, kind);
  if (!ok) importer.note('mismatch');
  return value;
}

/** Attribute values of one node or edge (key defaults first), plus its yEd graphics. */
function readData(el, keys, defaults, importer) {
  const values = new Map(defaults);
  let graphics = null;
  for (const data of childElements(el, 'data')) {
    const key = keys.get(data.getAttribute('key'));
    if (!key) {
      importer.note('undeclared');
      continue;
    }
    if (key.yfiles) graphics = data;
    else if (key.name && !isBlank(data.textContent)) values.set(key.name, typed(data.textContent, key.kind, importer));
  }
  return { values, graphics };
}

function domainDefaults(keys, domain, importer) {
  const defaults = new Map();
  for (const key of keys.values()) {
    if (key.name && !isBlank(key.default) && (key.domain === domain || key.domain === 'all')) {
      defaults.set(key.name, typed(key.default, key.kind, importer));
    }
  }
  return defaults;
}

/** Label and centre point from yEd's <y:NodeLabel> and <y:Geometry> (top-left + size). */
function yedGraphics(graphics) {
  if (!graphics) return {};
  const label = graphics.getElementsByTagNameNS('*', 'NodeLabel')[0]?.textContent.trim();
  const geometry = graphics.getElementsByTagNameNS('*', 'Geometry')[0];
  if (!geometry) return { label };
  const num = (name) => Number.parseFloat(geometry.getAttribute(name) ?? '0');
  return { label, x: num('x') + num('width') / 2, y: num('y') + num('height') / 2 };
}

/** Remove and return the first present of `names` from `values`. */
function take(values, ...names) {
  for (const name of names) {
    if (values.has(name)) {
      const value = values.get(name);
      values.delete(name);
      return value;
    }
  }
  return undefined;
}

function nodeFields(values, graphics) {
  const yed = yedGraphics(graphics);
  const label = take(values, 'label', 'name') ?? yed.label;
  const description = take(values, 'description');
  let x = yed.x;
  let y = yed.y;
  if (typeof values.get('x') === 'number' && typeof values.get('y') === 'number') {
    x = take(values, 'x');
    y = take(values, 'y');
  }
  return { label, description, x, y };
}

function readNodes(graph, keys, importer) {
  const defaults = domainDefaults(keys, 'node', importer);
  const nodes = childElements(graph, 'node');
  // Every default lands on every element; refuse before multiplying them out.
  checkAttributeValues(defaults.size * nodes.length);
  nodes.forEach((node, index) => {
    if (childElements(node, 'graph').length > 0) importer.note('nested');
    importer.note('port', childElements(node, 'port').length);
    const { values, graphics } = readData(node, keys, defaults, importer);
    importer.addNode(node.getAttribute('id'), nodeFields(values, graphics), values, `Node ${index + 1}`);
  });
}

function readEdges(graph, keys, importer) {
  const defaults = domainDefaults(keys, 'edge', importer);
  // edgedefault is required by the schema, with "directed" as its default.
  const directedByDefault = graph.getAttribute('edgedefault') !== 'undirected';
  const edges = childElements(graph, 'edge');
  checkAttributeValues(defaults.size * edges.length);
  edges.forEach((edge, index) => {
    const { values } = readData(edge, keys, defaults, importer);
    const directedAttr = edge.getAttribute('directed');
    const fields = {
      label: take(values, 'label'),
      description: take(values, 'description'),
      directed: directedAttr === null ? directedByDefault : directedAttr === 'true',
    };
    const where = `Edge ${index + 1}`;
    importer.addEdge(edge.getAttribute('source'), edge.getAttribute('target'), fields, values, where);
  });
  importer.note('hyperedge', childElements(graph, 'hyperedge').length);
}

const SKIPPED_PARTS = {
  graphs: 'additional graphs',
  nested: 'nested graphs inside nodes',
  hyperedge: 'hyperedges',
  port: 'ports',
  undeclared: 'values that refer to an undeclared <key>',
};

function notices(importer) {
  const skipped = Object.entries(SKIPPED_PARTS)
    .filter(([what]) => importer.counts.get(what) > 0)
    .map(([what, label]) => `${importer.counts.get(what)} ${label}`);
  const lines = importer.notices();
  if (skipped.length > 0) lines.push(`Not loaded from this GraphML file: ${skipped.join(', ')}.`);
  return lines;
}

/**
 * @param {string} text GraphML document
 * @returns {{fileData: object, notices: string[]}} fileData for preProcessData
 * @throws {Error} with a plain-language message when the file cannot be used
 */
function parseGraphML(text) {
  const root = parseRoot(text);
  const keys = readKeys(root);
  const graphs = childElements(root, 'graph');
  if (graphs.length === 0) throw new Error('The GraphML file contains no <graph> element.');
  const importer = new GraphImport(FORMAT_NAME);
  importer.note('graphs', graphs.length - 1);
  const graph = graphs[0];
  readNodes(graph, keys, importer);
  readEdges(graph, keys, importer);
  return { fileData: importer.result(), notices: notices(importer) };
}

// ----------------------------------------------------------------- export

// XML 1.0 cannot carry control characters or lone surrogates at all.
const INVALID_XML_CHARS = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu;
const XML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
  '\n': '&#10;',
  '\r': '&#13;',
  '\t': '&#9;',
};
const xml = (value) =>
  String(value)
    .replace(INVALID_XML_CHARS, '')
    .replace(/[&<>"'\n\r\t]/g, (c) => XML_ESCAPES[c]);

/** One key per written attribute: built-ins that occur, then the data columns. */
function declareKeys(prefix, builtins, columns, elements) {
  const keys = builtins
    .filter(({ get }) => elements.some((el) => !isBlank(get(el))))
    .map((builtin) => ({ ...builtin }));
  for (const column of columns) keys.push({ name: column.name, type: column.type, column });
  keys.forEach((key, index) => (key.id = `${prefix}${index}`));
  return keys;
}

function dataLines(element, keys) {
  const lines = [];
  for (const key of keys) {
    const value = key.column ? element.values.find(([c]) => c === key.column)?.[1] : key.get(element);
    if (!isBlank(value)) lines.push(`      <data key="${key.id}">${xml(value)}</data>`);
  }
  return lines;
}

function keyLine(key, domain) {
  return `  <key id="${key.id}" for="${domain}" attr.name="${xml(key.name)}" attr.type="${key.type}"/>`;
}

function elementLines(tag, attributes, element, keys) {
  const data = dataLines(element, keys);
  const open = `    <${tag} ${attributes}`;
  return data.length === 0 ? [`${open}/>`] : [`${open}>`, ...data, `    </${tag}>`];
}

/**
 * Serialize the loaded graph as GraphML. The graph is "directed" when every
 * edge shows an end arrow; other edges in a mixed graph say so one by one.
 *
 * @param {object} source see interchangeGraph
 * @returns {string}
 */
function toGraphML(source) {
  const graph = interchangeGraph(source, { node: NODE_BUILTINS, edge: EDGE_BUILTINS });
  const nodeKeys = declareKeys(
    'n',
    [
      { name: 'label', type: 'string', get: (n) => n.label },
      { name: 'description', type: 'string', get: (n) => n.description },
      { name: 'x', type: 'double', get: (n) => n.position?.x },
      { name: 'y', type: 'double', get: (n) => n.position?.y },
    ],
    graph.nodeColumns,
    graph.nodes
  );
  const edgeKeys = declareKeys(
    'e',
    [
      { name: 'label', type: 'string', get: (e) => e.label },
      { name: 'description', type: 'string', get: (e) => e.description },
    ],
    graph.edgeColumns,
    graph.edges
  );
  const directed = graph.edges.length > 0 && graph.edges.every((e) => e.directed);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<graphml xmlns="${GRAPHML_NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
      `xsi:schemaLocation="${GRAPHML_NS} ${GRAPHML_XSD}">`,
    ...nodeKeys.map((key) => keyLine(key, 'node')),
    ...edgeKeys.map((key) => keyLine(key, 'edge')),
    `  <graph id="G" edgedefault="${directed ? 'directed' : 'undirected'}">`,
  ];
  for (const node of graph.nodes) lines.push(...elementLines('node', `id="${xml(node.id)}"`, node, nodeKeys));
  for (const edge of graph.edges) {
    const own = edge.directed === directed ? '' : ` directed="${edge.directed}"`;
    const attributes = `source="${xml(edge.source)}" target="${xml(edge.target)}"${own}`;
    lines.push(...elementLines('edge', attributes, edge, edgeKeys));
  }
  lines.push('  </graph>', '</graphml>', '');
  return lines.join('\n');
}

export { parseGraphML, toGraphML };
