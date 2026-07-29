/**
 * The inspector (Concept C, phase 4): the single context-driven column that
 * replaced the left filter sidebar, the right styling sidebar and the floating
 * selection HUD. Two contexts — Workspace (filters, groups, overlays, find,
 * metrics) and Selection (act, arrange, appearance) — share one 356 px column
 * that is always present and never displaced.
 *
 * The router is deliberately two-state. Selecting something switches to the
 * Selection context; clearing a selection does NOT switch back, because a
 * panel that yanks itself away on a stray canvas click is the characteristic
 * failure of context-driven inspectors (spec §9). The Selection context shows
 * its own empty state instead.
 */

const CONTEXTS = ['workspace', 'selection'];

class Inspector {
  constructor() {
    this.context = 'workspace';
    this.hadSelection = false;
    this.panels = {
      workspace: document.getElementById('inspectorWorkspace'),
      selection: document.getElementById('inspectorSelection'),
    };
    this.pills = {
      workspace: document.getElementById('inspectorPillWorkspace'),
      selection: document.getElementById('inspectorPillSelection'),
    };
    for (const name of CONTEXTS) {
      this.pills[name]?.addEventListener('click', () => this.setContext(name));
      // role=tab carries a keyboard contract: arrows move between tabs and
      // only the selected one is in the tab order (roving tabindex).
      this.pills[name]?.addEventListener('keydown', (e) => this.#onPillKey(e));
    }
    this.setContext(this.context);
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

  /** @param {'workspace'|'selection'} name */
  setContext(name) {
    if (!CONTEXTS.includes(name)) return;
    this.context = name;
    for (const other of CONTEXTS) {
      const active = other === name;
      this.panels[other]?.toggleAttribute('hidden', !active);
      this.pills[other]?.classList.toggle('active', active);
      this.pills[other]?.setAttribute('aria-selected', String(active));
      this.pills[other]?.setAttribute('tabindex', active ? '0' : '-1');
    }
  }

  /**
   * Mirror the live selection: flip the Selection panel between its empty and
   * active states, and pull the context over on the EDGE into a non-empty
   * selection. Edge-triggered, not level-triggered — this runs on every
   * selection recompute (drags, filter changes, style writes), so pulling on
   * the level would drag a user who deliberately switched back to Workspace
   * out of it again on the next unrelated event.
   */
  syncToSelection(hasSelection) {
    this.panels.selection?.classList.toggle('has-selection', hasSelection);
    if (hasSelection && !this.hadSelection) this.setContext('selection');
    this.hadSelection = hasSelection;
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
export function initInspector() {
  return document.getElementById('inspectorBody') ? new Inspector() : null;
}

export { Inspector };
