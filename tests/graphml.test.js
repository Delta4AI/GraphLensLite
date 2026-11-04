// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseGraphML, toGraphML } from '../src/managers/graphml.js';
import { checkImportSize, checkElementCount, MAX_IMPORT_BYTES, MAX_IMPORT_ELEMENTS } from '../src/managers/interchange.js';
import { IOManager, normalizeD4DataBooleans } from '../src/managers/io.js';
import { CFG } from '../src/config.js';

const NODE = CFG.EXCEL_NODE_HEADER;
const EDGE = CFG.EXCEL_EDGE_HEADER;
const fixture = (name) => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8');
const props = (element, group = 'GraphML') =>
  element.D4Data[element.id.includes('::') ? EDGE : NODE][group];

/** A graph as the Excel importer hands it over: groups, types, a parallel edge, a self-loop. */
function sampleGraph() {
  const node = (id, label, x, y, data) => ({
    id,
    label,
    style: { x, y },
    D4Data: { [NODE]: data },
  });
  const edge = (source, target, id, data, endArrow = true) => ({
    id,
    source,
    target,
    style: { endArrow },
    D4Data: { [EDGE]: data },
  });
  return {
    nodes: [
      node('A', 'Alpha & <co>', 0, 0, { omics: { score: 1.5, count: 3, hit: 'true' }, [CFG.EXCEL_UNCATEGORIZED_SUBHEADER]: { note: 'x "y"' } }),
      node('B', undefined, -12.25, 40, { omics: { score: -2, count: 7, hit: 'false' } }),
    ],
    edges: [
      edge('A', 'B', 'A::B', { evidence: { weight: 0.5, kind: 'pp' } }),
      edge('A', 'B', 'A::B::2', { evidence: { weight: 0.25 } }),
      edge('B', 'B', 'B::B', {}, false),
    ],
    nodeColumns: [
      { subGroup: 'omics', key: 'score' },
      { subGroup: 'omics', key: 'count' },
      { subGroup: 'omics', key: 'hit' },
      { subGroup: CFG.EXCEL_UNCATEGORIZED_SUBHEADER, key: 'note' },
    ],
    edgeColumns: [
      { subGroup: 'evidence', key: 'weight' },
      { subGroup: 'evidence', key: 'kind' },
    ],
  };
}

describe('GraphML round trip', () => {
  it('keeps nodes, edges, typed attributes, groups, labels and positions', () => {
    const source = sampleGraph();
    const text = toGraphML(source);
    expect(text).toContain('attr.name="score [omics]" attr.type="double"');
    expect(text).toContain('attr.name="count [omics]" attr.type="long"');
    expect(text).toContain('attr.name="hit [omics]" attr.type="boolean"');
    expect(text).toContain('Alpha &amp; &lt;co&gt;');

    const { fileData } = parseGraphML(text);
    normalizeD4DataBooleans(fileData);
    const [a, b] = fileData.nodes;
    expect(a).toMatchObject({ id: 'A', label: 'Alpha & <co>', style: { x: 0, y: 0 } });
    expect(b.label).toBeUndefined();
    expect(b.style).toMatchObject({ x: -12.25, y: 40 });
    expect(a.D4Data[NODE].omics).toEqual({ score: 1.5, count: 3, hit: 'true' });
    // Ungrouped columns travel under their bare name and come back in the format's group.
    expect(a.D4Data[NODE].GraphML).toEqual({ note: 'x "y"' });

    expect(fileData.edges.map((e) => [e.id, e.source, e.target])).toEqual([
      ['A::B', 'A', 'B'],
      ['A::B::2', 'A', 'B'],
      ['B::B', 'B', 'B'],
    ]);
    expect(fileData.edges[0].D4Data[EDGE].evidence).toEqual({ weight: 0.5, kind: 'pp' });
    expect(fileData.edges.map((e) => e.style.endArrow === true)).toEqual([true, true, false]);
    expect(fileData.nodeDataHeaders).toEqual(expect.arrayContaining(source.nodeColumns.slice(0, 3)));
  });
});

