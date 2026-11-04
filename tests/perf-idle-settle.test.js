import { createRequire } from 'module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { waitForRafSettle } = require('../scripts/perf_benchmark.js');

const OPTS = { frameMs: 50, runFrames: 30, timeoutMs: 15000 };

/** Fake rAF clock: each frame lands `intervals()` ms after the previous one. */
function stubFrames(intervals) {
  let clock = 0;
  vi.stubGlobal('performance', { now: () => clock });
  vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => cb((clock += intervals())), 0));
}

describe('waitForRafSettle', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('waits out a GPU backlog of slow frames before reporting idle', async () => {
    // The wheel-zoom tail on a 50k graph: ~400 ms frames with short on-budget
    // runs in between, then steady 60 Hz. Settling needs 30 fast frames in a
    // row, so it must resolve only after the last slow frame.
    const backlog = [400, ...Array(20).fill(16), 400, ...Array(20).fill(16), 400];
    let frame = 0;
    stubFrames(() => backlog[frame++] ?? 16);
    const result = await waitForRafSettle(OPTS);
    expect(result.settled).toBe(true);
    expect(result.waitedMs).toBe(3 * 400 + 40 * 16 + 30 * 16);
  });

  it('gives up after the timeout when frames never get back on budget', async () => {
    stubFrames(() => 400);
    const result = await waitForRafSettle(OPTS);
    expect(result).toEqual({ settled: false, waitedMs: 15200 });
  });
});
