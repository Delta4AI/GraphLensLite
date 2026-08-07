// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  executeNeo4jImport,
  buildConnectionForm,
  openNeo4jPopup,
  runCypher,
  countQueryRows,
  connectionHint,
  collectGraph,
  collectPropertyKeys,
  toAppFormat,
  coerceValue,
  categoryColor,
  edgeCategoryColor,
  buildCategoryColors,
  primaryLabel,
  buildTxUrl,
  basicAuth,
  nodeDisplayLabel,
  readSavedSettings,
  saveSettings,
  showPropertyChecklist,
  DEFAULT_DATABASE,
  DEMO_SETTINGS,
  LARGE_ARRAY_THRESHOLD,
  SETTINGS_STORAGE_KEY,
  LARGE_RESULT_ROW_THRESHOLD,
} from '../src/utilities/neo4j_loader.js';
import { StaticUtilities } from '../src/utilities/static.js';
const sanitizeForAST = StaticUtilities.sanitizeForAST;

const CONFIG = {
  url: 'http://localhost:7474',
  username: 'neo4j',
  password: 'secret',
  database: 'movies',
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('buildTxUrl', () => {
  it('builds the tx/commit endpoint', () => {
    expect(buildTxUrl('http://localhost:7474', 'movies')).toBe(
      'http://localhost:7474/db/movies/tx/commit',
    );
  });

  it('strips trailing slashes and defaults the database', () => {
    expect(buildTxUrl('https://graph.example.com/', '')).toBe(
      `https://graph.example.com/db/${DEFAULT_DATABASE}/tx/commit`,
    );
  });

  it('throws on a malformed URL', () => {
    expect(() => buildTxUrl('not a url', 'neo4j')).toThrow();
  });
});

describe('basicAuth', () => {
  it('encodes user:password as Basic auth', () => {
    expect(basicAuth('neo4j', 'secret')).toBe('Basic ' + btoa('neo4j:secret'));
  });

  it('handles non-ASCII credentials', () => {
    expect(() => basicAuth('neo4j', 'pässwörd')).not.toThrow();
  });
});

describe('runCypher', () => {
  it('POSTs statements with auth and returns results', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ results: [{ data: [] }], errors: [] }));
    const results = await runCypher(CONFIG, [{ statement: 'RETURN 1' }], { fetchImpl });

    expect(results).toEqual([{ data: [] }]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:7474/db/movies/tx/commit');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Basic ' + btoa('neo4j:secret'));
    expect(JSON.parse(init.body)).toEqual({ statements: [{ statement: 'RETURN 1' }] });
  });

  it('throws a friendly error on 401', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    await expect(runCypher(CONFIG, [], { fetchImpl })).rejects.toThrow(/Authentication failed/);
  });

  it('throws on non-2xx status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 503));
    await expect(runCypher(CONFIG, [], { fetchImpl })).rejects.toThrow(/HTTP 503/);
  });

  it('surfaces Cypher errors from the payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [],
        errors: [{ code: 'Neo.ClientError.Statement.SyntaxError', message: 'bad query' }],
      }),
    );
    // The message, not the driver constant — the code travels as data.
    await expect(runCypher(CONFIG, [], { fetchImpl })).rejects.toThrow(/^bad query$/);
    await runCypher(CONFIG, [], { fetchImpl }).catch((err) => {
      expect(err.neo4jCode).toBe('Neo.ClientError.Statement.SyntaxError');
    });
  });

  it('logs each executed statement to the status log, collapsed and truncated', async () => {
    const logMessage = vi.fn();
    globalThis.cache = { ui: { logMessage } };
    try {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ results: [], errors: [] }));
      const long = 'MATCH (n)\n  WHERE n.name = "' + 'x'.repeat(200) + '" RETURN n';
      await runCypher(CONFIG, [{ statement: 'RETURN 1' }, { statement: long }], { fetchImpl });

      expect(logMessage).toHaveBeenCalledTimes(2);
      expect(logMessage.mock.calls[0][0]).toBe('RETURN 1');
      const truncated = logMessage.mock.calls[1][0];
      expect(truncated).toHaveLength(161); // 160 chars + ellipsis
      expect(truncated.endsWith('…')).toBe(true);
      expect(truncated).not.toContain('\n');
    } finally {
      delete globalThis.cache;
    }
  });
});

