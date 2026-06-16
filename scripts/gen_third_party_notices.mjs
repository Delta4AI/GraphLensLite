#!/usr/bin/env node
// Regenerates THIRD_PARTY_NOTICES from the actual bundled (production) dependency
// tree. Reads each package's license metadata and LICENSE file straight from
// node_modules and writes the notice file — no hand-maintained drift. Run:
//   node scripts/gen_third_party_notices.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NM = path.join(ROOT, 'node_modules');
const OUT = path.join(ROOT, 'THIRD_PARTY_NOTICES');

// Bundled/redistributed packages: the production dependency closure plus the
// Electron runtime (a devDependency by install, but shipped inside the app).
const PACKAGES = [
  'electron',
  '@antv/event-emitter', '@antv/expr', '@antv/graphlib', '@antv/layout', '@antv/util',
  '@sigma/edge-curve', '@sigma/export-image', '@sigma/node-border', '@sigma/node-image',
  '@sigma/node-piechart', '@sigma/node-square', '@types/trusted-types', '@yomguithereal/helpers',
  'bubblesets-js', 'comlink', 'd3-binarytree', 'd3-dispatch', 'd3-force', 'd3-force-3d',
  'd3-octree', 'd3-quadtree', 'd3-timer', 'dompurify', 'events', 'exceljs', 'fast-deep-equal',
  'file-saver', 'gl-matrix', 'graphlib', 'graphology', 'graphology-communities-louvain',
  'graphology-indices', 'graphology-layout', 'graphology-layout-forceatlas2',
  'graphology-layout-noverlap', 'graphology-metrics', 'graphology-shortest-path',
  'graphology-types', 'graphology-utils', 'is-any-array', 'lodash', 'marked', 'ml-array-max',
  'ml-array-min', 'ml-array-rescale', 'ml-matrix', 'mnemonist', 'obliterator', 'pandemonium',
  'polygon-clipping', 'robust-predicates', 'sigma', 'splaytree', 'tslib',
];

const LICENSE_FILE_RE = /^(LICENSE|LICENCE|COPYING)(\.|$)/i;

function readPkg(name) {
  const p = path.join(NM, name, 'package.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function findLicenseText(name) {
  const dir = path.join(NM, name);
  if (!fs.existsSync(dir)) return null;
  const file = fs.readdirSync(dir).find((f) => LICENSE_FILE_RE.test(f));
  if (!file) return null;
  return fs.readFileSync(path.join(dir, file), 'utf8').trim();
}

function spdx(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && pkg.license.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type).join(' OR ');
  return 'UNKNOWN';
}

function sourceUrl(pkg) {
  const r = pkg.repository;
  let url = typeof r === 'string' ? r : r && r.url;
  if (url) {
    url = url
      .replace(/^git\+/, '')
      .replace(/^git:\/\//, 'https://')
      .replace(/^ssh:\/\/git@/, 'https://')
      .replace(/^git@([^:]+):/, 'https://$1/') // git@github.com:owner/repo -> https://github.com/owner/repo
      .replace(/\.git$/, '');
    if (url.startsWith('github:')) url = 'https://github.com/' + url.slice(7);
    return url;
  }
  return pkg.homepage || `https://www.npmjs.com/package/${pkg.name}`;
}

function copyrightLine(name, text) {
  if (!text) return null;
  const line = text.split('\n').find((l) => /copyright/i.test(l) && /\d{4}|\(c\)|©/i.test(l));
  return line ? line.trim() : null;
}

const entries = [];
const byType = new Map(); // SPDX -> representative full license text
const missing = [];
const typeCounts = {};

for (const name of PACKAGES) {
  const pkg = readPkg(name);
  if (!pkg) { missing.push(name); continue; }
  const lic = spdx(pkg);
  const text = findLicenseText(name);
  typeCounts[lic] = (typeCounts[lic] || 0) + 1;
  if (text && !byType.has(lic)) byType.set(lic, text);
  entries.push({
    name,
    version: pkg.version,
    license: lic,
    source: sourceUrl(pkg),
    copyright: copyrightLine(name, text),
  });
}

const RULE = '------------------------------------------------------------';
let out = '';
out += 'THIRD PARTY NOTICES\n';
out += 'Graph Lens Lite\n\n';
out += 'The following third-party software is bundled into the distributed\n';
out += 'application (Electron desktop builds and the inline single-file HTML).\n';
out += 'Each package is listed with its SPDX license identifier, source, and\n';
out += 'copyright notice; the full text of every distinct license used appears\n';
out += 'in the "Full License Texts" section at the end.\n\n';
out += 'This file is generated from the production dependency tree by\n';
out += 'scripts/gen_third_party_notices.mjs — do not edit by hand.\n\n';
out += RULE + '\n';

for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
  out += `${e.name}@${e.version}\n`;
  out += `License: ${e.license}\n`;
  out += `Source: ${e.source}\n`;
  if (e.copyright) out += `${e.copyright}\n`;
  out += RULE + '\n';
}

out += '\n\nFull License Texts\n\n';
for (const [type, text] of [...byType.entries()].sort()) {
  out += RULE + '\n';
  out += `${type}\n`;
  out += RULE + '\n';
  out += text + '\n\n';
}

fs.writeFileSync(OUT, out);

// Report (no full texts in stdout — keep it terse).
console.log('Packages attributed:', entries.length);
console.log('License breakdown:', JSON.stringify(typeCounts, null, 0));
console.log('Distinct license types with full text:', [...byType.keys()].sort().join(', '));
console.log('Missing from node_modules:', missing.length ? missing.join(', ') : 'none');
const copyleft = entries.filter((e) => /GPL|AGPL|LGPL|MPL|CDDL|EUPL|CC-BY-SA/i.test(e.license));
console.log('Copyleft/incompatible:', copyleft.length ? copyleft.map((e) => `${e.name}(${e.license})`).join(', ') : 'NONE');
