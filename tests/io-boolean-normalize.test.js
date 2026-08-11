// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';

const { normalizeD4DataBooleans } = await import('../src/managers/io.js');

// --------------------------------------------------------------------------
// Regression: raw boolean D4Data values mis-classify as numeric downstream
// (isNaN(true) === false) and become [1,1] sliders whose BETWEEN condition
// never validates (query AST requires typeof number), hiding their carriers
// under an OR filter join. The import boundary must stringify them so every
// source (Excel boolean cells, hand-written JSON, live API pushes) yields
// categorical true/false filters.
// --------------------------------------------------------------------------

describe('normalizeD4DataBooleans', () => {
  it('stringifies boolean values on nodes and edges in place', () => {
    const fileData = {
      nodes: [
        { id: 'a', D4Data: { 'Node filters': { Cell: { active: true, name: 'A', size: 3 } } } },
      ],
      edges: [
        {
          id: 'e',
          D4Data: { 'Edge filters': { ANNOTATES: { mined: true, explicit: false } } },
        },
      ],
    };

    normalizeD4DataBooleans(fileData);

    expect(fileData.nodes[0].D4Data['Node filters'].Cell).toEqual({
      active: 'true',
      name: 'A',
      size: 3,
    });
    expect(fileData.edges[0].D4Data['Edge filters'].ANNOTATES).toEqual({
      mined: 'true',
      explicit: 'false',
    });
  });

  it('tolerates elements without D4Data and malformed groups', () => {
    const fileData = {
      nodes: [{ id: 'a' }, { id: 'b', D4Data: { 'Node filters': null } }],
      edges: [{ id: 'e', D4Data: { 'Edge filters': { X: null } } }],
    };
    expect(() => normalizeD4DataBooleans(fileData)).not.toThrow();
  });

  it('tolerates missing nodes/edges arrays', () => {
    expect(() => normalizeD4DataBooleans({})).not.toThrow();
  });
});
