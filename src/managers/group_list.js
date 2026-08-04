/**
 * The Groups list under Overlays › Groups — the home bubble groups never had.
 *
 * One row per group carrying everything about it: its colour, its name (bound
 * to the label drawn on the hull, so the list and the canvas cannot disagree),
 * its live member count, a ＋/－ button labelled with what a click will do, and
 * a ⋯ menu. Below the list, ONE settings pane, rebuilt for whichever row is
 * selected — a pane per group would be N × ~20 rows of DOM for a surface that
 * only ever shows one.
 *
 * This is DOM only. Every state change routes back through the bubble-set
 * manager, which owns the membership model; `bubble_sets` keeps thin delegating
 * methods so callers still have one entry point on it.
 */
import { RailMenu, menuItem, menuSeparator } from './rail.js';
import { StaticUtilities } from '../utilities/static.js';

/**
 * Every function here takes the bubble-set MANAGER, not the cache: this module
 * is the model's view, so it is handed the model rather than reaching back for
 * it through a global.
 */
const layoutOf = (bs) => bs.cache.data?.layouts?.[bs.cache.data?.selectedLayout];

/**
 * Mirror the live selection onto each group row's primary button. Runs from
 * selection.updateSelectedNodesAndEdges — the ONE point where
 * cache.selectedNodes is authoritative. An earlier hook (updateSelectedState)
 * reads a stale selection and the labels desync; that was a real bug once.
 */
export function syncGroupRows(bs) {
  for (const btn of document.querySelectorAll('.group-row-toggle')) {
    const group = btn.dataset.group;
    const count = bs.cache.selectedNodes?.length ?? bs.cache.selectedNodes?.size ?? 0;
    const state = bs.selectionMembership(group);
    const name = layoutOf(bs)?.bubbleSetStyle?.[group]?.labelText || group;

    btn.disabled = count === 0;
    btn.classList.toggle('remove', state === 'all');
    if (count === 0) {
      btn.textContent = '＋';
      btn.title = 'Select nodes first, then add them to this group';
    } else if (state === 'all') {
      btn.textContent = `－ ${count}`;
      btn.title = `Remove the ${count} selected node(s) from "${name}"`;
    } else {
      btn.textContent = `＋ ${count}`;
      btn.title =
        state === 'some'
          ? `Add the rest of the selection to "${name}" (some are already in it)`
          : `Add the ${count} selected node(s) to "${name}"`;
    }
    btn.setAttribute('aria-label', btn.title);
  }
}

/**
 * Which filters feed a group's property-derived membership, named the way the
 * filter panel names them MINUS the section — every entry would otherwise
 * start "Node filters ›", which is noise in a 356 px column.
 */
function groupFilterNames(bs, group) {
  const props = layoutOf(bs)?.[`${group}Props`] ?? new Set();
  return [...props].map((propID) => {
    const [, subSection, prop] = StaticUtilities.decodePropHashId(propID);
    return [subSection, prop].filter(Boolean).join(' › ') || propID;
  });
}

/**
 * Paint the Groups list. Rebuilt whole — the list is a handful of rows and
 * diffing it would be more code than redrawing it.
 */
