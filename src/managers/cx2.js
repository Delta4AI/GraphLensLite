/**
 * CX2 import and export — the JSON exchange format of Cytoscape and NDEx.
 * Spec: https://cytoscape.org/cx/cx2/specification/cytoscape-exchange-format-specification-(version-2)/
 *
 * A CX2 document is a JSON array: a `{CXVersion, hasFragments}` descriptor,
 * then one-key objects ("aspects") each holding an array, and a closing
 * `status`. Import reads `attributeDeclarations` (types `d`, aliases `a`,
 * defaults `v`), `nodes` (`id`, `v`, `x`, `y`) and `edges` (`id`, `s`, `t`,
 * `v`); visual styles and other aspects are reported, not loaded. Fragmented
 * documents work because repeated aspects are concatenated.
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
} from './interchange.js';

const FORMAT_NAME = 'CX2';
const CX_VERSION = '2.0';
/** Node attribute carrying the GLL node id, since CX2 node ids must be integers. */
const GLL_ID_ATTRIBUTE = 'GLL ID';
const READ_ASPECTS = new Set(['metaData', 'attributeDeclarations', 'nodes', 'edges', 'status']);
const NODE_BUILTINS = ['name', 'represents', 'alias', 'description', GLL_ID_ATTRIBUTE];
const EDGE_BUILTINS = ['label', 'description'];

/** CX2 data type (`d`) → coerceValue kind. */
function kindOf(dataType) {
  if (dataType === 'boolean') return 'boolean';
  if (dataType === 'integer' || dataType === 'long' || dataType === 'double') return 'number';
  if (typeof dataType === 'string' && dataType.startsWith('list_of_')) return 'list';
  return 'string';
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function parseDocument(text) {
  checkImportSize(text.length);
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new Error(`The file is not valid JSON (${err.message}).`);
  }
  if (!Array.isArray(doc)) {
    throw new Error('This is not a CX2 file: a CX2 document is a JSON list of aspects.');
  }
  return doc;
}

/** Aspect name → all its elements, repeated aspects concatenated; checks the CX version. */
function collectAspects(doc) {
  let version = null;
  const aspects = new Map();
  for (const entry of doc) {
    if (!isPlainObject(entry)) throw new Error('This is not a CX2 file: every aspect must be a JSON object.');
    if ('CXVersion' in entry) {
      version = String(entry.CXVersion);
      continue;
    }
    if ('numberVerification' in entry) {
      throw new Error(
        'This is a CX version 1 file. Graph Lens Lite reads CX2 — export the network as CX2 ' +
          'from Cytoscape or download the CX2 version from NDEx.'
      );
    }
    for (const [name, elements] of Object.entries(entry)) {
      if (!Array.isArray(elements)) throw new Error(`The "${name}" aspect is not a list.`);
      // concat, not push(...): spreading a 200k-node aspect overflows the call stack.
      aspects.set(name, (aspects.get(name) ?? []).concat(elements));
    }
  }
  if (version === null) throw new Error('This is not a CX2 file: the CXVersion descriptor is missing.');
  if (!version.startsWith('2.')) throw new Error(`CX version ${version} is not supported; Graph Lens Lite reads CX2.`);
  return aspects;
}

/** Per-domain declarations: name → {kind, default}, and alias → name. */
function readDeclarations(aspects, domain, importer) {
  const byName = new Map();
  const alias = new Map();
  for (const declaration of aspects.get('attributeDeclarations') ?? []) {
    const entries = isPlainObject(declaration?.[domain]) ? Object.entries(declaration[domain]) : [];
    for (const [name, spec] of entries) {
      if (!isPlainObject(spec)) continue;
      const kind = kindOf(spec.d);
      byName.set(name, { kind, default: isBlank(spec.v) ? undefined : coerced(spec.v, kind, importer) });
      if (typeof spec.a === 'string') alias.set(spec.a, name);
    }
  }
  checkDeclaredAttributes(byName.size, domain === 'nodes' ? 'node' : 'edge');
  return { byName, alias };
}

