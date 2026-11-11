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
const SHORTCUT_RE = /^(.*?)\s*\((\?|[A-Za-z]|(?:Ctrl|Cmd|Alt|Shift|⇧|⌘)\+?\S{1,3})\)$/;

/**
 * Split a trailing keyboard accelerator off a title. ONE parser for the whole
 * app: the tooltip layer renders it as a kbd chip and the command palette shows
 * it as a row accelerator, and while each had its own regex they disagreed —
 * "(⇧F)" got a chip in the tooltip and no accelerator in the palette.
 *
 * @param {string} text
 * @returns {{text: string, shortcut: string|null}}
 */
export function splitShortcut(text) {
  const m = String(text ?? '').match(SHORTCUT_RE);
  return m ? { text: m[1], shortcut: m[2] } : { text: String(text ?? ''), shortcut: null };
}

/**
 * Split a title string into renderable parts.
 * @param {string} text
 * @returns {{lead: string|null, body: string, shortcut: string|null}}
 */
function parseTip(text) {
  const split = splitShortcut(text);
  const shortcut = split.shortcut;
  text = split.text;
  const dash = text.indexOf(' — ');
  if (dash > 0) {
    return { lead: text.slice(0, dash), body: text.slice(dash + 3), shortcut };
  }
  return { lead: null, body: text, shortcut };
}

/**
 * The one tooltip box and the hover state behind it: which element it belongs
 * to, which titled elements are stripped to hold the native tooltip off, the
 * pending show, and when the last tip hid (for the warm window).
 */
class TooltipLayer {
  constructor(doc) {
    this.doc = doc;
    this.win = doc.defaultView ?? globalThis;
    this.tip = doc.createElement('div');
    this.tip.id = 'uiTip';
    this.tip.className = 'ui-tip';
    this.tip.setAttribute('role', 'tooltip');
    doc.body.appendChild(this.tip);
    this.anchor = null; // element the visible/pending tooltip belongs to
    // The anchor plus any titled ancestors: the native tooltip falls back to the
    // nearest ancestor title (e.g. the OR/AND segment inside the titled join
    // group), so the whole chain must be stashed.
    this.strippedEls = [];
    this.timer = 0;
    this.lastHideAt = -Infinity;
  }

  now() {
    return this.win.performance.now();
  }

  render(text) {
    const { doc, tip } = this;
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

  position(el) {
    const { tip, win } = this;
    // A modal <dialog> sits in the top layer above any z-index; render the
    // tooltip inside it so tips on dialog content stay visible.
    const host = el.closest('dialog[open]') ?? this.doc.body;
    if (tip.parentNode !== host) host.appendChild(tip);

    const r = el.getBoundingClientRect();
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

  show(el, text) {
    // The delayed show can outlive its anchor — panels rebuild their DOM on
    // filter changes; a detached rect would park the tip at the origin.
    if (!el.isConnected) return this.hide();
    this.render(text);
    this.position(el);
  }

  /** Suppress the native tooltip by moving title → data-tip while hovered,
   * on the element and every titled ancestor. */
  strip(el) {
    for (let n = el; n; n = n.parentElement) {
      if (!n.hasAttribute('title')) continue;
      n.dataset.tip = n.getAttribute('title');
      n.removeAttribute('title');
      this.strippedEls.push(n);
    }
  }

  restore() {
    for (const n of this.strippedEls) {
      // A writer may have set a fresh title mid-hover — never clobber it.
      if (!n.hasAttribute('title') && n.dataset.tip !== undefined) {
        n.setAttribute('title', n.dataset.tip);
      }
      delete n.dataset.tip;
    }
    this.strippedEls = [];
  }

  /** Hide the box but keep the anchor stripped — used on click, where the
   * pointer usually still rests on the element. */
  dismiss() {
    clearTimeout(this.timer);
    this.timer = 0;
    if (this.tip.classList.contains('show')) {
      this.tip.classList.remove('show');
      this.lastHideAt = this.now();
    }
  }

  hide() {
    this.dismiss();
    this.restore();
    this.anchor = null;
  }

  /**
   * Is the pointer inside the visible tip? The tip keeps `pointer-events: none`
   * so it can never swallow a click meant for the control it covers, which
   * means it is never an event target either — hover-persistence (WCAG 1.4.13)
   * has to be tested against its box.
   */
  overTip(e) {
    if (!this.tip.classList.contains('show')) return false;
    const r = this.tip.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  engage(el, { viaFocus = false } = {}) {
    if (el === this.anchor) {
      // Focus showed the tip without stripping; a later hover still must
      // suppress the native tooltip.
      if (!viaFocus) this.strip(el);
      return;
    }
    this.hide();
    const text = el.getAttribute('title') ?? el.dataset.tip;
    if (!text) return;
    this.anchor = el;
    if (!viaFocus) this.strip(el); // native tooltips only ever appear on hover
    if (viaFocus || this.now() - this.lastHideAt < WARM_WINDOW_MS) {
      this.show(el, text);
    } else {
      this.timer = setTimeout(() => this.show(el, text), SHOW_DELAY_MS);
    }
  }
}

/**
 * Titled `.disabled` controls keep their pointer events so the tooltip hover
 * can reach them (see style.css) — which also makes them clickable again. One
 * capture-phase guard swallows those clicks for every class-disabled control
 * at once, instead of a check in every handler.
 */
function guardDisabledClicks(doc) {
  doc.addEventListener(
    'click',
    (e) => {
      if (!e.target.closest?.('.disabled')) return;
      // `.disabled` covers a whole subtree, and one thing inside it is meant to
      // stay live: a disabled card's collapse bar, which style.css hands its
      // pointer events back so a section can still be folded (and its layer
      // switch flipped) while its controls are off. Swallowing that click made
      // the chevron on a dimmed card inert.
      if (e.target.closest('.card-collapse-bar')) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true
  );
}

/**
 * Install the global tooltip layer. Call once at boot.
 * @param {Document} doc
 */
function initUiTooltips(doc = document) {
  const layer = new TooltipLayer(doc);
  const hide = () => layer.hide();

  doc.addEventListener('pointerover', (e) => {
    if (layer.overTip(e)) return; // hovering the tip keeps it open (WCAG 1.4.13)
    const el = e.target.closest?.('[title], [data-tip]');
    if (el) layer.engage(el);
    else if (layer.anchor && !layer.anchor.contains(e.target)) hide();
  });
  doc.addEventListener('pointerout', (e) => {
    if (layer.anchor && !e.relatedTarget) hide(); // pointer left the window
  });
  doc.addEventListener('focusin', (e) => {
    const el = e.target.closest?.('[title], [data-tip]');
    if (el && el.matches(':focus-visible')) layer.engage(el, { viaFocus: true });
  });
  doc.addEventListener('focusout', hide);
  doc.addEventListener('pointerdown', () => layer.dismiss());
  guardDisabledClicks(doc);
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  doc.addEventListener('scroll', hide, { capture: true, passive: true });

  // Writers rewrite titles at any time (undo/redo hints, overlay switches,
  // filter counts). A rewrite on the hovered chain would resurrect the native
  // tooltip — re-strip it. Our own strip/restore mutations no-op here: after
  // strip there is no title attribute left, after restore anchor is null.
  new layer.win.MutationObserver((mutations) => {
    const { anchor } = layer;
    if (!anchor) return;
    for (const m of mutations) {
      if (m.target === anchor || m.target.contains?.(anchor)) layer.strip(anchor);
    }
  }).observe(doc.documentElement, {
    attributes: true,
    attributeFilter: ['title'],
    subtree: true,
  });
}

export { initUiTooltips, parseTip };