export function renderGroupList(bs) {
  const list = document.getElementById('groupList');
  if (!list) return;
  const layout = layoutOf(bs);
  const groups = [...bs.traverseBubbleSets()];

  // The settings pane lives inside the open row, so detach it BEFORE the rows
  // are replaced — replaceChildren would otherwise destroy the one element the
  // whole styling surface hangs off. It is parked in #groupStylePanelHome
  // whenever no row is open.
  const pane = document.getElementById('groupStylePanel');
  const paneHome = document.getElementById('groupStylePanelHome');
  pane?.remove();

  list.replaceChildren();
  list.classList.toggle('is-empty', groups.length === 0);

  if (groups.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'group-empty';
    empty.textContent =
      'No groups yet. A group draws a coloured bubble around the nodes you put in it.';
    list.appendChild(empty);
    if (pane && paneHome) paneHome.appendChild(pane);
    bs.cache.ui?.buildGroupStylePanel?.(null);
    return;
  }

  // null means "the user collapsed the open row" — a real state. Only an unset
  // or stale selection falls back to the first group.
  if (bs.selectedGroup !== null && !groups.includes(bs.selectedGroup)) {
    bs.selectedGroup = groups[0];
  }
  let openRow = null;
  for (const group of groups) {
    const row = buildGroupRow(bs, group, layout);
    if (group === bs.selectedGroup) openRow = row;
    list.appendChild(row);
  }

  // The settings pane lives INSIDE the open row, not below the list. A shared
  // pane at the bottom made "where do I click to style this one" a guess; as a
  // real disclosure the chevron says it, and the settings are next to the group
  // they belong to. One element, re-parented (the CARD_MOUNTS trick), so its
  // id, its listeners and refreshBubbleStyleElements all survive.
  if (pane) (openRow ?? paneHome)?.appendChild(pane);
  bs.cache.ui?.buildGroupStylePanel?.(bs.selectedGroup);
  syncGroupRows(bs);
}

function buildGroupRow(bs, group, layout) {
  const style = layout.bubbleSetStyle[group];
  const name = style.labelText || group;
  const count = bs.getEffectiveGroupMembers(group).size;

  const expanded = group === bs.selectedGroup;
  const row = document.createElement('div');
  row.className = 'group-row';
  row.dataset.group = group;
  if (expanded) {
    row.classList.add('active');
    row.style.setProperty('--row-color', style.fill || 'transparent');
  }

  const swatch = document.createElement('input');
  swatch.type = 'color';
  swatch.className = 'group-swatch';
  swatch.value = /^#[0-9a-f]{6}$/i.test(style.fill) ? style.fill : '#403C53';
  swatch.title = `Fill colour of "${name}"`;
  swatch.setAttribute('aria-label', `Fill colour of "${name}"`);
  swatch.addEventListener('change', async () => {
    await bs.updateBubbleSetStyle(`Bubble Set ${group} Fill Color`, swatch.value);
    renderGroupList(bs);
  });

  // The row name IS labelText, the string painted on the hull, so the list and
  // the canvas cannot disagree about what a group is called.
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'group-name';
  nameInput.value = name;
  nameInput.title = 'Rename this group (this is the label drawn on the bubble)';
  nameInput.setAttribute('aria-label', `Name of group "${name}"`);
  nameInput.addEventListener('change', async () => {
    await bs.updateBubbleSetStyle(`Bubble Set ${group} Label Text`, nameInput.value.trim());
    renderGroupList(bs);
  });

  const countEl = document.createElement('span');
  countEl.className = 'group-count';
  countEl.textContent = `${count} node${count === 1 ? '' : 's'}`;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'group-row-toggle';
  toggle.dataset.group = group;
  toggle.addEventListener('click', () => bs.toggleSelectedNodesInManualGroup(group));

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'group-row-more';
  more.textContent = '⋯';
  more.title = `More actions for "${name}"`;
  more.setAttribute('aria-label', more.title);
  attachRowMenu(bs, more, group);

  // The affordance for "open this group's appearance settings". Without it the
  // only cue was a faint row highlight, and nothing said the pane below
  // belonged to the highlighted row.
  const chevron = document.createElement('button');
  chevron.type = 'button';
  chevron.className = 'group-row-chevron';
  chevron.textContent = expanded ? '▾' : '▸';
  chevron.setAttribute('aria-expanded', String(expanded));
  chevron.title = expanded ? `Hide "${name}" settings` : `Appearance settings for "${name}"`;
  chevron.setAttribute('aria-label', chevron.title);
  chevron.addEventListener('click', () => {
    // Clicking the open row's chevron closes it, so a group can be collapsed
    // back to one line.
    bs.selectedGroup = expanded ? null : group;
    renderGroupList(bs);
  });

  const head = document.createElement('div');
  head.className = 'group-row-head';
  head.append(chevron, swatch, nameInput, countEl, toggle, more);
  // Only the HEAD selects the row. The settings pane below is content, and a
  // handler on the whole row swallowed clicks on its switches — a switch is a
  // <label><span>, neither a button nor an input, so it slipped past the guard
  // and the rebuild destroyed the control before the toggle completed.
  head.addEventListener('click', (e) => {
    // …and within the head, a click on a control is meant for that control.
    if (e.target.closest('button, input')) return;
    bs.selectedGroup = group;
    renderGroupList(bs);
  });
  row.appendChild(head);

  // The second line is the thing the old UI never admitted: a group can be fed
  // by a live filter AND by a hand-picked node set at the same time.
  const filters = groupFilterNames(bs, group);
  const manualCount = layout[`${group}ManualMembers`]?.size ?? 0;
  if (filters.length > 0) {
    const source = document.createElement('div');
    source.className = 'group-row-source';

    const fromFilter = document.createElement('span');
    fromFilter.className = 'group-source-part';
    fromFilter.textContent = `⚙ follows ${filters.join(', ')}`;
    fromFilter.title =
      `This group takes whichever nodes match ${filters.join(' and ')}, and ` +
      'follows those filters as you change them.';
    source.appendChild(fromFilter);

    // "+2 manual" read as jargon. Say what the number IS: nodes someone put
    // there by hand, which stay put whatever the filter does.
    if (manualCount) {
      const byHand = document.createElement('span');
      byHand.className = 'group-source-part';
      byHand.textContent = `＋ ${manualCount} added by hand`;
      byHand.title =
        `${manualCount} node(s) added from a selection. They stay in the group ` +
        'regardless of the filter above.';
      source.appendChild(byHand);
    }
    row.appendChild(source);
  }

  return row;
}

