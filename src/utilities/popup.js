// Popups nest: a flow inside one opens Popup.confirm on top of it. Escape has
// to dismiss the topmost only, which a per-popup document listener cannot know
// on its own.
const openPopups = [];
let dialogSeq = 0;

class Popup {
  /**
   * // Simple text popup
   * const popup1 = new Popup("Hello, I'm a simple popup!");
   *
   * // Popup with title
   * const popup2 = new Popup("<p>Content here</p>", { title: "My Popup" });
   *
   * // Popup with custom options
   * const popup3 = new Popup("Custom positioned popup!", {
   *     title: 'Settings',
   *     width: '400px',
   *     position: { x: 100, y: 100 },
   *     closeOnClickOutside: false,
   *     onClose: () => ui.debug('Popup closed!')
   * });
   */
  constructor(content, options = {}) {
    this.options = {
      title: null,
      width: '300px',
      height: 'auto',
      position: 'center',
      lineHeight: 'normal',
      closeOnClickOutside: true,
      onClose: null,
      showFullscreenButton: true,
      // What the × does, when "Close popup" is not what the user is doing —
      // the tour's × ends a 14-step tour.
      closeTitle: 'Close popup',
      ...options
    };

    this.popup = null;
    this.overlay = null;
    this.closeBtn = null;
    this.fullscreenBtn = null;
    this.isExpanded = false;
    this.originalStyles = null;

    this.init(content);
  }

/**
   * Single-line input modal. Resolves the trimmed value, '' on empty submit, or
   * null when dismissed. `initialValue` pre-fills and pre-selects the box — a
   * rename that starts empty makes the user retype what they are editing.
   */
  static async prompt(message, initialValue = '') {
    return new Promise((resolve) => {
      const inputField = document.createElement('input');
      inputField.type = 'text';
      inputField.className = "p-prompt";
      inputField.value = initialValue;

      const content = document.createElement('div');
      const messageEl = document.createElement('div');
      messageEl.textContent = message;
      content.appendChild(messageEl);
      content.appendChild(inputField);

      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'p-footer';

      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = 'OK';
      confirmBtn.className = "p-button p-button-primary";
      buttonContainer.appendChild(confirmBtn);
      content.appendChild(buttonContainer);

      let isConfirmed = false;

      const handleConfirm = () => {
        isConfirmed = true;
        const value = inputField.value.trim();
        popup.close();
        resolve(value);
      };

      const popup = new Popup(content, {
        title: 'Input',
        width: '300px',
        showFullscreenButton: false,
        closeOnClickOutside: false,
        onClose: () => {
          if (!isConfirmed) {
            resolve(null);
          }
        }
      });

      confirmBtn.addEventListener('click', handleConfirm);
      inputField.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          handleConfirm();
        }
      });

