// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  expandNeo4jSelection,
  openNeo4jJoinPopup,
  mergeAndApply,
  seedMergedPositions,
  showExpandChecklist,
  buildExpandPreflight,
  buildExpandFetch,
  buildStitchQuery,
  elementIdsFor,
  SEED_RADIUS,
  SEED_JITTER,
} from '../src/utilities/neo4j_session.js';
import {
  runCypher,
  executeNeo4jImport,
  startNeo4jSession,
  getNeo4jSession,
  clearNeo4jSession,
  refreshNeo4jSessionUI,
  toAppFormat,
  LARGE_RESULT_ROW_THRESHOLD,
  SETTINGS_STORAGE_KEY,
} from '../src/utilities/neo4j_loader.js';

const CONFIG = {
  url: 'http://localhost:7474',
  username: 'neo4j',
  password: 'sup3rsecret',
  database: 'movies',
};

const NO_EXCLUSIONS = { excludedNodeProps: new Set(), excludedEdgeProps: new Set() };

const rawNode = (id, label = 'Person', properties = {}, extra = {}) => ({
  id,
  labels: [label],
  properties,
  ...extra,
});
const rawRel = (id, startNode, endNode, type = 'KNOWS') => ({
  id,
  type,
  startNode,
  endNode,
  properties: {},
});

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function graphResponse(nodes, relationships) {
  return jsonResponse({
    results: [{ data: [{ graph: { nodes, relationships } }] }],
    errors: [],
  });
}

/** Minimal app cache: rendered nodes with app-model positions + ui mocks. */
function makeCache(renderedNodes = [], selectedNodes = []) {
  return {
    selectedNodes,
    graph: {
      getNodeData: vi.fn().mockResolvedValue(renderedNodes),
    },
    ui: {
      showLoading: vi.fn().mockResolvedValue(undefined),
      hideLoading: vi.fn().mockResolvedValue(undefined),
      setDataSourceLabel: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  clearNeo4jSession();
});

describe('runCypher statement passthrough (expand/join contract)', () => {
  it('sends parameters and per-statement resultDataContents verbatim', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ results: [], errors: [] }));
    const statement = {
      statement: 'MATCH (n) WHERE elementId(n) IN $ids RETURN n',
      parameters: { ids: ['4:abc:1'] },
      resultDataContents: ['row'],
    };
    await runCypher(CONFIG, [statement], { fetchImpl });

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ statements: [statement] });
  });
});

describe('expand query builders', () => {
  const ids = ['4:abc:1', '4:abc:2'];

  it('parameterizes ids — never interpolated into the Cypher text', () => {
    for (const built of [buildExpandPreflight(ids), buildExpandFetch(ids, [])]) {
      expect(built.statement).not.toContain('4:abc');
      expect(built.parameters.ids).toEqual(ids);
    }
  });

  it('preflight returns scalar rows grouped by type and leaf label', () => {
    const built = buildExpandPreflight(ids);
    expect(built.resultDataContents).toEqual(['row']);
    expect(built.statement).toContain("coalesce(labels(m)[-1], '')");
    expect(built.statement).toContain('count(*)');
  });

  it('fetch filters by exact (type, label) pairs and returns graph data', () => {
    const built = buildExpandFetch(ids, [
      { relType: 'ACTED_IN', neighborLabel: 'Movie' },
      { relType: 'KNOWS', neighborLabel: '' },
    ]);
    expect(built.resultDataContents).toEqual(['graph']);
    expect(built.statement).toContain("[type(r), coalesce(labels(m)[-1], '')] IN $pairs");
    expect(built.parameters.pairs).toEqual([
      ['ACTED_IN', 'Movie'],
      ['KNOWS', ''],
    ]);
  });
});

