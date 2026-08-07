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

/**
 * Same clamp on the vertical axis: top offset for a popover that would
 * otherwise truncate at the bottom edge (anchor near the bottom border).
 * The maths is axis-agnostic, only the name differs.
 */
export const clampPopoverTop = clampPopoverLeft;

/**
 * Where a dropdown PANEL should open relative to its anchor: flip upward when
 * there is more room above than below, and cap the height (with scroll) to the
 * chosen side so it never spills past the window edge.
 *
 * Pure function of measured geometry, so the flip logic stays unit-testable.
 * Lives here rather than in StaticUtilities: this module is the placement home
 * (four callers), and two homes for anchored-overlay maths is one too many.
 *
 * @param {{anchorRect: {top: number, bottom: number, left: number},
 *   dropdownHeight: number, viewportHeight: number, margin?: number}} opts
 * @returns {{openUp: boolean, left: number, top: number, maxHeight: number|null}}
 */
export function computeDropdownPlacement({
  anchorRect,
  dropdownHeight,
  viewportHeight,
  margin = 4,
}) {
  const spaceBelow = viewportHeight - anchorRect.bottom - margin;
  const spaceAbove = anchorRect.top - margin;
  const openUp = dropdownHeight > spaceBelow && spaceAbove > spaceBelow;
  const available = Math.max(0, openUp ? spaceAbove : spaceBelow);
  const height = Math.min(dropdownHeight, available);
  return {
    openUp,
    left: anchorRect.left - 3,
    top: openUp ? anchorRect.top - height : anchorRect.bottom,
    maxHeight: dropdownHeight > available ? available : null,
  };
}
