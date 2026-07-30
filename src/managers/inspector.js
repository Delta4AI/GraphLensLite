/**
 * The inspector (Concept C, phase 4): the single context-driven column that
 * replaced the left filter sidebar, the right styling sidebar and the floating
 * selection HUD. Three contexts — Filters, Overlays (groups, density heatmap,
 * minimap) and Selection (act, arrange, appearance) — share one 356 px column
 * that is always present and never displaced.
 *
 * Overlays used to sit below the filters inside a single "Workspace" panel,
 * where they were unreachable: the filter list is unbounded (855 px on a
 * 15-property template, more on a real one) and both overlay cards ship
 * collapsed at ~33 px, so they never appeared without scrolling past every
 * property. Splitting them out is what makes each pill name exactly one job.
 *
 * Selecting something switches to the Selection context; clearing a selection
 * does NOT switch back, because a panel that yanks itself away on a stray
 * canvas click is the characteristic failure of context-driven inspectors
 * (spec §9). The Selection context shows its own empty state instead.
 */

const CONTEXTS = ['filters', 'overlays', 'selection'];

/** 'filters' → 'Filters', for the id convention both panels and pills follow. */
const elementId = (prefix, name) => `${prefix}${name[0].toUpperCase()}${name.slice(1)}`;

class Inspector {
  constructor() {
    this.context = 'filters';
    this.hadSelection = false;
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
    }
  }

  /**
   * Mirror the live selection: flip the Selection panel between its empty and
   * active states, and pull the context over on the EDGE into a non-empty
   * selection. Edge-triggered, not level-triggered — this runs on every
   * selection recompute (drags, filter changes, style writes), so pulling on
   * the level would drag a user who deliberately switched back to Filters
   * out of it again on the next unrelated event.
   *
   * Only Filters gets pulled away. Tuning an overlay while picking the nodes
   * it applies to is a real loop — bubble-set membership and the heatmap fade
   * are both judged against a selection — so yanking that panel would fight
   * the user rather than follow them.
   */
  syncToSelection(hasSelection) {
    this.panels.selection?.classList.toggle('has-selection', hasSelection);
    if (hasSelection && !this.hadSelection && this.context === 'filters') {
      this.setContext('selection');
    }
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