describe('buildStitchQuery', () => {
  it('constrains BOTH endpoints to the loaded ids, parameterized, graph format', () => {
    const built = buildStitchQuery(['4:abc:1', '4:abc:2']);
    expect(built.statement).toContain('elementId(n) IN $ids AND elementId(m) IN $ids');
    expect(built.statement).not.toContain('4:abc');
    expect(built.parameters.ids).toEqual(['4:abc:1', '4:abc:2']);
    expect(built.resultDataContents).toEqual(['graph']);
  });

  it('hash-joins on the far endpoint and dedupes directions (supernode regression)', () => {
    // Without USING JOIN the planner checks the far end with a linear list
    // scan per expanded relationship — a 372k-degree hub made a 500-node
    // stitch take minutes. `<=` keeps self-loops while halving the rows.
    const built = buildStitchQuery(['4:abc:1']);
    expect(built.statement).toContain('USING JOIN ON m');
    expect(built.statement).toContain('elementId(n) <= elementId(m)');
  });
});

describe('elementIdsFor', () => {
  it('prefers the raw node elementId and falls back to the app id', () => {
    startNeo4jSession(
      CONFIG,
      [rawNode('1', 'Person', {}, { elementId: '4:abc:1' }), rawNode('2')],
      [],
      NO_EXCLUSIONS,
    );
    expect(elementIdsFor(getNeo4jSession(), ['1', '2'])).toEqual(['4:abc:1', '2']);
  });
});

describe('seedMergedPositions', () => {
  const maxSeedDistance = SEED_RADIUS + 2 * SEED_JITTER;

  it('keeps captured positions for existing nodes', () => {
    const data = { nodes: [{ id: 'a', style: { fill: '#FF0000' } }], edges: [] };
    seedMergedPositions(data, new Map([['a', { x: 10, y: -20 }]]));
    expect(data.nodes[0].style).toEqual({ fill: '#FF0000', x: 10, y: -20 });
  });

  it('seeds new nodes near a positioned neighbor', () => {
    const data = {
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [{ source: 'a', target: 'b' }],
    };
    seedMergedPositions(data, new Map([['a', { x: 100, y: 200 }]]));
    const b = data.nodes[1].style;
    expect(Math.hypot(b.x - 100, b.y - 200)).toBeLessThanOrEqual(maxSeedDistance);
    expect(Math.hypot(b.x - 100, b.y - 200)).toBeGreaterThan(0);
  });

  it('seeds disconnected new nodes at the centroid of the arrangement', () => {
    const data = { nodes: [{ id: 'lonely' }], edges: [] };
    const positions = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 200, y: 100 }],
    ]);
    seedMergedPositions(data, positions);
    const style = data.nodes[0].style;
    expect(Math.hypot(style.x - 100, style.y - 50)).toBeLessThanOrEqual(maxSeedDistance);
  });

  it('leaves the payload untouched when nothing was captured', () => {
    const data = { nodes: [{ id: 'a' }], edges: [] };
    seedMergedPositions(data, new Map());
    expect(data.nodes[0].style).toBeUndefined();
  });
});

