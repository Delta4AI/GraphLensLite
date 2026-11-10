// A native modal <dialog>: showModal() puts it in the top layer, makes the
// page behind inert, traps focus and turns Escape into a `cancel` event on the
// topmost dialog only — so popups nest (a flow inside one opens Popup.confirm
// on top of it) without any bookkeeping here.
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
    this.popup = document.createElement('dialog');
    this.popup.className = 'p-custom';
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
      inset: this.popup.style.inset,
      top: this.popup.style.top,
      left: this.popup.style.left,
      borderRadius: this.popup.style.borderRadius,
      margin: this.popup.style.margin
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
    this.popup.style.inset = '0';
    this.popup.style.margin = 'auto';
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

  // Centered popups keep the modal dialog's own centering (inset 0, margin
  // auto). Never a transform: it would make the dialog the containing block of
  // the fixed-position tooltip that ui_tooltip renders inside it.
  setPosition() {
    if (!this.isExpanded && this.options.position !== 'center') {
      const margin = 8;
      const y = this.options.position.y;
      this.popup.style.inset = 'auto';
      this.popup.style.margin = '0';
      this.popup.style.top = `${y}px`;
      this.popup.style.left = `${this.options.position.x}px`;
      this.popup.style.maxHeight = (window.innerHeight - y - margin) + 'px';
    }
  }

  setupCloseHandlers() {
    this.closeBtn.addEventListener('click', () => this.close());

    // A backdrop click targets the dialog element itself; so does a click on
    // its border, hence the bounds check.
    if (this.options.closeOnClickOutside) {
      this.popup.addEventListener('click', (e) => {
        if (e.target !== this.popup) return;
        const r = this.popup.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside) this.close();
      });
    }

    // Escape: the browser would only hide the dialog, skipping onClose and the
    // cleanup below.
    this.popup.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.close();
    });
  }

  show() {
    this.popup.showModal();
  }

  close() {
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
    if (this.options.onClose) {
      this.options.onClose();
    }
    this.popup.close();
    this.popup.remove();
    // Only if it is still in the document — the popup may have replaced the very
    // control that opened it.
    if (this._invoker?.isConnected) this._invoker.focus?.();
  }
}

export {Popup}
