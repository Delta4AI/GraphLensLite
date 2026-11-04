import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseCX2, toCX2, GLL_ID_ATTRIBUTE } from '../src/managers/cx2.js';
import { normalizeD4DataBooleans } from '../src/managers/io.js';
import { CFG } from '../src/config.js';

const NODE = CFG.EXCEL_NODE_HEADER;
const EDGE = CFG.EXCEL_EDGE_HEADER;
const fixture = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'ndex-style.cx2'), 'utf8');

function sampleGraph() {
  return {
    nodes: [
      { id: 'A', label: 'Alpha', description: 'first', style: {}, D4Data: { [NODE]: { omics: { score: 1.5, count: 3, hit: 'true' } } } },
      { id: 'B', style: {}, D4Data: { [NODE]: { omics: { score: -2, count: 7, hit: 'false' } } } },
    ],
    edges: [
      { id: 'A::B', source: 'A', target: 'B', label: 'binds', style: {}, D4Data: { [EDGE]: { evidence: { weight: 0.5 } } } },
      { id: 'A::B::2', source: 'A', target: 'B', style: {}, D4Data: { [EDGE]: { evidence: { weight: 0.25 } } } },
      { id: 'B::B', source: 'B', target: 'B', style: {}, D4Data: { [EDGE]: {} } },
    ],
    nodeColumns: [
      { subGroup: 'omics', key: 'score' },
      { subGroup: 'omics', key: 'count' },
      { subGroup: 'omics', key: 'hit' },
    ],
    edgeColumns: [{ subGroup: 'evidence', key: 'weight' }],
    positions: new Map([
      ['A', { style: { x: 0, y: 5 } }],
      ['B', { style: { x: -30.5, y: 12 } }],
    ]),
  };
}

describe('CX2 export', () => {
  it('writes a CX2 document with declarations, integer ids and coordinates', () => {
    const { text, withCoordinates } = toCX2(sampleGraph(), 'demo');
    const doc = JSON.parse(text);
    expect(withCoordinates).toBe(true);
    expect(doc[0]).toEqual({ CXVersion: '2.0', hasFragments: false });
    expect(doc.at(-1)).toEqual({ status: [{ error: '', success: true }] });
    const aspect = (name) => doc.find((entry) => name in entry)[name];
    expect(aspect('attributeDeclarations')[0].nodes).toMatchObject({
      name: { d: 'string' },
      'score [omics]': { d: 'double' },
      'count [omics]': { d: 'long' },
      'hit [omics]': { d: 'boolean' },
    });
    expect(aspect('networkAttributes')).toEqual([{ name: 'demo' }]);
    expect(aspect('nodes')[0]).toEqual({
      id: 0,
      x: 0,
      y: 5,
      v: { name: 'Alpha', [GLL_ID_ATTRIBUTE]: 'A', description: 'first', 'score [omics]': 1.5, 'count [omics]': 3, 'hit [omics]': true },
    });
    expect(aspect('edges')[1]).toEqual({ id: 1, s: 0, t: 1, v: { 'weight [evidence]': 0.25 } });
  });

  it('leaves coordinates out unless every node has one', () => {
    const graph = sampleGraph();
    graph.positions.delete('B');
    const { text, withCoordinates } = toCX2(graph);
    expect(withCoordinates).toBe(false);
    const nodes = JSON.parse(text).find((entry) => 'nodes' in entry).nodes;
    expect(nodes.some((node) => 'x' in node)).toBe(false);
  });
});

describe('CX2 round trip', () => {
  it('keeps ids, labels, edges, typed attributes, groups and positions', () => {
    const { fileData, notices } = parseCX2(toCX2(sampleGraph(), 'demo').text);
    normalizeD4DataBooleans(fileData);
    expect(notices).toEqual(['Not loaded from this CX2 file: networkAttributes. Graph Lens Lite reads nodes, edges and their attributes and applies its own styling.']);
    const [a, b] = fileData.nodes;
    expect(a).toMatchObject({ id: 'A', label: 'Alpha', description: 'first', style: { x: 0, y: 5 } });
    expect(b.label).toBeUndefined();
    expect(a.D4Data[NODE]).toEqual({ omics: { score: 1.5, count: 3, hit: 'true' } });
    expect(fileData.edges.map((e) => [e.id, e.source, e.target, e.label])).toEqual([
      ['A::B', 'A', 'B', 'binds'],
      ['A::B::2', 'A', 'B', undefined],
      ['B::B', 'B', 'B', undefined],
    ]);
    expect(fileData.edges[1].D4Data[EDGE]).toEqual({ evidence: { weight: 0.25 } });
  });
});

