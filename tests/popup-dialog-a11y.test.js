// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Popup } from '../src/utilities/popup.js';

// ==========================================================================
// Popup as a dialog. The static helpers (confirm/prompt/alert) always focused
// their own button, but a plain `new Popup(...)` announced itself as one more
// div: no role, no way to dismiss from the keyboard, and focus left wherever it
// happened to be. Popups nest — a flow inside one opens a confirm on top — so
// Escape has to take the topmost only.
// ==========================================================================

const dialogs = () => [...document.querySelectorAll('.p-custom')];
const escape = () =>
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('Popup dialog semantics', () => {
  it('is a labelled modal dialog', () => {
    const popup = new Popup('<p>body</p>', { title: 'Settings' });
    const el = dialogs()[0];

    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-modal')).toBe('true');
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

  it('stops listening for Escape once closed', () => {
    const onClose = vi.fn();
    const popup = new Popup('<p>body</p>', { title: 'Settings', onClose });
    popup.close();

    escape();

    expect(onClose).toHaveBeenCalledOnce(); // not twice
  });

  it('lets the static helpers keep focusing their own control', async () => {
    const pending = Popup.confirm('Sure?');
    await vi.waitFor(() =>
      expect(document.activeElement.className).toContain('p-button-primary')
    );

    document.querySelector('.p-button-secondary').click();
    expect(await pending).toBe(false);
  });

  it('resolves a confirm as dismissed when Escape takes it', async () => {
    const pending = Popup.confirm('Sure?');
    escape();
    // onClose resolves null for "dismissed" — callers gate on === true.
    expect(await pending).toBeNull();
  });
});
