/**
 * The command palette (Concept C, phase 7): ⌘K over every control in the app.
 *
 * **The index is derived from the live DOM on every open, never hand-written.**
 * The spec imagined a static registry of ~120 command descriptors; §9 calls
 * that "a permanent maintenance obligation" and asks for one source of truth so
 * coverage stays checkable. The DOM already is that source — rail buttons, rail
 * menu rows, inspector cards, workbench toolbars and filter rows each carry
 * their own label, tooltip and accelerator — so a control added by a later
 * phase is searchable the day it lands, with no registry entry to forget.
 *
 * Three verbs:
 * - `run` clicks the real control, so the real handler fires with whatever
 *   state guards it already carries.
 * - `reveal` walks the control back into view — switching inspector context,
 *   opening its rail menu, un-collapsing its card — because the palette is
 *   meant to teach where a control lives, not to replace its location.
 * - `focus` centres a node or edge matched by ID or label. This absorbs the old
 *   "Focus Elements" card, which was two datalists behind a section title.
 */

const MAX_RESULTS = 60;
const MAX_ELEMENTS = 8;
// Rail and menu tooltips already end in "(F)", "(L)", "(D)" … — free
// accelerators, and they cannot drift from the hotkey they document because
// they ARE the tooltip the user reads on hover.
const ACCEL_RE = /\(([^()\s]{1,2})\)\s*$/;

const hasWords = (text) => /[a-z]{2}/i.test(text || '');
const clean = (text) =>
  (text || '')
    .replace(/\s+/g, ' ')
    .replace(/[⌄▾▸▴]\s*$/, '')
    .trim();

/**
 * The best human name for a control: its own label span, then its accessible
 * name, then its text (only when that is words rather than a bare glyph), then
 * the first clause of its tooltip.
 *
 * A control that opens a menu is the exception. Those are labelled with their
 * current *state* — the workspace name, the active layout algorithm — so the
 * tooltip is the only place their function is written down: "Layout", not
 * "force"; "Workspace", not "Default 0/120 nodes · 0/240 edges".
 */
