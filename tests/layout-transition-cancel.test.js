// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Graph } from '../src/lib/graphology.bundle.mjs';

// The sigma bundle dereferences the WebGL context interfaces at module scope
// (program constants); jsdom doesn't define them. Bare stand-ins are enough —
// nothing here renders.
vi.hoisted(() => {
  globalThis.WebGLRenderingContext ??= class {};
  globalThis.WebGL2RenderingContext ??= class {};
  // The bundle also probes a context for its capability constants; jsdom's
  // getContext throws "not implemented". A do-nothing GL satisfies the probe.
  const fakeGL = new Proxy(
    {},
    {
      get: (target, key) => {
        if (typeof key === 'symbol') return undefined;
        if (key === 'canvas') return document.createElement('canvas');
        return () => 0;
      },
    }
  );
  globalThis.HTMLCanvasElement.prototype.getContext = () => fakeGL;
});
const { SigmaAdapter } = await import('../src/graph/sigma_adapter.js');

// ==========================================================================
// runLayoutTransition: cancellation + bubble fade (workspace switching).
//
// The bundled animateNodes never invokes its completion callback when
// cancelled — cancelling only does cancelAnimationFrame. A workspace tween
// cancelled by a rapid second switch therefore left the first changeLayout
// awaiting forever (its history.reset and finally block never ran). The
// contract under test:
//   - a cancelled transition RESOLVES (no hung caller) and hands ownership
//     (nodeRef mirror, bubble fade, cancel handle) to the newer transition
//   - the bubble canvases fade out for the tween and back in after the
//     settled redraw; a cancelled transition must NOT undo the newer one's
//     fade-out
//
// runLayoutTransition uses no private fields, so it runs via prototype.call
// on a stub `this` — constructing a real SigmaAdapter needs WebGL.
// ==========================================================================

/** Minimal `this` for runLayoutTransition. */
function makeAdapterStub(nodeIds) {
  const graph = new Graph();
  for (const id of nodeIds) graph.addNode(id, { x: 0, y: 0 });
  return {
    graph,
    killed: false,
    pendingLayoutTransition: true,
    layoutTransitionCancel: null,
    sigma: { refresh: vi.fn() },
    bubbleLayer: { setFaded: vi.fn() },
    cache: {
      nodeRef: new Map(nodeIds.map((id) => [id, { style: { x: 0, y: 0 } }])),
      bs: { redrawBubbleSets: vi.fn(async () => {}) },
    },
  };
}

const positionsFor = (nodeIds, x, y) =>
  new Map(nodeIds.map((id) => [id, { style: { x, y } }]));

const run = (stub, positions) =>
  SigmaAdapter.prototype.runLayoutTransition.call(stub, positions);

// animateNodes drives itself with requestAnimationFrame + Date.now. Queue the
// frames and fake the clock so the tween completes deterministically.
let rafQueue = [];
const flushFrame = () => {
  const queued = rafQueue;
  rafQueue = [];
  for (const cb of queued) cb(performance.now());
};
/** Advance past the tween duration and pump frames + microtasks until quiet. */
async function finishTween() {
  vi.setSystemTime(Date.now() + 10_000);
  for (let i = 0; i < 10 && rafQueue.length > 0; i++) {
    flushFrame();
    await Promise.resolve();
  }
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  rafQueue = [];
  vi.stubGlobal('requestAnimationFrame', (cb) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('runLayoutTransition', () => {
  it('completes a tween: nodes land on targets, nodeRef mirrored, fade out then in', async () => {
    const stub = makeAdapterStub(['a', 'b']);
    const done = run(stub, positionsFor(['a', 'b'], 100, 50));
    expect(stub.pendingLayoutTransition).toBe(false);
    expect(stub.bubbleLayer.setFaded).toHaveBeenCalledWith(true);

    await finishTween();
    await done;

    expect(stub.graph.getNodeAttributes('a').x).toBe(100);
    expect(stub.cache.nodeRef.get('a').style).toEqual({ x: 100, y: 50 });
    expect(stub.cache.bs.redrawBubbleSets).toHaveBeenCalledTimes(1);
    expect(stub.bubbleLayer.setFaded).toHaveBeenLastCalledWith(false);
    expect(stub.layoutTransitionCancel).toBe(null);
  });

  it('resolves a cancelled tween instead of hanging its caller', async () => {
    const stub = makeAdapterStub(['a']);
    const first = run(stub, positionsFor(['a'], 100, 0));
    const second = run(stub, positionsFor(['a'], 200, 0)); // cancels the first

    let firstSettled = false;
    first.then(() => {
      firstSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(firstSettled).toBe(true);

    await finishTween();
    await second;
    expect(stub.graph.getNodeAttributes('a').x).toBe(200);
  });

  it('a cancelled transition leaves fade and cancel handle to the newer one', async () => {
    const stub = makeAdapterStub(['a']);
    const first = run(stub, positionsFor(['a'], 100, 0));
    const second = run(stub, positionsFor(['a'], 200, 0));
    await first;

    // The first transition must not have faded the bubbles back in (the
    // second is still tweening) nor cleared the second's cancel handle.
    expect(stub.bubbleLayer.setFaded).not.toHaveBeenCalledWith(false);
    expect(stub.layoutTransitionCancel).not.toBe(null);
    // Ownership: the cancelled run skips the nodeRef mirror and the redraw.
    expect(stub.cache.bs.redrawBubbleSets).not.toHaveBeenCalled();

    await finishTween();
    await second;
    expect(stub.bubbleLayer.setFaded).toHaveBeenLastCalledWith(false);
    expect(stub.layoutTransitionCancel).toBe(null);
    expect(stub.cache.nodeRef.get('a').style.x).toBe(200);
  });

  it('snaps without fading past the node budget', async () => {
    const ids = Array.from({ length: 2001 }, (_, i) => `n${i}`);
    const stub = makeAdapterStub(ids);
    await run(stub, positionsFor(ids, 42, 7));

    expect(stub.graph.getNodeAttributes('n0').x).toBe(42);
    expect(stub.sigma.refresh).toHaveBeenCalledWith({ skipIndexation: true });
    // Never faded out; the shared tail may harmlessly re-assert visibility.
    expect(stub.bubbleLayer.setFaded).not.toHaveBeenCalledWith(true);
  });
});
