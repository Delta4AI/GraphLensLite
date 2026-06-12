#!/usr/bin/env node
// Copies ESM builds of npm deps into src/lib/ so they load under raw-module
// dev serve (npm run serve) and keep parity with vendored libs (exceljs).
// Also regenerates the assistant system prompt JS module from its .md source.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..', '..');
const libDir = path.join(root, 'src', 'lib');

const copies = [
  {
    from: path.join(root, 'node_modules', 'marked', 'lib', 'marked.esm.js'),
    to: path.join(libDir, 'marked.esm.js'),
    pkg: 'marked',
  },
  {
    from: path.join(root, 'node_modules', 'dompurify', 'dist', 'purify.es.mjs'),
    to: path.join(libDir, 'purify.esm.mjs'),
    pkg: 'dompurify',
  },
];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function pkgVersion(pkg) {
  try {
    return require(path.join(root, 'node_modules', pkg, 'package.json')).version;
  } catch {
    return 'unknown';
  }
}

fs.mkdirSync(libDir, {recursive: true});
for (const {from, to, pkg} of copies) {
  if (!fs.existsSync(from)) {
    console.error(`[vendor-libs] Missing source: ${from}`);
    console.error('[vendor-libs] Run `npm install` first.');
    process.exit(1);
  }
  fs.copyFileSync(from, to);
  const hash = sha256(to);
  const ver = pkgVersion(pkg);
  console.log(`[vendor-libs] ${path.relative(root, from)} -> ${path.relative(root, to)} (${pkg}@${ver} sha256:${hash.slice(0, 16)}…)`);
}

// Bundle multi-module deps (sigma + plugins, graphology + utils) into single
// ESM files under src/lib/ so they load under raw-module dev serve, Electron
// (file://), the esbuild app bundle and the inline-html dist — same parity
// goal as the plain copies above, but these packages have bare-specifier
// imports and need bundling instead of copying.
const esbuild = require('esbuild');

const bundles = [
  {
    entry: path.join(__dirname, 'vendor_entry_graphology.mjs'),
    out: path.join(libDir, 'graphology.bundle.mjs'),
    pkgs: ['graphology', 'graphology-layout', 'graphology-layout-forceatlas2', 'graphology-layout-noverlap', 'graphology-metrics', 'graphology-communities-louvain', '@antv/layout', 'bubblesets-js'],
  },
  {
    entry: path.join(__dirname, 'vendor_entry_sigma.mjs'),
    out: path.join(libDir, 'sigma.bundle.mjs'),
    pkgs: ['sigma', '@sigma/node-square', '@sigma/node-image', '@sigma/node-border', '@sigma/node-piechart', '@sigma/edge-curve', '@sigma/export-image'],
  },
];

for (const {entry, out, pkgs} of bundles) {
  try {
    esbuild.buildSync({
      entryPoints: [entry],
      bundle: true,
      format: 'esm',
      target: 'es2020',
      minify: true,
      legalComments: 'eof',
      outfile: out,
      logLevel: 'silent',
    });
  } catch (err) {
    console.error(`[vendor-libs] esbuild failed for ${path.relative(root, entry)}: ${err.message}`);
    process.exit(1);
  }
  const versions = pkgs.map((p) => `${p}@${pkgVersion(p)}`).join(' ');
  const sizeKb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`[vendor-libs] ${path.relative(root, entry)} -> ${path.relative(root, out)} (${sizeKb} kB; ${versions} sha256:${sha256(out).slice(0, 16)}…)`);
}

// Regenerate assistant prompt modules from their markdown sources so the
// prompts stay human-readable in source control but load as plain JS
// everywhere (serve, electron, bundle, tests).
const promptSources = [
  {
    md: path.join(root, 'src', 'managers', 'assistant', 'system_prompt.md'),
    js: path.join(root, 'src', 'managers', 'assistant', 'system_prompt.js'),
    exportName: 'SYSTEM_PROMPT',
  },
  {
    md: path.join(root, 'src', 'managers', 'assistant', 'query_generator_prompt.md'),
    js: path.join(root, 'src', 'managers', 'assistant', 'query_generator_prompt.js'),
    exportName: 'GENERATOR_SYSTEM_PROMPT',
  },
];

for (const {md, js, exportName} of promptSources) {
  if (!fs.existsSync(md)) continue;
  const body = fs.readFileSync(md, 'utf8');
  const escaped = body.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  const out = `// AUTO-GENERATED from ${path.basename(md)} by src/package/vendor_libs.js.\n// Do not edit by hand — run \`npm run vendor-libs\`.\nexport const ${exportName} = \`${escaped}\`\n`;
  fs.writeFileSync(js, out);
  console.log(`[vendor-libs] ${path.relative(root, md)} -> ${path.relative(root, js)} (${body.length} chars)`);
}
