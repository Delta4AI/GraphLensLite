// jsdom 29 ships <dialog> without showModal/close. Popup (and the command
// palette) open native modal dialogs, so the open/closed state is stubbed for
// every jsdom test; Escape, the focus trap and the backdrop come from the
// platform and are checked in a real browser, not here.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
}