describe('countQueryRows', () => {
  it('wraps the query in a CALL subquery and reads the count', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ results: [{ data: [{ row: [42] }] }], errors: [] }));
    const count = await countQueryRows(CONFIG, 'MATCH (n) RETURN n', { fetchImpl });

    expect(count).toBe(42);
    const statement = JSON.parse(fetchImpl.mock.calls[0][1].body).statements[0].statement;
    // Newline-delimited so a trailing // comment cannot swallow the wrapper,
    // and capped one row past the threshold — counting the whole result set
    // is what made every import and join cost two full executions.
    expect(statement).toBe(
      'CALL {\nMATCH (n) RETURN n\n}\nWITH * LIMIT 2001\nRETURN count(*) AS rowCount',
    );
  });

  it('answers from a trailing LIMIT instead of running the query twice', async () => {
    const fetchImpl = vi.fn();
    expect(await countQueryRows(CONFIG, 'MATCH (n) RETURN n LIMIT 500', { fetchImpl })).toBe(500);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('still counts when the trailing LIMIT is above the threshold', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ results: [{ data: [{ row: [2001] }] }], errors: [] }));
    expect(await countQueryRows(CONFIG, 'MATCH (n) RETURN n LIMIT 999999', { fetchImpl })).toBe(2001);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('strips a trailing semicolon the wrapper cannot take', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ results: [{ data: [{ row: [1] }] }], errors: [] }));
    await countQueryRows(CONFIG, 'MATCH (n) RETURN n;', { fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).statements[0].statement).toContain(
      'CALL {\nMATCH (n) RETURN n\n}',
    );
  });

  it('skips procedure calls, which can write without a write clause', async () => {
    const fetchImpl = vi.fn();
    for (const query of [
      'CALL apoc.refactor.mergeNodes([n])',
      "LOAD CSV FROM 'file:///x.csv' AS row RETURN row",
    ]) {
      expect(await countQueryRows(CONFIG, query, { fetchImpl })).toBeNull();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('gives up rather than killing the import when the count times out', async () => {
    // The fetch has ten times the count's budget, so a query too slow to
    // count may still be well within reach of the query the user asked for.
    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    const fetchImpl = vi.fn().mockRejectedValue(timeout);

    expect(await countQueryRows(CONFIG, 'MATCH (n) RETURN n', { fetchImpl })).toBeNull();
  });

  it('returns null when the CALL wrapper cannot take the query shape', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [],
        errors: [{ code: 'Neo.ClientError.Statement.SyntaxError', message: 'nope' }],
      }),
    );
    expect(await countQueryRows(CONFIG, 'MATCH (n) RETURN n', { fetchImpl })).toBeNull();
  });

  it('lets a bad password or a dead server through instead of swallowing it', async () => {
    // Swallowed, these cost a second doomed roundtrip and delayed the real
    // message by up to COUNT_TIMEOUT_MS.
    const unauthorized = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    await expect(countQueryRows(CONFIG, 'MATCH (n) RETURN n', { fetchImpl: unauthorized })).rejects.toThrow(
      /Authentication failed/,
    );

    const dead = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(countQueryRows(CONFIG, 'MATCH (n) RETURN n', { fetchImpl: dead })).rejects.toThrow(
      TypeError,
    );
  });

  it('never runs the preflight for write-shaped queries (it would write twice)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ results: [{ data: [{ row: [1] }] }], errors: [] }));
    const writes = [
      'CREATE (n:Person {name: "x"}) RETURN n',
      'MATCH (n) SET n.seen = true RETURN n',
      'MERGE (n:Tag {id: 1}) RETURN n',
      'MATCH (n) DETACH DELETE n',
      'MATCH (n) REMOVE n.tmp RETURN n',
      'match (n) create (n)-[:R]->(n) return n',
      'FOREACH (x IN [1] | CREATE (:N))',
    ];
    for (const query of writes) {
      expect(await countQueryRows(CONFIG, query, { fetchImpl })).toBeNull();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('collectGraph', () => {
  it('deduplicates nodes and relationships across rows', () => {
    const node = (id) => ({ id, labels: ['Person'], properties: {} });
    const rel = (id) => ({ id, type: 'KNOWS', startNode: '1', endNode: '2', properties: {} });
    const results = [
      {
        data: [
          { graph: { nodes: [node('1'), node('2')], relationships: [rel('r1')] } },
          { graph: { nodes: [node('1'), node('3')], relationships: [rel('r1')] } },
        ],
      },
    ];

    const { nodes, relationships } = collectGraph(results);
    expect(nodes.map((n) => n.id).sort()).toEqual(['1', '2', '3']);
    expect(relationships).toHaveLength(1);
  });

  it('tolerates rows without graph data', () => {
    const { nodes, relationships } = collectGraph([{ data: [{ row: [1] }] }, {}]);
    expect(nodes).toEqual([]);
    expect(relationships).toEqual([]);
  });
});

describe('coerceValue', () => {
  it('passes numbers through and sanitizes strings', () => {
    expect(coerceValue(3.5)).toBe(3.5);
    expect(coerceValue('plain')).toBe('plain');
    expect(coerceValue('a:b')).toBe('a-b');
  });

  it('maps booleans to categorical strings so filters can match them', () => {
    // Raw booleans would become numeric [1,1] sliders whose BETWEEN condition
    // never validates (query AST requires typeof number) — under an OR join
    // that hides every element carrying the property.
    expect(coerceValue(true)).toBe('true');
    expect(coerceValue(false)).toBe('false');
  });

  it('drops null and undefined', () => {
    expect(coerceValue(null)).toBeUndefined();
    expect(coerceValue(undefined)).toBeUndefined();
  });

  it('joins primitive arrays with pipes for multi-value categoricals', () => {
    expect(coerceValue(['a', 'b'])).toBe('a | b');
    expect(coerceValue([1, 2])).toBe('1 | 2');
  });

  it('stringifies nested structures', () => {
    expect(coerceValue({ lat: 1 })).toBe(sanitizeForAST(JSON.stringify({ lat: 1 })));
    expect(coerceValue([{ a: 1 }])).toBe(sanitizeForAST(JSON.stringify([{ a: 1 }])));
  });
});

describe('collectPropertyKeys', () => {
  it('unions keys per kind with types, examples, and large-array flags', () => {
    const nodes = [
      { properties: { name: 'A', embedding: Array(LARGE_ARRAY_THRESHOLD + 1).fill(0) } },
      { properties: { name: 'B', age: 3 } },
    ];
    const rels = [{ properties: { weight: 1 } }];

    const keys = collectPropertyKeys(nodes, rels);
    expect(keys).toEqual([
      { kind: 'node', key: 'age', type: 'number', examples: ['3'], largeArray: false },
      {
        kind: 'node',
        key: 'embedding',
        type: 'list',
        examples: [expect.any(String)],
        largeArray: true,
      },
      { kind: 'node', key: 'name', type: 'text', examples: ['A', 'B'], largeArray: false },
      { kind: 'edge', key: 'weight', type: 'number', examples: ['1'], largeArray: false },
    ]);
  });

  it('marks inconsistent value types as mixed and truncates long examples', () => {
    const nodes = [
      { properties: { p: 'text value' } },
      { properties: { p: 42 } },
      { properties: { q: 'x'.repeat(100) } },
    ];
    const keys = collectPropertyKeys(nodes, []);
    const p = keys.find((k) => k.key === 'p');
    const q = keys.find((k) => k.key === 'q');
    expect(p.type).toBe('mixed');
    expect(q.examples[0].length).toBeLessThanOrEqual(40);
    expect(q.examples[0].endsWith('…')).toBe(true);
  });

  it('skips null-valued occurrences', () => {
    const keys = collectPropertyKeys([{ properties: { p: null } }], []);
    expect(keys).toEqual([]);
  });
});

describe('category colors', () => {
  it('uses the brand palette first, then generated hues, deterministically', () => {
    expect(categoryColor(0)).toBe('#C33D35'); // SLICE_PALETTE[0]
    // Generated hues come from config's shared hslToHex, which writes lowercase
    // — the palette entries stay as authored. Case is meaningless to every
    // consumer (CSS, canvas, and <input type=color> lowercases anyway).
    expect(categoryColor(7)).toMatch(/^#[0-9a-f]{6}$/);
    expect(categoryColor(7)).toBe(categoryColor(7));
    expect(categoryColor(7)).not.toBe(categoryColor(8));
  });

  it('returns null for fewer than two categories', () => {
    expect(buildCategoryColors(['A', 'A'])).toBeNull();
    expect(buildCategoryColors([])).toBeNull();
  });

  it('assigns colors by sorted category order', () => {
    const colors = buildCategoryColors(['B', 'A', 'B']);
    expect(colors.get('A')).toBe(categoryColor(0));
    expect(colors.get('B')).toBe(categoryColor(1));
  });
});

describe('primaryLabel', () => {
  it('uses the last label — leaf class of a stored hierarchy', () => {
    expect(primaryLabel({ labels: ['Entity', 'AddOnCat', 'Cell'] })).toBe('Cell');
    expect(primaryLabel({ labels: ['Person'] })).toBe('Person');
    expect(primaryLabel({ labels: [] })).toBe('Node');
  });
});

describe('nodeDisplayLabel', () => {
  it('prefers name, then title, then label, then id property', () => {
    expect(nodeDisplayLabel({ id: '1', properties: { name: 'Ada', title: 'x' } })).toBe('Ada');
    expect(nodeDisplayLabel({ id: '1', properties: { title: 'Matrix' } })).toBe('Matrix');
    expect(nodeDisplayLabel({ id: '1', properties: { id: 'P42' } })).toBe('P42');
  });

  it('falls back to label + internal id', () => {
    expect(nodeDisplayLabel({ id: '7', labels: ['Person'], properties: {} })).toBe('Person 7');
    expect(nodeDisplayLabel({ id: '7', labels: [], properties: {} })).toBe('Node 7');
  });
});

describe('toAppFormat', () => {
  const nodes = [
    {
      id: '1',
      labels: ['Person', 'Actor'],
      properties: { name: 'Keanu', born: 1964, ignored: 'x' },
    },
    { id: '2', labels: ['Movie'], properties: { title: 'The Matrix' } },
  ];
  const relationships = [
    { id: 'r1', type: 'ACTED_IN', startNode: '1', endNode: '2', properties: { roles: ['Neo'] } },
  ];

  it('maps nodes and relationships into the native payload (last label = primary)', () => {
    const data = toAppFormat(nodes, relationships);

    expect(data.nodes[0]).toEqual({
      id: '1',
      label: 'Keanu',
      style: { fill: expect.stringMatching(/^#[0-9A-Fa-f]{6}$/) },
      D4Data: {
        'Node filters': {
          Actor: { name: 'Keanu', born: 1964, ignored: 'x' },
        },
      },
    });
    expect(data.edges[0]).toEqual({
      id: 'r1',
      source: '1',
      target: '2',
      label: 'ACTED_IN',
      D4Data: {
        'Edge filters': {
          ACTED_IN: { roles: 'Neo' },
        },
      },
    });
  });

  it('auto-colors nodes per primary label when there are at least two', () => {
    const data = toAppFormat(nodes, relationships);
    expect(data.nodes[0].style.fill).not.toBe(data.nodes[1].style.fill);
  });

  it('keeps default styling for a single node label / edge type', () => {
    const single = toAppFormat(
      [{ id: '1', labels: ['A'], properties: {} }, { id: '2', labels: ['A'], properties: {} }],
      [{ id: 'r', type: 'REL', startNode: '1', endNode: '2', properties: {} }],
    );
    expect(single.nodes[0].style).toBeUndefined();
    expect(single.edges[0].style).toBeUndefined();
  });

  it('auto-colors edges per type with translucency', () => {
    const data = toAppFormat(
      [{ id: '1', labels: ['A'], properties: {} }],
      [
        { id: 'r1', type: 'REL_A', startNode: '1', endNode: '1', properties: {} },
        { id: 'r2', type: 'REL_B', startNode: '1', endNode: '1', properties: {} },
      ],
    );
    expect(data.edges[0].style.stroke).toMatch(/^#[0-9A-Fa-f]{6}90$/);
    expect(data.edges[0].style.stroke).not.toBe(data.edges[1].style.stroke);
    expect(data.edges[0].style.stroke).toBe(`${edgeCategoryColor(0)}90`);
  });

  it('keeps edge auto-colors legible on light backgrounds (mid HSL lightness)', () => {
    for (let i = 0; i < 8; i++) {
      const hex = edgeCategoryColor(i);
      const [r, g, b] = [1, 3, 5].map((o) => parseInt(hex.slice(o, o + 2), 16) / 255);
      const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
      expect(lightness).toBeGreaterThan(0.3);
      expect(lightness).toBeLessThan(0.6);
    }
  });

  it('builds deduplicated headers without synthetic type properties', () => {
    const twoActors = [
      ...nodes,
      { id: '3', labels: ['Actor'], properties: { name: 'Carrie' } },
    ];
    const data = toAppFormat(twoActors, relationships);
    expect(data.nodeDataHeaders).toContainEqual({ subGroup: 'Actor', key: 'name' });
    expect(data.nodeDataHeaders).toContainEqual({ subGroup: 'Movie', key: 'title' });
    expect(data.nodeDataHeaders.filter((h) => h.key === 'name')).toHaveLength(1);
    expect(data.nodeDataHeaders.filter((h) => h.subGroup === 'Neo4j')).toHaveLength(0);
    expect(data.edgeDataHeaders.filter((h) => h.subGroup === 'Neo4j')).toHaveLength(0);
  });

  it('honors property exclusions per kind', () => {
    const data = toAppFormat(nodes, relationships, {
      excludedNodeProps: new Set(['ignored']),
      excludedEdgeProps: new Set(['roles']),
    });

    expect(data.nodes[0].D4Data['Node filters'].Actor).toEqual({ name: 'Keanu', born: 1964 });
    expect(data.edges[0].D4Data['Edge filters'].ACTED_IN).toEqual({});
    expect(data.nodeDataHeaders).not.toContainEqual({ subGroup: 'Actor', key: 'ignored' });
  });

  it('skips null-valued properties so IS MISSING works', () => {
    const data = toAppFormat([{ id: '1', labels: ['A'], properties: { p: null } }], []);
    expect(data.nodes[0].D4Data['Node filters'].A).toEqual({});
  });
});

describe('settings persistence', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips everything except the password', () => {
    saveSettings({ ...CONFIG, password: 'secret', query: 'MATCH (n) RETURN n' });
    const saved = readSavedSettings();
    expect(saved).toEqual({
      url: CONFIG.url,
      username: CONFIG.username,
      database: CONFIG.database,
      query: 'MATCH (n) RETURN n',
    });
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).not.toContain('secret');
  });

  it('returns an empty object on corrupt storage', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{nope');
    expect(readSavedSettings()).toEqual({});
  });
});

describe('executeNeo4jImport', () => {
  const graphResults = {
    results: [
      {
        data: [
          {
            graph: {
              nodes: [{ id: '1', labels: ['Person'], properties: { name: 'Ada' } }],
              relationships: [],
            },
          },
        ],
      },
    ],
    errors: [],
  };

  const makeUiCache = () => ({
    ui: {
      showLoading: vi.fn().mockResolvedValue(undefined),
      hideLoading: vi.fn().mockResolvedValue(undefined),
      error: vi.fn(),
      setDataSourceLabel: vi.fn(),
    },
  });

  const importConfig = { ...CONFIG, query: 'MATCH (n) RETURN n' };

  it('counts, fetches, applies exclusions, renders, and sets the source label', async () => {
    const cache = makeUiCache();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ results: [{ data: [{ row: [1] }] }], errors: [] }))
      .mockResolvedValueOnce(jsonResponse(graphResults));
    const checklist = vi
      .fn()
      .mockResolvedValue({ excludedNodeProps: new Set(), excludedEdgeProps: new Set() });
    const apply = vi.fn().mockResolvedValue(true);

    const rendered = await executeNeo4jImport(cache, importConfig, {
      fetchImpl,
      checklist,
      apply,
    });

    expect(rendered).toBe(true);
    expect(apply).toHaveBeenCalledWith(
      cache,
      expect.objectContaining({ nodes: [expect.objectContaining({ id: '1', label: 'Ada' })] }),
    );
    // Second argument is the machine-readable source: the expand/join buttons
    // key off that, not off the words, so the label can be reworded freely.
    expect(cache.ui.setDataSourceLabel).toHaveBeenCalledWith('Neo4j: movies', 'neo4j');
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).statements[0].resultDataContents).toEqual([
      'graph',
    ]);
  });

  it('asks for confirmation above the row threshold and aborts on decline', async () => {
    const cache = makeUiCache();
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [{ data: [{ row: [LARGE_RESULT_ROW_THRESHOLD + 1] }] }],
        errors: [],
      }),
    );
    const confirm = vi.fn().mockResolvedValue(false);

    const rendered = await executeNeo4jImport(cache, importConfig, { fetchImpl, confirm });

    expect(confirm).toHaveBeenCalledOnce();
    expect(rendered).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // count only, no data fetch
  });

  it('errors when the query returns no graph elements', async () => {
    const cache = makeUiCache();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ results: [{ data: [{ row: [0] }] }], errors: [] }))
      .mockResolvedValueOnce(jsonResponse({ results: [{ data: [] }], errors: [] }));

    const rendered = await executeNeo4jImport(cache, importConfig, { fetchImpl });

    expect(rendered).toBe(false);
    expect(cache.ui.error).toHaveBeenCalledWith(expect.stringContaining('no graph elements'));
  });

  it('aborts without rendering when the checklist is cancelled', async () => {
    const cache = makeUiCache();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ results: [{ data: [{ row: [1] }] }], errors: [] }))
      .mockResolvedValueOnce(jsonResponse(graphResults));
    const apply = vi.fn();

    const rendered = await executeNeo4jImport(cache, importConfig, {
      fetchImpl,
      checklist: vi.fn().mockResolvedValue(null),
      apply,
    });

    expect(rendered).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it('surfaces fetch failures as a friendly connectivity error', async () => {
    const cache = makeUiCache();
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const rendered = await executeNeo4jImport(cache, importConfig, { fetchImpl });

    expect(rendered).toBe(false);
    expect(cache.ui.error).toHaveBeenCalledWith(expect.stringContaining('Could not reach'));
  });

  it('drives injected progress/onFetched hooks in order', async () => {
    const cache = makeUiCache();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ results: [{ data: [{ row: [1] }] }], errors: [] }))
      .mockResolvedValueOnce(jsonResponse(graphResults));
    const calls = [];
    const rendered = await executeNeo4jImport(cache, importConfig, {
      fetchImpl,
      progress: (message) => calls.push(['progress', message]),
      onFetched: () => calls.push(['fetched']),
      checklist: vi.fn().mockImplementation(() => {
        calls.push(['checklist']);
        return Promise.resolve({ excludedNodeProps: new Set(), excludedEdgeProps: new Set() });
      }),
      apply: vi.fn().mockResolvedValue(true),
    });

    expect(rendered).toBe(true);
    expect(calls).toEqual([
      ['progress', 'Counting matching rows …'],
      ['progress', null],
      ['progress', 'Fetching graph data …'],
      ['progress', null],
      // The checklist comes first now: the connection popup (and the typed
      // password) has to survive a cancelled checklist.
      ['checklist'],
      ['fetched'],
    ]);
    // Injected progress used — the global overlay stays untouched.
    expect(cache.ui.showLoading).not.toHaveBeenCalled();
  });

  it('routes errors to the injected onError handler', async () => {
    const cache = makeUiCache();
    const onError = vi.fn();
    const rendered = await executeNeo4jImport(cache, importConfig, {
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
      onError,
    });
    expect(rendered).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Could not reach'));
    expect(cache.ui.error).not.toHaveBeenCalled();
  });

  it('reports Cypher errors from the data fetch', async () => {
    const cache = makeUiCache();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ results: [{ data: [{ row: [1] }] }], errors: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ results: [], errors: [{ code: 'Neo.X', message: 'nope' }] }),
      );

    const rendered = await executeNeo4jImport(cache, importConfig, { fetchImpl });

    expect(rendered).toBe(false);
    // The server's sentence, not its error constant.
    expect(cache.ui.error).toHaveBeenCalledWith(expect.stringContaining('nope'));
    expect(cache.ui.error.mock.calls[0][0]).not.toContain('Neo.X');
  });
});

