/**
 * The expanded filter surface (Concept C, phase 6 / spec §6.4): `⤢` lifts the
 * inspector's Filters section out of its 356 px column and onto a multi-column
 * surface over the stage; `⤡` (or Escape) puts it back.
 *
 * There is exactly ONE filter DOM. The surface re-parents `#filterContainer`
 * rather than building a second copy — the same trick `ui.js` CARD_MOUNTS uses
 * for the styling cards. Re-parenting preserves every listener and every live
 * widget object (BooleanToggle / DropdownChecklist / InvertibleRangeSlider), so
 * a filter behaves identically in either place and a `buildFilterUI()` rebuild
 * while expanded simply fills whichever parent the container currently has.
 *
 * The surface stops at the top of the workbench (`--workbench-height`) instead
 * of covering it, so filtering and the query editor can be used together.
 */

class FilterSurface {
  /** Escape-to-collapse handler, live only while the surface is open. */
  #escape = null;

  constructor(cache) {
    this.cache = cache;
    this.el = document.getElementById('filterSurface');
    this.mount = document.getElementById('filterSurfaceMount');
    this.home = document.getElementById('filterHome');
    this.container = document.getElementById('filterContainer');
    this.countEl = document.getElementById('filterSurfaceCount');
    this.toggleBtn = document.getElementById('inspectorExpandBtn');
    this.homeNote = document.getElementById('filterExpandedNote');
    // Delegated, because buildFilterUI empties #filterContainer on every
    // rebuild and takes the search box with it. The container element itself
    // survives, so one listener here outlives every rebuild — binding to the
    // input would mean re-binding from the builder on the surface's behalf.
    this.container?.addEventListener('input', (event) => {
      if (event.target.id === 'filterSearch') this.applySearch();
    });
  }

  /**
   * Looked up per call, not cached: the search box lives inside
   * #filterContainer (so it travels with the rows and works in the narrow
   * panel too), and buildFilterUI replaces that subtree on every rebuild.
   */
  get searchInput() {
    return document.getElementById('filterSearch');
  }

  get isOpen() {
    return !!this.el && !this.el.hasAttribute('hidden');
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    if (!this.el || this.isOpen) return;
    // Expanding the filters from another context would leave the inspector
    // showing a panel nobody asked about once the surface collapses again.
    this.cache.inspector?.setContext('filters');
    this.mount.appendChild(this.container);
    // Breadth is the point here: every section at once, so the narrow panel's
    // node/edge scope segment steps aside. CSS reads the class; there is still
    // exactly one filter DOM.
    this.container.classList.add('filters-expanded');
    this.el.removeAttribute('hidden');
    if (this.homeNote) this.homeNote.hidden = false;
    this.#setToggle(true, '⤡', 'Collapse the filter properties back into the inspector');
    this.sortActiveFirst();
    this.applySearch();
    this.#escape = (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
        this.toggleBtn?.focus();
      }
    };
    document.addEventListener('keydown', this.#escape, true);
    this.searchInput?.focus();
  }

  close() {
    if (!this.el || !this.isOpen) return;
    // Clear the search before handing the rows back: a hidden row in the
    // compact panel with no search box in sight is an unexplainable gap.
    if (this.searchInput) this.searchInput.value = '';
    this.applySearch();
    // Whatever had focus is about to be hidden; hand it to the control that
    // brings the surface back rather than dropping it on <body>.
    const returnFocus = this.el.contains(document.activeElement);
    this.container.classList.remove('filters-expanded');
    this.home.appendChild(this.container);
    this.el.setAttribute('hidden', '');
    if (this.homeNote) this.homeNote.hidden = true;
    this.#setToggle(
      false,
      '⤢',
      'Expand the filter properties over the stage — every property in columns, with search'
    );
    if (returnFocus) this.toggleBtn?.focus();
    if (this.#escape) {
      document.removeEventListener('keydown', this.#escape, true);
      this.#escape = null;
    }
  }

  /**
   * "⤢" and "⤡" have no reliable spoken form, so the button carries an
   * explicit label as well as the tooltip; both track the state.
   */
  #setToggle(pressed, glyph, label) {
    if (!this.toggleBtn) return;
    this.toggleBtn.setAttribute('aria-pressed', String(pressed));
    this.toggleBtn.textContent = glyph;
    this.toggleBtn.title = label;
    this.toggleBtn.setAttribute('aria-label', label);
  }

  /**
   * Re-apply the ordering and the search after `buildFilterUI()` replaces the
   * rows underneath us (a data reload, a layout switch, a filter-lock change).
   * Without this the surface would keep a stale search box over a full list.
   */
  refresh() {
    if (!this.isOpen) return;
    this.sortActiveFirst();
    this.applySearch();
  }

  #rows() {
    return this.container ? [...this.container.querySelectorAll('.filter-row')] : [];
  }

  /** A row is active when its own checkbox (col1, never the invert box) is on. */
  static isActive(row) {
    return !!row.querySelector('.filter-row-col1 input[type="checkbox"]')?.checked;
  }

  /**
   * Float the active filters to the top of each sub-group. Applied on open and
   * on search, never on toggle — re-sorting under a live cursor would move the
   * row you just clicked out from under the pointer.
   */
  sortActiveFirst() {
    if (!this.container) return;
    for (const body of this.container.querySelectorAll('.filter-subgroup-body')) {
      const rows = [...body.children].filter((el) => el.classList.contains('filter-row'));
      const active = rows.filter((r) => FilterSurface.isActive(r));
      if (!active.length || active.length === rows.length) continue;
      body.append(...active, ...rows.filter((r) => !FilterSurface.isActive(r)));
    }
  }

  /**
   * Hide non-matching rows, then any sub-group or section left with nothing to
   * show. A matching group is also un-collapsed — a search that "finds"
   * something inside a folded accordion has found nothing the user can see.
   */
  applySearch() {
    if (!this.container) return;
    const query = (this.searchInput?.value ?? '').trim().toLowerCase();
    // A search spans both sections, so the narrow panel's node/edge segment
    // steps aside while one is running — otherwise a hit in the section you are
    // not looking at is a hit you cannot see.
    this.container.classList.toggle('filters-searching', !!query);
    const rows = this.#rows();
    let shown = 0;
    for (const row of rows) {
      const match = !query || (row.dataset.search ?? '').includes(query);
      row.hidden = !match;
      if (match) shown += 1;
    }
    for (const selector of ['.filter-subgroup', '.filter-section']) {
      for (const group of this.container.querySelectorAll(selector)) {
        const has = !!group.querySelector('.filter-row:not([hidden])');
        group.hidden = !has;
        if (has && query) group.classList.remove('collapsed');
      }
    }
    this.#updateCount(rows, shown, query);
  }

  #updateCount(rows, shown, query) {
    if (!this.countEl) return;
    const active = rows.filter((r) => FilterSurface.isActive(r)).length;
    const total = `${rows.length} ${rows.length === 1 ? 'property' : 'properties'}`;
    this.countEl.textContent = query
      ? `${shown} of ${total} shown · ${active} active`
      : `${total} · ${active} active`;
  }
}

/** Safe in DOMs without the surface markup (unit tests): returns null. */
export function initFilterSurface(cache) {
  return document.getElementById('filterSurface') ? new FilterSurface(cache) : null;
}

export { FilterSurface };
