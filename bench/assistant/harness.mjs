// Benchmark harness for the assistant's query generator (phase 2).
//
// Loads a graph through the app's own Excel import (IOManager.parseExcelToJson
// + preProcessData), builds the same graph_state the panel sends, calls the
// real generateQueries() with the real OllamaClient, and scores the rendered
// query by evaluating it with the app's own query parser/evaluator.

/* global document, structuredClone, performance -- Node 22 + the jsdom shim below */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import ExcelJS from 'exceljs'
import {JSDOM} from 'jsdom'

export const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(BENCH_DIR, '../..')

// Same values the panel uses: STATUS_LOG_LINES_CAP in assistant/index.js and
// DEFAULTS.numCtx in assistant/settings.js.
const STATUS_LOG_LINES_CAP = 20
export const APP_DEFAULT_NUM_CTX = 16384

// QueryManager parses queries through DOMParser and the managers touch
// `document`; give plain Node a DOM before any app module is imported.
if (typeof globalThis.DOMParser === 'undefined') {
  const {window} = new JSDOM('<!doctype html><html><body></body></html>')
  for (const k of ['window', 'document', 'DOMParser', 'Node', 'HTMLElement']) globalThis[k] = window[k]
}
// The app loads ExcelJS from a vendored <script> tag, i.e. as a global.
globalThis.ExcelJS ??= ExcelJS

const {VERSION, CFG, DEFAULTS} = await import('../../src/config.js')
const {IOManager} = await import('../../src/managers/io.js')
const {QueryManager} = await import('../../src/managers/query.js')
const {GraphCoreManager} = await import('../../src/graph/core.js')
const {GraphStyleManager} = await import('../../src/graph/style.js')
const {GraphLayoutManager} = await import('../../src/graph/layout.js')
const {StaticUtilities} = await import('../../src/utilities/static.js')
const {buildContextSnapshot, serializeSnapshot} = await import('../../src/managers/assistant/context.js')
const {generateQueries, collectFieldsFromAst} = await import('../../src/managers/assistant/query_generator.js')
const {buildQuerySchema, flattenHierarchy} = await import('../../src/managers/assistant/query_schema.js')
const {OllamaClient} = await import('../../src/managers/assistant/client.js')

// ------------------------------------------------------------ graph loading

// The slice of gll.js Cache.reset() the import path writes to.
function resetState(cache) {
  cache.initialized = false
  cache.data = {filterDefaults: new Map()}
  cache.query = {valid: false, ast: null, text: document.createElement('div'), overlay: document.createElement('div')}
  cache.EVENT_LOCKS = {}
  cache.nodeRef = new Map()
  cache.edgeRef = new Map()
  cache.uniquePropHierarchy = {}
  cache.nodeIDsToBeShown = new Set()
  cache.edgeIDsToBeShown = new Set()
  cache.selectedNodes = new Set()
  cache.selectedEdges = new Set()
  cache.hiddenDanglingNodeIDs = new Set()
  cache.lastBubbleSetMembers = new Map()
}

// The slice of gll.js Cache.initialize() (iterNodes/iterEdges +
// populateUniquePropGroups) that the query evaluator and the snapshot read.
// A freshly imported graph has no active query and every element visible.
function initializeState(cache) {
  for (const [ref, elements] of [[cache.nodeRef, cache.data.nodes], [cache.edgeRef, cache.data.edges]]) {
    for (const el of elements) {
      ref.set(el.id, structuredClone(el))
      for (const propID of el.features) {
        const [main, sub, prop] = StaticUtilities.decodePropHashId(propID)
        ;((cache.uniquePropHierarchy[main] ??= {})[sub] ??= new Set()).add(prop)
      }
    }
  }
  cache.nodeIDsToBeShown = new Set(cache.nodeRef.keys())
  cache.edgeIDsToBeShown = new Set(cache.edgeRef.keys())
  cache.initialized = true
}

