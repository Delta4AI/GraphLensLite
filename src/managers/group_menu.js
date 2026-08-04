/**
 * The one menu every "put this in a bubble group" control opens.
 *
 * Two places assign membership and they mean different things: a filter row
 * assigns a PROPERTY (membership resolves live through the filter), the
 * Selection panel assigns NODES (a snapshot). Both used to be a 2×2 quadrant
 * pie — the same glyph for two different verbs, unlabelled, and structurally
 * limited to four groups. One checklist of named groups replaces both: it says
 * which groups exist, which ones this thing is already in, and scales to any
 * number.
 *
 * Built on RailMenu, which already owns anchoring, outside-pointerdown, Escape
 * and the ✓ state — this module is only the group-specific rows.
 */
import { RailMenu, menuItem, menuSeparator } from './rail.js';

/** A ● in the group's own colour, so a row reads as that bubble. */
function groupDot(color) {
  const dot = document.createElement('span');
  dot.className = 'group-menu-dot';
  dot.style.background = color || 'transparent';
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

/**
 * Wire a button to open the group checklist. Call once per button: RailMenu
 * installs the click handler, and `getOpts` is re-read on every open so the
 * rows always describe current state (groups are created, renamed, recoloured
 * and deleted while the button lives on).
 *
 * `getOpts()` returns:
 *   isChecked(group)  -> boolean   fully in this group
 *   isPartial(group)  -> boolean   optional; some-but-not-all
 *   onToggle(group)               row activated
 *   onNew()                       "new group" activated
 *   newLabel          string      wording for that last row
 *   emptyHint         string      optional, shown when no groups exist
 *
 * @param {HTMLElement} anchor
 * @param {object} cache
 * @param {() => object} getOpts
 * @returns {RailMenu}
 */
export function attachGroupMenu(anchor, cache, getOpts) {
  const menu = new RailMenu(anchor, (el) => build(el, menu, cache, getOpts()));
  return menu;
}

function build(el, menu, cache, opts) {
  const groups = [...(cache.bs?.traverseBubbleSets() ?? [])];
  const styles = cache.data?.layouts?.[cache.data?.selectedLayout]?.bubbleSetStyle ?? {};

  if (groups.length === 0 && opts.emptyHint) {
    const hint = document.createElement('div');
    hint.className = 'group-menu-hint';
    hint.textContent = opts.emptyHint;
    el.appendChild(hint);
  }

  for (const group of groups) {
    const style = styles[group] ?? {};
    const name = style.labelText || group;
    const checked = !!opts.isChecked?.(group);
    const partial = !checked && !!opts.isPartial?.(group);

    const row = menuItem({
      label: name,
      checked,
      title: checked ? `Remove from "${name}"` : `Add to "${name}"`,
      onClick: () => {
        menu.close();
        opts.onToggle?.(group);
      },
    });
    // Partial membership is a third state ✓/no-✓ cannot express, and it is the
    // common one for a multi-node selection.
    if (partial) {
      row.classList.add('partial');
      const mark = document.createElement('span');
      mark.className = 'rail-menu-check';
      mark.textContent = '–';
      row.append(mark);
      row.title = `Some of the selection is already in "${name}"`;
    }
    row.prepend(groupDot(style.fill));
    el.appendChild(row);
  }

  if (groups.length > 0) el.appendChild(menuSeparator());

  el.appendChild(
    menuItem({
      icon: '＋',
      label: opts.newLabel,
      onClick: () => {
        menu.close();
        opts.onNew?.();
      },
    })
  );
}
