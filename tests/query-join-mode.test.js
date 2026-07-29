// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { QueryManager, QueryAST } from '../src/managers/query.js';

// ==========================================================================
// OR/AND join mode: the non-strict AND query emitted by updateQueryTextArea
// wraps each conjunct as "(cond) OR (prop IS MISSING)". This must survive a
// full encodeQuery -> decodeQuery round-trip AND evaluate with non-strict
// semantics (a property an element lacks does not disqualify it).
// ==========================================================================

function makeQM() {
  for (const id of ['queryUpdateBtn', 'querySelectBtn']) {
    const btn = document.createElement('button');
    btn.id = id;
    document.body.appendChild(btn);
  }
  const cache = {
    query: { valid: true, overlay: document.createElement('div') },
    uniquePropHierarchy: {
      'Node filters': { g: new Set(['score']) },
      'Edge filters': { g: new Set(['weight']) },
    },
  };
  return new QueryManager(cache);
}

function makeNode(props = {}) {
  return { D4Data: { 'Node filters': props }, featureIsWithinThreshold: new Map() };
}
function makeEdge(props = {}) {
  return { D4Data: { 'Edge filters': props }, featureIsWithinThreshold: new Map() };
}

// QM whose layout derives the query from a filters Map, with recorded defaults
// so "narrowed" detection works (used by updateQueryTextArea for AND).
function makeDerivingQM(filters, defaults, mode, strict) {
  for (const id of ['queryUpdateBtn', 'querySelectBtn']) {
    const btn = document.createElement('button');
    btn.id = id;
    document.body.appendChild(btn);
  }
  const cache = {
    query: {
      valid: true,
      text: document.createElement('div'),
      overlay: document.createElement('div'),
    },
    uniquePropHierarchy: { 'Node filters': { g: new Set(['type', 'score']) } },
    data: {
      selectedLayout: 'L',
      filterDefaults: defaults,
      layouts: { L: { filters, filterJoinMode: mode, filterStrict: strict, query: '' } },
    },
  };
  const qm = new QueryManager(cache);
  qm.moveCaretToEnd = () => {};
  return qm;
}

// Non-strict AND across a node filter and an edge filter.
const AND_QUERY =
  '((Node filters::g::score BETWEEN 0 AND 10) OR (Node filters::g::score IS MISSING))' +
  ' AND ' +
  '((Edge filters::g::weight BETWEEN 0 AND 1) OR (Edge filters::g::weight IS MISSING))';

// Strict AND (complete cases): same shape as the non-strict query with the
// narrower "IS FOREIGN" filler — only the other element type excuses a
// conjunct, so a same-type absent value still excludes.
const STRICT_AND_QUERY =
  '((Node filters::g::score BETWEEN 0 AND 10) OR (Node filters::g::score IS FOREIGN))' +
  ' AND ' +
  '((Edge filters::g::weight BETWEEN 0 AND 1) OR (Edge filters::g::weight IS FOREIGN))';

describe('join mode: non-strict AND round-trip', () => {
  let qm;
  beforeEach(() => {
    document.body.innerHTML = '';
    qm = makeQM();
  });

  it('keeps the wrapped AND query valid through encoding', () => {
    qm.cache.query.overlay.innerHTML = qm.encodeQuery(AND_QUERY);
    expect(qm.cache.query.valid).toBe(true);
  });

  it('decodes to an AST that evaluates with non-strict semantics', () => {
    qm.cache.query.overlay.innerHTML = qm.encodeQuery(AND_QUERY);
    const ast = new QueryAST(qm.decodeQuery());

    // node passes its own filter, lacks the edge property → shown
    expect(ast.testNode(makeNode({ g: { score: 5 } }))).toBe(true);
    // node fails its own filter → hidden
    expect(ast.testNode(makeNode({ g: { score: 99 } }))).toBe(false);
    // edge passes its own filter, node property is neutral for it → shown
    expect(ast.testEdge(makeEdge({ g: { weight: 0.5 } }))).toBe(true);
    // edge fails its own filter → hidden
    expect(ast.testEdge(makeEdge({ g: { weight: 5 } }))).toBe(false);
  });
});

