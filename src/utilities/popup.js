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

static async prompt(message) {
    return new Promise((resolve) => {
      const inputField = document.createElement('input');
      inputField.type = 'text';
      inputField.className = "p-prompt";

      const content = document.createElement('div');
      content.innerHTML = `<div>${message}</div>`;
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

      setTimeout(() => inputField.focus(), 0);
    });
  }


  static async confirm(message) {
    return new Promise((resolve) => {
      const content = document.createElement('div');
      content.innerHTML = `<div>${message}</div>`;

      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'p-footer';

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.className = "p-button p-button-secondary";

      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = 'OK';
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

      setTimeout(() => confirmBtn.focus(), 0);
    });
  }

  static async layoutCreationDialog(layoutInternals) {
    return new Promise((resolve) => {
      const container = document.createElement('div');

      // Name input
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'p-prompt';
      nameInput.placeholder = 'Enter workspace name...';
      nameInput.style.width = '100%';
      nameInput.style.marginBottom = '20px';
      nameInput.style.padding = '8px';
      container.appendChild(nameInput);

      // Mode selection
      const modeContainer = document.createElement('div');

      // Clone option
      const cloneDiv = document.createElement('div');
      cloneDiv.style.marginBottom = '10px';

      const cloneRadio = document.createElement('input');
      cloneRadio.type = 'radio';
      cloneRadio.name = 'layout-mode';
      cloneRadio.value = 'clone';
      cloneRadio.checked = true;
      cloneRadio.id = 'mode-clone';

      const cloneLabel = document.createElement('label');
      cloneLabel.htmlFor = 'mode-clone';
      cloneLabel.textContent = ' Clone Current Workspace';
      cloneLabel.style.fontWeight = 'bold';

      const cloneDesc = document.createElement('p');
      cloneDesc.textContent = 'Copies all settings: positions, filters, query, and bubble groups';
      cloneDesc.style.fontSize = '12px';
      cloneDesc.style.color = 'var(--text-muted)';
      cloneDesc.style.marginLeft = '20px';
      cloneDesc.style.marginTop = '5px';
      cloneDesc.style.marginBottom = '0';

      cloneDiv.appendChild(cloneRadio);
      cloneDiv.appendChild(cloneLabel);
      cloneDiv.appendChild(cloneDesc);
      modeContainer.appendChild(cloneDiv);

      // Template option
      const templateDiv = document.createElement('div');
      templateDiv.style.marginBottom = '10px';

      const templateRadio = document.createElement('input');
      templateRadio.type = 'radio';
      templateRadio.name = 'layout-mode';
      templateRadio.value = 'template';
      templateRadio.id = 'mode-template';

      const templateLabel = document.createElement('label');
      templateLabel.htmlFor = 'mode-template';
      templateLabel.textContent = ' Create from Template';
      templateLabel.style.fontWeight = 'bold';

      // Template dropdown (inline, initially hidden)
      const dropdown = document.createElement('select');
      dropdown.id = 'template-type-select';
      dropdown.className = 'p-prompt';
      dropdown.style.width = '150px';
      dropdown.style.marginLeft = '10px';
      dropdown.style.display = 'none';

      // Populate dropdown with layout types
      for (const [key, value] of Object.entries(layoutInternals)) {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = key.charAt(0).toUpperCase() + key.slice(1);
        dropdown.appendChild(option);
      }

      const templateDesc = document.createElement('p');
      templateDesc.textContent = 'Starts fresh with selected layout algorithm and default filters';
      templateDesc.style.fontSize = '12px';
      templateDesc.style.color = 'var(--text-muted)';
      templateDesc.style.marginLeft = '20px';
      templateDesc.style.marginTop = '5px';
      templateDesc.style.marginBottom = '10px';

      templateDiv.appendChild(templateRadio);
      templateDiv.appendChild(templateLabel);
      templateDiv.appendChild(dropdown);
      templateDiv.appendChild(templateDesc);
      modeContainer.appendChild(templateDiv);

      container.appendChild(modeContainer);

      // Show/hide dropdown based on radio selection
      const updateDropdownVisibility = () => {
        dropdown.style.display = templateRadio.checked ? 'inline-block' : 'none';
      };

      cloneRadio.addEventListener('change', updateDropdownVisibility);
      templateRadio.addEventListener('change', updateDropdownVisibility);

      // Buttons
      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'p-footer';

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.className = 'p-button p-button-secondary';

      const createBtn = document.createElement('button');
      createBtn.textContent = 'Create';
      createBtn.className = 'p-button p-button-primary';
      createBtn.style.backgroundColor = '#015C0C';

      buttonContainer.appendChild(cancelBtn);
      buttonContainer.appendChild(createBtn);
      container.appendChild(buttonContainer);

      let isResolved = false;

      const popup = new Popup(container, {
        title: 'Create New Workspace',
        width: '400px',
        showFullscreenButton: false,
        closeOnClickOutside: false,
        onClose: () => {
          if (!isResolved) {
            resolve(null);
          }
        }
      });

      const handleCreate = () => {
        const name = nameInput.value.trim();
        if (!name) {
          alert('Please enter a name for the layout');
          return;
        }

        isResolved = true;
        popup.close();

        const mode = cloneRadio.checked ? 'clone' : 'template';
        const result = {
          name: name,
          mode: mode,
          templateType: mode === 'template' ? dropdown.value : null
        };

        resolve(result);
      };

      createBtn.addEventListener('click', handleCreate);
      cancelBtn.addEventListener('click', () => {
        isResolved = true;
        popup.close();
        resolve(null);
      });

      nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          handleCreate();
        }
      });

      setTimeout(() => nameInput.focus(), 0);
    });
  }

  /**
   * Layout-picker dialog for re-laying-out the current workspace. A trimmed
   * sibling of layoutCreationDialog: no name/mode, just an algorithm choice
   * plus inline warnings. Resolves to { templateType } on Apply, or null on
   * Cancel / close.
   *
   * @param {Object} layoutInternals - layout template vocabulary (keys are types)
   * @param {Object} [options]
   * @param {string} [options.defaultType] - layout type to pre-select
   * @param {boolean} [options.hasPositions] - show the overwrite-positions warning
   * @param {number} [options.nodeCount] - current node count (perf warning)
   * @param {string[]} [options.expensiveLayouts] - types that warrant a perf warning
   * @param {number} [options.warningThreshold] - node count above which to warn
   * @returns {Promise<{templateType: string}|null>}
   */
  static async layoutSelectDialog(layoutInternals, options = {}) {
    const {
      defaultType = null,
      hasPositions = false,
      nodeCount = 0,
      expensiveLayouts = [],
      warningThreshold = Infinity,
    } = options;

    return new Promise((resolve) => {
      const container = document.createElement('div');

      const label = document.createElement('label');
      label.textContent = 'Layout algorithm';
      label.htmlFor = 'relayout-type-select';
      label.style.display = 'block';
      label.style.fontWeight = 'bold';
      label.style.marginBottom = '8px';
      container.appendChild(label);

      const dropdown = document.createElement('select');
      dropdown.id = 'relayout-type-select';
      dropdown.className = 'p-prompt';
      dropdown.style.width = '100%';
      dropdown.style.marginBottom = '12px';
      for (const key of Object.keys(layoutInternals)) {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = key.charAt(0).toUpperCase() + key.slice(1);
        if (key === defaultType) option.selected = true;
        dropdown.appendChild(option);
      }
      container.appendChild(dropdown);

      // Overwrite note (static): a full re-layout always discards the current
      // arrangement, so only surface it when there are positions to lose.
      if (hasPositions) {
        const overwrite = document.createElement('p');
        overwrite.textContent =
          '⚠ Recomputes positions for the whole workspace, overwriting the current (manually arranged) layout.';
        overwrite.style.fontSize = '12px';
        overwrite.style.color = 'var(--text-muted)';
        overwrite.style.margin = '0 0 12px';
        container.appendChild(overwrite);
      }

      // Perf warning (dynamic): only for super-linear layouts on large graphs;
      // re-evaluated whenever the chosen type changes.
      const perf = document.createElement('p');
      perf.id = 'relayout-perf-warning';
      perf.style.fontSize = '12px';
      perf.style.color = 'var(--danger-text)';
      perf.style.margin = '0 0 12px';
      container.appendChild(perf);

      const updatePerfWarning = () => {
        const type = dropdown.value;
        if (expensiveLayouts.includes(type) && nodeCount > warningThreshold) {
          perf.textContent =
            `⚠ The "${type}" layout is computationally intensive and may take several ` +
            `minutes on ${nodeCount.toLocaleString()} nodes. The UI stays blocked until it finishes.`;
          perf.style.display = '';
        } else {
          perf.textContent = '';
          perf.style.display = 'none';
        }
      };
      dropdown.addEventListener('change', updatePerfWarning);
      updatePerfWarning();

      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'p-footer';

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.className = 'p-button p-button-secondary';

      const applyBtn = document.createElement('button');
      applyBtn.textContent = 'Apply';
      applyBtn.className = 'p-button p-button-primary';

      buttonContainer.appendChild(cancelBtn);
      buttonContainer.appendChild(applyBtn);
      container.appendChild(buttonContainer);

      let isResolved = false;

      const popup = new Popup(container, {
        title: 'Re-layout Workspace',
        width: '400px',
        showFullscreenButton: false,
        closeOnClickOutside: false,
        onClose: () => {
          if (!isResolved) resolve(null);
        },
      });

      applyBtn.addEventListener('click', () => {
        isResolved = true;
        popup.close();
        resolve({ templateType: dropdown.value });
      });

      cancelBtn.addEventListener('click', () => {
        isResolved = true;
        popup.close();
        resolve(null);
      });

      setTimeout(() => applyBtn.focus(), 0);
    });
  }

  init(content) {
    this.createPopup(content);
    this.setupCloseHandlers();
    if (this.options.showFullscreenButton) {
      this.setupFullscreenButton();
    }
    this.show();
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

    // Header bar
    const headerDiv = document.createElement('div');
    headerDiv.className = 'p-header';

    if (this.options.title) {
      const titleEl = document.createElement('span');
      titleEl.className = 'p-title';
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
    this.closeBtn.title = 'Close popup';
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
  }

  show() {
    this.popup.style.display = 'flex';
    this.overlay.style.display = 'block';
  }

  close() {
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
    }
    if (this.options.onClose) {
      this.options.onClose();
    }
    this.popup.remove();
    this.overlay.remove();
  }
}

export {Popup}
