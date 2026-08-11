/**
 * One pending animation frame at a time.
 *
 * The three overlay layers (bubbles, heatmap, notes) all listen to sigma's
 * afterRender, which fires far more often than their own work needs to run —
 * hover alone re-renders — so each coalesced its repaint into a single rAF and
 * cancelled it on destroy. That was the same six lines written three times,
 * around guards that genuinely differ per layer (the heatmap's already-blank
 * early return, the notes' camera fingerprint). Only the coalescing is shared;
 * each layer keeps its own reason to skip a frame.
 */
class FrameCoalescer {
  /** @param {() => void} run  the work to do at most once per frame */
  constructor(run) {
    this.run = run;
    this.handle = null;
    this.killed = false;
  }

  /** @returns {boolean} true while a frame is already pending */
  get pending() {
    return this.handle !== null;
  }

  schedule() {
    if (this.killed || this.handle !== null) return;
    this.handle = requestAnimationFrame(() => {
      this.handle = null;
      if (!this.killed) this.run();
    });
  }

  /** Drop a pending frame and refuse any further ones. */
  kill() {
    this.killed = true;
    if (this.handle !== null) {
      cancelAnimationFrame(this.handle);
      this.handle = null;
    }
  }
}

export { FrameCoalescer };
