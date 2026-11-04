import { describe, it, expect } from 'vitest';
import {
  loadGold,
  prepareGold,
  runBenchmark,
  summarize,
} from '../bench/assistant/harness.mjs';

// ==========================================================================
// bench/assistant end-to-end: real graph import, real generateQueries and
// OllamaClient, with fetch stubbed to canned Ollama /api/chat replies.
// ==========================================================================

const AIRPORTS = 'templates/airport-network-template.xlsx';

const cond = (field, rest) => ({ kind: 'condition', field, ...rest });
const REGION = 'Node filters::geo::region';
const RISK = 'Node filters::health::bio_risk_level';
const DISTANCE = 'Edge filters::geo::distance_km';

// Keyed by the question; `repair` is what the model answers once the
// generator sends a <repair_hint>.
const CANNED = {
  'Airports in Africa.': {
    first: { queries: [{ title: 'Africa', expr: cond(REGION, { op: 'IN', values: ['Africa'] }) }] },
  },
  'European airports with a high bio risk level.': {
    // Invents "continent"; the repair pass corrects it to "region".
    first: {
      queries: [{
        title: 'EU high risk',
        expr: {
          kind: 'binary', bop: 'AND',
          left: cond('Node filters::geo::continent', { op: 'IN', values: ['Europe'] }),
          right: cond(RISK, { op: 'IN', values: ['high'] }),
        },
      }],
    },
    repair: {
      queries: [{
        title: 'EU high risk',
        expr: {
          kind: 'binary', bop: 'AND',
          left: cond(REGION, { op: 'IN', values: ['Europe'] }),
          right: cond(RISK, { op: 'IN', values: ['high'] }),
        },
      }],
    },
  },
  // Wrong threshold: selects the >=10000 km routes, a strict subset of gold.
  'Routes that are at least 5000 km long.': {
    first: { queries: [{ title: 'Long', expr: cond(DISTANCE, { op: 'BETWEEN', min: 10000, max: 17148 }) }] },
  },
  'Airports handling more than 10 million passengers a year.': {
    first: { queries: [] },
  },
};

function stubFetch(url, init) {
  const body = JSON.parse(init.body);
  const user = body.messages.at(-1).content;
  const question = user.match(/<user_question>\n([\s\S]*?)\n<\/user_question>/)[1];
  const canned = CANNED[question];
  const reply = user.includes('<repair_hint>') ? canned.repair : canned.first;
  return Promise.resolve(new Response(JSON.stringify({
    message: { content: JSON.stringify(reply) },
    prompt_eval_count: 1000,
    eval_count: 50,
    total_duration: 2e8,
  })));
}

describe('assistant query benchmark', () => {
  it('scores correct, repaired, wrong and abstaining answers', async () => {
    const prepared = await prepareGold({
      graphs: { airports: { file: AIRPORTS } },
      items: [
        { id: 'ok', graph: 'airports', tier: 'categorical', question: 'Airports in Africa.', gold: `(${REGION} IN [Africa])` },
        { id: 'repaired', graph: 'airports', tier: 'two_clause', question: 'European airports with a high bio risk level.', gold: `(${REGION} IN [Europe]) AND (${RISK} IN [high])` },
        { id: 'wrong', graph: 'airports', tier: 'numeric', question: 'Routes that are at least 5000 km long.', gold: `(${DISTANCE} BETWEEN 5000 AND 17148)` },
        { id: 'none', graph: 'airports', tier: 'impossible', question: 'Airports handling more than 10 million passengers a year.', gold: null },
      ],
    });

    const { results, failedModels } = await runBenchmark({
      prepared, models: ['stub-model'], endpoint: 'http://stub', fetchImpl: stubFetch,
    });
    expect(failedModels).toEqual({});
    const by = Object.fromEntries(results.map((r) => [r.id, r]));

    expect(by.ok).toMatchObject({ exact: true, jaccard: 1, repairUsed: false, schemaValid: true, parses: true, unknownPropertyCount: 0, calls: 1 });
    expect(by.ok.selectedNodes).toHaveLength(46);
    expect(by.ok.promptEvalCount).toBe(1000);

    expect(by.repaired).toMatchObject({ exact: true, repairUsed: true, schemaValid: false, calls: 2, unknownPropertyCount: 1 });
    expect(by.repaired.inventedFields).toEqual(['Node filters::geo::continent']);
    expect(by.repaired.promptEvalCount).toBe(2000);

    // 31 routes >= 10000 km out of 105 routes >= 5000 km.
    expect(by.wrong.exact).toBe(false);
    expect(by.wrong.jaccard).toBeCloseTo(31 / 105, 10);
    expect(by.wrong.repairUsed).toBe(false);

    expect(by.none).toMatchObject({ abstained: true, exact: true, jaccard: 1 });

    const md = summarize(results, { timestamp: 't' });
    expect(md).toContain('| stub-model | 4 | 75.0 |');
    expect(md).toContain('| stub-model | two_clause | 1 | 100.0 |');
  });

  it('every gold query parses and selects a non-empty set', async () => {
    const { items } = await prepareGold(loadGold());
    expect(items.length).toBeGreaterThanOrEqual(50);
    expect(new Set(items.map((i) => i.tier))).toEqual(
      new Set(['numeric', 'categorical', 'two_clause', 'nested', 'paraphrase', 'impossible'])
    );
  }, 30000);
});
