/**
 * The inspector: the single context-driven 356 px column on the right, always
 * present and never displaced — except at phone width, where it is a bottom
 * sheet opened from the rail's ▤ Panel button (openSheet / closeSheet). Three contexts — Filters, Overlays (groups,
 * density heatmap, notes, minimap) and Selection (act, arrange, appearance) —
 * share it, and each pill names exactly one job.
 *
 * NOTHING switches context on its own. A panel that swaps itself out from under
 * the click that caused it costs the user the row they were working in — the
 * characteristic failure of context-driven inspectors, and just as true entering
 * a context as leaving one. A change the user did not make from the panel it
 * belongs to announces itself by flashing that pill instead; the move stays
 * theirs. Only the Selection pill does that today (syncToSelection) — filter and
 * overlay changes are nearly always made from their own panel, where a flash
 * would be noise.
 */

const CONTEXTS = ['filters', 'overlays', 'selection'];

/** Matches the .insp-pill.flash animation; the class is what drives it. */
const FLASH_MS = 1200;

/** Below this width the inspector is a bottom sheet (style.css has the twin query). */
const PHONE_QUERY = '(max-width: 760px)';
const isPhone = () => !!globalThis.matchMedia?.(PHONE_QUERY).matches;

/** 'filters' → 'Filters', for the id convention both panels and pills follow. */
const elementId = (prefix, name) => `${prefix}${name[0].toUpperCase()}${name.slice(1)}`;

class Inspector {
  #flashTimer = null;

  constructor(cache = null) {
    this.cache = cache;
    this.context = 'filters';
    this.selectionSize = '0/0';
    this.panels = {};
    this.pills = {};
    for (const name of CONTEXTS) {
      this.panels[name] = document.getElementById(elementId('inspector', name));
      this.pills[name] = document.getElementById(elementId('inspectorPill', name));
    }
    for (const name of CONTEXTS) {
      this.pills[name]?.addEventListener('click', () => this.setContext(name));
      // role=tab carries a keyboard contract: arrows move between tabs and
      // only the selected one is in the tab order (roving tabindex).
      this.pills[name]?.addEventListener('keydown', (e) => this.#onPillKey(e));
    }
    this.setContext(this.context);
    // Escape closes the sheet from anywhere inside it; a field's own Escape
    // (a menu, an edit) stops propagation first.
    document.getElementById('inspector')?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.sheet && isPhone()) this.closeSheet();
    });
  }

  // ------------------------------------------------- phone: the bottom sheet

  /** null (closed), 'half' or 'full'. Ignored above the phone breakpoint. */
  get sheet() {
    return document.body.dataset.sheet || null;
  }

  /** @param {'half'|'full'} [detent] */
  openSheet(detent = 'half') {
    document.body.dataset.sheet = detent;
    document.querySelector('.sheet-grab')?.setAttribute('aria-label', detent === 'full' ? 'Shorter panel' : 'Taller panel');
    document.getElementById('panelToggleBtn')?.setAttribute('aria-expanded', 'true');
    // One sheet at a time on a phone: the workbench rises from the same edge.
    if (isPhone()) this.cache?.workbench?.close();
    this.pills[this.context]?.focus();
    this.cache?.graph?.resize?.(); // half height shrinks the stage
  }

  closeSheet() {
    if (!this.sheet) return;
    const hadFocus = document.getElementById('inspector')?.contains(document.activeElement);
    delete document.body.dataset.sheet;
    const toggle = document.getElementById('panelToggleBtn');
    toggle?.setAttribute('aria-expanded', 'false');
    if (hadFocus) toggle?.focus();
    this.cache?.graph?.resize?.();
  }

  toggleSheet() {
    if (this.sheet) this.closeSheet();
    else this.openSheet();
  }

  /** The grabber: half ↔ full. */
  cycleSheet() {
    const next = this.sheet === 'full' ? 'half' : 'full';
    document.body.dataset.sheet = next;
    document.querySelector('.sheet-grab')?.setAttribute('aria-label', next === 'full' ? 'Shorter panel' : 'Taller panel');
    this.cache?.graph?.resize?.();
  }

  #onPillKey(event) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    const jump = { Home: CONTEXTS[0], End: CONTEXTS[CONTEXTS.length - 1] }[event.key];
    if (step === undefined && jump === undefined) return;
    event.preventDefault();
    const next =
      jump ?? CONTEXTS[(CONTEXTS.indexOf(this.context) + step + CONTEXTS.length) % CONTEXTS.length];
    this.setContext(next);
    this.pills[next]?.focus();
  }

  /** @param {'filters'|'overlays'|'selection'} name */
  setContext(name) {
    if (!CONTEXTS.includes(name)) return;
    this.context = name;
    for (const other of CONTEXTS) {
      const active = other === name;
      this.panels[other]?.toggleAttribute('hidden', !active);
      this.pills[other]?.classList.toggle('active', active);
      this.pills[other]?.setAttribute('aria-selected', String(active));
      this.pills[other]?.setAttribute('tabindex', active ? '0' : '-1');
      // Opening a context answers whatever its flash was announcing.
      if (active) this.pills[other]?.classList.remove('flash');
    }
  }

  /** "Something landed over here" — without taking the panel the user is in. */
  flashPill(name) {
    const pill = this.pills[name];
    if (!pill || this.context === name) return;
    clearTimeout(this.#flashTimer);
    // Restart rather than stack: two changes in quick succession are one
    // "look here", and a half-finished animation must not swallow the second.
    for (const other of CONTEXTS) this.pills[other]?.classList.remove('flash');
    void pill.offsetWidth;
    pill.classList.add('flash');
    this.#flashTimer = setTimeout(() => pill.classList.remove('flash'), FLASH_MS);
  }

  /**
   * Mirror the live selection: flip the Selection panel between its empty and
   * active states, and flash the Selection pill whenever the selection changes
   * while the user is looking somewhere else.
   *
   * On the change, not on the level: this runs on every selection recompute
   * (drags, filter changes, style writes), and a pill that pulsed on all of
   * them would be noise. On the change rather than only on the 0 → N edge,
   * because "Add to selection" fires just as often against a selection that
   * already exists, and that is the case the hint has to cover.
   */
  syncToSelection(nodeCount, edgeCount) {
    const size = `${nodeCount}/${edgeCount}`;
    const changed = size !== this.selectionSize;
    this.selectionSize = size;
    this.panels.selection?.classList.toggle('has-selection', nodeCount + edgeCount > 0);
    // With the sheet closed, the Panel button is the one place that shows a selection.
    const total = nodeCount + edgeCount;
    const count = document.querySelector('#panelToggleBtn .rail-panel-count');
    if (count) count.textContent = total > 0 ? String(total) : '';
    if (changed && nodeCount + edgeCount > 0) this.flashPill('selection');
  }

  /** "Y": bring the appearance controls into view, whatever context is up. */
  showAppearance() {
    this.setContext('selection');
    document
      .getElementById('inspectorAppearanceTitle')
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}

/** Safe in DOMs without the inspector markup (unit tests): returns null. */
export function initInspector(cache) {
  return document.getElementById('inspectorBody') ? new Inspector(cache) : null;
}