function controlName(el) {
  const inner = el.querySelector?.('.rail-vb-t, .rail-menu-label')?.textContent;
  const label = el.getAttribute?.('aria-label');
  const own = el.textContent;
  const title = el.getAttribute?.('title')?.split(/[—:(]/)[0];
  const candidates = el.hasAttribute?.('aria-expanded')
    ? [label, title, inner, own]
    : [inner, label, own, title];
  return clean(candidates.filter(hasWords)[0]);
}

function accelerator(el) {
  return el.getAttribute?.('title')?.match(ACCEL_RE)?.[1] ?? '';
}

/** Hidden by an attribute or an inline style anywhere below `root`. */
function visibleWithin(el, root) {
  for (let node = el; node && node !== root; node = node.parentElement) {
    if (node.hasAttribute?.('hidden') || node.style?.display === 'none') return false;
  }
  return true;
}

/**
 * Clickable things under `root`, without descending into one another: a rail
 * menu's toggle row is itself the control, and the button inside it is only its
 * state glyph.
 */
function actionables(root) {
  const found = [...root.querySelectorAll('.rail-menu-item, button')];
  return found.filter(
    (el) => !found.some((other) => other !== el && other.contains(el)) && visibleWithin(el, root)
  );
}

function command(el, trail, extra = {}) {
  const name = controlName(el);
  if (!name) return null;
  const disabled = el.disabled || el.getAttribute?.('aria-disabled') === 'true';
  return {
    name,
    trail,
    el,
    glyph: extra.glyph ?? '▸',
    accel: accelerator(el),
    // A control that cannot fire right now still belongs in the index — the
    // palette teaches location — but running it would be a silent no-op, so it
    // reveals itself instead.
    kind: disabled ? 'reveal' : (extra.kind ?? 'run'),
    disabled,
    ...extra,
  };
}

/** The inspector section heading a control sits under ("Filters", "Groups"…). */
function sectionOf(el, panel) {
  let node = el;
  while (node && node.parentElement !== panel) node = node.parentElement;
  let prev = node?.previousElementSibling;
  while (prev && !prev.matches('h4.insp-section-title')) prev = prev.previousElementSibling;
  return prev ? clean(prev.textContent) : '';
}

function breadcrumb(...parts) {
  return parts.filter(Boolean).join(' › ');
}

function collectRail(cache, out) {
  const rail = document.getElementById('rail');
  if (rail) {
    for (const el of actionables(rail)) {
      if (el.id === 'cmdkBtn') continue; // the way in is not a destination
      out.push(command(el, 'Rail', { glyph: '◆' }));
    }
  }
  for (const menu of cache.rail?.menus ?? []) {
    // Build the menu without opening it: contents that only exist while a
    // dropdown is on screen would be a hole in the index.
    menu.ensureBuilt();
    const trail = controlName(menu.anchor) || 'Menu';
    for (const el of actionables(menu.el)) out.push(command(el, trail, { glyph: '⌄' }));
  }
}

function collectInspector(out) {
  for (const [context, panelId] of [
    ['Workspace', 'inspectorWorkspace'],
    ['Selection', 'inspectorSelection'],
  ]) {
    const panel = document.getElementById(panelId);
    if (!panel) continue;
    const trailFor = (el) =>
      breadcrumb(
        'Inspector',
        context,
        sectionOf(el, panel),
        clean(el.closest('[data-label]')?.dataset.label)
      );

    for (const el of actionables(panel)) {
      // The filters have their own collector: #filterContainer moves between
      // the inspector and the expanded surface, so indexing it from here would
      // make half the app searchable only while ⤢ is off. The empty state's
      // links are prose shortcuts to rail controls already in the index.
      if (el.closest('#filterContainer, .insp-empty')) continue;
      // ~13 preset swatches × ~12 colour properties would be half the index,
      // all of it "Set X of the selected elements to red". The row's label is
      // already indexed as the destination, and the swatch is one click away
      // once you are there — the palette says where colours live, it is not a
      // paint program.
      if (el.classList.contains('style-color-button')) continue;
      out.push(command(el, trailFor(el), { glyph: '⚙' }));
    }
    // A row of inputs is one destination, not one command per field: the label
    // names it and revealing it puts the whole row on screen.
    for (const label of panel.querySelectorAll('.card-row > label')) {
      const row = label.parentElement;
      if (!row.querySelector('input, select')) continue;
      out.push(
        command(label, trailFor(label), { glyph: '⚙', kind: 'reveal', el: row, name: clean(label.textContent) })
      );
    }
  }
}

function collectWorkbench(cache, out) {
  for (const [tab, spec] of Object.entries(cache.workbench?.tabs ?? {})) {
    const toolbar = spec.toolbar && document.querySelector(spec.toolbar);
    if (!toolbar) continue;
    for (const el of actionables(toolbar)) {
      out.push(command(el, breadcrumb('Workbench', spec.title), { glyph: '▤', tab }));
    }
  }
}

/**
 * Filters are collected by container rather than by panel: `#filterContainer`
 * is re-parented between the inspector and the expanded surface, and its
 * controls mean the same thing in either place.
 */
function collectFilters(out) {
  const container = document.getElementById('filterContainer');
  if (!container) return;
  const trailFor = (el) =>
    breadcrumb(
      'Filters',
      clean(el.closest('.filter-section')?.querySelector('.header-card h4')?.textContent),
      clean(el.closest('.filter-subgroup')?.querySelector('.sub-header-card h5')?.textContent)
    );

  for (const el of actionables(container)) {
    if (el.closest('.filter-row')) continue;
    out.push(command(el, trailFor(el), { glyph: '⛃' }));
  }
  // A property row is a destination, not a command: it holds a checkbox, a
  // widget and two selection verbs, and none of them is "the" action.
  for (const row of container.querySelectorAll('.filter-row')) {
    const name = clean(row.querySelector('.checkboxLabel')?.textContent);
    if (!name) continue;
    out.push({ name, trail: trailFor(row), el: row, glyph: '⛃', accel: '', kind: 'reveal' });
  }
}

/** The whole static index, deduped by name+location, in source order. */
export function collectCommands(cache) {
  const out = [];
  collectRail(cache, out);
  collectInspector(out);
  collectWorkbench(cache, out);
  collectFilters(out);
  const seen = new Set();
  return out.filter((cmd) => {
    if (!cmd) return false;
    const key = `${cmd.name}|${cmd.trail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Nodes and edges by ID or label, from the same maps the old Focus card used.
 * Query-driven rather than indexed up front — a 6 000-node graph has no
 * business being copied into a list on every ⌘K.
 */
export function matchElements(cache, query) {
  const found = [];
  for (const [isNode, map] of [
    [true, cache.nodeIDOrLabelToNodeIDs],
    [false, cache.edgeIDOrLabelToEdgeIDs],
  ]) {
    for (const [key, ids] of map ?? []) {
      if (found.length >= MAX_ELEMENTS) break;
      if (!String(key).toLowerCase().includes(query)) continue;
      found.push({
        name: String(key),
        trail: isNode ? 'node' : 'edge',
        glyph: isNode ? '⬡' : '⟋',
        accel: '',
        kind: 'focus',
        ids,
        isNode,
      });
    }
  }
  return found;
}

/**
 * Rank by where the query lands: a name that starts with it, then a name that
 * contains it, then a location that contains it. Every token must appear
 * somewhere, so "heat int" finds "Heatmap intensity".
 */
export function search(commands, query, limit = MAX_RESULTS) {
  const tokens = query.split(/\s+/).filter(Boolean);
  if (!tokens.length) return commands.slice(0, limit);
  const scored = [];
  for (const cmd of commands) {
    const name = cmd.name.toLowerCase();
    const trail = cmd.trail.toLowerCase();
    if (!tokens.every((t) => name.includes(t) || trail.includes(t))) continue;
    const rank = name.startsWith(tokens[0]) ? 0 : name.includes(tokens[0]) ? 1 : 2;
    scored.push({ cmd, rank });
  }
  return scored
    .map((entry, i) => ({ ...entry, i }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .slice(0, limit)
    .map((entry) => entry.cmd);
}

/** Put a control back on screen wherever it lives, and say so with a flash. */
export function reveal(cache, cmd) {
  const el = cmd.el;
  if (!el) return;

  const menu = (cache.rail?.menus ?? []).find((m) => m.el === el.closest?.('.rail-menu'));
  if (menu) {
    cache.rail.closeMenus();
    menu.open();
  }
  if (cmd.tab) cache.workbench?.show(cmd.tab);
  const panel = el.closest?.('.insp-panel');
  if (panel) {
    cache.inspector?.setContext(panel.id === 'inspectorSelection' ? 'selection' : 'workspace');
  }
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (!node.classList?.contains('collapsed')) continue;
    if (node.dataset?.label) cache.ui?.expandStylingCard(node.dataset.label);
    else node.classList.remove('collapsed');
    const chevron = node.querySelector(':scope > * > .filter-group-chevron');
    if (chevron) chevron.textContent = '▾';
  }

  // A filter row is `display: contents` — it has no box, so scrolling to it
  // and ringing it both do nothing. Fall back to its first cell, which does.
  const box = el.getBoundingClientRect?.().height ? el : (el.firstElementChild ?? el);
  box.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  el.classList?.add('cmdk-flash');
  setTimeout(() => el.classList?.remove('cmdk-flash'), 1200);
  const target = el.matches?.('input, select, button') ? el : el.querySelector?.('input, select, button');
  target?.focus({ preventScroll: true });
}

class CommandPalette {
  #commands = [];
  #results = [];
  #active = 0;

  constructor(cache) {
    this.cache = cache;
    this.el = document.getElementById('cmdk');
    this.input = document.getElementById('cmdkInput');
    this.list = document.getElementById('cmdkResults');
    this.countEl = document.getElementById('cmdkCount');

    this.input?.addEventListener('input', () => this.#render());
    this.input?.addEventListener('keydown', (e) => this.#onKey(e));
    this.list?.addEventListener('click', (e) => {
      const row = e.target.closest('[data-index]');
      if (row) this.#activate(this.#results[Number(row.dataset.index)], false);
    });
    // <dialog> gives Escape, the backdrop and the focus trap for free; this is
    // the one thing it does not: a click on the backdrop itself.
    this.el?.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
  }

  get isOpen() {
    return !!this.el?.open;
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open() {
    if (!this.el || this.isOpen) return;
    // Re-collected every time: contexts, selections and loaded data all change
    // what exists, and a stale index is worse than no index.
    this.#commands = collectCommands(this.cache);
    this.input.value = '';
    this.el.showModal();
    this.#render();
    this.input.focus();
  }

  close() {
    if (this.isOpen) this.el.close();
  }

  #render() {
    const query = (this.input?.value ?? '').trim().toLowerCase();
    const elements = query.length >= 2 ? matchElements(this.cache, query) : [];
    const matched = [...search(this.#commands, query, Infinity), ...elements];
    this.#results = matched.slice(0, MAX_RESULTS);
    this.#active = 0;
    if (!this.list) return;

    this.list.replaceChildren(...this.#results.map((cmd, i) => this.#row(cmd, i)));
    this.#syncActive();
    if (this.countEl) {
      const shown = this.#results.length;
      // Say when the list is truncated: "60 results" over a 147-match query
      // reads as "that is everything", and the user stops narrowing.
      this.countEl.textContent = !shown
        ? 'no matches'
        : shown < matched.length
          ? `${shown} of ${matched.length} — keep typing`
          : `${shown} result${shown === 1 ? '' : 's'}`;
    }
  }

  #row(cmd, index) {
    const row = document.createElement('li');
    row.className = 'cmdk-row';
    row.id = `cmdkRow${index}`;
    row.dataset.index = String(index);
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', 'false');
    if (cmd.disabled) row.classList.add('disabled');

    const glyph = document.createElement('span');
    glyph.className = 'cmdk-glyph';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = cmd.glyph;
    const name = document.createElement('span');
    name.className = 'cmdk-name';
    name.textContent = cmd.name;
    // The breadcrumb is the point: the palette runs the command AND says where
    // it lives, so the next time the user goes straight there.
    const trail = document.createElement('span');
    trail.className = 'cmdk-trail';
    trail.textContent = cmd.trail;
    row.append(glyph, name, trail);
    if (cmd.accel) {
      const kbd = document.createElement('kbd');
      kbd.textContent = cmd.accel;
      row.appendChild(kbd);
    }
    return row;
  }

  #syncActive() {
    const rows = [...(this.list?.children ?? [])];
    rows.forEach((row, i) => {
      const active = i === this.#active;
      row.classList.toggle('active', active);
      row.setAttribute('aria-selected', String(active));
      if (active) row.scrollIntoView({ block: 'nearest' });
    });
    this.input?.setAttribute(
      'aria-activedescendant',
      rows.length ? `cmdkRow${this.#active}` : ''
    );
  }

  #onKey(event) {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step !== undefined && this.#results.length) {
      event.preventDefault();
      this.#active = (this.#active + step + this.#results.length) % this.#results.length;
      this.#syncActive();
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const cmd = this.#results[this.#active];
      if (!cmd) return;
      event.preventDefault();
      // Tab is "show me where that is" — the same row, without firing it.
      this.#activate(cmd, event.key === 'Tab');
    }
  }

  #activate(cmd, revealOnly) {
    if (!cmd) return;
    this.close();
    if (cmd.kind === 'focus') {
      this.cache.gcm?.focusElements(cmd.ids, cmd.isNode);
      return;
    }
    if (revealOnly || cmd.kind === 'reveal') reveal(this.cache, cmd);
    else cmd.el.click();
  }
}

/**
 * "⌘K" everywhere would be a lie on Linux and Windows, where the palette
 * answers to Ctrl+K. One source for the rail pill, the tooltip and the
 * keyboard sheet.
 */
export function paletteAccelerator() {
  const platform = globalThis.navigator?.platform ?? '';
  return /Mac|iPhone|iPad/.test(platform) ? '⌘K' : 'Ctrl K';
}

/** Safe in DOMs without the palette markup (unit tests): returns null. */
export function initCommandPalette(cache) {
  if (!document.getElementById('cmdk')) return null;
  const palette = new CommandPalette(cache);

  const accel = paletteAccelerator();
  const btn = document.getElementById('cmdkBtn');
  if (btn) {
    btn.querySelector('kbd').textContent = accel;
    btn.title = `Search every control, node and property by name (${accel})`;
  }
  // Not part of registerHotkeyEvents: that handler deliberately ignores keys
  // typed into inputs, and ⌘K has to work from the query editor too.
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      // Mid-load the DOM is half-built, so the index would be wrong and running
      // a command off it could hit a graph that is still settling.
      if (cache.ui?.isBusy?.()) return;
      event.preventDefault();
      palette.toggle();
    }
  });
  return palette;
}
