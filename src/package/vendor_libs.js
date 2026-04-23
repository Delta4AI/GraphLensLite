#!/usr/bin/env node
// Copies ESM builds of npm deps into src/lib/ so they load under raw-module
// dev serve (npm run serve) and keep parity with vendored libs (g6, exceljs).
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

// Regenerate the assistant system prompt module from its markdown source so
// the prompt stays human-readable in source control but loads as plain JS
// everywhere (serve, electron, bundle, tests).
const promptMd = path.join(root, 'src', 'managers', 'assistant', 'system_prompt.md');
const promptJs = path.join(root, 'src', 'managers', 'assistant', 'system_prompt.js');
if (fs.existsSync(promptMd)) {
  const body = fs.readFileSync(promptMd, 'utf8');
  const escaped = body.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  const out = `// AUTO-GENERATED from system_prompt.md by src/package/vendor_libs.js.\n// Do not edit by hand — run \`npm run vendor-libs\`.\nexport const SYSTEM_PROMPT = \`${escaped}\`\n`;
  fs.writeFileSync(promptJs, out);
  console.log(`[vendor-libs] ${path.relative(root, promptMd)} -> ${path.relative(root, promptJs)} (${body.length} chars)`);
}
