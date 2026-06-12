/**
 * Drives the edge-flow animation (browser-only — imports the flow programs,
 * which import the sigma bundle; must never be loaded under node/vitest).
 *
 * One instance per SigmaAdapter. While at least one visible edge carries a
 * positive flowMode AND the document is visible, a rAF loop advances the
 * shared flowClock and asks sigma for a redraw-only refresh
 * (skipIndexation: true — buffers untouched, the flow program's setUniforms
 * re-reads the clock). Zero work otherwise: graphology edge events only flip
 * a dirty flag, the actual someEdge rescan is deferred to one rAF so bulk
 * style updates (N mergeEdgeAttributes → N events) pay for a single scan.
 */
import { flowClock } from "./edge_flow_programs.js";

// Graphology events that can change whether any edge flows.
const GRAPH_EVENTS = ["edgeAttributesUpdated", "edgeAdded", "edgeDropped", "edgesCleared", "cleared"];

// flowClock.time wrap, keeping the shader's highp fract() argument small on
// long sessions. 3600 s is a whole number of pattern cycles for every
// slider-step speed (0.2 increments × 40 px/s over 16/48 px periods), so
// wrapping is seamless there; exotic hand-set speeds get at most one phase
// jump per hour.
const TIME_WRAP_S = 3600;

class FlowAnimator {
  /** @param {import("./sigma_adapter.js").SigmaAdapter} adapter */
  constructor(adapter) {
    this.adapter = adapter;
    this.graph = adapter.graph;
    this.killed = false;
    this.rafId = null;
    // Lazily-refreshed "does any visible edge flow" answer.
    this.dirty = true;
    this.hasFlow = false;

    this.onGraphChange = () => {
      this.dirty = true;
      this.#schedule();
    };
    this.onVisibilityChange = () => this.#schedule();

    for (const event of GRAPH_EVENTS) this.graph.on(event, this.onGraphChange);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.#schedule();
  }

  destroy() {
    this.killed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    for (const event of GRAPH_EVENTS) this.graph.off(event, this.onGraphChange);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    // A successor adapter's animator starts from a fresh clock.
    flowClock.time = 0;
  }

  /** Single rAF entry point for ticking AND re-evaluating (never doubled). */
  #schedule() {
    if (this.killed || this.rafId !== null) return;
    this.rafId = requestAnimationFrame(this.#tick);
  }

  #tick = (now) => {
    this.rafId = null;
    if (this.killed) return;
    if (this.dirty) {
      this.hasFlow = this.graph.someEdge((_, attrs) => attrs.flowMode > 0 && !attrs.hidden);
      this.dirty = false;
    }
    // Hidden tab: stop dead (visibilitychange reschedules); browsers throttle
    // background rAF anyway, but an explicit pause keeps the contract clear.
    if (!this.hasFlow || document.visibilityState !== "visible") return;

    // rAF timestamps are DOMHighResTimeStamp milliseconds → seconds.
    flowClock.time = (now / 1000) % TIME_WRAP_S;
    this.adapter.sigma.refresh({ skipIndexation: true });
    this.#schedule();
  };
}

export { FlowAnimator };