function coerced(raw, kind, importer) {
  const { ok, value } = coerceValue(raw, kind);
  if (!ok) importer.note('mismatch');
  return value;
}

/** One element's attributes by full name, declared defaults first. */
function readValues(v, declarations, importer) {
  const values = new Map();
  for (const [name, spec] of declarations.byName) {
    if (spec.default !== undefined) values.set(name, spec.default);
  }
  if (!isPlainObject(v)) return values;
  for (const [key, raw] of Object.entries(v)) {
    const name = declarations.alias.get(key) ?? key;
    if (isBlank(raw)) values.delete(name);
    else values.set(name, coerced(raw, declarations.byName.get(name)?.kind ?? null, importer));
  }
  return values;
}

function take(values, name) {
  const value = values.get(name);
  values.delete(name);
  return value;
}

/** Every default lands on every element; refuse before multiplying them out. */
function checkDefaults(declarations, elementCount) {
  const defaults = [...declarations.byName.values()].filter((spec) => spec.default !== undefined);
  checkAttributeValues(defaults.length * elementCount);
}

/** @returns {Map<string, string>} CX2 node id → GLL node id */
function readNodes(nodes, declarations, importer) {
  checkDefaults(declarations, nodes.length);
  const ids = new Map();
  nodes.forEach((node, index) => {
    const where = `Node ${index + 1}`;
    if (!isPlainObject(node) || isBlank(node.id)) throw new Error(`${where} has no id.`);
    const cxId = String(node.id);
    if (ids.has(cxId)) throw new Error(`Node id ${cxId} appears more than once.`);
    const values = readValues(node.v, declarations, importer);
    const gllId = take(values, GLL_ID_ATTRIBUTE);
    const id = isBlank(gllId) ? cxId : String(gllId);
    const name = take(values, 'name');
    const fields = {
      // A name that only repeats the id is the exporter's stand-in for "no label".
      label: isBlank(name) || String(name) === id ? undefined : name,
      description: take(values, 'description'),
      x: node.x,
      y: node.y,
    };
    importer.addNode(id, fields, values, where);
    ids.set(cxId, id);
  });
  return ids;
}

function readEdges(edges, declarations, nodeIds, importer) {
  checkDefaults(declarations, edges.length);
  edges.forEach((edge, index) => {
    const where = `Edge ${index + 1}`;
    if (!isPlainObject(edge) || isBlank(edge.s) || isBlank(edge.t)) {
      throw new Error(`${where} is missing its source or target.`);
    }
    for (const end of [edge.s, edge.t]) {
      if (!nodeIds.has(String(end))) throw new Error(`${where} points to node ${end}, which is not in the file.`);
    }
    const values = readValues(edge.v, declarations, importer);
    const fields = { label: take(values, 'label'), description: take(values, 'description') };
    importer.addEdge(nodeIds.get(String(edge.s)), nodeIds.get(String(edge.t)), fields, values, where);
  });
}

function checkStatus(aspects) {
  const status = aspects.get('status')?.[0];
  if (status?.success === false) {
    const reason = isBlank(status.error) ? '' : `: ${String(status.error)}`;
    throw new Error(`The file reports that it was not written successfully${reason}.`);
  }
}

/**
 * @param {string} text CX2 document
 * @returns {{fileData: object, notices: string[]}} fileData for preProcessData
 * @throws {Error} with a plain-language message when the file cannot be used
 */
function parseCX2(text) {
  const aspects = collectAspects(parseDocument(text));
  checkStatus(aspects);
  const nodes = aspects.get('nodes') ?? [];
  const edges = aspects.get('edges') ?? [];
  checkElementCount(nodes.length + edges.length);
  const importer = new GraphImport(FORMAT_NAME);
  const nodeIds = readNodes(nodes, readDeclarations(aspects, 'nodes', importer), importer);
  readEdges(edges, readDeclarations(aspects, 'edges', importer), nodeIds, importer);

  const fileData = importer.result();
  const notices = importer.notices();
  const ignored = [...aspects.keys()].filter((name) => !READ_ASPECTS.has(name));
  if (ignored.length > 0) {
    notices.push(
      `Not loaded from this CX2 file: ${ignored.join(', ')}. ` +
        'Graph Lens Lite reads nodes, edges and their attributes and applies its own styling.'
    );
  }
  return { fileData, notices };
}