describe('mergeAndApply', () => {
  it('captures positions before the union, keeps them, and refreshes overlapping ids', async () => {
    startNeo4jSession(CONFIG, [rawNode('1', 'Person', { name: 'Old' })], [], NO_EXCLUSIONS);
    const cache = makeCache([{ id: '1', style: { x: 42, y: 24 } }]);
    const apply = vi.fn().mockResolvedValue(true);

    const rendered = await mergeAndApply(
      cache,
      [rawNode('1', 'Person', { name: 'Fresh' }), rawNode('2', 'Movie', { title: 'M' })],
      [rawRel('r1', '1', '2', 'ACTED_IN')],
      { apply },
    );

    expect(rendered).toBe(true);
    const data = apply.mock.calls[0][1];
    const node1 = data.nodes.find((n) => n.id === '1');
    // Re-fetched id refreshed stale properties, position survived.
    expect(node1.D4Data['Node filters'].Person.name).toBe('Fresh');
    expect(node1.style.x).toBe(42);
    expect(node1.style.y).toBe(24);
    expect(data.edges).toHaveLength(1);
    // Session accumulator now carries the union for the next merge.
    expect([...getNeo4jSession().rawNodes.keys()].sort()).toEqual(['1', '2']);
  });

  it('declares the current workspace with full positions so no initial layout fires', async () => {
    startNeo4jSession(CONFIG, [rawNode('1')], [rawRel('r1', '1', '2')], NO_EXCLUSIONS);
    const cache = makeCache([{ id: '1', style: { x: 7, y: 8 } }]);
    cache.data = { selectedLayout: 'My view' };
    const apply = vi.fn().mockResolvedValue(true);

    await mergeAndApply(cache, [rawNode('2')], [], { apply });

    const data = apply.mock.calls[0][1];
    // The JSON-import path (fileData.layouts present, positions for every
    // node, no layoutType) skips the Excel path's post-render force pass —
    // regression guard for the visible re-layout jump after a merge.
    expect(data.selectedLayout).toBe('My view');
    const layout = data.layouts['My view'];
    expect(layout.layoutType).toBeUndefined();
    expect(Object.keys(layout.positions).sort()).toEqual(['1', '2']);
    expect(layout.positions['1']).toEqual({ style: { x: 7, y: 8 } });
    expect(Number.isFinite(layout.positions['2'].style.x)).toBe(true);
  });

  it('settles only the new nodes after apply, then persists the positions', async () => {
    startNeo4jSession(CONFIG, [rawNode('1')], [], NO_EXCLUSIONS);
    const cache = makeCache([{ id: '1', style: { x: 0, y: 0 } }]);
    cache.graphData = { order: 2 }; // live graphology stand-in
    cache.lm = { persistNodePositions: vi.fn().mockResolvedValue(undefined) };
    const settle = vi.fn().mockResolvedValue(undefined);

    await mergeAndApply(cache, [rawNode('2')], [], {
      apply: vi.fn().mockResolvedValue(true),
      settle,
    });

    expect(settle).toHaveBeenCalledWith(cache.graphData, ['2']);
    expect(cache.lm.persistNodePositions).toHaveBeenCalledOnce();
  });

  it('skips the settle when the merge brought no new nodes', async () => {
    startNeo4jSession(CONFIG, [rawNode('1')], [], NO_EXCLUSIONS);
    const cache = makeCache([{ id: '1', style: { x: 0, y: 0 } }]);
    cache.graphData = { order: 1 };
    cache.lm = { persistNodePositions: vi.fn() };
    const settle = vi.fn();

    await mergeAndApply(cache, [rawNode('1', 'Person', { name: 'refreshed' })], [], {
      apply: vi.fn().mockResolvedValue(true),
      settle,
    });

    expect(settle).not.toHaveBeenCalled();
    expect(cache.lm.persistNodePositions).not.toHaveBeenCalled();
  });

  it('omits the workspace declaration when nothing was rendered yet', async () => {
    startNeo4jSession(CONFIG, [], [], NO_EXCLUSIONS);
    const cache = makeCache([]);
    const apply = vi.fn().mockResolvedValue(true);

    await mergeAndApply(cache, [rawNode('1')], [], { apply });

    expect(apply.mock.calls[0][1].layouts).toBeUndefined();
  });

  it('re-sets the Neo4j data-source label after apply (applyGraph clobbers it)', async () => {
    startNeo4jSession(CONFIG, [], [], NO_EXCLUSIONS);
    const cache = makeCache();
    await mergeAndApply(cache, [rawNode('1')], [], { apply: vi.fn().mockResolvedValue(true) });
    expect(cache.ui.setDataSourceLabel).toHaveBeenCalledWith('Neo4j: movies');
  });

  it('does not re-label when apply fails', async () => {
    startNeo4jSession(CONFIG, [], [], NO_EXCLUSIONS);
    const cache = makeCache();
    const rendered = await mergeAndApply(cache, [rawNode('1')], [], {
      apply: vi.fn().mockResolvedValue(false),
    });
    expect(rendered).toBe(false);
    expect(cache.ui.setDataSourceLabel).not.toHaveBeenCalled();
  });

  it('keeps colors stable across merges (same category set → same colors)', async () => {
    const initialNodes = [rawNode('1', 'Person'), rawNode('2', 'Movie')];
    const before = toAppFormat(initialNodes, [], NO_EXCLUSIONS);
    const colorBefore = before.nodes.find((n) => n.id === '1').style.fill;

    startNeo4jSession(CONFIG, initialNodes, [], NO_EXCLUSIONS);
    const apply = vi.fn().mockResolvedValue(true);
    await mergeAndApply(makeCache(), [rawNode('3', 'Person')], [], { apply });

    const merged = apply.mock.calls[0][1];
    expect(merged.nodes.find((n) => n.id === '1').style.fill).toBe(colorBefore);
    expect(merged.nodes.find((n) => n.id === '3').style.fill).toBe(colorBefore);
  });

  it('re-applies the import-time property exclusions to merged data', async () => {
    startNeo4jSession(CONFIG, [], [], {
      excludedNodeProps: new Set(['embedding']),
      excludedEdgeProps: new Set(),
    });
    const apply = vi.fn().mockResolvedValue(true);
    await mergeAndApply(
      makeCache(),
      [rawNode('1', 'Person', { name: 'Ada', embedding: [1, 2, 3] })],
      [],
      { apply },
    );
    expect(apply.mock.calls[0][1].nodes[0].D4Data['Node filters'].Person).toEqual({
      name: 'Ada',
    });
  });
});

