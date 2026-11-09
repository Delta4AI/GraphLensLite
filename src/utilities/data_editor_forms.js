/**
 * The data editor's popovers: the "+ Add" menu with its three small forms, and
 * the review list of unsaved changes. Both render into a RailMenu's element;
 * the DataTable owns the state and does the work.
 */
import { menuItem, menuSeparator } from '../managers/rail.js';

const FORMS = {
  node: { title: 'New node', submit: 'Add node' },
  edge: { title: 'New edge', submit: 'Add edge' },
  column: { title: 'New property column', submit: 'Add column' },
};

let fieldSeq = 0;

/** The menu as it opens: the three things that can be added. */
export function buildAddMenu(dt, el) {
  const open = (mode) => () => buildAddForm(dt, el, mode);
  el.append(
    menuItem({ icon: '○', label: 'Node…', onClick: open('node') }),
    menuItem({ icon: '—', label: 'Edge…', onClick: open('edge') }),
    menuItem({ icon: '▥', label: 'Property column…', onClick: open('column') })
  );
}

function field(form, label, { list, value = '', readOnly = false } = {}) {
  const id = `dataAddField${++fieldSeq}`;
  const row = document.createElement('div');
  row.className = 'data-form-row';
  const lab = document.createElement('label');
  lab.htmlFor = id;
  lab.textContent = label;
  const input = document.createElement('input');
  input.id = id;
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.value = value;
  input.readOnly = readOnly;
  if (list) input.setAttribute('list', list.id);
  const error = document.createElement('div');
  error.className = 'data-form-error';
  error.id = `${id}Error`;
  error.hidden = true;
  row.append(lab, input, error);
  form.appendChild(row);
  return { input, error };
}

function datalist(form, entries) {
  const list = document.createElement('datalist');
  list.id = `dataAddList${++fieldSeq}`;
  for (const [value, label] of entries) {
    const option = document.createElement('option');
    option.value = value;
    if (label) option.label = label;
    list.appendChild(option);
  }
  form.appendChild(list);
  return list;
}

function showError(fields, problem) {
  for (const { input, error } of Object.values(fields)) {
    error.hidden = true;
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  }
  if (!problem) return;
  const { input, error } = fields[problem.field];
  error.textContent = problem.message;
  error.hidden = false;
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', error.id);
  input.focus();
}

/** A small form in place of the menu, with an explicit button. */
function buildAddForm(dt, el, mode) {
  el.replaceChildren();
  const form = document.createElement('form');
  form.className = 'data-add-form';
  form.noValidate = true;
  const title = document.createElement('h4');
  title.textContent = FORMS[mode].title;
  form.appendChild(title);

  let fields;
  let forNodes = dt.kind !== 'Edge';
  if (mode === 'node') {
    fields = { id: field(form, 'ID'), label: field(form, 'Label') };
  } else if (mode === 'edge') {
    const nodes = datalist(form, (dt.fileData?.nodes ?? []).map((n) => [n.id, n.label]));
    fields = { source: field(form, 'Source', { list: nodes }), target: field(form, 'Target', { list: nodes }) };
    const id = field(form, 'ID', { readOnly: true });
    const sync = () => {
      const [s, t] = [fields.source.input.value.trim(), fields.target.input.value.trim()];
      id.input.value = s && t ? `${s}::${t}` : '';
    };
    fields.source.input.addEventListener('input', sync);
    fields.target.input.addEventListener('input', sync);
  } else {
    fields = {
      name: field(form, 'Name'),
      group: field(form, 'Group', { list: datalist(form, dt.propertyGroups().map((g) => [g])) }),
    };
    const row = document.createElement('div');
    row.className = 'data-form-row';
    const lab = document.createElement('span');
    lab.textContent = 'For';
    const seg = document.createElement('div');
    seg.className = 'prop-seg';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Column for');
    for (const [nodes, text] of [[true, 'Nodes'], [false, 'Edges']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.setAttribute('aria-pressed', String(nodes === forNodes));
      b.addEventListener('click', () => {
        forNodes = nodes;
        for (const other of seg.children) other.setAttribute('aria-pressed', String(other === b));
      });
      seg.appendChild(b);
    }
    row.append(lab, seg);
    form.appendChild(row);
  }

  const actions = document.createElement('div');
  actions.className = 'data-form-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'insp-btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => dt.addMenu.close());
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'insp-btn primary';
  submit.textContent = FORMS[mode].submit;
  actions.append(cancel, submit);
  form.appendChild(actions);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const value = (key) => fields[key].input.value;
    const problem =
      mode === 'node'
        ? await dt.addNode(value('id'), value('label'))
        : mode === 'edge'
          ? await dt.addEdge(value('source'), value('target'))
          : await dt.addColumn({ name: value('name'), group: value('group'), isNode: forNodes });
    if (problem) return showError(fields, problem);
    dt.addMenu.close();
    dt.focusActiveCell();
  });

  el.appendChild(form);
  Object.values(fields)[0].input.focus();
}

/** One line per unsaved change, each with its own Undo. */
export function buildReviewList(dt, el) {
  const items = dt.changeList();
  if (!items.length) {
    const none = document.createElement('div');
    none.className = 'data-review-empty';
    none.textContent = 'No unsaved changes.';
    el.appendChild(none);
    return;
  }
  const list = document.createElement('div');
  list.className = 'data-review';
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'data-review-item';
    const what = document.createElement('div');
    what.className = 'data-review-what';
    what.textContent = item.what;
    const detail = document.createElement('div');
    detail.className = 'data-review-detail';
    if (item.before !== undefined) {
      const before = document.createElement('del');
      before.textContent = item.before === '' ? '(empty)' : item.before;
      const after = document.createElement('ins');
      after.textContent = item.after === '' ? '(empty)' : item.after;
      detail.append(before, ' → ', after);
    } else {
      detail.textContent = item.detail;
    }
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'insp-btn';
    undo.textContent = 'Undo';
    undo.setAttribute('aria-label', `Undo: ${item.what}`);
    undo.addEventListener('click', () => {
      item.undo();
      if (!dt.changeList().length) return dt.reviewMenu.close();
      el.replaceChildren();
      buildReviewList(dt, el);
      el.querySelector('button')?.focus();
    });
    row.append(what, undo, detail);
    list.appendChild(row);
  }
  el.appendChild(list);
}

/** The row's ⋯ menu. */
export function buildRowMenu(dt, el, { type, id, added }) {
  const noun = type.toLowerCase();
  if (!added) {
    el.append(
      menuItem({ icon: '⌖', label: 'Show in graph', onClick: () => dt.showInGraph(type, id) }),
      menuSeparator()
    );
  }
  el.appendChild(
    menuItem({
      icon: '✕',
      label: added ? `Remove new ${noun}` : `Delete ${noun}`,
      onClick: () => dt.deleteRow(type, id),
    })
  );
}
