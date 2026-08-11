import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ==========================================================================
// ARCHITECTURE.md is the map an agent (or a new maintainer) reads before
// touching anything, and its graph-layer / managers / utilities lists are meant
// to be exhaustive. They drifted: 2100 lines of new code — annotation_layer,
// annotation_geometry, bubble_tuning, bubble_smoothing, ui_tooltip — shipped
// with no entry. This fails the next time that happens.
// ==========================================================================

const root = path.resolve(import.meta.dirname, '..');
const doc = fs.readFileSync(path.join(root, 'ARCHITECTURE.md'), 'utf8');

const modulesIn = (dir) =>
  fs
    .readdirSync(path.join(root, dir))
    .filter((f) => f.endsWith('.js'))
    .sort();

describe('ARCHITECTURE.md module map', () => {
  it.each(['src/graph', 'src/managers', 'src/utilities'])('names every module in %s', (dir) => {
    const missing = modulesIn(dir).filter((file) => !doc.includes(file));
    expect(missing).toEqual([]);
  });

  it('does not name modules that no longer exist', () => {
    const real = new Set([
      ...modulesIn('src/graph'),
      ...modulesIn('src/managers'),
      ...modulesIn('src/utilities'),
      ...fs.readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.js')),
      ...fs.readdirSync(path.join(root, 'src/package')).filter((f) => f.endsWith('.js')),
      ...fs.readdirSync(path.join(root, 'src/managers/assistant')).filter((f) => f.endsWith('.js')),
      ...fs.readdirSync(path.join(root, 'src/lib')),
      ...fs.readdirSync(path.join(root, 'server')).filter((f) => f.endsWith('.js')),
    ]);
    // Backticked `foo.js` mentions only — prose may name a file that lives
    // elsewhere (e.g. a build output).
    const named = [...doc.matchAll(/`([\w.-]+\.js)`/g)].map((m) => m[1]);
    const stale = [...new Set(named)].filter((f) => !real.has(f));
    expect(stale).toEqual([]);
  });
});
