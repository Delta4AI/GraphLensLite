#!/usr/bin/env node
// Turns a render-sweep results JSON (scripts/perf_benchmark.js --sweep) into a
// markdown table and a figure-ready CSV (one row per size x ratio x variant,
// median + quartiles per metric), written next to the JSON.
//
// Run: node scripts/perf_sweep_report.js bench/render/results/sweep_<ts>.json

const fs = require('fs');
const path = require('path');

// Per-run fields summarised per cell, in table/CSV order.
const SWEEP_METRICS = [
  { key: 'loadMs', label: 'Load ms', digits: 0 },
  { key: 'firstInteractionStallMs', label: 'Stall ms', digits: 0 },
  // No-input FPS after load: idle ceiling, or the edge-flow animation rate.
  { key: 'settledFps', label: 'Idle FPS', digits: 1 },
  { key: 'wheelZoomFps', label: 'Zoom FPS', digits: 1 },
  { key: 'wheelZoomRenderFps', label: 'Zoom renders/s', digits: 1 },
  { key: 'dragPanFps', label: 'Pan FPS', digits: 1 },
  { key: 'dragPanRenderFps', label: 'Pan renders/s', digits: 1 },
  { key: 'select500Ms', label: 'Select-500 ms', digits: 0 },
  { key: 'heapUsedMB', label: 'Heap MB', digits: 0 },
];
const TABLE_METRICS = [
  'loadMs',
  'firstInteractionStallMs',
  'settledFps',
  'wheelZoomFps',
  'dragPanFps',
  'select500Ms',
  'heapUsedMB',
];
const INTERACTIVE_FPS = 30;

/** Linear-interpolated quantile (R type 7, numpy default) of a non-empty list. */
function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * @param {object[]} runs per-run result objects
 * @param {{key: string}[]} metrics
 * @returns {Record<string, {median, q1, q3, iqr, n}>} metrics with no finite value are left out
 */
function summarizeRuns(runs, metrics) {
  const summary = {};
  for (const { key } of metrics) {
    const values = runs.map((r) => r[key]).filter(Number.isFinite);
    if (values.length === 0) continue;
    const q1 = quantile(values, 0.25);
    const q3 = quantile(values, 0.75);
    summary[key] = { median: quantile(values, 0.5), q1, q3, iqr: q3 - q1, n: values.length };
  }
  return summary;
}

/** Largest node count per ratio x variant whose median zoom AND pan FPS are >= 30. */
function largestInteractive(cells) {
  const best = new Map();
  for (const c of cells) {
    const k = `${c.ratio}|${c.variant}`;
    if (!best.has(k)) best.set(k, { ratio: c.ratio, variant: c.variant, nodes: null });
    const s = c.summary;
    if (s?.wheelZoomFps?.median >= INTERACTIVE_FPS && s?.dragPanFps?.median >= INTERACTIVE_FPS) {
      best.get(k).nodes = Math.max(best.get(k).nodes ?? 0, c.nodes);
    }
  }
  return [...best.values()];
}

const fmt = (v, digits) => (Number.isFinite(v) ? v.toFixed(digits) : '');

function toCsv(report) {
  const head = [
    'nodes',
    'edges',
    'edge_node_ratio',
    'variant',
    'status',
    'non_representative',
    'runs',
  ];
  for (const { key } of SWEEP_METRICS) head.push(`${key}_median`, `${key}_q1`, `${key}_q3`);
  head.push('caveats');
  const quote = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const rows = report.cells.map((c) => {
    const row = [
      c.nodes,
      c.edges,
      c.ratio,
      c.variant,
      c.status,
      c.nonRepresentative ?? '',
      c.runs.length,
    ];
    for (const { key, digits } of SWEEP_METRICS) {
      const m = c.summary?.[key];
      row.push(fmt(m?.median, digits + 1), fmt(m?.q1, digits + 1), fmt(m?.q3, digits + 1));
    }
    row.push(quote([c.reason, ...(c.caveats ?? [])].filter(Boolean).join('; ')));
    return row.join(',');
  });
  return [head.join(','), ...rows].join('\n') + '\n';
}

function toMarkdown(report) {
  const env = report.environment;
  const metrics = SWEEP_METRICS.filter((m) => TABLE_METRICS.includes(m.key));
  const lines = [
    `# GLL render sweep — ${report.startedAt}`,
    '',
    `GLL ${env.gllVersion} (${env.gitCommit}) · ${env.browser} · ${env.os}`,
    `CPU ${env.cpu} (${env.cpuThreads} threads, ${env.memoryGB} GB) · WebGL renderer: ${env.renderer}`,
    `Viewport ${env.viewport.width}×${env.viewport.height} @ DPR ${env.devicePixelRatio} · idle rAF ceiling ${fmt(env.idleFpsCeiling, 1)} fps · ${report.config.runs} runs per cell, median (Q1–Q3)`,
    '',
  ];
  if (env.nonRepresentative) {
    lines.push(
      '**Non-representative environment:** no hardware GPU (software rasterizer); load and FPS are lower bounds, not what a laptop GPU delivers.',
      ''
    );
  }
  lines.push(`| Nodes | Edges | Variant | ${metrics.map((m) => m.label).join(' | ')} | Notes |`);
  lines.push(`|${' --- |'.repeat(metrics.length + 4)}`);
  for (const c of report.cells) {
    const values = metrics.map(({ key, digits }) => {
      const m = c.summary?.[key];
      if (!m) return '–';
      return m.n > 1
        ? `${fmt(m.median, digits)} (${fmt(m.q1, digits)}–${fmt(m.q3, digits)})`
        : fmt(m.median, digits);
    });
    // The software-renderer caveat is environment-wide (stated above).
    const notes = [c.status === 'ok' ? null : c.status, c.reason, ...(c.caveats ?? [])]
      .filter((n) => n && !/^software renderer/.test(n))
      .join('; ');
    lines.push(
      `| ${c.nodes.toLocaleString('en')} | ${c.edges.toLocaleString('en')} | ${c.variant} | ${values.join(' | ')} | ${notes} |`
    );
  }
  lines.push('', `Largest node count with median zoom and pan ≥ ${INTERACTIVE_FPS} FPS:`, '');
  for (const b of largestInteractive(report.cells)) {
    lines.push(
      `- ratio ${b.ratio}, ${b.variant}: ${b.nodes === null ? 'none' : b.nodes.toLocaleString('en')}`
    );
  }
  return lines.join('\n') + '\n';
}

/** Write <base>.md and <base>.csv next to a sweep results JSON. */
function writeReports(jsonFile) {
  const report = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  if (report.kind !== 'gll-render-sweep')
    throw new Error(`${jsonFile} is not a render-sweep result`);
  const base = jsonFile.replace(/\.json$/, '');
  const mdFile = `${base}.md`;
  const csvFile = `${base}.csv`;
  fs.writeFileSync(mdFile, toMarkdown(report));
  fs.writeFileSync(csvFile, toCsv(report));
  return { mdFile, csvFile };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/perf_sweep_report.js <sweep_results.json>');
    process.exit(1);
  }
  const { mdFile, csvFile } = writeReports(path.resolve(file));
  console.log(`[report] ${mdFile}\n[report] ${csvFile}`);
}

module.exports = {
  quantile,
  summarizeRuns,
  largestInteractive,
  toCsv,
  toMarkdown,
  writeReports,
  SWEEP_METRICS,
};