// ----------------------------------------------------------------- export

function declarations(builtins, columns) {
  const declared = {};
  for (const [name, d] of builtins) declared[name] = { d };
  for (const column of columns) declared[column.name] = { d: column.type };
  return declared;
}

function attributeMap(element, builtins) {
  const v = {};
  for (const [name, value] of builtins) if (!isBlank(value)) v[name] = value;
  for (const [column, value] of element.values) v[column.name] = value;
  return v;
}

function cxNodes(graph) {
  const withCoordinates = graph.nodes.every((node) => node.position);
  return graph.nodes.map((node, index) => {
    const builtins = [
      ['name', isBlank(node.label) ? node.id : String(node.label)],
      [GLL_ID_ATTRIBUTE, node.id],
      ['description', node.description],
    ];
    const cxNode = { id: index, v: attributeMap(node, builtins) };
    if (withCoordinates) Object.assign(cxNode, { x: node.position.x, y: node.position.y });
    return cxNode;
  });
}

function cxEdges(graph) {
  const nodeIndex = new Map(graph.nodes.map((node, index) => [node.id, index]));
  return graph.edges.map((edge, index) => ({
    id: index,
    s: nodeIndex.get(edge.source),
    t: nodeIndex.get(edge.target),
    v: attributeMap(edge, [
      ['label', edge.label],
      ['description', edge.description],
    ]),
  }));
}

function cxDeclarations(graph, network) {
  const has = (elements, field) => elements.some((el) => !isBlank(el[field]));
  const nodeBuiltins = [
    ['name', 'string'],
    [GLL_ID_ATTRIBUTE, 'string'],
  ];
  if (has(graph.nodes, 'description')) nodeBuiltins.push(['description', 'string']);
  const edgeBuiltins = ['label', 'description']
    .filter((field) => has(graph.edges, field))
    .map((field) => [field, 'string']);
  return {
    ...(network ? { networkAttributes: { name: { d: 'string' } } } : {}),
    nodes: declarations(nodeBuiltins, graph.nodeColumns),
    edges: declarations(edgeBuiltins, graph.edgeColumns),
  };
}

/**
 * Serialize the loaded graph as a CX2 document. Node ids become 0..n-1 (CX2
 * ids are integers) with the GLL id kept in the "GLL ID" attribute. CX2
 * requires coordinates on every node or none, so they are written only when
 * every node has one.
 *
 * @param {object} source see interchangeGraph
 * @param {string} [networkName]
 * @returns {{text: string, withCoordinates: boolean}}
 */
function toCX2(source, networkName) {
  const graph = interchangeGraph(source, { node: NODE_BUILTINS, edge: EDGE_BUILTINS });
  const network = isBlank(networkName) ? null : { name: String(networkName) };
  const nodes = cxNodes(graph);
  const edges = cxEdges(graph);
  const doc = [
    { CXVersion: CX_VERSION, hasFragments: false },
    {
      metaData: [
        { name: 'attributeDeclarations', elementCount: 1 },
        ...(network ? [{ name: 'networkAttributes', elementCount: 1 }] : []),
        { name: 'nodes', elementCount: nodes.length },
        { name: 'edges', elementCount: edges.length },
      ],
    },
    { attributeDeclarations: [cxDeclarations(graph, network)] },
    ...(network ? [{ networkAttributes: [network] }] : []),
    { nodes },
    { edges },
    { status: [{ error: '', success: true }] },
  ];
  return { text: JSON.stringify(doc), withCoordinates: nodes.every((node) => 'x' in node) };
}

export { parseCX2, toCX2, GLL_ID_ATTRIBUTE };
