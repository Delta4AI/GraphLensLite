import { describe, it, expect, beforeEach } from 'vitest';
import { QueryAST } from '../src/managers/query.js';

// ==========================================================================
// QueryAST — evaluation logic unit tests
// ==========================================================================

// Helper: build a node with D4Data and a featureIsWithinThreshold map
function makeNode(props = {}) {
  return {
    D4Data: { 'Node filters': props },
    featureIsWithinThreshold: new Map(),
  };
}

// Helper: build an edge with D4Data and a featureIsWithinThreshold map
function makeEdge(props = {}) {
  return {
    D4Data: { 'Edge filters': props },
    featureIsWithinThreshold: new Map(),
  };
}

// Shorthand: property token
function prop(sub, name) {
  return {
    type: 'property',
    main: 'Node filters',
    sub,
    prop: name,
    propID: `Node filters::${sub}::${name}`,
  };
}

function edgeProp(sub, name) {
  return {
    type: 'property',
    main: 'Edge filters',
    sub,
    prop: name,
    propID: `Edge filters::${sub}::${name}`,
  };
}

// Shorthand: keyword token
function kw(value) {
  return { type: 'KW', value };
}

// Shorthand: "IS MISSING" leaf for a given property token
function missing(propToken) {
  return [propToken, kw('IS MISSING')];
}

// Shorthand: number token
function num(value) {
  return { type: 'NUM', value };
}

// Shorthand: string token
function str(value) {
  return { type: 'STR', value };
}

// --------------------------------------------------------------------------
// BETWEEN expressions
// --------------------------------------------------------------------------

describe('QueryAST: BETWEEN expressions', () => {
  it('matches value within range (inclusive)', () => {
    // Node filters::groupA::score BETWEEN 0 AND 10
    const instructions = [[prop('groupA', 'score'), kw('BETWEEN'), num(0), kw('AND'), num(10)]];
    const ast = new QueryAST(instructions);
    const node = makeNode({ groupA: { score: 5 } });
    expect(ast.testNode(node)).toBe(true);
  });

  it('matches exact lower bound', () => {
    const instructions = [[prop('groupA', 'score'), kw('BETWEEN'), num(0), kw('AND'), num(10)]];
    const ast = new QueryAST(instructions);
    const node = makeNode({ groupA: { score: 0 } });
    expect(ast.testNode(node)).toBe(true);
  });

  it('matches exact upper bound', () => {
    const instructions = [[prop('groupA', 'score'), kw('BETWEEN'), num(0), kw('AND'), num(10)]];
    const ast = new QueryAST(instructions);
    const node = makeNode({ groupA: { score: 10 } });
    expect(ast.testNode(node)).toBe(true);
  });

  it('rejects value below range', () => {
    const instructions = [[prop('groupA', 'score'), kw('BETWEEN'), num(5), kw('AND'), num(10)]];
    const ast = new QueryAST(instructions);
    const node = makeNode({ groupA: { score: 3 } });
    expect(ast.testNode(node)).toBe(false);
  });

  it('rejects value above range', () => {
    const instructions = [[prop('groupA', 'score'), kw('BETWEEN'), num(5), kw('AND'), num(10)]];
    const ast = new QueryAST(instructions);
    const node = makeNode({ groupA: { score: 15 } });
    expect(ast.testNode(node)).toBe(false);
  });

  it('rejects string value for BETWEEN (type mismatch)', () => {
    const instructions = [[prop('groupA', 'score'), kw('BETWEEN'), num(0), kw('AND'), num(10)]];
    const ast = new QueryAST(instructions);
    const node = makeNode({ groupA: { score: 'five' } });
    expect(ast.testNode(node)).toBe(false);
  });

  it('handles negative range values', () => {
    const instructions = [[prop('groupA', 'temp'), kw('BETWEEN'), num(-10), kw('AND'), num(-5)]];
    const ast = new QueryAST(instructions);
    expect(ast.testNode(makeNode({ groupA: { temp: -7 } }))).toBe(true);
    expect(ast.testNode(makeNode({ groupA: { temp: -3 } }))).toBe(false);
    expect(ast.testNode(makeNode({ groupA: { temp: -11 } }))).toBe(false);
  });
});