describe('session lifecycle and UI gating', () => {
  const mountButtons = (labelText) => {
    document.body.innerHTML = `
      <span id="dataSourceLabel">${labelText}</span>
      <button id="neo4jExpandBtn"></button>
      <button id="neo4jJoinBtn"></button>
    `;
  };

  it('shows the buttons while the session is active and the label is Neo4j', () => {
    mountButtons('Neo4j: movies');
    startNeo4jSession(CONFIG, [], [], NO_EXCLUSIONS);
    expect(document.getElementById('neo4jExpandBtn').style.display).toBe('');
    expect(document.getElementById('neo4jJoinBtn').style.display).toBe('');
  });

  it('hides the buttons when another source labels the graph', () => {
    mountButtons('Neo4j: movies');
    startNeo4jSession(CONFIG, [], [], NO_EXCLUSIONS);
    document.getElementById('dataSourceLabel').textContent = 'Live (API)';
    refreshNeo4jSessionUI();
    expect(document.getElementById('neo4jExpandBtn').style.display).toBe('none');
    expect(document.getElementById('neo4jJoinBtn').style.display).toBe('none');
  });

  it('hides the buttons without a session', () => {
    mountButtons('Neo4j: movies');
    refreshNeo4jSessionUI();
    expect(document.getElementById('neo4jExpandBtn').style.display).toBe('none');
  });

  it('executeNeo4jImport starts the session; the password never reaches localStorage', async () => {
    mountButtons('');
    const cache = makeCache();
    cache.ui.setDataSourceLabel = (text) => {
      document.getElementById('dataSourceLabel').textContent = text;
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ results: [{ data: [{ row: [1] }] }], errors: [] }))
      .mockResolvedValueOnce(graphResponse([rawNode('1', 'Person', { name: 'Ada' })], []));

    const rendered = await executeNeo4jImport(
      cache,
      { ...CONFIG, query: 'MATCH (n) RETURN n' },
      {
        fetchImpl,
        checklist: vi.fn().mockResolvedValue(NO_EXCLUSIONS),
        apply: vi.fn().mockResolvedValue(true),
      },
    );

    expect(rendered).toBe(true);
    expect(getNeo4jSession()).not.toBeNull();
    expect(getNeo4jSession().rawNodes.has('1')).toBe(true);
    expect(document.getElementById('neo4jExpandBtn').style.display).toBe('');
    for (const key of Object.keys(localStorage)) {
      expect(localStorage.getItem(key)).not.toContain(CONFIG.password);
    }
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '').not.toContain(CONFIG.password);
  });
});

