/**
 * Light/dark theme handling.
 *
 * The active theme is a `data-theme="dark"` attribute on <html> (absent =
 * light) driving the CSS custom-property overrides at the top of style.css.
 * The choice persists under localStorage "gllTheme"; prefers-color-scheme is
 * only the initial default while no stored choice exists.
 */

const THEME_STORAGE_KEY = "gllTheme";

// Renderer fallback for node labels without a per-element labelColor
// (sigma settings.labelColor → label_renderers.js resolveSettingsColor).
// User-set label colors on nodes/edges are never touched.
const NODE_LABEL_COLORS = { light: "#000", dark: "#E7E6EE" };

/**
 * @param {string|null} stored  persisted preference ("light"|"dark"|null)
 * @param {boolean} prefersDark  matchMedia("(prefers-color-scheme: dark)")
 * @returns {"light"|"dark"}
 */
function resolveInitialTheme(stored, prefersDark) {
  if (stored === "dark" || stored === "light") return stored;
  return prefersDark ? "dark" : "light";
}

/**
 * Set/remove the data-theme attribute and (by default) persist the choice.
 * @param {Document} doc
 * @param {"light"|"dark"} theme
 * @param {{persist?: boolean}} [opts]
 */
function applyTheme(doc, theme, { persist = true } = {}) {
  if (theme === "dark") doc.documentElement.setAttribute("data-theme", "dark");
  else doc.documentElement.removeAttribute("data-theme");
  if (!persist) return;
  try {
    (doc.defaultView ?? globalThis).localStorage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable (e.g. blocked) — theme stays session-only.
  }
}

/** @returns {"light"|"dark"} */
function currentTheme(doc) {
  return doc.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function nodeLabelColorForTheme(theme) {
  return NODE_LABEL_COLORS[theme] ?? NODE_LABEL_COLORS.light;
}

/**
 * Boot helper: resolve the stored preference (OS preference as fallback)
 * and apply it. Only an explicit stored choice is (re-)persisted, so the
 * OS-preference default keeps following the OS until the user toggles.
 */
function initTheme(doc, win) {
  let stored = null;
  try {
    stored = win.localStorage?.getItem(THEME_STORAGE_KEY) ?? null;
  } catch {
    stored = null;
  }
  const prefersDark = win.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;
  const theme = resolveInitialTheme(stored, prefersDark);
  applyTheme(doc, theme, { persist: stored !== null });
  return theme;
}

export {
  THEME_STORAGE_KEY,
  resolveInitialTheme,
  applyTheme,
  currentTheme,
  nodeLabelColorForTheme,
  initTheme,
};