export async function loadGraph(file) {
  const warnings = []
  const cache = {
    VERSION,
    CFG: {...CFG}, // preProcessData writes HIDE_LABELS; keep the module's object pristine
    DEFAULTS,
    ui: {
      warning: (m) => warnings.push(m),
      info() {},
      debug() {},
      error: (m) => { throw new Error(`${file}: ${m}`) },
    },
    reset() { resetState(this) },
    initialize() { initializeState(this) },
  }
  resetState(cache)
  cache.gcm = new GraphCoreManager(cache)
  cache.style = new GraphStyleManager(cache)
  cache.lm = new GraphLayoutManager(cache)
  cache.io = new IOManager(cache)
  cache.qm = new QueryManager(cache)

  const fileData = await cache.io.parseExcelToJson(fs.readFileSync(path.resolve(REPO_ROOT, file)))
  if (!fileData) throw new Error(`${file}: Excel import returned nothing`)
  cache.io.preProcessData(fileData)
  cache.importWarnings = warnings
  return cache
}

// Exactly what AssistantManager.send() serialises into <graph_state>, minus
// the status-log lines (DOM-only in the app; empty here so runs are stable).
export function buildGraphJson(cache) {
  return serializeSnapshot(buildContextSnapshot(cache, {
    maxStatusLogLines: STATUS_LOG_LINES_CAP,
    readActions: () => [],
  }))
}

// ------------------------------------------------------------ evaluation

// Parse + evaluate a query string the way the Query Editor's Select does
// (encodeQuery → decodeQuery → QueryAST over visible elements).
// unknownProperties: decoded property tokens absent from the graph (the
// editor highlights these but still accepts the query).
export function evaluateQuery(cache, text) {
  cache.query.overlay.innerHTML = cache.qm.encodeQuery(text)
  if (!cache.query.valid) return {parses: false, unknownProperties: [], nodes: [], edges: []}
  cache.qm.decodeQueryAndBuildAST()
  const ast = cache.query.ast
  const unknownProperties = []
  const walk = (x) => {
    if (Array.isArray(x)) return x.forEach(walk)
    if (x?.type === 'property' && !cache.uniquePropHierarchy[x.main]?.[x.sub]?.has(x.prop)) unknownProperties.push(x.propID)
  }
  walk(ast.instructions)
  const nodes = [...cache.nodeRef.values()].filter((n) => cache.nodeIDsToBeShown.has(n.id) && ast.testNode(n)).map((n) => n.id)
  const edges = [...cache.edgeRef.values()].filter((e) => cache.edgeIDsToBeShown.has(e.id) && ast.testEdge(e)).map((e) => e.id)
  return {parses: true, unknownProperties, nodes: nodes.sort(), edges: edges.sort()}
}

export function jaccard(a, b) {
  const A = new Set(a)
  const B = new Set(b)
  if (A.size === 0 && B.size === 0) return 1
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  return inter / (A.size + B.size - inter)
}

// Node and edge IDs live in separate namespaces; prefix them so a node "x"
// never collides with an edge "x" when scoring the combined selection.
const tagged = (sel) => [...sel.nodes.map((id) => `n:${id}`), ...sel.edges.map((id) => `e:${id}`)]

