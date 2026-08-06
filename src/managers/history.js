/**
 * Global undo/redo over the current workspace's *view state*.
 *
 * A snapshot is the whole layout object — positions, filters, per-element
 * styles, bubble-set knobs and members, query, layout type: everything the app
 * treats as "how this workspace looks". It is deliberately NOT the graph data.
 * An import, a data-table edit or a Neo4j merge rebuilds the model, so the
 * history is cleared there instead of pretending it can be reversed.
 *
 * Snapshots rather than per-operation inverses, on purpose: an inverse per
 * mutation is a dozen hand-written reverses that every future feature has to
 * remember to add, while capture/restore is written once and covers whatever a
 * later feature happens to store on the layout. Restoring goes through
 * `lm.changeLayout()`, which is already the "make the screen match this layout
 * object" path used by workspace switching and by Reset style.
 *
 * The before-state comes from a rolling baseline (the state as of the last
 * commit), so a call site only has to mark the END of an operation. Placing a
 * capture before every mutation would mean five call sites for the filter
 * widgets alone, and one forgotten capture is a silently wrong undo.
 */

import { hotkeyLabel } from './command_palette.js';

// A layout carries a per-element style map, so a snapshot grows with the graph.
// ponytail: depth is capped crudely by node count; make it size-aware only if
// a real workspace shows memory pressure.
const MAX_DEPTH = 20;
const MAX_DEPTH_LARGE = 5;
const LARGE_GRAPH_NODES = 2000;

/** Renderer handle, re-created per render — never part of the state. */
const VOLATILE_KEYS = ['internals'];

function currentLayout(cache) {
  const name = cache.data?.selectedLayout;
  const layout = name && cache.data.layouts?.[name];
  return layout ? { name, layout } : null;
}

/**
 * Comparable form of a snapshot's state. JSON alone would flatten the layout's
 * Maps and Sets (filters, positions, group members) to `{}` and call every
 * change equal, so both are spelled out. Key order counts as a difference —
 * that only ever costs one redundant undo entry, never a missed one.
 */
function signatureOf(state) {
  return JSON.stringify(state, (_key, value) => {
    if (value instanceof Map) return { __map: [...value] };
    if (value instanceof Set) return { __set: [...value] };
    return value;
  });
}

/** A deep copy of the current workspace's view state, or null if there is none. */
function snapshot(cache) {
  const current = currentLayout(cache);
  if (!current) return null;
  const state = {};
  for (const [key, value] of Object.entries(current.layout)) {
    if (VOLATILE_KEYS.includes(key)) continue;
    state[key] = structuredClone(value);
  }
  return { name: current.name, state, signature: signatureOf(state) };
}

class History {
  constructor(cache) {
    this.cache = cache;
    this.past = [];
    this.future = [];
    this.baseline = null;
    this.restoring = false;
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  /** The action ↶ would take back, for the button's tooltip. */
  get undoLabel() {
    return this.past[this.past.length - 1]?.label ?? '';
  }

  get redoLabel() {
    return this.future[this.future.length - 1]?.label ?? '';
  }

  /**
   * Forget everything and re-baseline. Called when the graph or the workspace
   * underneath the snapshots changes, which makes all of them meaningless.
   */
  reset() {
    // The restore path re-runs the app's initial-render choreography, which
    // resets the history — obeying that would wipe the redo branch mid-undo.
    if (this.restoring) return;
    this.past = [];
    this.future = [];
    this.baseline = snapshot(this.cache);
    this.syncButtons();
  }

  /**
   * Record everything that changed since the last commit under one label. Call
   * it at the end of an operation, after the state has settled.
   */
  commit(label) {
    if (this.restoring) return;
    const after = snapshot(this.cache);
    if (!after) return;
    // No baseline means nothing has been recorded since the graph loaded; the
    // first operation still needs a before-state, so take this one as the floor.
    if (!this.baseline || this.baseline.name !== after.name) {
      this.baseline = after;
      return;
    }
    // Every filter change funnels through commit(), including the ones that
    // changed nothing (a section reset with nothing narrowed, a re-applied
    // query). Recording those left an undo entry whose before and after are the
    // same state — pressing undo appeared to do nothing.
    if (this.baseline.signature === after.signature) return;
    this.past.push({ label, before: this.baseline, after });
    while (this.past.length > this.#depth()) this.past.shift();
    this.future = [];
    this.baseline = after;
    this.syncButtons();
  }

  async undo() {
    if (!this.canUndo) return false;
    const entry = this.past.pop();
    this.future.push(entry);
    const done = await this.#install(entry.before, `Undone: ${entry.label}`, {
      header: 'Undoing',
      text: entry.label,
    });
    if (!done) {
      // The snapshot's workspace is gone — the entry is unusable, drop it.
      this.future.pop();
    }
    this.syncButtons();
    return done;
  }

  async redo() {
    if (!this.canRedo) return false;
    const entry = this.future.pop();
    this.past.push(entry);
    const done = await this.#install(entry.after, `Redone: ${entry.label}`, {
      header: 'Redoing',
      text: entry.label,
    });
    if (!done) {
      this.past.pop();
    }
    this.syncButtons();
    return done;
  }

  syncButtons() {
    const ui = this.cache.ui;
    if (!ui?.toggleDisabledElements) return;
    ui.toggleDisabledElements(['historyUndoBtn'], this.canUndo);
    ui.toggleDisabledElements(['historyRedoBtn'], this.canRedo);
    setTitle('historyUndoBtn', 'Undo', this.undoLabel, hotkeyLabel('Z'));
    setTitle('historyRedoBtn', 'Redo', this.redoLabel, hotkeyLabel('Y'));
  }

  #depth() {
    return this.cache.nodeRef?.size > LARGE_GRAPH_NODES ? MAX_DEPTH_LARGE : MAX_DEPTH;
  }

  /** Put a snapshot back on screen. False when its workspace no longer exists. */
  async #install(entry, message, busy) {
    const layouts = this.cache.data?.layouts;
    if (!layouts?.[entry.name] || !this.cache.graph) return false;

    this.restoring = true;
    try {
      // Rebuilt from the snapshot rather than merged onto the live object, so a
      // key the operation ADDED disappears again. Only the volatile keys are
      // carried over: they are live handles a clone would turn into a corpse.
      const live = layouts[entry.name];
      const restored = {};
      for (const key of VOLATILE_KEYS) restored[key] = live[key];
      for (const [key, value] of Object.entries(entry.state)) {
        restored[key] = structuredClone(value);
      }
      layouts[entry.name] = restored;

      const select = document.getElementById('selectView');
      if (select) select.value = entry.name;
      await this.cache.lm.changeLayout(message, busy);
      this.baseline = snapshot(this.cache);
    } finally {
      this.restoring = false;
    }
    return true;
  }
}

function setTitle(id, verb, label, hotkey) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.title = label ? `${verb}: ${label} (${hotkey})` : `Nothing to ${verb.toLowerCase()}`;
}

export function initHistory(cache) {
  const history = new History(cache);
  history.syncButtons();
  return history;
}

export { History };
