// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  THEME_STORAGE_KEY,
  applyTheme,
  currentTheme,
  initTheme,
  nodeLabelColorForTheme,
  resolveInitialTheme,
} from "../src/utilities/theme.js";

// ==========================================================================
// Theme resolution + application (src/utilities/theme.js). The dark theme is
// a data-theme attribute on <html>; persistence under localStorage gllTheme;
// prefers-color-scheme is only the default while no stored choice exists.
// ==========================================================================

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  window.localStorage.clear();
});

describe("resolveInitialTheme", () => {
  it("falls back to prefers-color-scheme when nothing is stored", () => {
    expect(resolveInitialTheme(null, true)).toBe("dark");
    expect(resolveInitialTheme(null, false)).toBe("light");
  });

  it("stored preference wins over prefers-color-scheme", () => {
    expect(resolveInitialTheme("light", true)).toBe("light");
    expect(resolveInitialTheme("dark", false)).toBe("dark");
  });

  it("ignores invalid stored values", () => {
    expect(resolveInitialTheme("blue", true)).toBe("dark");
    expect(resolveInitialTheme("", false)).toBe("light");
    expect(resolveInitialTheme(undefined, false)).toBe("light");
  });
});

describe("applyTheme", () => {
  it("sets data-theme=dark on <html> and persists", () => {
    applyTheme(document, "dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("removes the attribute for light and persists", () => {
    applyTheme(document, "dark");
    applyTheme(document, "light");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("skips persistence when persist is false", () => {
    applyTheme(document, "dark", { persist: false });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("survives an unavailable localStorage", () => {
    const doc = {
      documentElement: document.documentElement,
      defaultView: {
        get localStorage() {
          throw new Error("denied");
        },
      },
    };
    expect(() => applyTheme(doc, "dark")).not.toThrow();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

describe("currentTheme", () => {
  it("reflects the data-theme attribute", () => {
    expect(currentTheme(document)).toBe("light");
    document.documentElement.setAttribute("data-theme", "dark");
    expect(currentTheme(document)).toBe("dark");
  });
});

describe("nodeLabelColorForTheme", () => {
  it("is dark text for light theme and light text for dark theme", () => {
    expect(nodeLabelColorForTheme("light")).toBe("#000");
    expect(nodeLabelColorForTheme("dark")).toBe("#E7E6EE");
  });

  it("falls back to the light color for unknown themes", () => {
    expect(nodeLabelColorForTheme("mystery")).toBe("#000");
  });
});

describe("initTheme", () => {
  const win = (stored, prefersDark) => ({
    localStorage: {
      getItem: () => stored,
      setItem: (k, v) => window.localStorage.setItem(k, v),
    },
    matchMedia: (q) => ({
      matches: q === "(prefers-color-scheme: dark)" ? prefersDark : false,
    }),
  });

  it("applies the OS preference when nothing is stored, without persisting", () => {
    expect(initTheme(document, win(null, true))).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    // OS-default keeps following the OS until the user explicitly toggles.
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("applies light when nothing is stored and the OS prefers light", () => {
    expect(initTheme(document, win(null, false))).toBe("light");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("stored preference wins over the OS preference", () => {
    expect(initTheme(document, win("light", true))).toBe("light");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);

    expect(initTheme(document, win("dark", false))).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("tolerates a window without matchMedia or localStorage", () => {
    expect(initTheme(document, {})).toBe("light");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
