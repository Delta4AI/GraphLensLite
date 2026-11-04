import { describe, it, expect } from 'vitest';
import { GraphImport } from '../src/managers/interchange.js';

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
