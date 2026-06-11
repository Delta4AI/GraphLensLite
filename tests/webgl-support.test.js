// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  isWebGL2Available,
  renderWebGLUnavailableMessage,
  WEBGL2_ERROR_MESSAGE,
  WEBGL2_ERROR_HINT,
} from "../src/graph/webgl_support.js";

// ==========================================================================
// WebGL2 probe + dead-renderer fallback message (src/graph/webgl_support.js).
// core.js runs the probe before constructing SigmaAdapter: sigma 3.0.3's
// createWebGLContext dereferences a null context unchecked, so an unavailable
// WebGL2 must be caught before (and around) `new Sigma(...)`.
// jsdom provides the DOM for the message renderer; jsdom canvases have no
// WebGL at all, so the probe's document-based paths use injected fakes.
// ==========================================================================

function fakeDocument(getContext) {
  return { createElement: () => ({ getContext }) };
}

describe("isWebGL2Available", () => {
  it("returns true when the canvas yields a webgl2 context", () => {
    const doc = fakeDocument((type) => (type === "webgl2" ? {} : null));
    expect(isWebGL2Available(doc)).toBe(true);
  });

  it("returns false when getContext('webgl2') returns null", () => {
    const doc = fakeDocument(() => null);
    expect(isWebGL2Available(doc)).toBe(false);
  });

  it("returns false when context creation throws", () => {
    const doc = fakeDocument(() => {
      throw new Error("context limit reached");
    });
    expect(isWebGL2Available(doc)).toBe(false);
  });

  it("returns false without a document (non-browser environment)", () => {
    expect(isWebGL2Available(null)).toBe(false);
    expect(isWebGL2Available(undefined)).toBe(false);
  });

  it("probes exactly the webgl2 context type (no webgl1 fallback)", () => {
    const requested = [];
    const doc = fakeDocument((type) => {
      requested.push(type);
      return type === "webgl" ? {} : null; // webgl1 present, webgl2 absent
    });
    expect(isWebGL2Available(doc)).toBe(false);
    expect(requested).toEqual(["webgl2"]);
  });
});

describe("renderWebGLUnavailableMessage", () => {
  it("renders the persistent message and hint into the container", () => {
    const container = document.createElement("div");
    renderWebGLUnavailableMessage(container);

    const wrapper = container.querySelector(".webgl-error");
    expect(wrapper).not.toBeNull();
    expect(container.querySelector(".webgl-error-title").textContent).toContain(
      WEBGL2_ERROR_MESSAGE,
    );
    expect(container.querySelector(".webgl-error-hint").textContent).toBe(
      WEBGL2_ERROR_HINT,
    );
  });

  it("clears half-initialized renderer leftovers from the container", () => {
    const container = document.createElement("div");
    container.appendChild(document.createElement("canvas")); // sigma leftover
    renderWebGLUnavailableMessage(container);

    expect(container.querySelector("canvas")).toBeNull();
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild.className).toBe("webgl-error");
  });

  it("is a no-op on a missing container (does not throw)", () => {
    expect(() => renderWebGLUnavailableMessage(null)).not.toThrow();
  });

  it("mentions WebGL2 explicitly so users can act on the message", () => {
    expect(WEBGL2_ERROR_MESSAGE).toContain("WebGL2");
  });
});