describe('expandNeo4jSelection', () => {
  const preflightResponse = jsonResponse({
    results: [
      {
        data: [
          { row: ['ACTED_IN', 'Movie', 12] },
          { row: ['KNOWS', 'Person', 3] },
        ],
      },
    ],
    errors: [],
  });

  it('no-ops without a session or without a selection', async () => {
    expect(await expandNeo4jSelection(makeCache([], ['1']))).toBe(false);
    startNeo4jSession(CONFIG, [], [], NO_EXCLUSIONS);
    expect(await expandNeo4jSelection(makeCache([], []))).toBe(false);
  });

  it('preflights, filters by the checked pairs, fetches, and merges', async () => {
    startNeo4jSession(
      CONFIG,
      [rawNode('1', 'Person', {}, { elementId: '4:abc:1' })],
      [],
      NO_EXCLUSIONS,
    );
    const cache = makeCache([{ id: '1', style: { x: 5, y: 5 } }], ['1']);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(preflightResponse)
      .mockResolvedValueOnce(
        graphResponse(
          [rawNode('1', 'Person'), rawNode('9', 'Movie', { title: 'M' })],
          [rawRel('r1', '1', '9', 'ACTED_IN')],
        ),
      );
    const checklist = vi
      .fn()
      .mockImplementation(async (pairs) => ({ pairs: [pairs[0]], stitch: false }));
    const apply = vi.fn().mockResolvedValue(true);

    const rendered = await expandNeo4jSelection(cache, { fetchImpl, checklist, apply });

    expect(rendered).toBe(true);
    expect(checklist).toHaveBeenCalledWith([
      { relType: 'ACTED_IN', neighborLabel: 'Movie', count: 12 },
      { relType: 'KNOWS', neighborLabel: 'Person', count: 3 },
    ]);
    const preflightBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(preflightBody.statements[0].parameters.ids).toEqual(['4:abc:1']);
    const fetchBody = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(fetchBody.statements[0].parameters.pairs).toEqual([['ACTED_IN', 'Movie']]);
    const merged = apply.mock.calls[0][1];
    expect(merged.nodes.map((n) => n.id).sort()).toEqual(['1', '9']);
    // The anchor kept its position; the new node was seeded near it.
    expect(merged.nodes.find((n) => n.id === '1').style.x).toBe(5);
    expect(merged.nodes.find((n) => n.id === '9').style.x).toBeDefined();
  });

  it('informs instead of merging when the selection has no neighbors', async () => {
    startNeo4jSession(CONFIG, [rawNode('1')], [], NO_EXCLUSIONS);
    const cache = makeCache([], ['1']);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ results: [{ data: [] }], errors: [] }));

    expect(await expandNeo4jSelection(cache, { fetchImpl })).toBe(false);
    expect(cache.ui.info).toHaveBeenCalledWith(expect.stringContaining('no neighbors'));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('informs instead of merging when the fetch returns no elements (data changed under us)', async () => {
    startNeo4jSession(CONFIG, [rawNode('1')], [], NO_EXCLUSIONS);
    const cache = makeCache([], ['1']);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(preflightResponse)
      .mockResolvedValueOnce(jsonResponse({ results: [{ data: [] }], errors: [] }));
    const apply = vi.fn();

    const rendered = await expandNeo4jSelection(cache, {
      fetchImpl,
      checklist: vi.fn().mockImplementation(async (pairs) => ({ pairs, stitch: false })),
      apply,
    });

    expect(rendered).toBe(false);
    expect(cache.ui.info).toHaveBeenCalledWith(expect.stringContaining('no graph elements'));
    expect(apply).not.toHaveBeenCalled();
  });

  it('runs the stitch after the fetch when the checklist opted in', async () => {
    startNeo4jSession(
      CONFIG,
      [rawNode('1', 'Person', {}, { elementId: '4:abc:1' })],
      [],
      NO_EXCLUSIONS,
    );
    const cache = makeCache([{ id: '1', style: { x: 0, y: 0 } }], ['1']);
    const stitchRel = rawRel('r9', '9', '1', 'REGULATES');
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(preflightResponse)
      .mockResolvedValueOnce(
        graphResponse([rawNode('9', 'Movie', {}, { elementId: '4:abc:9' })], []),
      )
      .mockResolvedValueOnce(graphResponse([], [stitchRel]));
    const apply = vi.fn().mockResolvedValue(true);

    const rendered = await expandNeo4jSelection(cache, {
      fetchImpl,
      checklist: vi.fn().mockImplementation(async (pairs) => ({ pairs, stitch: true })),
      apply,
    });

    expect(rendered).toBe(true);
    const stitchBody = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(stitchBody.statements[0].statement).toContain('USING JOIN ON m');
    expect(stitchBody.statements[0].parameters.ids.sort()).toEqual(['4:abc:1', '4:abc:9']);
    expect(apply.mock.calls[0][1].edges.map((e) => e.id)).toContain('r9');
  });

  it('aborts silently when the checklist is cancelled', async () => {
    startNeo4jSession(CONFIG, [rawNode('1')], [], NO_EXCLUSIONS);
    const cache = makeCache([], ['1']);
    const fetchImpl = vi.fn().mockResolvedValue(preflightResponse);
    const apply = vi.fn();

    const rendered = await expandNeo4jSelection(cache, {
      fetchImpl,
      checklist: vi.fn().mockResolvedValue(null),
      apply,
    });

    expect(rendered).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // preflight only
  });

  it('surfaces errors and clears the busy overlay', async () => {
    startNeo4jSession(CONFIG, [rawNode('1')], [], NO_EXCLUSIONS);
    const cache = makeCache([], ['1']);
    const rendered = await expandNeo4jSelection(cache, {
      fetchImpl: vi.fn().mockRejectedValue(new Error('boom')),
    });

    expect(rendered).toBe(false);
    expect(cache.ui.error).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(cache.ui.hideLoading).toHaveBeenCalled();
  });
});