describe('CX2 import of an NDEx-style file', () => {
  it('resolves aliases, applies defaults, joins lists and reads coordinates', () => {
    const { fileData, notices } = parseCX2(fixture);
    const [tp53, mdm2, atm] = fileData.nodes;
    expect(tp53).toMatchObject({ id: '101', label: 'TP53', style: { x: 0, y: 0 } });
    expect(tp53.D4Data[NODE].CX2).toEqual({
      'stringdb:canonical name': '9606.ENSP00000269305',
      expression: 2.5,
      is_target: true,
      alias: 'P53|LFS1',
    });
    expect(mdm2.D4Data[NODE].CX2.expression).toBe(0);
    expect(atm.style).toMatchObject({ x: -60, y: 210 });
    expect(fileData.edges.map((e) => [e.source, e.target])).toEqual([
      ['101', '102'],
      ['103', '101'],
      ['102', '101'],
    ]);
    expect(fileData.edges[0].D4Data[EDGE].CX2).toEqual({ interaction: 'pp', 'stringdb:score': 0.999, evidence_count: 12 });
    expect(fileData.edges[1].D4Data[EDGE].CX2.interaction).toBe('phosphorylation');
    expect(notices).toEqual([
      '"::" is reserved in property names and was replaced by ":" in "stringdb::canonical name", "stringdb::score".',
      'Not loaded from this CX2 file: networkAttributes, visualProperties, nodeBypasses. ' +
        'Graph Lens Lite reads nodes, edges and their attributes and applies its own styling.',
    ]);
  });
});

describe('CX2 broken input', () => {
  const doc = (...aspects) => JSON.stringify([{ CXVersion: '2.0' }, ...aspects]);

  it.each([
    ['invalid JSON', '[{', /not valid JSON/],
    ['a GLL JSON model', '{"nodes":[],"edges":[]}', /JSON list of aspects/],
    ['a CX1 file', '[{"numberVerification":[{"longNumber":281474976710655}]}]', /CX version 1 file/],
    ['no descriptor', '[{"nodes":[{"id":1}]}]', /CXVersion descriptor is missing/],
    ['a future major version', '[{"CXVersion":"3.0"}]', /CX version 3.0 is not supported/],
    ['a failed status', doc({ nodes: [{ id: 1 }] }, { status: [{ success: false, error: 'disk full' }] }), /not written successfully: disk full/],
    ['no nodes', doc(), /contains no nodes/],
    ['a node without id', doc({ nodes: [{ id: 1 }, { v: {} }] }), /Node 2 has no id/],
    ['a duplicate node id', doc({ nodes: [{ id: 1 }, { id: 1 }] }), /Node id 1 appears more than once/],
    ['a dangling edge', doc({ nodes: [{ id: 1 }] }, { edges: [{ id: 1, s: 1, t: 9 }] }), /Edge 1 points to node 9, which is not in the file/],
    ['an edge without target', doc({ nodes: [{ id: 1 }] }, { edges: [{ id: 1, s: 1 }] }), /Edge 1 is missing its source or target/],
    ['an aspect that is not a list', doc({ nodes: { id: 1 } }), /"nodes" aspect is not a list/],
  ])('refuses %s with a clear message', (_, text, message) => {
    expect(() => parseCX2(text)).toThrow(message);
  });

  it('never lets an attribute named __proto__ reach an object prototype', () => {
    // Spelled as text: an object literal's __proto__ would set the prototype, not a key.
    const text = '[{"CXVersion":"2.0"},{"nodes":[{"id":1,"v":{"__proto__":{"polluted":true},"ok":1}}]}]';
    const { fileData, notices } = parseCX2(text);
    expect({}.polluted).toBeUndefined();
    expect(fileData.nodes[0].D4Data[NODE].CX2).toEqual({ ok: 1 });
    expect(notices[0]).toMatch(/1 values with a reserved or empty property name/);
  });
});
