// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { CFG } from '../src/config.js';

// Same WebGL stand-ins as layout-transition-cancel.test.js: the sigma bundle
// touches the GL interfaces at module scope; nothing here renders.
vi.hoisted(() => {
  globalThis.WebGLRenderingContext ??= class {};
  globalThis.WebGL2RenderingContext ??= class {};
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
const { edgeEventsEnabled } = await import('../src/graph/sigma_adapter.js');

describe('edge events cutoff', () => {
  it('keeps edge hover/click up to the cutoff and drops it above', () => {
    const max = CFG.MAX_EDGES_FOR_EDGE_EVENTS;
    expect(edgeEventsEnabled(0, CFG)).toBe(true);
    expect(edgeEventsEnabled(max, CFG)).toBe(true);
    expect(edgeEventsEnabled(max + 1, CFG)).toBe(false);
  });
});
