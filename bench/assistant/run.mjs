#!/usr/bin/env node
// CLI for the assistant query benchmark. See README.md in this folder.
//
//   node bench/assistant/run.mjs --endpoint http://host:11434 --models a,b --repeats 3
//   node bench/assistant/run.mjs --check-gold

/* global console, process, fetch -- Node 22 globals */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {parseArgs} from 'node:util'
import {Agent, fetch as undiciFetch} from 'undici'
import {APP_DEFAULT_NUM_CTX, BENCH_DIR, REPO_ROOT, loadGold, prepareGold, runBenchmark, summarize} from './harness.mjs'

const {values: args} = parseArgs({
  options: {
    endpoint: {type: 'string', default: 'http://localhost:11434'},
    models: {type: 'string'},
    repeats: {type: 'string', default: '1'},
    'num-ctx': {type: 'string', default: String(APP_DEFAULT_NUM_CTX)},
    limit: {type: 'string'},
    gold: {type: 'string', default: path.join(BENCH_DIR, 'gold.json')},
    out: {type: 'string', default: path.join(BENCH_DIR, 'results')},
    hardware: {type: 'string', default: ''},
    'check-gold': {type: 'boolean', default: false},
  },
})

function positiveInt(name) {
  const n = Number(args[name])
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer, got "${args[name]}"`)
  return n
}

const gold = loadGold(args.gold)
const prepared = await prepareGold(gold)

if (args['check-gold']) {
  for (const item of prepared.items) {
    const sel = item.goldSelection
    console.log(`${item.id.padEnd(16)} ${item.tier.padEnd(12)} ${sel ? `${sel.nodes.length} nodes, ${sel.edges.length} edges` : 'impossible (no query)'}`)
  }
  console.log(`\n${prepared.items.length} items, all gold queries parse and select a non-empty set.`)
  process.exit(0)
}

const endpoint = args.endpoint.replace(/\/+$/, '')
const tagsRes = await fetch(`${endpoint}/api/tags`).catch((err) => {
  throw new Error(`Cannot reach Ollama at ${endpoint} (${err?.cause?.code || err?.cause?.message || err.message}). Is it running, and is --endpoint right?`)
})
if (!tagsRes.ok) throw new Error(`Ollama /api/tags returned HTTP ${tagsRes.status}`)
const installed = (await tagsRes.json()).models ?? []
const models = args.models ? args.models.split(',').map((m) => m.trim()).filter(Boolean) : installed.map((m) => m.name)
if (!models.length) throw new Error('No models: pass --models or pull one into Ollama first.')
const missing = models.filter((m) => !installed.some((t) => t.name === m))
if (missing.length) throw new Error(`Not installed on ${endpoint}: ${missing.join(', ')}`)

if (args.limit) prepared.items = prepared.items.slice(0, positiveInt('limit'))
const repeats = positiveInt('repeats')
const numCtx = positiveInt('num-ctx')

const gitCommit = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {cwd: REPO_ROOT, encoding: 'utf8'}).trim()
  } catch {
    return 'unknown'
  }
})()
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const meta = {
  timestamp,
  endpoint,
  models: models.map((name) => {
    const t = installed.find((m) => m.name === name)
    return {name, digest: t?.digest, ...t?.details}
  }),
  repeats,
  numCtx,
  temperature: 0,
  items: prepared.items.length,
  gold: path.relative(REPO_ROOT, args.gold),
  gitCommit,
  hardware: args.hardware || '(not given — pass --hardware)',
  runner: `${os.type()} ${os.release()}, node ${process.version}`,
}

// Ollama's non-streamed /api/chat sends headers only once generation ends, so
// Node fetch's default 300 s headersTimeout aborts slow items and drops the
// whole model. The app (browser fetch) has no such cap; keep one only to
// surface a hung server.
const OLLAMA_CALL_TIMEOUT_MS = 30 * 60 * 1000
const dispatcher = new Agent({headersTimeout: OLLAMA_CALL_TIMEOUT_MS, bodyTimeout: OLLAMA_CALL_TIMEOUT_MS})
const fetchImpl = (url, init) => undiciFetch(url, {...init, dispatcher})

const total = models.length * repeats * prepared.items.length
let done = 0
const {results, failedModels} = await runBenchmark({
  prepared, models, endpoint, repeats, numCtx, fetchImpl,
  onResult: (r) => {
    done++
    const verdict = r.exact ? 'exact' : `J=${r.jaccard.toFixed(2)}`
    console.error(`[${done}/${total}] ${r.model} ${r.id} ${verdict}${r.repairUsed ? ' (repair)' : ''} ${(r.latencyMs / 1000).toFixed(1)}s`)
  },
})
meta.failedModels = failedModels

fs.mkdirSync(args.out, {recursive: true})
const jsonPath = path.join(args.out, `${timestamp}.json`)
const mdPath = path.join(args.out, `${timestamp}.md`)
fs.writeFileSync(jsonPath, JSON.stringify({meta, results}, null, 2))
fs.writeFileSync(mdPath, summarize(results, meta))
console.log(fs.readFileSync(mdPath, 'utf8'))
console.log(`Wrote ${path.relative(process.cwd(), jsonPath)} and ${path.relative(process.cwd(), mdPath)}`)
for (const [m, err] of Object.entries(failedModels)) console.error(`FAILED ${m}: ${err}`)
if (Object.keys(failedModels).length) process.exitCode = 1
