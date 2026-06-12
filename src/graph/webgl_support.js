/**
 * WebGL2 availability probe + persistent in-container fallback message.
 *
 * Sigma v3 needs a WebGL context; its createWebGLContext falls through
 * webgl2 → webgl → experimental-webgl and then dereferences the result
 * unchecked, so `new Sigma(...)` dies with an opaque TypeError ("Cannot read
 * properties of null (reading 'blendFunc')") when none is available (GPU
 * blocklist, remote desktop, disabled flags). We probe webgl2 specifically —
 * sigma's shader programs assume it — and render a clear message instead.
 *
 * Node-safe: no sigma import; DOM access only inside the functions.
 */

export const WEBGL2_ERROR_MESSAGE =
  "Graph rendering requires WebGL2, which is not available in this browser or environment.";
export const WEBGL2_ERROR_HINT =
  "Enable hardware acceleration in your browser settings (or update your GPU drivers), then reload.";

/**
 * Cheap pre-check before constructing the renderer. A passing probe does not
 * guarantee sigma's own context creation succeeds (callers must still wrap
 * construction), but a failing probe is definitive.
 *
 * @param {Document} [doc] injectable for tests; defaults to the global document
 * @returns {boolean}
 */
export function isWebGL2Available(doc = globalThis.document) {
  if (!doc) return false;
  try {
    const canvas = doc.createElement("canvas");
    return canvas.getContext("webgl2") != null;
  } catch {
    return false;
  }
}

// Probe result is per-GPU, not per-call: cache it for the session.
let cachedMaxSide = null;

/**
 * Largest canvas side (device px) the WebGL2 driver claims to render to.
 * Sigma draws through WebGL framebuffers, whose ceiling
 * (MAX_RENDERBUFFER_SIZE / MAX_TEXTURE_SIZE) is what actually governs
 * high-resolution exports — Chrome's 2D-canvas limits are often higher, and
 * exceeding the GL ceiling fails SILENTLY (blank render, no exception).
 *
 * @param {Document} [doc] injectable for tests; defaults to the global document
 * @returns {number|null} the probed side limit, or null when no context exists
 */
export function webglMaxCanvasSide(doc = globalThis.document) {
  if (cachedMaxSide !== null) return cachedMaxSide;
  if (!doc) return null;
  try {
    const gl = doc.createElement("canvas").getContext("webgl2");
    if (!gl) return null;
    const side = Math.min(
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      gl.getParameter(gl.MAX_TEXTURE_SIZE),
    );
    if (Number.isFinite(side) && side > 0) cachedMaxSide = side;
    return cachedMaxSide;
  } catch {
    return null;
  }
}

/** Test hook: forget the cached probe so a fake document can be re-probed. */
export function resetWebglMaxCanvasSideCache() {
  cachedMaxSide = null;
}

/**
 * Renders the WebGL2-unavailable message into the graph container. The
 * renderer is permanently dead in this session, so a transient toast is not
 * enough — the message must persist where the graph would be. Clears any
 * half-initialized sigma canvases first.
 *
 * @param {HTMLElement|null} containerEl
 */
export function renderWebGLUnavailableMessage(containerEl) {
  if (!containerEl) return;
  const doc = containerEl.ownerDocument;
  containerEl.replaceChildren();

  const wrapper = doc.createElement("div");
  wrapper.className = "webgl-error";

  const title = doc.createElement("p");
  title.className = "webgl-error-title";
  title.textContent = `⛔ ${WEBGL2_ERROR_MESSAGE}`;

  const hint = doc.createElement("p");
  hint.className = "webgl-error-hint";
  hint.textContent = WEBGL2_ERROR_HINT;

  wrapper.append(title, hint);
  containerEl.appendChild(wrapper);
}