// --------------------------------------------------------------------------
// LOWER THAN / OR GREATER THAN (inverted slider)
// --------------------------------------------------------------------------

describe('QueryAST: LOWER THAN expressions', () => {
  it('matches value at or below lower threshold', () => {
    // score LOWER THAN 3 OR GREATER THAN 7
    const instructions = [
      [prop('groupA', 'score'), kw('LOWER THAN'), num(3), kw('OR GREATER THAN'), num(7)],
    ];
    const ast = new QueryAST(instructions);
    expect(ast.testNode(makeNode({ groupA: { score: 2 } }))).toBe(true);
    expect(ast.testNode(makeNode({ groupA: { score: 3 } }))).toBe(true);
  });

  it('matches value at or above upper threshold', () => {
    const instructions = [
      [prop('groupA', 'score'), kw('LOWER THAN'), num(3), kw('OR GREATER THAN'), num(7)],
    ];
    const ast = new QueryAST(instructions);
    expect(ast.testNode(makeNode({ groupA: { score: 7 } }))).toBe(true);
    expect(ast.testNode(makeNode({ groupA: { score: 9 } }))).toBe(true);
  });

  it('rejects value in the middle (excluded range)', () => {
    const instructions = [
      [prop('groupA', 'score'), kw('LOWER THAN'), num(3), kw('OR GREATER THAN'), num(7)],
    ];
    const ast = new QueryAST(instructions);
    expect(ast.testNode(makeNode({ groupA: { score: 5 } }))).toBe(false);
  });
});

// --------------------------------------------------------------------------
// IN (categorical) expressions
// --------------------------------------------------------------------------