describe('buildConnectionForm', () => {
  it('prefills saved settings without interpolating them into markup', () => {
    const form = buildConnectionForm({
      url: 'http://db:7474',
      username: '<img src=x onerror=alert(1)>',
      database: 'movies',
      query: 'MATCH (n) RETURN n LIMIT 5',
    });

    expect(form.querySelector('#neo4j-url').value).toBe('http://db:7474');
    expect(form.querySelector('#neo4j-username').value).toBe('<img src=x onerror=alert(1)>');
    expect(form.querySelector('#neo4j-database').value).toBe('movies');
    expect(form.querySelector('#neo4j-query').value).toBe('MATCH (n) RETURN n LIMIT 5');
    expect(form.querySelector('img')).toBeNull();
    expect(form.querySelector('#neo4j-password').value).toBe('');
  });

  it('fills the public demo settings when the demo link is clicked', () => {
    const form = buildConnectionForm({ url: 'http://db:7474', username: 'me' });

    form.querySelector('#neo4j-demo-link').click();

    expect(form.querySelector('#neo4j-url').value).toBe(DEMO_SETTINGS.url);
    expect(form.querySelector('#neo4j-username').value).toBe(DEMO_SETTINGS.username);
    expect(form.querySelector('#neo4j-password').value).toBe(DEMO_SETTINGS.password);
    expect(form.querySelector('#neo4j-database').value).toBe(DEMO_SETTINGS.database);
    expect(form.querySelector('#neo4j-query').value).toBe(DEMO_SETTINGS.query);
  });
});