describe('showExpandChecklist', () => {
  const pairs = [
    { relType: 'ACTED_IN', neighborLabel: 'Movie', count: 12 },
    { relType: 'KNOWS', neighborLabel: '', count: 3 },
  ];

  it('resolves the checked pairs and stitch flag (all preselected), labels blanks as Node', async () => {
    const promise = showExpandChecklist(pairs);
    const names = [...document.querySelectorAll('.neo4j-prop-name')].map((el) => el.textContent);
    expect(names).toEqual(['ACTED_IN → Movie', 'KNOWS → Node']);

    const boxes = [...document.querySelectorAll('.p-custom input[data-index]')];
    boxes[1].checked = false;
    boxes[1].dispatchEvent(new Event('change', { bubbles: true }));

    const stitchBox = document.querySelector('.p-custom .neo4j-stitch-row input');
    expect(stitchBox.checked).toBe(true);
    stitchBox.checked = false;

    const buttons = [...document.querySelectorAll('.p-custom button')];
    buttons.find((b) => b.textContent === 'Fetch & merge').click();
    expect(await promise).toEqual({ pairs: [pairs[0]], stitch: false });
  });

  it('disables fetch at zero checked and toggle-all restores', async () => {
    const promise = showExpandChecklist(pairs);
    const toggleAll = document.querySelector('.neo4j-props-heading input');
    const fetchBtn = [...document.querySelectorAll('.p-custom button')].find(
      (b) => b.textContent === 'Fetch & merge',
    );

    toggleAll.checked = false;
    toggleAll.dispatchEvent(new Event('change'));
    expect(fetchBtn.disabled).toBe(true);

    toggleAll.checked = true;
    toggleAll.dispatchEvent(new Event('change'));
    expect(fetchBtn.disabled).toBe(false);

    fetchBtn.click();
    expect(await promise).toEqual({ pairs, stitch: true });
  });

  it('warns when the checked counts sum past the row threshold', async () => {
    const bigPairs = [
      { relType: 'A', neighborLabel: 'X', count: LARGE_RESULT_ROW_THRESHOLD },
      { relType: 'B', neighborLabel: 'Y', count: 1 },
    ];
    const promise = showExpandChecklist(bigPairs);
    const warning = document.querySelector('.neo4j-warning');
    expect(warning.hidden).toBe(false);
    expect(warning.textContent).toContain('slow');

    // Unchecking drops the sum back under the threshold.
    const boxes = [...document.querySelectorAll('.p-custom input[data-index]')];
    boxes[0].checked = false;
    boxes[0].dispatchEvent(new Event('change', { bubbles: true }));
    expect(warning.hidden).toBe(true);

    [...document.querySelectorAll('.p-custom button')]
      .find((b) => b.textContent === 'Cancel')
      .click();
    expect(await promise).toBeNull();
  });
});

