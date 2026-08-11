/**
 * Property search over the inspector's filter list.
 *
 * The search box itself is built into `#filterContainer` by `ui.buildFilterUI`,
 * which empties that container on every rebuild and takes the box with it. The
 * container element survives, so one delegated listener here outlives every
 * rebuild — binding to the input would mean re-binding from the builder.
 */

/**
 * Hide non-matching rows, then any sub-group or section left with nothing to
 * show. Folded groups open for the duration of the search — a search that
 * "finds" something inside a folded accordion has found nothing the user can
 * see — but they keep their `.collapsed` class, so clearing the box restores
 * the folds the user had (see the `:not(.filters-searching)` collapse rule).
 */
function applyFilterSearch(container) {
  if (!container) return;
  const query = (document.getElementById('filterSearch')?.value ?? '').trim().toLowerCase();
  // A search spans both sections, so the panel's node/edge segment steps aside
  // while one is running — otherwise a hit in the section you are not looking
  // at is a hit you cannot see.
  container.classList.toggle('filters-searching', !!query);
  for (const row of container.querySelectorAll('.filter-row')) {
    row.hidden = !!query && !(row.dataset.search ?? '').includes(query);
  }
  for (const selector of ['.filter-subgroup', '.filter-section']) {
    for (const group of container.querySelectorAll(selector)) {
      group.hidden = !group.querySelector('.filter-row:not([hidden])');
    }
  }
  // Everything hidden leaves a blank panel that says nothing about whether the
  // search or the graph came up empty.
  const nothing = !!query && !container.querySelector('.filter-section:not([hidden])');
  noMatchNote(container).hidden = !nothing;
}

/** The "nothing matches" line, created on demand — buildFilterUI empties the
 * container (and this note with it) on every rebuild. */
function noMatchNote(container) {
  let note = container.querySelector('.filter-no-match');
  if (!note) {
    note = document.createElement('p');
    note.className = 'insp-note filter-no-match';
    // Typing into the search box changes the list silently otherwise: a screen
    // reader user gets no signal that the filter matched nothing.
    note.setAttribute('role', 'status');
    note.setAttribute('aria-live', 'polite');
    note.textContent = 'No properties match this search.';
    container.appendChild(note);
  }
  return note;
}

/** Safe in DOMs without the filter markup (unit tests): does nothing. */
export function initFilterSearch() {
  const container = document.getElementById('filterContainer');
  container?.addEventListener('input', (event) => {
    if (event.target.id === 'filterSearch') applyFilterSearch(container);
  });
}