function attachRowMenu(bs, anchor, group) {
  const menu = new RailMenu(anchor, (el) => {
    const layout = layoutOf(bs);
    const name = layout?.bubbleSetStyle?.[group]?.labelText || group;
    const hasProps = (layout?.[`${group}Props`]?.size ?? 0) > 0;
    const hasManual = (layout?.[`${group}ManualMembers`]?.size ?? 0) > 0;

    el.appendChild(
      menuItem({
        icon: '◈',
        label: 'Select members',
        disabled: bs.getEffectiveGroupMembers(group).size === 0,
        title: `Select every node in "${name}"`,
        onClick: () => {
          menu.close();
          bs.cache.sm.selectNodes([...bs.getEffectiveGroupMembers(group)]);
        },
      })
    );
    el.appendChild(
      menuItem({
        icon: '⧉',
        label: 'Duplicate',
        title: `Copy "${name}" and its membership into a new group`,
        onClick: async () => {
          menu.close();
          await bs.duplicateGroup(group);
        },
      })
    );
    el.appendChild(menuSeparator());
    // The two source-specific clears only exist when that source does — a group
    // fed only by a filter has no "manual nodes" to drop.
    if (hasManual) {
      el.appendChild(
        menuItem({
          icon: '−',
          label: 'Clear manual nodes',
          title: 'Drop the hand-picked nodes, keep the filter-driven ones',
          onClick: async () => {
            menu.close();
            layout[`${group}ManualMembers`].clear();
            await bs.afterMembershipChange(`Clear manual nodes (${name})`);
          },
        })
      );
    }
    if (hasProps) {
      el.appendChild(
        menuItem({
          icon: '⚙',
          label: 'Detach filter',
          title: 'Drop the filter-driven members, keep the hand-picked ones',
          onClick: async () => {
            menu.close();
            bs.clearGroupPropAssignments(group);
            await bs.afterMembershipChange(`Detach filter (${name})`);
          },
        })
      );
    }
    el.appendChild(
      menuItem({
        icon: '✕',
        label: 'Delete group',
        title: `Remove "${name}" entirely`,
        onClick: async () => {
          menu.close();
          await bs.deleteGroup(group);
          renderGroupList(bs);
          bs.refreshBubbleStyleElements();
          bs.cache.uiComponents?.refreshGroupChips?.();
          bs.cache.ui.info(`Deleted group "${name}"`);
        },
      })
    );
  });
}