describe('join mode: AND counts only narrowed filters', () => {
  // Defaults: type has both categories; score slider spans 0..1.
  const defaults = () =>
    new Map([
      ['Node filters::g::type', { isCategory: true, categories: new Set(['a', 'b']) }],
      [
        'Node filters::g::score',
        { isCategory: false, isInverted: false, lowerThreshold: 0, upperThreshold: 1 },
      ],
    ]);

  it('emits no query when nothing is narrowed (full graph)', () => {
    const filters = new Map([
      [
        'Node filters::g::type',
        { active: true, isCategory: true, categories: new Set(['a', 'b']) },
      ],
      [
        'Node filters::g::score',
        {
          active: true,
          isCategory: false,
          isInverted: false,
          lowerThreshold: 0,
          upperThreshold: 1,
        },
      ],
    ]);
    const qm = makeDerivingQM(filters, defaults(), 'AND', false);
    qm.updateQueryTextArea();
    expect(qm.cache.query.text.textContent).toBe('');
  });

  it('includes only the narrowed filter under AND', () => {
    const filters = new Map([
      // narrowed: only "a" selected (default had a,b)
      ['Node filters::g::type', { active: true, isCategory: true, categories: new Set(['a']) }],
      // un-narrowed: full range
      [
        'Node filters::g::score',
        {
          active: true,
          isCategory: false,
          isInverted: false,
          lowerThreshold: 0,
          upperThreshold: 1,
        },
      ],
    ]);
    const qm = makeDerivingQM(filters, defaults(), 'AND', false);
    qm.updateQueryTextArea();
    const q = qm.cache.query.text.textContent;
    expect(q).toContain('Node filters::g::type IN [a]');
    expect(q).not.toContain('score'); // un-narrowed slider excluded
  });

  it('OR still includes un-narrowed filters (unchanged behavior)', () => {
    const filters = new Map([
      [
        'Node filters::g::type',
        { active: true, isCategory: true, categories: new Set(['a', 'b']) },
      ],
    ]);
    const qm = makeDerivingQM(filters, defaults(), 'OR', false);
    qm.updateQueryTextArea();
    expect(qm.cache.query.text.textContent).toContain('Node filters::g::type IN [a,b]');
  });
});

describe('join mode: strict AND round-trip', () => {
  let qm;
  beforeEach(() => {
    document.body.innerHTML = '';
    qm = makeQM();
  });

  it('keeps the wrapped strict AND query valid through encoding', () => {
    qm.cache.query.overlay.innerHTML = qm.encodeQuery(STRICT_AND_QUERY);
    expect(qm.cache.query.valid).toBe(true);
  });

  it('decodes to an AST that excludes elements missing a same-type filter', () => {
    qm.cache.query.overlay.innerHTML = qm.encodeQuery(STRICT_AND_QUERY);
    const ast = new QueryAST(qm.decodeQuery());

    // node lacks the node property → excluded under strict (kept under non-strict)
    expect(ast.testNode(makeNode({ g: {} }))).toBe(false);
    // node has and matches its property → shown (edge conjunct is foreign→neutral)
    expect(ast.testNode(makeNode({ g: { score: 5 } }))).toBe(true);
    // node has it but out of range → excluded
    expect(ast.testNode(makeNode({ g: { score: 99 } }))).toBe(false);
    // edge has and matches its property → shown
    expect(ast.testEdge(makeEdge({ g: { weight: 0.5 } }))).toBe(true);
    // edge lacks its own property → excluded under strict
    expect(ast.testEdge(makeEdge({ g: {} }))).toBe(false);
  });
});

// A "complete cases" run where the user narrowed filters of ONE element type
// only. The type with nothing narrowed carries no constraint, so it must stay
// fully visible: judging it against the other type's conditions — which it can
// never satisfy — used to wipe it off the canvas entirely.
describe('join mode: strict AND with only one element type narrowed', () => {
  const defaults = () =>
    new Map([
      ['Node filters::g::type', { isCategory: true, categories: new Set(['a', 'b']) }],
      ['Edge filters::g::kind', { isCategory: true, categories: new Set(['x', 'y']) }],
    ]);

  const filters = (nodeCats, edgeCats) =>
    new Map([
      ['Node filters::g::type', { active: true, isCategory: true, categories: new Set(nodeCats) }],
      ['Edge filters::g::kind', { active: true, isCategory: true, categories: new Set(edgeCats) }],
    ]);

  function astFor(nodeCats, edgeCats) {
    const qm = makeDerivingQM(filters(nodeCats, edgeCats), defaults(), 'AND', true);
    qm.cache.uniquePropHierarchy = {
      'Node filters': { g: new Set(['type']) },
      'Edge filters': { g: new Set(['kind']) },
    };
    qm.updateQueryTextArea();
    qm.cache.query.overlay.innerHTML = qm.encodeQuery(qm.cache.query.text.textContent);
    expect(qm.cache.query.valid).toBe(true);
    return new QueryAST(qm.decodeQuery());
  }

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('leaves every edge visible when only a node filter is narrowed', () => {
    const ast = astFor(['a'], ['x', 'y']);
    expect(ast.testNode(makeNode({ g: { type: 'a' } }))).toBe(true);
    expect(ast.testNode(makeNode({ g: { type: 'b' } }))).toBe(false);
    expect(ast.testEdge(makeEdge({ g: { kind: 'x' } }))).toBe(true);
    expect(ast.testEdge(makeEdge({ g: { kind: 'y' } }))).toBe(true);
  });

  it('leaves every node visible when only an edge filter is narrowed', () => {
    const ast = astFor(['a', 'b'], ['x']);
    expect(ast.testNode(makeNode({ g: { type: 'a' } }))).toBe(true);
    expect(ast.testNode(makeNode({ g: { type: 'b' } }))).toBe(true);
    expect(ast.testEdge(makeEdge({ g: { kind: 'x' } }))).toBe(true);
    expect(ast.testEdge(makeEdge({ g: { kind: 'y' } }))).toBe(false);
  });

  it('still excludes a same-type element whose value is absent', () => {
    const ast = astFor(['a'], ['x', 'y']);
    expect(ast.testNode(makeNode({ g: {} }))).toBe(false);
  });
});
