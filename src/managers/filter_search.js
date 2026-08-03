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
 * show. A matching group is also un-collapsed — a search that "finds" something
 * inside a folded accordion has found nothing the user can see.
 */
export function applyFilterSearch(container) {
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
      const has = !!group.querySelector('.filter-row:not([hidden])');
      group.hidden = !has;
      if (has && query) group.classList.remove('collapsed');
    }
  }
}

/** Safe in DOMs without the filter markup (unit tests): does nothing. */
export function initFilterSearch() {
  const container = document.getElementById('filterContainer');
  container?.addEventListener('input', (event) => {
    if (event.target.id === 'filterSearch') applyFilterSearch(container);
  });
}