describe('openNeo4jJoinPopup', () => {
  // The Popup relocates the .p-footer out of the content element, so buttons
  // must be driven through the live document (footer-relocation regression).
  it('resolves false immediately without a session', async () => {
    expect(await openNeo4jJoinPopup(makeCache())).toBe(false);
    expect(document.querySelector('.p-custom')).toBeNull();
  });

  it('requires a query inline and cancels cleanly', async () => {
    startNeo4jSession(CONFIG, [], [], NO_EXCLUSIONS);
    const promise = openNeo4jJoinPopup(makeCache());

    document.getElementById('neo4j-join-fetch-btn').click();
    const errorBox = document.getElementById('neo4j-join-error');
    expect(errorBox.hidden).toBe(false);
    expect(errorBox.textContent).toContain('required');

    document.getElementById('neo4j-join-cancel-btn').click();
    expect(await promise).toBe(false);
  });

  it('counts, confirms above the threshold, and aborts on decline', async () => {
    startNeo4jSession(CONFIG, [], [], NO_EXCLUSIONS);
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [{ data: [{ row: [LARGE_RESULT_ROW_THRESHOLD + 1] }] }],
        errors: [],
      }),
    );
    const confirm = vi.fn().mockResolvedValue(false);
    const promise = openNeo4jJoinPopup(makeCache(), { fetchImpl, confirm });

    document.getElementById('neo4j-join-query').value = 'MATCH (n) RETURN n';
    document.getElementById('neo4j-join-fetch-btn').click();
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(fetchImpl).toHaveBeenCalledTimes(1); // count only

    document.getElementById('neo4j-join-cancel-btn').click();
    expect(await promise).toBe(false);
  });

  it('fetches, merges, and resolves the render result', async () => {
    startNeo4jSession(CONFIG, [rawNode('1', 'Person')], [], NO_EXCLUSIONS);
    const cache = makeCache([{ id: '1', style: { x: 1, y: 2 } }]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ results: [{ data: [{ row: [2] }] }], errors: [] }))
      .mockResolvedValueOnce(graphResponse([rawNode('7', 'Gene', { symbol: 'TP53' })], []));
    const apply = vi.fn().mockResolvedValue(true);
    const promise = openNeo4jJoinPopup(cache, { fetchImpl, apply });

    document.getElementById('neo4j-join-stitch').checked = false; // plain path — stitch has its own tests
    document.getElementById('neo4j-join-query').value = 'MATCH (g:Gene) RETURN g LIMIT 2';
    document.getElementById('neo4j-join-fetch-btn').click();

    expect(await promise).toBe(true);
    const merged = apply.mock.calls[0][1];
    expect(merged.nodes.map((n) => n.id).sort()).toEqual(['1', '7']);
    // Join results may be disconnected — seeded at the centroid, not left bare.
    expect(merged.nodes.find((n) => n.id === '7').style.x).toBeDefined();
    expect(cache.ui.setDataSourceLabel).toHaveBeenCalledWith('Neo4j: movies');
  });

  it('abandons the merge when the popup is dismissed mid-flight', async () => {
    // The × stays live while the fetch runs. Merging after it replaces the
    // user's graph (and resets filters and undo) from a dialog they dismissed.
    startNeo4jSession(CONFIG, [rawNode('1', 'Person')], [], NO_EXCLUSIONS);
    const cache = makeCache([{ id: '1', style: { x: 1, y: 2 } }]);
    let releaseCount;
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseCount = () =>
              resolve(jsonResponse({ results: [{ data: [{ row: [2] }] }], errors: [] }));
          }),
      )
      .mockResolvedValueOnce(graphResponse([rawNode('7', 'Gene')], []));
    const apply = vi.fn().mockResolvedValue(true);
    const promise = openNeo4jJoinPopup(cache, { fetchImpl, apply });

    document.getElementById('neo4j-join-stitch').checked = false; // plain path
    document.getElementById('neo4j-join-query').value = 'MATCH (g:Gene) RETURN g';
    document.getElementById('neo4j-join-fetch-btn').click();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    document.querySelector('.p-icon').click(); // the × the audit found still live
    releaseCount();

    expect(await promise).toBe(false);
    // The promise settles on close, so the abandoned handler still has to be
    // given the chance to do the damage before asserting that it didn't.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(apply).not.toHaveBeenCalled();
    // Bailing before the fetch also spares the doomed second roundtrip.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('shows fetch failures inline and re-enables the buttons', async () => {
    startNeo4jSession(CONFIG, [], [], NO_EXCLUSIONS);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ results: [{ data: [{ row: [1] }] }], errors: [] }))
      .mockRejectedValueOnce(new Error('Neo.ClientError.Statement.SyntaxError: bad'));
    const promise = openNeo4jJoinPopup(makeCache(), { fetchImpl });

    document.getElementById('neo4j-join-query').value = 'MATCH oops';
    const fetchBtn = document.getElementById('neo4j-join-fetch-btn');
    fetchBtn.click();

    await vi.waitFor(() => {
      expect(document.getElementById('neo4j-join-error').hidden).toBe(false);
    });
    expect(document.getElementById('neo4j-join-error').textContent).toContain('SyntaxError');
    expect(fetchBtn.disabled).toBe(false);

    document.getElementById('neo4j-join-cancel-btn').click();
    expect(await promise).toBe(false);
  });

  it('stitches by default: fetches relationships among ALL loaded nodes and merges them', async () => {
    startNeo4jSession(
      CONFIG,
      [rawNode('1', 'Person', {}, { elementId: '4:abc:1' })],
      [],
      NO_EXCLUSIONS,
    );
    const cache = makeCache([{ id: '1', style: { x: 1, y: 2 } }]);
    const stitchRel = rawRel('r9', '1', '7', 'REGULATES');
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ results: [{ data: [{ row: [1] }] }], errors: [] }))
      .mockResolvedValueOnce(graphResponse([rawNode('7', 'Gene', {}, { elementId: '4:abc:7' })], []))
      .mockResolvedValueOnce(graphResponse([], [stitchRel]));
    const apply = vi.fn().mockResolvedValue(true);
    const promise = openNeo4jJoinPopup(cache, { fetchImpl, apply });

    document.getElementById('neo4j-join-query').value = 'MATCH (g:Gene) RETURN g';
    expect(document.getElementById('neo4j-join-stitch').checked).toBe(true);
    document.getElementById('neo4j-join-fetch-btn').click();

    expect(await promise).toBe(true);
    // Third call is the stitch: both accumulated and new element ids, both endpoints constrained.
    const stitchBody = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(stitchBody.statements[0].statement).toContain('elementId(n) IN $ids AND elementId(m) IN $ids');
    expect(stitchBody.statements[0].parameters.ids.sort()).toEqual(['4:abc:1', '4:abc:7']);
    // The stitched relationship made it into the merged payload.
    expect(apply.mock.calls[0][1].edges.map((e) => e.id)).toContain('r9');
  });

  it('skips the stitch roundtrip when the checkbox is unchecked', async () => {
    startNeo4jSession(CONFIG, [], [], NO_EXCLUSIONS);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ results: [{ data: [{ row: [1] }] }], errors: [] }))
      .mockResolvedValueOnce(graphResponse([rawNode('7', 'Gene')], []));
    const apply = vi.fn().mockResolvedValue(true);
    const promise = openNeo4jJoinPopup(makeCache(), { fetchImpl, apply });

    document.getElementById('neo4j-join-stitch').checked = false;
    document.getElementById('neo4j-join-query').value = 'MATCH (g:Gene) RETURN g';
    document.getElementById('neo4j-join-fetch-btn').click();

    expect(await promise).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // count + fetch, no stitch
  });

  it('shows an inline error when the query returns no graph elements', async () => {
    startNeo4jSession(CONFIG, [], [], NO_EXCLUSIONS);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ results: [{ data: [{ row: [0] }] }], errors: [] }))
      .mockResolvedValueOnce(jsonResponse({ results: [{ data: [] }], errors: [] }));
    const promise = openNeo4jJoinPopup(makeCache(), { fetchImpl });

    document.getElementById('neo4j-join-query').value = 'MATCH (n) RETURN count(n)';
    const fetchBtn = document.getElementById('neo4j-join-fetch-btn');
    fetchBtn.click();

    await vi.waitFor(() => {
      expect(document.getElementById('neo4j-join-error').hidden).toBe(false);
    });
    expect(document.getElementById('neo4j-join-error').textContent).toContain(
      'no graph elements',
    );
    expect(fetchBtn.disabled).toBe(false); // busy state cleared, popup still open

    document.getElementById('neo4j-join-cancel-btn').click();
    expect(await promise).toBe(false);
  });
});
