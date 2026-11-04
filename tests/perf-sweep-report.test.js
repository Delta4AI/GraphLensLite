// @vitest-environment node
import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { summarizeRuns, largestInteractive, toCsv } = require('../scripts/perf_sweep_report.js');
const { buildFixture } = require('../scripts/generate_benchmark_fixture.js');

describe('render sweep report', () => {
  it('summarises runs as median and type-7 quartiles, skipping missing values', () => {
    const runs = [{ loadMs: 30 }, { loadMs: 10 }, { loadMs: 20 }, { loadMs: null }];
    expect(summarizeRuns(runs, [{ key: 'loadMs' }, { key: 'heapUsedMB' }])).toEqual({
      loadMs: { median: 20, q1: 15, q3: 25, iqr: 10, n: 3 },
    });
  });

  it('picks the largest size whose median zoom and pan both reach 30 FPS', () => {
    const cell = (nodes, zoom, pan) => ({
      nodes,
      edges: nodes,
      ratio: 1,
      variant: 'plain',
      status: 'ok',
      runs: [],
      summary: { wheelZoomFps: { median: zoom }, dragPanFps: { median: pan } },
    });
    const cells = [cell(1000, 60, 60), cell(5000, 45, 31), cell(10000, 50, 29)];
    expect(largestInteractive(cells)).toEqual([{ ratio: 1, variant: 'plain', nodes: 5000 }]);
    expect(toCsv({ cells }).split('\n')).toHaveLength(cells.length + 2); // header + rows + trailing newline
  });
});

describe('benchmark fixture variants', () => {
  it('share one topology and layout; only styling differs', () => {
    const plain = buildFixture({ nodeCount: 80, edgeCount: 120 });
    const overlays = buildFixture({ nodeCount: 80, edgeCount: 120, variant: 'overlays' });
    expect(overlays.edges.map((e) => [e.source, e.target])).toEqual(
      plain.edges.map((e) => [e.source, e.target])
    );
    expect(overlays.layouts.Default.positions).toEqual(plain.layouts.Default.positions);
    expect(overlays.nodes[0].style.label).toBe(true);
    expect(
      overlays.edges.every((e) => e.type === 'cubic' && e.style.flow && e.style.endArrow)
    ).toBe(true);
    expect(overlays.layouts.Default.groupOneManualMembers).toHaveLength(10);
    expect(plain.edges[0].style).toBeUndefined();
  });
});
