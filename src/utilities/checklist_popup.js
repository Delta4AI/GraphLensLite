/**
 * The checklist modal shared by the Neo4j property picker and the expand
 * picker: an intro line, one or more sections of checkbox rows with a
 * section-wide toggle-all, and a Cancel / confirm footer. Both flows had this
 * scaffolding — heading, rows, toggle-all tri-state sync, footer, resolve
 * guard — written out in full, ~60 duplicated lines each.
 */

import { Popup } from './popup.js';

function span(className, text) {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

/**
 * One titled section. The toggle-all reflects its rows (checked /
 * indeterminate / unchecked) and drives them; `onChange` sees the `data` of
 * the currently checked rows, including once at build time.
 *
 * @param {{
 *   title: string,
 *   rows: Array<{label: string, meta?: string, metaTitle?: string, note?: string, checked?: boolean, data?: *}>,
 *   onChange?: (checked: *[]) => void,
 * }} spec
 * @returns {{elements: HTMLElement[], rows: Array<{input: HTMLInputElement, data: *}>}}
 */
function buildChecklistSection({ title, rows, onChange }) {
  const heading = document.createElement('div');
  heading.className = 'neo4j-props-heading';
  const headingLabel = document.createElement('label');
  const toggleAll = document.createElement('input');
  toggleAll.type = 'checkbox';
  headingLabel.appendChild(toggleAll);
  headingLabel.appendChild(document.createTextNode(` ${title}`));
  heading.appendChild(headingLabel);

  const list = document.createElement('div');
  list.className = 'neo4j-props-list';
  const built = rows.map((spec) => {
    const row = document.createElement('label');
    row.className = 'neo4j-prop-row';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = spec.checked !== false;
    row.appendChild(input);
    row.appendChild(span('neo4j-prop-name', spec.label));
    if (spec.meta) {
      const meta = span('neo4j-prop-type', spec.meta);
      if (spec.metaTitle) meta.title = spec.metaTitle;
      row.appendChild(meta);
    }
    if (spec.note) row.appendChild(span('neo4j-prop-examples', spec.note));

    list.appendChild(row);
    return { input, data: spec.data };
  });

  const sync = () => {
    const checked = built.filter((row) => row.input.checked);
    toggleAll.checked = checked.length === built.length;
    toggleAll.indeterminate = checked.length > 0 && checked.length < built.length;
    onChange?.(checked.map((row) => row.data));
  };
  sync();
  toggleAll.addEventListener('change', () => {
    built.forEach((row) => (row.input.checked = toggleAll.checked));
    sync();
  });
  list.addEventListener('change', sync); // row changes bubble

  return { elements: [heading, list], rows: built };
}

/**
 * Put checklist content in a modal with a Cancel / confirm footer. Resolves
 * with `onConfirm()`, or null when cancelled or dismissed (× / Escape).
 * `onReady` runs once the confirm button exists but before the popup opens —
 * for callers whose row state governs whether confirming is allowed.
 *
 * @param {{
 *   title: string,
 *   content: HTMLElement,
 *   confirmLabel: string,
 *   onConfirm: () => *,
 *   onReady?: (confirmBtn: HTMLButtonElement) => void,
 * }} spec
 * @returns {Promise<*|null>}
 */
function openChecklistPopup({ title, content, confirmLabel, onConfirm, onReady }) {
  return new Promise((resolve) => {
    const footer = document.createElement('div');
    footer.className = 'p-footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'p-button p-button-secondary';
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = confirmLabel;
    confirmBtn.className = 'p-button p-button-primary';
    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);
    content.appendChild(footer);
    onReady?.(confirmBtn);

    let resolved = false;
    const popup = new Popup(content, {
      title,
      width: '480px',
      showFullscreenButton: false,
      closeOnClickOutside: false,
      onClose: () => {
        if (!resolved) resolve(null);
      },
    });

    const settle = (value) => {
      resolved = true;
      popup.close();
      resolve(value);
    };
    confirmBtn.addEventListener('click', () => settle(onConfirm()));
    cancelBtn.addEventListener('click', () => settle(null));
  });
}

export { buildChecklistSection, openChecklistPopup };
