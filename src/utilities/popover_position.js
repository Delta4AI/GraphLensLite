// Shared placement maths for button-anchored popovers (export resolution,
// community detection). Keeps the popover left-aligned to its anchor but
// pulls it back inside the viewport so the right edge never truncates —
// the failure mode when the anchor sits near the right edge.

const VIEWPORT_MARGIN = 8;

/**
 * Left offset (px) for a popover anchored below a button.
 *
 * Prefers the anchor's left edge; if that would push the popover past the
 * right margin, slides it left just enough to fit; never goes past the left
 * margin on very narrow viewports.
 *
 * @param {number} anchorLeft   anchor's left edge (viewport px)
 * @param {number} popoverWidth measured popover width incl. padding + border
 * @param {number} viewportWidth window.innerWidth
 * @param {number} [margin] gap to keep from each viewport edge
 * @returns {number}
 */
export function clampPopoverLeft(anchorLeft, popoverWidth, viewportWidth, margin = VIEWPORT_MARGIN) {
  const maxLeft = viewportWidth - popoverWidth - margin;
  return Math.max(margin, Math.min(anchorLeft, maxLeft));
}
