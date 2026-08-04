/**
 * Styled replacement for native title tooltips.
 *
 * One delegated layer intercepts every element carrying a `title` attribute —
 * static markup and the many dynamic `.title = …` writers alike — so no call
 * site changes. On hover the title is stashed into `data-tip` (suppressing the
 * native browser tooltip) and restored when the pointer leaves, keeping the
 * attribute canonical for accessibility-name computation and for code that
 * reads titles back (command palette, syncOverlays).
 *
 * Presentation niceties parsed from the existing title strings:
 *  - "Name — description" renders the lead as a bold header line.
 *  - A trailing "(F)" / "(Ctrl+K)" shortcut renders as a <kbd> chip.
 */

import { clampPopoverLeft } from './popover_position.js';

const SHOW_DELAY_MS = 500;
// After a tooltip hides, the next one within this window shows instantly —
// the "warm" toolbar feel of native tooltips.
const WARM_WINDOW_MS = 400;
const ANCHOR_GAP_PX = 7;
const VIEWPORT_MARGIN_PX = 8;

// Trailing keyboard-shortcut suffix, e.g. "(F)", "(?)", "(Ctrl+K)", "(⇧F)".
const SHORTCUT_RE = /^(.*?)\s*\((\?|[A-Za-z]|(?:Ctrl|Alt|Shift|⇧|⌘)\+?\S{1,3})\)$/;

/**
 * Split a title string into renderable parts.
 * @param {string} text
 * @returns {{lead: string|null, body: string, shortcut: string|null}}
 */
function parseTip(text) {
  let shortcut = null;
  const m = text.match(SHORTCUT_RE);
  if (m) {
    text = m[1];
    shortcut = m[2];
  }
  const dash = text.indexOf(' — ');
  if (dash > 0) {
    return { lead: text.slice(0, dash), body: text.slice(dash + 3), shortcut };
  }
  return { lead: null, body: text, shortcut };
}

/**
 * Install the global tooltip layer. Call once at boot.
 * @param {Document} doc
 */
function initUiTooltips(doc = document) {
  const tip = doc.createElement('div');
  tip.id = 'uiTip';
  tip.className = 'ui-tip';
  tip.setAttribute('role', 'tooltip');
  doc.body.appendChild(tip);

  let anchor = null; // element the visible/pending tooltip belongs to
  // The anchor plus any titled ancestors: the native tooltip falls back to the
  // nearest ancestor title (e.g. the OR/AND segment inside the titled join
  // group), so the whole chain must be stashed.
  let strippedEls = [];
  let timer = 0;
  let lastHideAt = -Infinity;
  const now = () => (doc.defaultView ?? globalThis).performance.now();

  function render(text) {
    const { lead, body, shortcut } = parseTip(text);
    tip.replaceChildren();
    if (lead) {
      const b = doc.createElement('span');
      b.className = 'ui-tip-lead';
      b.textContent = lead;
      tip.appendChild(b);
    }
    tip.appendChild(doc.createTextNode(body));
    if (shortcut) {
      const kbd = doc.createElement('kbd');
      kbd.textContent = shortcut;
      tip.appendChild(kbd);
    }
  }

  function position(el) {
    // A modal <dialog> sits in the top layer above any z-index; render the
    // tooltip inside it so tips on dialog content stay visible.
    const host = el.closest('dialog[open]') ?? doc.body;
    if (tip.parentNode !== host) host.appendChild(tip);

    const r = el.getBoundingClientRect();
    const win = doc.defaultView ?? globalThis;
    tip.style.left = '0px';
    tip.style.top = '0px';
    tip.classList.add('show');
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = clampPopoverLeft(r.left + r.width / 2 - w / 2, w, win.innerWidth, VIEWPORT_MARGIN_PX);
    let top = r.bottom + ANCHOR_GAP_PX;
    if (top + h > win.innerHeight - VIEWPORT_MARGIN_PX) top = r.top - h - ANCHOR_GAP_PX;
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(VIEWPORT_MARGIN_PX, top)}px`;
  }

  function show(el, text) {
    // The delayed show can outlive its anchor — panels rebuild their DOM on
    // filter changes; a detached rect would park the tip at the origin.
    if (!el.isConnected) return hide();
    render(text);
    position(el);
  }

  /** Suppress the native tooltip by moving title → data-tip while hovered,
   * on the element and every titled ancestor. */
  function strip(el) {
    for (let n = el; n; n = n.parentElement) {
      if (!n.hasAttribute('title')) continue;
      n.dataset.tip = n.getAttribute('title');
      n.removeAttribute('title');
      strippedEls.push(n);
    }
  }

  function restore() {
    for (const n of strippedEls) {
      // A writer may have set a fresh title mid-hover — never clobber it.
      if (!n.hasAttribute('title') && n.dataset.tip !== undefined) {
        n.setAttribute('title', n.dataset.tip);
      }
      delete n.dataset.tip;
    }
    strippedEls = [];
  }

  /** Hide the box but keep the anchor stripped — used on click, where the
   * pointer usually still rests on the element. */
  function dismiss() {
    clearTimeout(timer);
    timer = 0;
    if (tip.classList.contains('show')) {
      tip.classList.remove('show');
      lastHideAt = now();
    }
  }

  function hide() {
    dismiss();
    restore();
    anchor = null;
  }

  function engage(el, { viaFocus = false } = {}) {
    if (el === anchor) {
      // Focus showed the tip without stripping; a later hover still must
      // suppress the native tooltip.
      if (!viaFocus) strip(el);
      return;
    }
    hide();
    const text = el.getAttribute('title') ?? el.dataset.tip;
    if (!text) return;
    anchor = el;
    if (!viaFocus) strip(el); // native tooltips only ever appear on hover
    if (viaFocus || now() - lastHideAt < WARM_WINDOW_MS) {
      show(el, text);
    } else {
      timer = setTimeout(() => show(el, text), SHOW_DELAY_MS);
    }
  }

  doc.addEventListener('pointerover', (e) => {
    if (tip.contains(e.target)) return; // hovering the tip keeps it open (WCAG 1.4.13)
    const el = e.target.closest?.('[title], [data-tip]');
    if (el) engage(el);
    else if (anchor && !anchor.contains(e.target)) hide();
  });
  doc.addEventListener('pointerout', (e) => {
    if (anchor && !e.relatedTarget) hide(); // pointer left the window
  });
  doc.addEventListener('focusin', (e) => {
    const el = e.target.closest?.('[title], [data-tip]');
    if (el && el.matches(':focus-visible')) engage(el, { viaFocus: true });
  });
  doc.addEventListener('focusout', hide);
  doc.addEventListener('pointerdown', dismiss);
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  doc.addEventListener('scroll', hide, { capture: true, passive: true });

  // Writers rewrite titles at any time (undo/redo hints, overlay switches,
  // filter counts). A rewrite on the hovered chain would resurrect the native
  // tooltip — re-strip it. Our own strip/restore mutations no-op here: after
  // strip there is no title attribute left, after restore anchor is null.
  new (doc.defaultView ?? globalThis).MutationObserver((mutations) => {
    if (!anchor) return;
    for (const m of mutations) {
      if (m.target === anchor || m.target.contains?.(anchor)) strip(anchor);
    }
  }).observe(doc.documentElement, {
    attributes: true,
    attributeFilter: ['title'],
    subtree: true,
  });

  return { hide };
}

export { initUiTooltips, parseTip };