      setTimeout(() => inputField.select(), 0);
    });
  }


  /**
   * Yes/no modal. Resolves true (confirmed), false (cancelled) or null (closed).
   *
   * Cancel takes the focus, so Enter on a confirm the user has not read yet is
   * the SAFE answer — several callers here discard the loaded graph, a
   * workspace or a conversation. `confirmLabel` names the action instead of
   * saying "OK": the verb is the last thing between the user and the damage.
   *
   * @param {string} message
   * @param {string} [confirmLabel]
   */
  static async confirm(message, confirmLabel = 'OK') {
    return new Promise((resolve) => {
      const content = document.createElement('div');
      const messageEl = document.createElement('div');
      messageEl.textContent = message;
      content.appendChild(messageEl);

      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'p-footer';

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.className = "p-button p-button-secondary";

      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = confirmLabel;
      confirmBtn.className = "p-button p-button-primary";

      buttonContainer.appendChild(cancelBtn);
      buttonContainer.appendChild(confirmBtn);
      content.appendChild(buttonContainer);

      let isResolved = false;

      const popup = new Popup(content, {
        title: 'Confirm',
        width: '300px',
        showFullscreenButton: false,
        closeOnClickOutside: false,
        onClose: () => {
          if (!isResolved) {
            resolve(null);
          }
        }
      });

      confirmBtn.addEventListener('click', () => {
        isResolved = true;
        popup.close();
        resolve(true);
      });

      cancelBtn.addEventListener('click', () => {
        isResolved = true;
        popup.close();
        resolve(false);
      });

      setTimeout(() => cancelBtn.focus(), 0);
    });
  }



  init(content) {
    // Whoever had focus gets it back on close — otherwise focus lands on <body>
    // and a keyboard user restarts from the top of the document.
    this._invoker = document.activeElement;
    this.createPopup(content);
    this.setupCloseHandlers();
    if (this.options.showFullscreenButton) {
      this.setupFullscreenButton();
    }
    this.show();
    openPopups.push(this);
    // Focus the dialog itself, not a control inside it: the static helpers
    // (confirm/prompt) focus their own button or input from a timeout, which
    // runs after this and still wins.
    this.popup.focus();
    requestAnimationFrame(() => this.updateExpandButtonVisibility());
    this._resizeHandler = () => {
      if (this.isExpanded) {
        this.popup.style.transition = 'none';
        this.applyExpandedSize();
        this.popup.offsetHeight;
        this.popup.style.transition = '';
      } else {
        if (this.options.position !== 'center') {
          const margin = 8;
          this.popup.style.maxHeight = (window.innerHeight - this.options.position.y - margin) + 'px';
        }
        this.updateExpandButtonVisibility();
      }
    };
    window.addEventListener('resize', this._resizeHandler);
  }

  createPopup(content) {
    this.popup = document.createElement('div');
    this.popup.className = 'p-custom';
    // A screen reader has to be told this is a modal dialog; without the role
    // it reads as one more div and the user never learns focus is trapped in it.
    this.popup.setAttribute('role', 'dialog');
    this.popup.setAttribute('aria-modal', 'true');
    // Focusable so the dialog itself can take focus when it has no controls of
    // its own to hand it to.
    this.popup.tabIndex = -1;

    // Header bar
    const headerDiv = document.createElement('div');
    headerDiv.className = 'p-header';

    if (this.options.title) {
      const titleEl = document.createElement('span');
      titleEl.className = 'p-title';
      titleEl.id = `p-title-${++dialogSeq}`;
      this.popup.setAttribute('aria-labelledby', titleEl.id);
      if (typeof this.options.title === 'string') {
        titleEl.textContent = this.options.title;
      } else {
        titleEl.appendChild(this.options.title);
      }
      headerDiv.appendChild(titleEl);
    }

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'p-header-actions';

    if (this.options.showFullscreenButton) {
      this.fullscreenBtn = document.createElement('button');
      this.fullscreenBtn.className = 'p-icon';
      this.fullscreenBtn.innerHTML = '⛶';
      this.fullscreenBtn.title = 'Expand to fit content';
      actionsDiv.appendChild(this.fullscreenBtn);
    }

    this.closeBtn = document.createElement('button');
    this.closeBtn.className = 'p-icon';
    this.closeBtn.innerHTML = '×';
    this.closeBtn.title = this.options.closeTitle;
    actionsDiv.appendChild(this.closeBtn);

    headerDiv.appendChild(actionsDiv);

    // Body
    const popupContent = document.createElement('div');
    popupContent.className = 'p-body';

    if (typeof content === 'string') {
      popupContent.innerHTML = content;
    } else {
      popupContent.appendChild(content);
    }

    this.popup.appendChild(headerDiv);
    this.popup.appendChild(popupContent);

    const footer = popupContent.querySelector('.p-footer, .tour-footer');
    if (footer) {
      footer.remove();
      this.popup.appendChild(footer);
    }

    this.overlay = document.createElement('div');
    this.overlay.className = 'p-overlay';

    document.body.appendChild(this.overlay);
    document.body.appendChild(this.popup);

    this.popup.style.width = this.options.width;
    if (this.options.height !== 'auto') {
      this.popup.style.height = this.options.height;
    }

    if (this.options.lineHeight !== 'normal') {
      popupContent.style.lineHeight = this.options.lineHeight;
    }

    this.setPosition();
    this.storeOriginalStyles();
  }

  storeOriginalStyles() {
    this.originalStyles = {
      width: this.popup.style.width,
      height: this.popup.style.height,
      maxWidth: this.popup.style.maxWidth,
      maxHeight: this.popup.style.maxHeight,
      top: this.popup.style.top,
      left: this.popup.style.left,
      transform: this.popup.style.transform,
      borderRadius: this.popup.style.borderRadius,
      margin: this.popup.style.margin,
      position: this.popup.style.position
    };
  }

  setupFullscreenButton() {
    this.fullscreenBtn.addEventListener('click', () => this.toggleExpand());
  }

  updateExpandButtonVisibility() {
    if (!this.fullscreenBtn) return;
    if (this.isExpanded) {
      this.fullscreenBtn.style.display = '';
      return;
    }
    const body = this.popup.querySelector('.p-body');
    if (!body) return;
    const isClipped = body.scrollHeight > body.clientHeight + 1 || body.scrollWidth > body.clientWidth + 1;
    this.fullscreenBtn.style.display = isClipped ? '' : 'none';
  }

  measureNaturalSize() {
    const savedTransition = this.popup.style.transition;
    this.popup.style.transition = 'none';
    const saved = {
      w: this.popup.style.width, h: this.popup.style.height,
      mw: this.popup.style.maxWidth, mh: this.popup.style.maxHeight
    };
    this.popup.style.width = 'auto';
    this.popup.style.height = 'auto';
    this.popup.style.maxWidth = 'none';
    this.popup.style.maxHeight = 'none';
    const naturalW = this.popup.offsetWidth;
    const naturalH = this.popup.offsetHeight;
    Object.assign(this.popup.style, {
      width: saved.w, height: saved.h,
      maxWidth: saved.mw, maxHeight: saved.mh
    });
    this.popup.offsetHeight; // force reflow before re-enabling transitions
    this.popup.style.transition = savedTransition;
    return { w: naturalW, h: naturalH };
  }

  applyExpandedSize() {
    const currentW = this.popup.offsetWidth;
    const currentH = this.popup.offsetHeight;
    const { w: naturalW, h: naturalH } = this.measureNaturalSize();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const fitW = Math.min(Math.max(naturalW, currentW), vw);
    const fitH = Math.min(Math.max(naturalH, currentH), vh);

    this.popup.style.width = fitW + 'px';
    this.popup.style.height = fitH + 'px';
    this.popup.style.maxWidth = '100vw';
    this.popup.style.maxHeight = '100vh';
    this.popup.style.top = '50%';
    this.popup.style.left = '50%';
    this.popup.style.transform = 'translate(-50%, -50%)';
    this.popup.style.borderRadius = (fitW >= vw || fitH >= vh) ? '0' : '';
  }

  toggleExpand() {
    if (!this.isExpanded) {
      this.isExpanded = true;
      this.applyExpandedSize();
      this.fullscreenBtn.innerHTML = '⤡';
      this.fullscreenBtn.title = 'Restore size';
    } else {
      this.isExpanded = false;
      Object.assign(this.popup.style, this.originalStyles);
      this.fullscreenBtn.innerHTML = '⛶';
      this.fullscreenBtn.title = 'Expand to fit content';
      const onDone = (e) => {
        if (e.target !== this.popup) return;
        this.popup.removeEventListener('transitionend', onDone);
        this.updateExpandButtonVisibility();
      };
      this.popup.addEventListener('transitionend', onDone);
    }
  }

  setPosition() {
    if (!this.isExpanded) {
      if (this.options.position === 'center') {
        this.popup.style.top = '50%';
        this.popup.style.left = '50%';
        this.popup.style.transform = 'translate(-50%, -50%)';
      } else {
        const margin = 8;
        const y = this.options.position.y;
        this.popup.style.top = `${y}px`;
        this.popup.style.left = `${this.options.position.x}px`;
        this.popup.style.transform = 'none';
        this.popup.style.maxHeight = (window.innerHeight - y - margin) + 'px';
      }
    }
  }

  setupCloseHandlers() {
    this.closeBtn.addEventListener('click', () => this.close());

    if (this.options.closeOnClickOutside) {
      this.overlay.addEventListener('click', () => this.close());
    }

    // Escape is the only dismissal a keyboard user can reach without hunting
    // for the × in the tab order; Tab is what aria-modal="true" promises and
    // a plain div cannot deliver. Topmost popup only, so a nested confirm does
    // not take its parent down with it — or steal its parent's Tab.
    this._escapeHandler = (e) => {
      if (openPopups[openPopups.length - 1] !== this) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
        return;
      }
      if (e.key === 'Tab') trapTab(e, this.popup);
    };
    document.addEventListener('keydown', this._escapeHandler, true);
  }

  show() {
    this.popup.style.display = 'flex';
    this.overlay.style.display = 'block';
  }

  close() {
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
    if (this._escapeHandler) {
      document.removeEventListener('keydown', this._escapeHandler, true);
      this._escapeHandler = null;
    }
    const at = openPopups.indexOf(this);
    if (at !== -1) openPopups.splice(at, 1);
    if (this.options.onClose) {
      this.options.onClose();
    }
    this.popup.remove();
    this.overlay.remove();
    // Only if it is still in the document — the popup may have replaced the very
    // control that opened it.
    if (this._invoker?.isConnected) this._invoker.focus?.();
  }
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keep Tab inside the dialog. `aria-modal="true"` tells assistive tech focus
 * is trapped; nothing traps it, so Tab walked straight out into the page
 * behind — which is still there, still clickable, and reads as if the dialog
 * had closed.
 */
function trapTab(event, dialog) {
  // `hidden` is how this codebase hides dialog sections (the Neo4j error box,
  // the checklist's empty groups). Elements hidden by display:none instead are
  // not focusable anyway, so focus simply stays where it is.
  const items = [...dialog.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('[hidden]'));
  if (items.length === 0) {
    // Nothing to tab to: hold focus on the dialog rather than let it escape.
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !dialog.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

export {Popup}
