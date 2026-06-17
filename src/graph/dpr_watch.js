/**
 * Device-pixel-ratio change watcher.
 *
 * Dragging the window to a monitor with a different DPR changes
 * window.devicePixelRatio without changing the container's CSS box, so
 * sigma.resize() refreshes its pixelRatio but early-returns before re-sizing any
 * canvas — leaving the WebGL layers at the old backing resolution while the
 * bubble/heatmap overlays repaint at the new ratio, so groups land misaligned
 * until a sidebar toggle forces a real resize. The adapter uses this watcher to
 * force that resize automatically on every DPR change.
 */

/**
 * Invoke `onChange` whenever window.devicePixelRatio changes. matchMedia with a
 * ratio-specific resolution query is the standard signal: the query stops
 * matching the instant the ratio leaves its value, so we re-arm against the new
 * ratio after each change. Returns a cleanup that detaches the currently-armed
 * one-shot listener.
 *
 * @param {() => void} onChange
 * @returns {() => void} cleanup
 */
function watchDevicePixelRatio(onChange) {
  let detach = null;
  const handler = () => {
    onChange();
    arm();
  };
  function arm() {
    const dpr = window.devicePixelRatio || 1;
    const media = window.matchMedia?.(`(resolution: ${dpr}dppx)`);
    if (!media?.addEventListener) {
      detach = null;
      return;
    }
    media.addEventListener('change', handler, { once: true });
    detach = () => media.removeEventListener('change', handler);
  }
  arm();
  return () => detach?.();
}

export { watchDevicePixelRatio };
