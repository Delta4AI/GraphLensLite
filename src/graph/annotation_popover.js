/**
 * The style popover for one text note (annotation_layer.js): font, border,
 * fill and shadow inputs plus Delete, appended to document.body and anchored
 * to the note's element.
 *
 * Inputs mutate the note object live; the layer owns everything that follows
 * from that — repaint, the undo entry, closing — through the callbacks.
 */
import {
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  MAX_BORDER_WIDTH,
  MAX_BORDER_RADIUS,
} from './annotation_geometry.js';
import { FONT_STYLES } from './label_renderers.js';
import { clampPopoverLeft, clampPopoverTop } from '../utilities/popover_position.js';

const POPOVER_OFFSET_PX = 8;

// ------------------------------------------------------------ popover inputs
// Row + input builders. `after` is the caller's per-edit hook (repaint + mark
// dirty).

function popoverRow(labelText, input) {
  const label = document.createElement('label');
  label.className = 'annotation-popover-row';
  const span = document.createElement('span');
  span.textContent = labelText;
  label.append(span, input);
  return label;
}

function popoverNumberInput(value, min, max, step, onChange, after) {
  const input = document.createElement('input');
  input.type = 'number';
  Object.assign(input, { min, max, step, value });
  input.addEventListener('input', () => {
    const n = Number(input.value);
    if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
    after();
  });
  return input;
}

function popoverColorInput(value, onChange, after) {
  const input = document.createElement('input');
  input.type = 'color';
  input.value = value;
  input.addEventListener('input', () => {
    onChange(input.value);
    after();
  });
  return input;
}

function popoverSelectInput(options, value, onChange, after) {
  const input = document.createElement('select');
  for (const option of options) input.appendChild(new Option(option, option));
  input.value = value;
  input.addEventListener('change', () => {
    onChange(input.value);
    after();
  });
  return input;
}

function popoverCheckboxInput(checked, onChange, after) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('input', () => {
    onChange(input.checked);
    after();
  });
  return input;
}

/**
 * The two rows that depend on each other: background (a toggle plus a colour,
 * because <input type=color> has no "none") and shadow, which needs a fill to
 * be visible at all (see ANNOTATION_SHADOW) and so switches the background on
 * rather than doing nothing.
 */
function buildPopoverFillRows(ann, after) {
  const bgColorInput = popoverColorInput(ann.bgColor ?? '#ffffff', (v) => {
    if (ann.bgColor != null) ann.bgColor = v;
  }, after);
  const bgToggle = popoverCheckboxInput(ann.bgColor != null, (on) => {
    ann.bgColor = on ? bgColorInput.value : null;
  }, after);
  const bgControls = document.createElement('span');
  bgControls.className = 'annotation-popover-pair';
  bgControls.append(bgToggle, bgColorInput);
  const bgRow = popoverRow('Background', bgControls);

  const shadowToggle = popoverCheckboxInput(ann.shadow === true, (on) => {
    ann.shadow = on;
    if (on && ann.bgColor == null) {
      ann.bgColor = bgColorInput.value;
      bgToggle.checked = true;
    }
  }, after);
  return { bgRow, shadowToggle };
}

/**
 * Open the popover for `ann`, anchored to its note element. The caller
 * positions and focuses it once it holds the handle, so anything that runs
 * during that focus change already sees the popover as open.
 *
 * Outside-pointerdown and Escape call `onDismiss`, which is expected to end up
 * in close(); Escape then hands focus back to the note.
 *
 * @param {object} ann  the note, mutated in place by the inputs
 * @param {HTMLElement|undefined} noteEl  the note's DOM element (anchor)
 * @param {{onEdit: () => void, onDelete: () => void, onDismiss: () => void}} hooks
 * @returns {{position: () => void, focus: () => void, close: () => void}}
 */
function openAnnotationPopover(ann, noteEl, { onEdit, onDelete, onDismiss }) {
  const pop = document.createElement('div');
  pop.className = 'annotation-popover';
  pop.setAttribute('role', 'group');
  pop.setAttribute('aria-label', 'Note style');
  // Every input reports through the same hook: repaint now, record one undo
  // entry when the popover closes.
  const after = onEdit;
  const numberInput = (value, min, max, step, onChange) =>
    popoverNumberInput(value, min, max, step, onChange, after);
  const colorInput = (value, onChange) => popoverColorInput(value, onChange, after);

  const { bgRow, shadowToggle } = buildPopoverFillRows(ann, after);

  pop.append(
    // Same bounds the sanitizer clamps to on load — stated once, there.
    popoverRow(
      'Font size',
      numberInput(ann.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE, 1, (v) => (ann.fontSize = v))
    ),
    popoverRow('Font style', popoverSelectInput(FONT_STYLES, ann.fontStyle, (v) => (ann.fontStyle = v), after)),
    popoverRow('Font color', colorInput(ann.fontColor, (v) => (ann.fontColor = v))),
    popoverRow('Border color', colorInput(ann.borderColor, (v) => (ann.borderColor = v))),
    popoverRow(
      'Border width',
      numberInput(ann.borderWidth, 0, MAX_BORDER_WIDTH, 0.5, (v) => (ann.borderWidth = v))
    ),
    popoverRow(
      'Corner radius',
      numberInput(ann.borderRadius ?? 0, 0, MAX_BORDER_RADIUS, 1, (v) => (ann.borderRadius = v))
    ),
    bgRow,
    popoverRow('Shadow', shadowToggle)
  );
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'annotation-popover-delete';
  del.textContent = '✗ Delete note';
  del.addEventListener('click', onDelete);
  pop.appendChild(del);

  const position = () => {
    if (!noteEl) return;
    const rect = noteEl.getBoundingClientRect();
    // Below the note by default, above it when the colour rows and Delete would
    // fall off the bottom edge (same flip as the tooltip layer). The clamp is
    // the last resort for a popover taller than the space on either side.
    const height = pop.offsetHeight;
    let top = rect.bottom + POPOVER_OFFSET_PX;
    if (top + height > window.innerHeight - POPOVER_OFFSET_PX) {
      top = rect.top - height - POPOVER_OFFSET_PX;
    }
    pop.style.top = `${clampPopoverTop(top, height, window.innerHeight)}px`;
    pop.style.left = `${clampPopoverLeft(rect.left, pop.offsetWidth, window.innerWidth)}px`;
  };

  document.body.appendChild(pop);

  // Both listeners are scoped to this popover's lifetime; close() drops them.
  const onOutside = (event) => {
    if (pop.contains(event.target) || noteEl?.contains(event.target)) return;
    onDismiss();
  };
  document.addEventListener('pointerdown', onOutside, true);
  const onEscape = (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onDismiss();
    noteEl?.focus();
  };
  document.addEventListener('keydown', onEscape, true);

  const close = () => {
    pop.remove();
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onEscape, true);
  };
  const focus = () => pop.querySelector('input')?.focus();
  return { position, focus, close };
}

export { openAnnotationPopover };