describe('QueryAST: IN expressions', () => {
  it('matches value present in the set', () => {
    // category IN [foo, bar]
    const instructions = [[prop('groupA', 'category'), kw('IN ['), str('foo'), str('bar')]];
    const ast = new QueryAST(instructions);
    expect(ast.testNode(makeNode({ groupA: { category: 'foo' } }))).toBe(true);
    expect(ast.testNode(makeNode({ groupA: { category: 'bar' } }))).toBe(true);
  });

  it('rejects value not in the set', () => {
    const instructions = [[prop('groupA', 'category'), kw('IN ['), str('foo'), str('bar')]];
    const ast = new QueryAST(instructions);
    expect(ast.testNode(makeNode({ groupA: { category: 'baz' } }))).toBe(false);
  });

  it('handles single category', () => {
    const instructions = [[prop('groupA', 'category'), kw('IN ['), str('only')]];
    const ast = new QueryAST(instructions);
    expect(ast.testNode(makeNode({ groupA: { category: 'only' } }))).toBe(true);
    expect(ast.testNode(makeNode({ groupA: { category: 'other' } }))).toBe(false);
  });

  it('handles pipe-separated values in node data', () => {
    // Node has "alpha|beta" as value, query asks for IN [alpha]
    const instructions = [[prop('groupA', 'tags'), kw('IN ['), str('alpha')]];
    const ast = new QueryAST(instructions);
    expect(ast.testNode(makeNode({ groupA: { tags: 'alpha|beta' } }))).toBe(true);
  });

  it('rejects when none of the pipe-separated values match', () => {
    const instructions = [[prop('groupA', 'tags'), kw('IN ['), str('gamma')]];
    const ast = new QueryAST(instructions);
    expect(ast.testNode(makeNode({ groupA: { tags: 'alpha|beta' } }))).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Logical connectors: AND, OR, NOT
// --------------------------------------------------------------------------

describe('QueryAST: AND connector', () => {
  it('returns true when both conditions are true', () => {
    const instructions = [
      [prop('g', 'a'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
      'AND',
      [prop('g', 'b'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
    ];
    const ast = new QueryAST(instructions);
    const node = makeNode({ g: { a: 5, b: 5 } });
    expect(ast.testNode(node)).toBe(true);
  });

  it('returns false when first condition is false', () => {
    const instructions = [
      [prop('g', 'a'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
      'AND',
      [prop('g', 'b'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
    ];
    const ast = new QueryAST(instructions);
    const node = makeNode({ g: { a: 15, b: 5 } });
    expect(ast.testNode(node)).toBe(false);
  });

  it('returns false when second condition is false', () => {
    const instructions = [
      [prop('g', 'a'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
      'AND',
      [prop('g', 'b'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
    ];
    const ast = new QueryAST(instructions);
    const node = makeNode({ g: { a: 5, b: 15 } });
    expect(ast.testNode(node)).toBe(false);
  });
});

describe('QueryAST: OR connector', () => {
  it('returns true when at least one condition is true', () => {
    const instructions = [
      [prop('g', 'a'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
      'OR',
      [prop('g', 'b'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
    ];
    const ast = new QueryAST(instructions);
    expect(ast.testNode(makeNode({ g: { a: 5, b: 15 } }))).toBe(true);
    expect(ast.testNode(makeNode({ g: { a: 15, b: 5 } }))).toBe(true);
  });

  it('returns true when both conditions are true', () => {
    const instructions = [
      [prop('g', 'a'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
      'OR',
      [prop('g', 'b'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
    ];
    const ast = new QueryAST(instructions);
    expect(ast.testNode(makeNode({ g: { a: 5, b: 5 } }))).toBe(true);
  });

  it('returns false when both conditions are false', () => {
    const instructions = [
      [prop('g', 'a'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
      'OR',
      [prop('g', 'b'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
    ];
    const ast = new QueryAST(instructions);
    expect(ast.testNode(makeNode({ g: { a: 15, b: 15 } }))).toBe(false);
  });
});

describe('QueryAST: NOT connector', () => {
  it('returns true when first is true and second is false', () => {
    // "lhs NOT rhs" := lhs && !rhs
    const instructions = [
      [prop('g', 'a'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
      'NOT',
      [prop('g', 'b'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
    ];
    const ast = new QueryAST(instructions);
    const node = makeNode({ g: { a: 5, b: 15 } });
    expect(ast.testNode(node)).toBe(true);
  });

  it('returns false when both are true', () => {
    const instructions = [
      [prop('g', 'a'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
      'NOT',
      [prop('g', 'b'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
    ];
    const ast = new QueryAST(instructions);
    const node = makeNode({ g: { a: 5, b: 5 } });
    expect(ast.testNode(node)).toBe(false);
  });

  it('returns false when first is false', () => {
    const instructions = [
      [prop('g', 'a'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
      'NOT',
      [prop('g', 'b'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
    ];
    const ast = new QueryAST(instructions);
    const node = makeNode({ g: { a: 15, b: 15 } });
    expect(ast.testNode(node)).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Nested / chained expressions
// --------------------------------------------------------------------------

describe('QueryAST: nested expressions', () => {
  it('handles nested groups with AND inside OR', () => {
    // (a BETWEEN 0 AND 10 AND b BETWEEN 0 AND 10) OR (c BETWEEN 0 AND 10)
    const instructions = [
      [
        [prop('g', 'a'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
        'AND',
        [prop('g', 'b'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
      ],
      'OR',
      [prop('g', 'c'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
    ];
    const ast = new QueryAST(instructions);

    // Both a and b match → true
    expect(ast.testNode(makeNode({ g: { a: 5, b: 5, c: 15 } }))).toBe(true);
    // Only c matches → true
    expect(ast.testNode(makeNode({ g: { a: 15, b: 15, c: 5 } }))).toBe(true);
    // Nothing matches → false
    expect(ast.testNode(makeNode({ g: { a: 15, b: 15, c: 15 } }))).toBe(false);
  });

  it('handles three-way OR chain', () => {
    const instructions = [
      [prop('g', 'a'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
      'OR',
      [prop('g', 'b'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
      'OR',
      [prop('g', 'c'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
    ];
    const ast = new QueryAST(instructions);
    expect(ast.testNode(makeNode({ g: { a: 15, b: 15, c: 5 } }))).toBe(true);
    expect(ast.testNode(makeNode({ g: { a: 15, b: 15, c: 15 } }))).toBe(false);
  });

  it('evaluates left-to-right for mixed connectors', () => {
    // (a OR b) AND c  — left-to-right: (a OR b) then AND c
    const instructions = [
      [prop('g', 'a'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
      'OR',
      [prop('g', 'b'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
      'AND',
      [prop('g', 'c'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
    ];
    const ast = new QueryAST(instructions);

    // a=5 (OR succeeds), c=5 (AND succeeds) → true
    expect(ast.testNode(makeNode({ g: { a: 5, b: 15, c: 5 } }))).toBe(true);
    // a=5 (OR succeeds), c=15 (AND fails) → false
    expect(ast.testNode(makeNode({ g: { a: 5, b: 15, c: 15 } }))).toBe(false);
  });
});

// --------------------------------------------------------------------------
// IS MISSING primitive (non-strict AND filler)
// --------------------------------------------------------------------------

describe('QueryAST: IS MISSING primitive', () => {
  it('is true when the value is absent', () => {
    const ast = new QueryAST([missing(prop('g', 'score'))]);
    expect(ast.testNode(makeNode({ g: { other: 5 } }))).toBe(true);
  });

  it('is true for null, empty string and NaN', () => {
    const ast = new QueryAST([missing(prop('g', 'score'))]);
    expect(ast.testNode(makeNode({ g: { score: null } }))).toBe(true);
    expect(ast.testNode(makeNode({ g: { score: '' } }))).toBe(true);
    expect(ast.testNode(makeNode({ g: { score: NaN } }))).toBe(true);
  });

  it('is false when a value is present', () => {
    const ast = new QueryAST([missing(prop('g', 'score'))]);
    expect(ast.testNode(makeNode({ g: { score: 0 } }))).toBe(false);
    expect(ast.testNode(makeNode({ g: { score: 'x' } }))).toBe(false);
  });

  it('is true when the property belongs to the other element type', () => {
    // A node property is "missing" from the perspective of an edge.
    const ast = new QueryAST([missing(prop('g', 'score'))]);
    expect(ast.testEdge(makeEdge({ g: { score: 5 } }))).toBe(true);
  });
});

// --------------------------------------------------------------------------
// Non-strict AND join (as emitted by updateQueryTextArea)
// --------------------------------------------------------------------------

describe('QueryAST: non-strict AND join', () => {
  // ((score BETWEEN 0 AND 10) OR (score IS MISSING))
  //   AND
  // ((type IN [alpha]) OR (type IS MISSING))
  const nonStrictAnd = () => [
    [
      [prop('g', 'score'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
      'OR',
      missing(prop('g', 'score')),
    ],
    'AND',
    [[prop('g', 'type'), kw('IN ['), str('alpha')], 'OR', missing(prop('g', 'type'))],
  ];

  it('shows an element that passes every property it actually has', () => {
    const ast = new QueryAST(nonStrictAnd());
    // has score (in range), missing type entirely → not disqualified
    expect(ast.testNode(makeNode({ g: { score: 5 } }))).toBe(true);
  });

  it('shows an element matching all present properties', () => {
    const ast = new QueryAST(nonStrictAnd());
    expect(ast.testNode(makeNode({ g: { score: 5, type: 'alpha' } }))).toBe(true);
  });

  it('hides an element that has a property but fails its filter', () => {
    const ast = new QueryAST(nonStrictAnd());
    // score present but out of range → excluded despite missing type
    expect(ast.testNode(makeNode({ g: { score: 99 } }))).toBe(false);
    // type present but wrong value → excluded despite matching score
    expect(ast.testNode(makeNode({ g: { score: 5, type: 'beta' } }))).toBe(false);
  });

  it('does not hide elements across element types (node + edge filters)', () => {
    // Mixed query: one node filter AND one edge filter, both non-strict.
    const mixed = [
      [
        [prop('g', 'score'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
        'OR',
        missing(prop('g', 'score')),
      ],
      'AND',
      [
        [edgeProp('g', 'weight'), kw('BETWEEN'), num(0), kw('AND'), num(1)],
        'OR',
        missing(edgeProp('g', 'weight')),
      ],
    ];
    const ast = new QueryAST(mixed);
    // node passes its node filter; edge conjunct is neutral for a node
    expect(ast.testNode(makeNode({ g: { score: 5 } }))).toBe(true);
    // edge passes its edge filter; node conjunct is neutral for an edge
    expect(ast.testEdge(makeEdge({ g: { weight: 0.5 } }))).toBe(true);
    // node failing its own filter is still hidden
    expect(ast.testNode(makeNode({ g: { score: 99 } }))).toBe(false);
    // edge failing its own filter is still hidden
    expect(ast.testEdge(makeEdge({ g: { weight: 5 } }))).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Strict AND join (type-grouped, as emitted with filterStrict on):
//   ((score ...) AND (type ...)) OR ((weight ...))
// AND within each element type, OR between the two type groups.
// --------------------------------------------------------------------------

describe('QueryAST: strict AND join (type-grouped)', () => {
  // node group only: (score BETWEEN 0 AND 10) AND (type IN [alpha])
  const nodeOnly = () => [
    [prop('g', 'score'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
    'AND',
    [prop('g', 'type'), kw('IN ['), str('alpha')],
  ];

  // node group OR edge group
  const mixed = () => [
    [
      [prop('g', 'score'), kw('BETWEEN'), num(0), kw('AND'), num(10)],
      'AND',
      [prop('g', 'type'), kw('IN ['), str('alpha')],
    ],
    'OR',
    [[edgeProp('g', 'weight'), kw('BETWEEN'), num(0), kw('AND'), num(1)]],
  ];

  it('shows an element that has and matches every same-type filter', () => {
    const ast = new QueryAST(nodeOnly());
    expect(ast.testNode(makeNode({ g: { score: 5, type: 'alpha' } }))).toBe(true);
  });

  it('hides an element missing any same-type filter (complete cases only)', () => {
    const ast = new QueryAST(nodeOnly());
    // matches score but lacks type entirely → excluded (unlike non-strict)
    expect(ast.testNode(makeNode({ g: { score: 5 } }))).toBe(false);
  });

  it('judges each element type on its own group (no empty graph on mixed filters)', () => {
    const ast = new QueryAST(mixed());
    // node satisfies the node group; edge group is false for it, OR ignores it
    expect(ast.testNode(makeNode({ g: { score: 5, type: 'alpha' } }))).toBe(true);
    // node missing a node filter → node group false, edge group false → hidden
    expect(ast.testNode(makeNode({ g: { score: 5 } }))).toBe(false);
    // edge satisfies the edge group; node group is false for it, OR ignores it
    expect(ast.testEdge(makeEdge({ g: { weight: 0.5 } }))).toBe(true);
    // edge failing its own filter → hidden
    expect(ast.testEdge(makeEdge({ g: { weight: 5 } }))).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Edge testing
// --------------------------------------------------------------------------

describe('QueryAST: edge evaluation', () => {
  it('evaluates edge properties via testEdge', () => {
    const instructions = [[edgeProp('groupX', 'weight'), kw('BETWEEN'), num(0), kw('AND'), num(1)]];
    const ast = new QueryAST(instructions);
    const edge = makeEdge({ groupX: { weight: 0.5 } });
    expect(ast.testEdge(edge)).toBe(true);
  });

  it('ignores node property tokens when testing edges', () => {
    // A node property should not match against edge data
    const instructions = [[prop('g', 'score'), kw('BETWEEN'), num(0), kw('AND'), num(10)]];
    const ast = new QueryAST(instructions);
    const edge = makeEdge({ g: { score: 5 } });
    // main group is "Node filters" but testEdge uses "Edge filters" → mismatch
    expect(ast.testEdge(edge)).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Empty query semantics: no constraints = match everything
// --------------------------------------------------------------------------

describe('QueryAST: empty instructions', () => {
  it('matches any node via testNode', () => {
    const ast = new QueryAST([]);
    expect(ast.testNode(makeNode({ g: { a: 5 } }))).toBe(true);
    expect(ast.testNode(makeNode())).toBe(true);
  });

  it('matches any edge via testEdge', () => {
    const ast = new QueryAST([]);
    expect(ast.testEdge(makeEdge({ groupX: { weight: 0.5 } }))).toBe(true);
    expect(ast.testEdge(makeEdge())).toBe(true);
  });

  it('does not change non-empty invalid input semantics', () => {
    // Non-empty but malformed expression still falls through to false
    const ast = new QueryAST([{ type: 'garbage' }, { type: 'garbage' }]);
    expect(ast.testNode(makeNode({ g: { a: 5 } }))).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Edge cases / robustness
// --------------------------------------------------------------------------

describe('QueryAST: edge cases', () => {
  it('returns false for missing property on node', () => {
    const instructions = [[prop('groupA', 'missing'), kw('BETWEEN'), num(0), kw('AND'), num(10)]];
    const ast = new QueryAST(instructions);
    const node = makeNode({ groupA: { other: 5 } });
    expect(ast.testNode(node)).toBe(false);
  });

  it('returns false for null property value', () => {
    const instructions = [[prop('groupA', 'val'), kw('BETWEEN'), num(0), kw('AND'), num(10)]];
    const ast = new QueryAST(instructions);
    const node = makeNode({ groupA: { val: null } });
    expect(ast.testNode(node)).toBe(false);
  });

  it('matches everything for empty instructions (no constraints)', () => {
    const ast = new QueryAST([]);
    const node = makeNode({ g: { a: 5 } });
    expect(ast.testNode(node)).toBe(true);
  });

  it('handles single instruction without nesting', () => {
    const instructions = [[prop('g', 'a'), kw('BETWEEN'), num(0), kw('AND'), num(10)]];
    const ast = new QueryAST(instructions);
    expect(ast.testNode(makeNode({ g: { a: 5 } }))).toBe(true);
  });

  it('sets featureIsWithinThreshold on the element', () => {
    const instructions = [[prop('groupA', 'score'), kw('BETWEEN'), num(0), kw('AND'), num(10)]];
    const ast = new QueryAST(instructions);
    const node = makeNode({ groupA: { score: 5 } });
    ast.testNode(node);
    expect(node.featureIsWithinThreshold.get('Node filters::groupA::score')).toBe(true);
  });

  it('sets featureIsWithinThreshold to false for out-of-range', () => {
    const instructions = [[prop('groupA', 'score'), kw('BETWEEN'), num(0), kw('AND'), num(10)]];
    const ast = new QueryAST(instructions);
    const node = makeNode({ groupA: { score: 15 } });
    ast.testNode(node);
    expect(node.featureIsWithinThreshold.get('Node filters::groupA::score')).toBe(false);
  });

  it('handles mixed BETWEEN and IN in an OR chain', () => {
    const instructions = [
      [prop('g', 'score'), kw('BETWEEN'), num(0), kw('AND'), num(5)],
      'OR',
      [prop('g', 'type'), kw('IN ['), str('alpha'), str('beta')],
    ];
    const ast = new QueryAST(instructions);
    // score matches
    expect(ast.testNode(makeNode({ g: { score: 3, type: 'gamma' } }))).toBe(true);
    // type matches
    expect(ast.testNode(makeNode({ g: { score: 10, type: 'alpha' } }))).toBe(true);
    // neither matches
    expect(ast.testNode(makeNode({ g: { score: 10, type: 'gamma' } }))).toBe(false);
  });
});
