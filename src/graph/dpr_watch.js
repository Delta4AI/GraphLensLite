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

/**
 * Resize (if needed) and clear an overlay canvas, scaled to the device ratio.
 * Shared by the bubble and heatmap layers, which are both canvases sigma did
 * not create and therefore does not size.
 *
 * Owning the CSS display size is the whole point: sigma.createCanvasContext
 * only sets position:absolute, and sigma.resize() — the sole writer of
 * element.style width/height — runs once at construction, before these
 * canvases exist, and early-returns on unchanged dimensions. Left unset, a
 * canvas displays at its backing-store size (width*dpr CSS px), dpr* too
 * large on a >1 DPR display, so the overlay lands in the wrong place until a
 * panel toggle forces a real sigma resize.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width   CSS pixels
 * @param {number} height  CSS pixels
 * @param {number} dpr
 */
function prepareOverlayCanvas(canvas, ctx, width, height, dpr) {
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }
  if (canvas.style.width !== `${width}px`) canvas.style.width = `${width}px`;
  if (canvas.style.height !== `${height}px`) canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
}

export { watchDevicePixelRatio, prepareOverlayCanvas };
