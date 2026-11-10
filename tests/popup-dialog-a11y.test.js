// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Popup } from '../src/utilities/popup.js';

// ==========================================================================
// Popup as a dialog: a native modal <dialog>. The platform supplies the role,
// the focus trap, the inert page behind and Escape-to-topmost (as a `cancel`
// event) — checked in a real browser; jsdom has no showModal (see
// tests/setup/dialog-shim.js). What this file pins is Popup's side of the
// contract: labelling, focus in and back, and that a `cancel` runs onClose
// instead of merely hiding the dialog. Popups nest — a flow inside one opens a
// confirm on top — and the browser sends `cancel` to the topmost only.
// ==========================================================================

const dialogs = () => [...document.querySelectorAll('.p-custom')];
// What the browser does on Escape: a cancelable `cancel` on the topmost modal.
const escape = () =>
  dialogs().at(-1)?.dispatchEvent(new window.Event('cancel', { cancelable: true }));

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('Popup dialog semantics', () => {
  it('is a labelled, open modal dialog', () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    const popup = new Popup('<p>body</p>', { title: 'Settings' });
    const el = dialogs()[0];

    expect(el.tagName).toBe('DIALOG');
    expect(showModal).toHaveBeenCalledOnce();
    expect(el.open).toBe(true);
    showModal.mockRestore();
    const labelId = el.getAttribute('aria-labelledby');
    expect(document.getElementById(labelId).textContent).toBe('Settings');
    popup.close();
  });

  it('does not point aria-labelledby at a title that does not exist', () => {
    const popup = new Popup('<p>body</p>');
    expect(dialogs()[0].hasAttribute('aria-labelledby')).toBe(false);
    popup.close();
  });

  it('gives untitled dialogs a unique label id per instance', () => {
    const a = new Popup('a', { title: 'First' });
    const b = new Popup('b', { title: 'Second' });
    const [idA, idB] = dialogs().map((el) => el.getAttribute('aria-labelledby'));

    expect(idA).not.toBe(idB);
    b.close();
    a.close();
  });

  it('moves focus into the dialog and restores it to the invoker on close', () => {
    document.body.innerHTML = '<button id="invoker">open</button>';
    const invoker = document.getElementById('invoker');
    invoker.focus();

    const popup = new Popup('<p>body</p>', { title: 'Settings' });
    expect(dialogs()[0].contains(document.activeElement)).toBe(true);

    popup.close();
    expect(document.activeElement).toBe(invoker);
  });

  it('closes on Escape, running onClose', () => {
    const onClose = vi.fn();
    new Popup('<p>body</p>', { title: 'Settings', onClose });

    escape();

    expect(onClose).toHaveBeenCalledOnce();
    expect(dialogs()).toHaveLength(0);
  });

  it('closes only the topmost of two stacked dialogs', () => {
    const outerClosed = vi.fn();
    const innerClosed = vi.fn();
    new Popup('<p>outer</p>', { title: 'Outer', onClose: outerClosed });
    new Popup('<p>inner</p>', { title: 'Inner', onClose: innerClosed });
    expect(dialogs()).toHaveLength(2);

    escape();
    expect(innerClosed).toHaveBeenCalledOnce();
    expect(outerClosed).not.toHaveBeenCalled();
    expect(dialogs()).toHaveLength(1);

    escape();
    expect(outerClosed).toHaveBeenCalledOnce();
    expect(dialogs()).toHaveLength(0);
  });

  it('keeps the browser from merely hiding the dialog on Escape', () => {
    new Popup('<p>body</p>', { title: 'Settings' });
    const cancel = new window.Event('cancel', { cancelable: true });

    dialogs()[0].dispatchEvent(cancel);

    expect(cancel.defaultPrevented).toBe(true);
    expect(dialogs()).toHaveLength(0);
  });

  it('closes on a backdrop click, not on a click inside', () => {
    const onClose = vi.fn();
    const popup = new Popup('<p>body</p>', { title: 'Settings', onClose });
    const el = popup.popup;
    el.getBoundingClientRect = () => ({ left: 100, top: 100, right: 300, bottom: 200 });
    const clickAt = (x, y) =>
      el.dispatchEvent(new window.MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));

    clickAt(150, 150); // the dialog's own border/padding
    expect(onClose).not.toHaveBeenCalled();
    clickAt(20, 20); // the ::backdrop
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('leaves the document once closed', () => {
    const onClose = vi.fn();
    const popup = new Popup('<p>body</p>', { title: 'Settings', onClose });
    popup.close();

    expect(dialogs()).toHaveLength(0);
    expect(onClose).toHaveBeenCalledOnce();
  });

  // Cancel, not OK: several callers discard the loaded graph or a workspace, so
  // Enter on an unread confirm has to be the harmless answer.
  it('focuses Cancel, not the confirming action', async () => {
    const pending = Popup.confirm('Sure?');
    await vi.waitFor(() =>
      expect(document.activeElement.className).toContain('p-button-secondary')
    );

    document.querySelector('.p-button-secondary').click();
    expect(await pending).toBe(false);
  });

  it('labels the confirming button with the caller\'s verb', async () => {
    const pending = Popup.confirm('Delete it?', 'Delete workspace');
    await vi.waitFor(() => expect(document.querySelector('.p-button-primary')).toBeTruthy());
    expect(document.querySelector('.p-button-primary').textContent).toBe('Delete workspace');

    document.querySelector('.p-button-primary').click();
    expect(await pending).toBe(true);
  });

  it('resolves a confirm as dismissed when Escape takes it', async () => {
    const pending = Popup.confirm('Sure?');
    escape();
    // onClose resolves null for "dismissed" — callers gate on === true.
    expect(await pending).toBeNull();
  });
});
