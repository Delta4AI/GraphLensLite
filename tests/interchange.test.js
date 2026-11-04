import { describe, it, expect } from 'vitest';
import { GraphImport, interchangeGraph } from '../src/managers/interchange.js';
import { CFG } from '../src/config.js';

const PARALLEL_EDGES = 50_000;
const BUDGET_MS = 1000;

describe('GraphImport edge ids', () => {
  it(`numbers ${PARALLEL_EDGES} parallel edges in under ${BUDGET_MS} ms`, () => {
    const importer = new GraphImport('GraphML');
    importer.addNode('a', {}, [], 'Node 1');
    importer.addNode('b', {}, [], 'Node 2');
    const started = performance.now();
    for (let i = 0; i < PARALLEL_EDGES; i++) importer.addEdge('a', 'b', {}, [], `Edge ${i + 1}`);
    expect(performance.now() - started).toBeLessThan(BUDGET_MS);
    expect(importer.edges.at(-1).id).toBe(`a::b::${PARALLEL_EDGES}`);
  });

  it('still steps past an id another node pair already produced', () => {
    const importer = new GraphImport('GraphML');
    for (const id of ['a', 'b', 'a::b', '2']) importer.addNode(id, {}, [], id);
    importer.addEdge('a::b', '2', {}, [], 'Edge 1');
    importer.addEdge('a', 'b', {}, [], 'Edge 2');
    importer.addEdge('a', 'b', {}, [], 'Edge 3');
    expect(importer.edges.map((e) => e.id)).toEqual(['a::b::2', 'a::b', 'a::b::3']);
  });
});

describe('interchangeGraph column types', () => {
  const columnOf = (values) => {
    const nodes = values.map((value, i) => ({ id: `n${i}`, D4Data: { [CFG.EXCEL_NODE_HEADER]: { g: { v: value } } } }));
    const graph = interchangeGraph(
      { nodes, edges: [], nodeColumns: [{ subGroup: 'g', key: 'v' }], edgeColumns: [] },
      { node: [], edge: [] }
    );
    return { type: graph.nodeColumns[0].type, values: graph.nodes.map((n) => n.values[0][1]) };
  };

  it.each([['007'], ['0x1F'], ['1e3'], ['12345678901234567890'], ['Infinity']])(
    'exports "%s" as the text it is, not as a number',
    (text) => {
      expect(columnOf([text, '2'])).toEqual({ type: 'string', values: [text, '2'] });
    }
  );

  it('still exports plain numbers as numbers', () => {
    expect(columnOf([3, '-2', '0.5'])).toEqual({ type: 'double', values: [3, -2, 0.5] });
    expect(columnOf(['7', 8])).toEqual({ type: 'long', values: [7, 8] });
  });
});