// Minimal JSON-Schema check covering exactly the keywords buildQuerySchema()
// uses (type, enum, pattern, required, properties, items, minItems, $ref into
// #/$defs). Returns the first violation as a path string, or null.
export function schemaViolation(value, schema, root = schema, at = '$') {
  if (schema.$ref) return schemaViolation(value, root.$defs[schema.$ref.replace('#/$defs/', '')], root, at)
  if (schema.enum && !schema.enum.includes(value)) return `${at}: ${JSON.stringify(value)} not in enum`
  const t = schema.type
  if (t === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) return `${at}: not an object`
  if (t === 'array' && !Array.isArray(value)) return `${at}: not an array`
  if (t === 'string' && typeof value !== 'string') return `${at}: not a string`
  if (t === 'number' && typeof value !== 'number') return `${at}: not a number`
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${at}: does not match pattern`
  for (const k of schema.required ?? []) if (!(k in value)) return `${at}: missing "${k}"`
  for (const [k, sub] of Object.entries(schema.properties ?? {})) {
    if (value[k] === undefined) continue
    const v = schemaViolation(value[k], sub, root, `${at}.${k}`)
    if (v) return v
  }
  if (Array.isArray(value)) {
    if (schema.minItems && value.length < schema.minItems) return `${at}: fewer than ${schema.minItems} items`
    for (const [i, item] of value.entries()) {
      const v = schema.items && schemaViolation(item, schema.items, root, `${at}[${i}]`)
      if (v) return v
    }
  }
  return null
}

// What one raw model reply contained, judged against the schema actually
// sent to Ollama and against the graph's real property paths.
export function analyzeRaw(raw, hierarchy) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {json: false, schemaViolation: 'not JSON', inventedFields: []}
  }
  const valid = new Set(flattenHierarchy(hierarchy))
  const queries = Array.isArray(parsed?.queries) ? parsed.queries : []
  const inventedFields = [...new Set(queries.flatMap((q) => collectFieldsFromAst(q?.expr)).filter((f) => !valid.has(f)))]
  return {json: true, schemaViolation: schemaViolation(parsed, buildQuerySchema(hierarchy)), inventedFields}
}

// Score one generator output against the gold selection. Top-1 = the first
// query that rendered without error (what the panel lists first). An item
// with gold === null is impossible on its graph: correct = no valid query.
export function scoreItem({cache, entries, goldSelection}) {
  const valid = entries.filter((e) => e?.text && !e.error)
  const evaluated = valid.map((e) => {
    const sel = evaluateQuery(cache, e.text)
    const out = {title: e.title, text: e.text, parses: sel.parses, nodes: sel.nodes, edges: sel.edges}
    if (goldSelection) {
      out.jaccard = jaccard(tagged(sel), tagged(goldSelection))
      out.nodeJaccard = jaccard(sel.nodes, goldSelection.nodes)
      out.edgeJaccard = jaccard(sel.edges, goldSelection.edges)
      out.exact = out.jaccard === 1
    }
    return out
  })
  const top = evaluated[0] ?? null
  const errors = entries.filter((e) => e?.error).map((e) => e.error)
  const base = {
    queryCount: entries.length,
    validCount: valid.length,
    errors,
    renderedQuery: top?.text ?? null,
    parses: top ? top.parses : null,
    selectedNodes: top?.nodes ?? [],
    selectedEdges: top?.edges ?? [],
    queries: evaluated,
  }
  if (!goldSelection) {
    const abstained = valid.length === 0
    return {...base, abstained, exact: abstained, jaccard: abstained ? 1 : 0, bestJaccard: abstained ? 1 : 0}
  }
  return {
    ...base,
    abstained: valid.length === 0,
    exact: top?.exact ?? false,
    jaccard: top?.jaccard ?? 0,
    nodeJaccard: top?.nodeJaccard ?? 0,
    edgeJaccard: top?.edgeJaccard ?? 0,
    bestJaccard: Math.max(0, ...evaluated.map((q) => q.jaccard)),
  }
}

// ------------------------------------------------------------ gold set

export function loadGold(file = path.join(BENCH_DIR, 'gold.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

// Load every graph and evaluate every gold query. Throws on a gold query
// that fails to parse or selects nothing — a broken gold set must not
// produce numbers.
export async function prepareGold(gold) {
  const graphs = {}
  for (const [name, spec] of Object.entries(gold.graphs)) {
    const cache = await loadGraph(spec.file)
    const graphJson = buildGraphJson(cache)
    graphs[name] = {cache, graphJson, hierarchy: JSON.parse(graphJson).properties.hierarchy}
  }
  const problems = []
  const items = gold.items.map((item) => {
    const g = graphs[item.graph]
    if (!g) throw new Error(`gold item ${item.id}: unknown graph "${item.graph}"`)
    if (item.gold === null) return {...item, goldSelection: null}
    const sel = evaluateQuery(g.cache, item.gold)
    if (!sel.parses) problems.push(`${item.id}: gold query does not parse`)
    else if (sel.unknownProperties.length) problems.push(`${item.id}: gold uses unknown properties ${sel.unknownProperties.join(', ')}`)
    else if (!sel.nodes.length && !sel.edges.length) problems.push(`${item.id}: gold query selects nothing`)
    return {...item, goldSelection: sel}
  })
  if (problems.length) throw new Error(`invalid gold set:\n  ${problems.join('\n  ')}`)
  return {graphs, items}
}

// ------------------------------------------------------------ running

// OllamaClient calls the global fetch and discards the response metadata, so
// the harness swaps in a recording fetch around each item to capture raw
// output, token counts and server timings without touching the client.
// shortcut: global swap, safe only because items run strictly sequentially.
const DEGENERATE_GENERATION = /token repeat limit reached/

async function withRecordedCalls(fetchImpl, fn) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null
    const call = {repair: !!body?.messages?.some((m) => m.content?.includes('<repair_hint>'))}
    calls.push(call)
    let res
    try {
      res = await fetchImpl(url, init)
    } catch (err) {
      call.transportError = String(err?.cause?.code || err?.cause?.message || err?.message || err)
      throw err
    }
    call.status = res.status
    if (!res.ok) {
      const text = await res.clone().text().catch(() => '')
      // Ollama aborts a looping generation with a 500. That is the model's
      // answer (the panel shows an error), not an outage, so it gets scored.
      if (res.status === 500 && DEGENERATE_GENERATION.test(text)) call.degenerate = true
      else call.transportError = `HTTP ${res.status}: ${text}`
      return res
    }
    const data = await res.clone().json().catch(() => null)
    call.raw = data?.message?.content ?? null
    call.promptEvalCount = data?.prompt_eval_count ?? null
    call.evalCount = data?.eval_count ?? null
    call.totalDurationMs = data?.total_duration != null ? data.total_duration / 1e6 : null
    return res
  }
  try {
    return {result: await fn(), calls}
  } catch (error) {
    return {error, calls}
  } finally {
    globalThis.fetch = original
  }
}

const sum = (xs) => xs.reduce((a, b) => a + (b ?? 0), 0)

async function runItem({client, item, g, fetchImpl}) {
  const started = performance.now()
  const {result: entries, error, calls} = await withRecordedCalls(fetchImpl, () => generateQueries({
    client,
    graphJson: g.graphJson,
    userQuestion: item.question,
    // The panel's drift-recovery path: the question itself is the intent.
    intent: {summary: item.question, scope: null},
  }))
  const latencyMs = performance.now() - started
  // Ollama unreachable / model missing / OOM is not a model answer: stop
  // instead of scoring it as a wrong query.
  const transport = calls.find((c) => c.transportError)
  if (transport) throw new Error(`Ollama call failed for "${client.model}": ${transport.transportError}`)

  const analyses = calls.map((c) => (c.raw == null ? null : analyzeRaw(c.raw, g.hierarchy)))
  const record = {
    model: client.model, id: item.id, graph: item.graph, tier: item.tier, question: item.question,
    gold: item.gold,
    goldNodes: item.goldSelection?.nodes ?? null,
    goldEdges: item.goldSelection?.edges ?? null,
    latencyMs,
    calls: calls.length,
    repairUsed: calls.some((c) => c.repair),
    degenerateCalls: calls.filter((c) => c.degenerate).length,
    // First reply only: did the constrained decoder alone produce a reply
    // that conforms to the schema it was given?
    schemaValid: analyses[0] ? analyses[0].schemaViolation === null : false,
    schemaViolations: analyses.map((a) => a?.schemaViolation ?? null),
    inventedFields: [...new Set(analyses.flatMap((a) => a?.inventedFields ?? []))],
    rawOutputs: calls.map((c) => c.raw ?? null),
    promptEvalCount: sum(calls.map((c) => c.promptEvalCount)),
    evalCount: sum(calls.map((c) => c.evalCount)),
    ollamaDurationMs: sum(calls.map((c) => c.totalDurationMs)),
  }
  record.unknownPropertyCount = record.inventedFields.length
  if (error) {
    // Both attempts failed (unparseable JSON, no queries array): the panel
    // shows an error and no query.
    const impossible = item.goldSelection === null
    return {...record, error: String(error?.message ?? error), abstained: true, parses: null,
      exact: impossible, jaccard: impossible ? 1 : 0, bestJaccard: impossible ? 1 : 0, queries: []}
  }
  return {...record, ...scoreItem({cache: g.cache, entries, goldSelection: item.goldSelection})}
}

// Runs every item for every model. A model whose Ollama calls fail is
// reported in `failedModels` and its partial records are dropped; the other
// models still run.
export async function runBenchmark({
  prepared,
  models,
  endpoint,
  repeats = 1,
  numCtx = APP_DEFAULT_NUM_CTX,
  fetchImpl = globalThis.fetch,
  onResult = () => {},
}) {
  const results = []
  const failedModels = {}
  for (const model of models) {
    const client = new OllamaClient(endpoint, model, {numCtx})
    const own = []
    try {
      for (let repeat = 0; repeat < repeats; repeat++) {
        for (const item of prepared.items) {
          const record = {...(await runItem({client, item, g: prepared.graphs[item.graph], fetchImpl})), repeat}
          own.push(record)
          onResult(record)
        }
      }
      results.push(...own)
    } catch (err) {
      failedModels[model] = err.message
    }
  }
  return {results, failedModels}
}

// ------------------------------------------------------------ summary

const mean = (xs) => (xs.length ? sum(xs) / xs.length : NaN)
function median(xs) {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const pct = (x) => (Number.isNaN(x) ? '–' : `${(100 * x).toFixed(1)}`)
const num = (x, d = 3) => (Number.isNaN(x) ? '–' : x.toFixed(d))

export function aggregate(records) {
  return {
    n: records.length,
    exact: mean(records.map((r) => (r.exact ? 1 : 0))),
    jaccard: mean(records.map((r) => r.jaccard)),
    bestJaccard: mean(records.map((r) => r.bestJaccard)),
    repairRate: mean(records.map((r) => (r.repairUsed ? 1 : 0))),
    schemaValid: mean(records.map((r) => (r.schemaValid ? 1 : 0))),
    abstain: mean(records.map((r) => (r.abstained ? 1 : 0))),
    unknownProps: mean(records.map((r) => r.unknownPropertyCount ?? 0)),
    medianLatencyMs: median(records.map((r) => r.latencyMs)),
  }
}

function groupBy(records, key) {
  const out = new Map()
  for (const r of records) {
    const k = key(r)
    if (!out.has(k)) out.set(k, [])
    out.get(k).push(r)
  }
  return out
}

const HEADER = '| exact % | mean Jaccard | best-of Jaccard | repair % | schema-valid % | no-query % | unknown props / item | median latency (s) |'
const row = (a) => `| ${pct(a.exact)} | ${num(a.jaccard)} | ${num(a.bestJaccard)} | ${pct(a.repairRate)} | ${pct(a.schemaValid)} | ${pct(a.abstain)} | ${num(a.unknownProps, 2)} | ${num(a.medianLatencyMs / 1000, 1)} |`

export function summarize(records, meta = {}) {
  const lines = [`# Assistant query benchmark — ${meta.timestamp ?? ''}`, '']
  for (const [k, v] of Object.entries(meta)) if (k !== 'timestamp') lines.push(`- **${k}**: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
  lines.push('', '## Per model', '', `| model | n ${HEADER}`, `|---|---${'|---'.repeat(8)}|`)
  const byModel = groupBy(records, (r) => r.model)
  for (const [model, rs] of byModel) {
    const a = aggregate(rs)
    lines.push(`| ${model} | ${a.n} ${row(a)}`)
  }
  lines.push('', '## Per model and tier', '', `| model | tier | n ${HEADER}`, `|---|---|---${'|---'.repeat(8)}|`)
  for (const [model, rs] of byModel) {
    for (const [tier, ts] of groupBy(rs, (r) => r.tier)) {
      const a = aggregate(ts)
      lines.push(`| ${model} | ${tier} | ${a.n} ${row(a)}`)
    }
  }
  lines.push('')
  return lines.join('\n')
}
