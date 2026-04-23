#!/usr/bin/env node
// Copies ESM builds of npm deps into src/lib/ so they load under raw-module
// dev serve (npm run serve) and keep parity with vendored libs (g6, exceljs).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const libDir = path.join(root, 'src', 'lib');

const copies = [
  {
    from: path.join(root, 'node_modules', 'marked', 'lib', 'marked.esm.js'),
    to: path.join(libDir, 'marked.esm.js'),
  },
  {
    from: path.join(root, 'node_modules', 'dompurify', 'dist', 'purify.es.mjs'),
    to: path.join(libDir, 'purify.esm.mjs'),
  },
];

fs.mkdirSync(libDir, {recursive: true});
for (const {from, to} of copies) {
  if (!fs.existsSync(from)) {
    console.error(`[vendor-libs] Missing source: ${from}`);
    console.error('[vendor-libs] Run `npm install` first.');
    process.exit(1);
  }
  fs.copyFileSync(from, to);
  console.log(`[vendor-libs] ${path.relative(root, from)} -> ${path.relative(root, to)}`);
}