describe('openNeo4jPopup', () => {
  // The Popup relocates the .p-footer out of the content element, so these
  // tests must drive the buttons through the live document, exactly like a
  // user click — regression coverage for the wiring breaking silently.
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('wires the Fetch button after Popup construction (footer is relocated)', async () => {
    const promise = openNeo4jPopup({ ui: {} });

    const loadBtn = document.getElementById('neo4j-load-btn');
    expect(loadBtn).not.toBeNull();
    loadBtn.click(); // empty form → inline validation error, popup stays open
    const errorBox = document.getElementById('neo4j-error');
    expect(errorBox.hidden).toBe(false);
    expect(errorBox.textContent).toBe('Server URL and Cypher query are required.');

    document.getElementById('neo4j-cancel-btn').click();
    expect(await promise).toBe(false);
  });

  it('rejects an invalid URL inline without closing the popup', async () => {
    const promise = openNeo4jPopup({ ui: {} });

    document.getElementById('neo4j-url').value = 'not a url';
    document.getElementById('neo4j-load-btn').click();
    const errorBox = document.getElementById('neo4j-error');
    expect(errorBox.hidden).toBe(false);
    expect(errorBox.textContent).toBe('Invalid server URL: not a url');

    document.getElementById('neo4j-cancel-btn').click();
    expect(await promise).toBe(false);
  });

  it('rejects a scheme-less URL, which URL() would wave through', async () => {
    // "localhost:7474" parses as scheme "localhost:", so the only thing that
    // caught it before was a generic network error minutes later.
    const promise = openNeo4jPopup({ ui: {} });

    document.getElementById('neo4j-url').value = 'localhost:7474';
    document.getElementById('neo4j-load-btn').click();
    const errorBox = document.getElementById('neo4j-error');
    expect(errorBox.hidden).toBe(false);
    expect(errorBox.textContent).toContain('http://');

    document.getElementById('neo4j-cancel-btn').click();
    expect(await promise).toBe(false);
  });

  it('submits on Enter from the single-line fields', async () => {
    const promise = openNeo4jPopup({ ui: {} });

    const url = document.getElementById('neo4j-url');
    url.value = 'not a url';
    url.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    // Reaching validation at all proves the submit ran.
    expect(document.getElementById('neo4j-error').textContent).toBe('Invalid server URL: not a url');

    document.getElementById('neo4j-cancel-btn').click();
    expect(await promise).toBe(false);
  });

  it('warns that importing replaces the graph, only when one is loaded', async () => {
    const fresh = openNeo4jPopup({ ui: {} });
    expect(document.getElementById('neo4j-replace-note').hidden).toBe(true);
    document.getElementById('neo4j-cancel-btn').click();
    await fresh;

    const loaded = openNeo4jPopup({ ui: {}, initialized: true });
    expect(document.getElementById('neo4j-replace-note').hidden).toBe(false);
    document.getElementById('neo4j-cancel-btn').click();
    await loaded;
  });

  it('keeps the form (and the typed password) when the checklist is cancelled', async () => {
    // The popup used to close as soon as data arrived, so cancelling the
    // property checklist meant retyping the password to try again.
    // The prefilled query carries its own LIMIT, so the count preflight is
    // skipped and the graph fetch is the only roundtrip.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          results: [
            {
              data: [
                {
                  graph: {
                    nodes: [{ id: '1', labels: ['Person'], properties: { name: 'Ada' } }],
                    relationships: [],
                  },
                },
              ],
            },
          ],
          errors: [],
        }),
      ),
    );
    try {
      openNeo4jPopup({ ui: {} });
      document.getElementById('neo4j-url').value = 'http://localhost:7474';
      document.getElementById('neo4j-password').value = 'sup3rsecret';
      document.getElementById('neo4j-load-btn').click();

      // The property checklist opens on top; the connection form is still there.
      await vi.waitFor(() => {
        expect(document.body.textContent).toContain('Select the properties to import');
      });
      expect(document.getElementById('neo4j-password').value).toBe('sup3rsecret');

      // Two popups are open, so scope to the topmost — the first Cancel in
      // document order belongs to the connection form underneath.
      const checklist = [...document.querySelectorAll('.p-custom')].at(-1);
      [...checklist.querySelectorAll('button')].find((b) => b.textContent === 'Cancel').click();

      await vi.waitFor(() => {
        expect(document.getElementById('neo4j-load-btn').disabled).toBe(false);
      });
      expect(document.getElementById('neo4j-password').value).toBe('sup3rsecret');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps Cancel live while busy and aborts the in-flight request', async () => {
    // Before: both buttons went dead while the query ran and nothing aborted,
    // so dismissing left a zombie flow that popped a property checklist over
    // whatever the user did next.
    let signal = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (url, init) =>
          new Promise((_resolve, reject) => {
            signal = init.signal;
            const fail = () => reject(new DOMException('aborted', 'AbortError'));
            if (init.signal.aborted) fail();
            else init.signal.addEventListener('abort', fail);
          }),
      ),
    );
    try {
      const promise = openNeo4jPopup({ ui: {} });
      document.getElementById('neo4j-url').value = 'http://localhost:7474';
      document.getElementById('neo4j-load-btn').click();
      await vi.waitFor(() => expect(signal).not.toBeNull());

      const cancelBtn = document.getElementById('neo4j-cancel-btn');
      expect(cancelBtn.disabled).toBe(false);
      cancelBtn.click();

      expect(signal.aborted).toBe(true);
      expect(await promise).toBe(false);
      // Give the abandoned flow its chance to reach the checklist anyway.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(document.body.textContent).not.toContain('Select the properties to import');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the submit dead while the size confirm is up', async () => {
    // busy(null) after the count used to re-enable Fetch while the size confirm
    // and the property checklist were still open — and nested popups share a
    // z-index with no focus trap, so a second concurrent fetch was one click
    // away.
    let disabledDuringConfirm = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ results: [{ data: [{ row: [LARGE_RESULT_ROW_THRESHOLD + 1] }] }], errors: [] }),
      ),
    );
    try {
      const promise = openNeo4jPopup({ ui: {} });
      document.getElementById('neo4j-url').value = 'http://localhost:7474';
      // No trailing LIMIT, or the preflight answers from the query itself.
      document.getElementById('neo4j-query').value = 'MATCH (n)-[r]->(m) RETURN n, r, m';
      document.getElementById('neo4j-load-btn').click();

      // The size confirm is a second Popup; its buttons are the ones without an id.
      const confirmButton = (label) =>
        [...document.querySelectorAll('.p-button')].find(
          (b) => !b.id && b.textContent === label,
        );
      await vi.waitFor(() => expect(confirmButton('OK')).toBeTruthy());
      disabledDuringConfirm = document.getElementById('neo4j-load-btn').disabled;
      expect(disabledDuringConfirm).toBe(true);

      confirmButton('Cancel').click(); // decline the size warning
      await vi.waitFor(() => expect(document.getElementById('neo4j-load-btn').disabled).toBe(false));

      document.getElementById('neo4j-cancel-btn').click();
      expect(await promise).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('offers to forget a remembered connection, and only then', async () => {
    // The saved query often carries literal identifiers from the user's data
    // and persisted indefinitely with no UI to clear it.
    openNeo4jPopup({ ui: {} });
    expect(document.getElementById('neo4j-forget-btn').hidden).toBe(true);

    saveSettings({ ...CONFIG, query: 'MATCH (p:Patient {mrn: "12345"}) RETURN p' });
    document.body.innerHTML = '';
    openNeo4jPopup({ ui: {} });

    const forget = document.getElementById('neo4j-forget-btn');
    expect(forget.hidden).toBe(false);
    forget.click();

    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
    expect(document.getElementById('neo4j-url').value).toBe('');
    expect(forget.hidden).toBe(true);
  });

  it('asks before sending credentials in the clear to a remote host', async () => {
    // Basic auth is base64, not encryption: over http: to anything but this
    // machine, everything on the path can read the password.
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    try {
      openNeo4jPopup({ ui: {} });
      document.getElementById('neo4j-url').value = 'http://graph.example.com:7474';
      document.getElementById('neo4j-load-btn').click();

      await vi.waitFor(() => {
        expect(document.body.textContent).toContain('Connect anyway?');
      });
      // Two popups are open; the confirm is the topmost.
      const confirm = [...document.querySelectorAll('.p-custom')].at(-1);
      [...confirm.querySelectorAll('button')].find((b) => b.textContent === 'Cancel').click();

      await vi.waitFor(() => expect(document.getElementById('neo4j-load-btn').disabled).toBe(false));
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not ask for a local server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    try {
      openNeo4jPopup({ ui: {} });
      document.getElementById('neo4j-url').value = 'http://127.0.0.1:7474';
      document.getElementById('neo4j-load-btn').click();

      await vi.waitFor(() => {
        expect(document.getElementById('neo4j-error').hidden).toBe(false);
      });
      // The form's own disclaimer mentions http:// — the confirm is what must
      // not appear, so assert on its wording.
      expect(document.body.textContent).not.toContain('Connect anyway?');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows fetch failures inline and re-enables the buttons', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    try {
      openNeo4jPopup({ ui: {} });
      document.getElementById('neo4j-url').value = 'http://localhost:7474';

      const loadBtn = document.getElementById('neo4j-load-btn');
      loadBtn.click();
      expect(loadBtn.disabled).toBe(true); // spinner state while working
      await vi.waitFor(() => {
        expect(document.getElementById('neo4j-error').hidden).toBe(false);
      });
      expect(document.getElementById('neo4j-error').textContent).toContain('Could not reach');
      expect(loadBtn.disabled).toBe(false);
      expect(loadBtn.textContent).toBe('Fetch');
      // Settings were saved even though the fetch failed.
      expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)).url).toBe(
        'http://localhost:7474',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('showPropertyChecklist', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('resolves immediately with no exclusions when there are no properties', async () => {
    expect(await showPropertyChecklist([])).toEqual({
      excludedNodeProps: new Set(),
      excludedEdgeProps: new Set(),
    });
  });

  it('excludes deselected properties (large arrays start deselected)', async () => {
    const promise = showPropertyChecklist([
      { kind: 'node', key: 'name', type: 'text', examples: ['A'], largeArray: false },
      { kind: 'node', key: 'embedding', type: 'list', examples: ['0 | 0'], largeArray: true },
      { kind: 'edge', key: 'weight', type: 'number', examples: ['1'], largeArray: false },
    ]);

    // Rows are in listed order, nodes before relationships.
    const rows = [...document.querySelectorAll('.p-custom .neo4j-prop-row')];
    expect(rows).toHaveLength(3);
    const boxFor = (key) =>
      rows.find((row) => row.querySelector('.neo4j-prop-name').textContent === key)
        .querySelector('input');
    expect(boxFor('embedding').checked).toBe(false);

    boxFor('weight').checked = false;
    const buttons = [...document.querySelectorAll('.p-custom button')];
    buttons.find((b) => b.textContent === 'Import').click();

    expect(await promise).toEqual({
      excludedNodeProps: new Set(['embedding']),
      excludedEdgeProps: new Set(['weight']),
    });
  });

  it('resolves null on cancel', async () => {
    const promise = showPropertyChecklist([
      { kind: 'node', key: 'name', type: 'text', examples: ['A'], largeArray: false },
    ]);
    const buttons = [...document.querySelectorAll('.p-custom button')];
    buttons.find((b) => b.textContent === 'Cancel').click();
    expect(await promise).toBeNull();
  });

  it('renders type badges and examples, and section toggle-all works', async () => {
    const promise = showPropertyChecklist([
      { kind: 'node', key: 'born', type: 'number', examples: ['1964', '1791'], largeArray: false },
      { kind: 'node', key: 'name', type: 'text', examples: ['Keanu'], largeArray: false },
    ]);

    const types = [...document.querySelectorAll('.neo4j-prop-type')].map((el) => el.textContent);
    expect(types).toEqual(['number', 'text']);
    expect(document.querySelector('.neo4j-prop-examples').textContent).toBe('e.g. 1964  ·  1791');

    const toggleAll = document.querySelector('.neo4j-props-heading input');
    expect(toggleAll.checked).toBe(true);
    toggleAll.checked = false;
    toggleAll.dispatchEvent(new Event('change'));

    const buttons = [...document.querySelectorAll('.p-custom button')];
    buttons.find((b) => b.textContent === 'Import').click();
    expect(await promise).toEqual({
      excludedNodeProps: new Set(['born', 'name']),
      excludedEdgeProps: new Set(),
    });
  });
});

describe('connectionHint', () => {
  // Connect mapped these to actionable text; expand and join surfaced the raw
  // strings, which name none of the causes.
  it('names the timeout', () => {
    const err = new Error('x');
    err.name = 'TimeoutError';
    expect(connectionHint(err)).toContain('timed out');
  });

  it('recognises an unreachable server by the tag runCypher attaches', async () => {
    // Not by JS type and not by Chromium's wording: the callers' try blocks wrap
    // the whole import, so an ordinary TypeError in the merge path used to be
    // reported to the user as a network problem.
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const transportErr = await runCypher(CONFIG, [], { fetchImpl }).catch((e) => e);
    expect(transportErr.transport).toBe(true);
    expect(connectionHint(transportErr)).toContain('Could not reach the server');

    expect(connectionHint(new TypeError('x.map is not a function'))).toBe('x.map is not a function');
  });

  it('names the likely cause of a 404, including the database', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    const err = await runCypher(CONFIG, [], { fetchImpl }).catch((e) => e);
    expect(err.message).toContain('HTTP 404');
    expect(err.message).toContain(CONFIG.database);
    expect(err.message).toMatch(/Bolt/);
  });

  it('passes a Cypher error through untouched', () => {
    expect(connectionHint(new Error('Neo.ClientError.Statement.SyntaxError: bad'))).toBe(
      'Neo.ClientError.Statement.SyntaxError: bad',
    );
  });
});
