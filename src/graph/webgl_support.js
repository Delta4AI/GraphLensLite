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
