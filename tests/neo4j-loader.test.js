// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  executeNeo4jImport,
  buildConnectionForm,
  openNeo4jPopup,
  runCypher,
  countQueryRows,
  collectGraph,
  collectPropertyKeys,
  toAppFormat,
  coerceValue,
  sanitizeForAST,
  buildTxUrl,
  basicAuth,
  nodeDisplayLabel,
  readSavedSettings,
  saveSettings,
  showPropertyChecklist,
  DEFAULT_DATABASE,
  LARGE_ARRAY_THRESHOLD,
  SETTINGS_STORAGE_KEY,
  LARGE_RESULT_ROW_THRESHOLD,
} from '../src/utilities/neo4j_loader.js';

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
    await expect(runCypher(CONFIG, [], { fetchImpl })).rejects.toThrow(
      /SyntaxError: bad query/,
    );
  });
});

describe('countQueryRows', () => {
  it('wraps the query in a CALL subquery and reads the count', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ results: [{ data: [{ row: [42] }] }], errors: [] }));
    const count = await countQueryRows(CONFIG, 'MATCH (n) RETURN n', { fetchImpl });

    expect(count).toBe(42);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.statements[0].statement).toBe(
      'CALL { MATCH (n) RETURN n } RETURN count(*) AS rowCount',
    );
  });

  it('returns null when the count query fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('boom'));
    expect(await countQueryRows(CONFIG, 'MATCH (n) RETURN n', { fetchImpl })).toBeNull();
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
  it('passes primitives through (sanitizing strings)', () => {
    expect(coerceValue(3.5)).toBe(3.5);
    expect(coerceValue(true)).toBe(true);
    expect(coerceValue('plain')).toBe('plain');
    expect(coerceValue('a:b')).toBe('a-b');
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
  it('unions keys per kind and flags large arrays', () => {
    const nodes = [
      { properties: { name: 'A', embedding: Array(LARGE_ARRAY_THRESHOLD + 1).fill(0) } },
      { properties: { age: 3 } },
    ];
    const rels = [{ properties: { weight: 1 } }];

    const keys = collectPropertyKeys(nodes, rels);
    expect(keys).toEqual([
      { kind: 'node', key: 'age', largeArray: false, sample: 3 },
      { kind: 'node', key: 'embedding', largeArray: true, sample: expect.any(Array) },
      { kind: 'node', key: 'name', largeArray: false, sample: 'A' },
      { kind: 'edge', key: 'weight', largeArray: false, sample: 1 },
    ]);
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

  it('maps nodes and relationships into the native payload', () => {
    const data = toAppFormat(nodes, relationships);

    expect(data.nodes[0]).toEqual({
      id: '1',
      label: 'Keanu',
      D4Data: {
        'Node filters': {
          Person: { name: 'Keanu', born: 1964, ignored: 'x' },
          Neo4j: { Labels: 'Person | Actor' },
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
          Neo4j: { Type: 'ACTED_IN' },
        },
      },
    });
  });

  it('builds deduplicated headers', () => {
    const data = toAppFormat(nodes, relationships);
    expect(data.nodeDataHeaders).toContainEqual({ subGroup: 'Person', key: 'name' });
    expect(data.nodeDataHeaders).toContainEqual({ subGroup: 'Movie', key: 'title' });
    expect(data.nodeDataHeaders).toContainEqual({ subGroup: 'Neo4j', key: 'Labels' });
    expect(data.edgeDataHeaders).toContainEqual({ subGroup: 'Neo4j', key: 'Type' });
    const labelHeaders = data.nodeDataHeaders.filter((h) => h.key === 'Labels');
    expect(labelHeaders).toHaveLength(1);
  });

  it('honors property exclusions per kind', () => {
    const data = toAppFormat(nodes, relationships, {
      excludedNodeProps: new Set(['ignored']),
      excludedEdgeProps: new Set(['roles']),
    });

    expect(data.nodes[0].D4Data['Node filters'].Person).toEqual({ name: 'Keanu', born: 1964 });
    expect(data.edges[0].D4Data['Edge filters'].ACTED_IN).toEqual({});
    expect(data.nodeDataHeaders).not.toContainEqual({ subGroup: 'Person', key: 'ignored' });
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
    expect(cache.ui.setDataSourceLabel).toHaveBeenCalledWith('Neo4j: movies');
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
    expect(cache.ui.error).toHaveBeenCalledWith(expect.stringContaining('Neo.X: nope'));
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
    const cache = { ui: { error: vi.fn() } };
    const promise = openNeo4jPopup(cache);

    const loadBtn = document.getElementById('neo4j-load-btn');
    expect(loadBtn).not.toBeNull();
    loadBtn.click(); // empty form → validation error, popup stays open
    expect(cache.ui.error).toHaveBeenCalledWith('Server URL and Cypher query are required.');

    document.getElementById('neo4j-cancel-btn').click();
    expect(await promise).toBe(false);
  });

  it('rejects an invalid URL without closing the popup', async () => {
    const cache = { ui: { error: vi.fn() } };
    const promise = openNeo4jPopup(cache);

    document.getElementById('neo4j-url').value = 'not a url';
    document.getElementById('neo4j-load-btn').click();
    expect(cache.ui.error).toHaveBeenCalledWith('Invalid server URL: not a url');

    document.getElementById('neo4j-cancel-btn').click();
    expect(await promise).toBe(false);
  });
});

describe('showPropertyChecklist', () => {
  it('resolves immediately with no exclusions when there are no properties', async () => {
    expect(await showPropertyChecklist([])).toEqual({
      excludedNodeProps: new Set(),
      excludedEdgeProps: new Set(),
    });
  });

  it('excludes deselected properties (large arrays start deselected)', async () => {
    const promise = showPropertyChecklist([
      { kind: 'node', key: 'name', largeArray: false, sample: 'A' },
      { kind: 'node', key: 'embedding', largeArray: true, sample: [] },
      { kind: 'edge', key: 'weight', largeArray: false, sample: 1 },
    ]);

    const checkboxes = [...document.querySelectorAll('.p-custom input[type="checkbox"]')];
    expect(checkboxes).toHaveLength(3);
    expect(checkboxes.find((c) => c.dataset.key === 'embedding').checked).toBe(false);

    checkboxes.find((c) => c.dataset.key === 'weight').checked = false;
    const buttons = [...document.querySelectorAll('.p-custom button')];
    buttons.find((b) => b.textContent === 'Import').click();

    expect(await promise).toEqual({
      excludedNodeProps: new Set(['embedding']),
      excludedEdgeProps: new Set(['weight']),
    });
  });

  it('resolves null on cancel', async () => {
    const promise = showPropertyChecklist([
      { kind: 'node', key: 'name', largeArray: false, sample: 'A' },
    ]);
    const buttons = [...document.querySelectorAll('.p-custom button')];
    buttons.find((b) => b.textContent === 'Cancel').click();
    expect(await promise).toBeNull();
  });
});