describe('GraphML import of other tools\' files', () => {
  it('reads a Cytoscape-style export: name as label, typed columns, directed parallel edges', () => {
    const { fileData } = parseGraphML(fixture('cytoscape-style.graphml'));
    const [tp53, mdm2, cdkn1a] = fileData.nodes;
    expect(tp53).toMatchObject({ id: 'n0', label: 'TP53' });
    expect(props(tp53)).toEqual({ 'shared name': 'TP53', selected: false, Degree: 2, log2FC: -1.25 });
    expect(props(mdm2).selected).toBe(true);
    expect(props(cdkn1a)).toEqual({ selected: false, Degree: 1 });
    expect(fileData.edges.map((e) => e.id)).toEqual(['n0::n1', 'n0::n1::2', 'n0::n2']);
    expect(fileData.edges.every((e) => e.style.endArrow === true)).toBe(true);
    expect(fileData.edges[1].D4Data[EDGE].GraphML).toEqual({ interaction: 'expression', score: 0.42 });
  });

  it('reads a NetworkX-style export: label key, x/y keys as positions, undirected, self-loop', () => {
    const { fileData, notices } = parseGraphML(fixture('networkx-style.graphml'));
    const [egfr, grb2, sos1] = fileData.nodes;
    expect(egfr).toMatchObject({ id: 'EGFR', label: 'Epidermal growth factor receptor', style: { x: 0, y: 0 } });
    expect(props(egfr)).toEqual({ pathway: 'ErbB signalling', essential: true });
    expect(props(grb2).essential).toBe(false);
    expect(sos1.style).toMatchObject({ x: 60, y: 80 });
    expect(sos1.label).toBeUndefined();
    expect(fileData.edges.map((e) => e.id)).toEqual(['EGFR::GRB2', 'GRB2::SOS1', 'EGFR::EGFR']);
    expect(fileData.edges.some((e) => e.style.endArrow)).toBe(false);
    expect(notices).toEqual([]);
  });

  it('takes a yEd node label and the centre of its geometry', () => {
    const { fileData } = parseGraphML(`<?xml version="1.0"?>
      <graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:y="http://www.yworks.com/xml/graphml">
        <key for="node" id="d6" yfiles.type="nodegraphics"/>
        <graph edgedefault="directed">
          <node id="n0"><data key="d6"><y:ShapeNode>
            <y:Geometry height="30" width="60" x="10" y="20"/><y:NodeLabel>Kinase</y:NodeLabel>
          </y:ShapeNode></data></node>
        </graph>
      </graphml>`);
    expect(fileData.nodes[0]).toMatchObject({ label: 'Kinase', style: { x: 40, y: 35 } });
  });

  it('reports what it could not load instead of dropping it silently', () => {
    const { notices } = parseGraphML(`<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
      <key id="k" for="node" attr.name="n" attr.type="int"/>
      <graph edgedefault="directed">
        <node id="a"><data key="k">twelve</data><data key="missing">1</data>
          <graph><node id="inner"/></graph></node>
        <hyperedge><endpoint node="a"/></hyperedge>
      </graph>
      <graph/>
    </graphml>`);
    expect(notices.join(' ')).toMatch(/1 values did not match their declared type/);
    expect(notices.join(' ')).toMatch(/1 additional graphs, 1 nested graphs inside nodes, 1 hyperedges, 1 values that refer to an undeclared <key>/);
  });
});

describe('GraphML hostile and broken input', () => {
  const wrap = (graph) => `<graphml xmlns="http://graphml.graphdrawing.org/xmlns"><graph>${graph}</graph></graphml>`;

  it.each([
    [
      'an entity-expansion bomb',
      '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><graphml>&lol2;</graphml>',
      /declares a DTD or entities/,
    ],
    ['a different root element', '<svg xmlns="http://www.w3.org/2000/svg"/>', /not a GraphML file: it starts with <svg>/],
    ['malformed XML', '<graphml><graph></graphml>', /not well-formed XML/],
    ['no graph', '<graphml xmlns="http://graphml.graphdrawing.org/xmlns"/>', /contains no <graph>/],
    ['no nodes', wrap(''), /contains no nodes/],
    ['a node without id', wrap('<node id="a"/><node/>'), /Node 2 has no id/],
    ['a duplicate node id', wrap('<node id="a"/><node id="a"/>'), /"a" appears more than once/],
    ['a dangling edge', wrap('<node id="a"/><edge source="a" target="ghost"/>'), /Edge 1 points to node "ghost", which is not in the file/],
    ['an edge without target', wrap('<node id="a"/><edge source="a"/>'), /Edge 1 is missing its source or target/],
  ])('refuses %s with a clear message', (_, text, message) => {
    expect(() => parseGraphML(text)).toThrow(message);
  });

  it('refuses files above the size and element caps', () => {
    expect(() => checkImportSize(MAX_IMPORT_BYTES + 1)).toThrow(/larger than 100 MB/);
    expect(() => checkElementCount(MAX_IMPORT_ELEMENTS + 1)).toThrow(/opens at most 500,000/);
  });

  it('keeps markup in attribute values as text', () => {
    const { fileData } = parseGraphML(`<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
      <key id="l" for="node" attr.name="label"/>
      <graph><node id="a"><data key="l">&lt;img src=x onerror=alert(1)&gt;</data></node></graph></graphml>`);
    expect(fileData.nodes[0].label).toBe('<img src=x onerror=alert(1)>');
  });

  it('shows the parser error to the user and loads nothing', async () => {
    const ui = { error: vi.fn(), warning: vi.fn() };
    const io = new IOManager({ ui });
    const file = new File(['<graphml><graph>'], 'broken.graphml');
    const result = await io.loadFile({ target: { files: [file] } });
    expect(result).toBeNull();
    expect(ui.error).toHaveBeenCalledWith(expect.stringMatching(/^Could not open broken\.graphml: The file is not well-formed XML/));
  });
});
