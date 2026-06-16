import { Popup } from './popup.js';

class ColorScalePicker {
  constructor(cache) {
    this.defaultColors = {
      min: '#403C53',
      zero: '#FFFFFF',
      max: '#C33D35',
    };
    this.handles = [];
    this.resolvePromise = null;
    this.minValue = 0;
    this.maxValue = 0;
    this.categories = [];
    this.defaultColorForMissing = '#CCCCCC';
    this.elementType = 'nodes';
    this.currentProperty = null;
    this.dom = {};
    this.metricValuePrefix = '__metric__:';
    this.activeMetricSource = null;
    this.popup = null;
    this.cache = cache;
  }

  buildContent() {
    const container = document.createElement('div');

    const dropdown = document.createElement('select');
    dropdown.className = 'p-prompt picker-dropdown';
    this.dom.dropdown = dropdown;
    container.appendChild(dropdown);

    const infoSection = document.createElement('div');
    infoSection.className = 'picker-info';
    infoSection.style.display = 'none';
    this.dom.infoSection = infoSection;
    container.appendChild(infoSection);

    const gradient = document.createElement('div');
    gradient.className = 'picker-gradient';
    gradient.style.display = 'none';
    this.dom.gradient = gradient;
    container.appendChild(gradient);

    const handleContainer = document.createElement('div');
    handleContainer.className = 'picker-handle-container';
    this.dom.handleContainer = handleContainer;
    container.appendChild(handleContainer);

    const controls = document.createElement('div');
    controls.className = 'picker-controls';
    controls.style.display = 'none';
    this.dom.controls = controls;

    const addButton = document.createElement('button');
    addButton.className = 'p-button picker-stop-btn';
    addButton.textContent = '+ Add Stop';
    addButton.title = 'Add a color stop to the gradient';
    addButton.onclick = () => this.addHandle();
    this.dom.addButton = addButton;

    const removeButton = document.createElement('button');
    removeButton.className = 'p-button picker-stop-btn';
    removeButton.textContent = '− Remove Stop';
    removeButton.title = 'Remove the middle color stop from the gradient';
    removeButton.onclick = () => this.removeHandle();
    this.dom.removeButton = removeButton;

    controls.append(addButton, removeButton);
    container.appendChild(controls);

    const categoryContainer = document.createElement('div');
    categoryContainer.className = 'picker-category-container';
    categoryContainer.style.display = 'none';
    this.dom.categoryContainer = categoryContainer;
    container.appendChild(categoryContainer);

    const defaultSection = document.createElement('div');
    defaultSection.className = 'picker-default-color-section';
    defaultSection.style.display = 'none';
    this.dom.defaultColorContainer = defaultSection;

    const dcLabel = document.createElement('span');
    dcLabel.textContent = 'Default color for missing values:';

    const dcInput = document.createElement('input');
    dcInput.type = 'color';
    dcInput.className = 'picker-color-swatch';
    dcInput.value = this.defaultColorForMissing;
    dcInput.addEventListener('input', (e) => {
      this.defaultColorForMissing = e.target.value;
    });
    this.dom.defaultColorEl = dcInput;

    defaultSection.append(dcLabel, dcInput);
    container.appendChild(defaultSection);

    const footer = document.createElement('div');
    footer.className = 'p-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'p-button p-button-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => this.cancel();

    const applyBtn = document.createElement('button');
    applyBtn.className = 'p-button p-button-primary disabled';
    applyBtn.textContent = 'Apply';
    applyBtn.onclick = () => this.apply();
    this.dom.applyButton = applyBtn;

    footer.append(cancelBtn, applyBtn);
    container.appendChild(footer);

    return container;
  }

  async pickColors(elementType = 'nodes') {
    this.elementType = elementType;
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      const content = this.buildContent();
      this.popup = new Popup(content, {
        title: 'Map Property to Color Scale',
        width: '480px',
        showFullscreenButton: false,
        closeOnClickOutside: false,
        onClose: () => {
          if (this.resolvePromise) {
            this.resolvePromise(null);
            this.resolvePromise = null;
          }
          this.popup = null;
        },
      });
      this.initializeFilters();
      this.setupHandleDragging();
    });
  }

  initializeFilters() {
    const dropdown = this.dom.dropdown;
    const filters = new Map(this.cache.data.layouts[this.cache.data.selectedLayout].filters);
    const available = new Set();

    const selectedElements =
      this.elementType === 'nodes' ? this.cache.selectedNodes : this.cache.selectedEdges;

    selectedElements.forEach((elementId) => {
      const element =
        this.elementType === 'nodes'
          ? this.cache.nodeRef.get(elementId)
          : this.cache.edgeRef.get(elementId);

      element?.features.forEach((f) => {
        if (filters.has(f)) available.add(f);
      });
    });

    const metricOptions =
      this.elementType === 'nodes' ? this.cache.metrics.getMetricScaleOptions() : [];

    dropdown.innerHTML = '<option value="">Select property...</option>';
    const propertyOptions = Array.from(available).sort();
    if (propertyOptions.length > 0) {
      const dataGroup = document.createElement('optgroup');
      dataGroup.label = 'Data Properties';
      propertyOptions.forEach((prop) => {
        const opt = document.createElement('option');
        opt.value = prop;
        opt.textContent = prop;
        dataGroup.appendChild(opt);
      });
      dropdown.appendChild(dataGroup);
    }

    if (metricOptions.length > 0) {
      const metricGroup = document.createElement('optgroup');
      metricGroup.label = 'Network Metrics';
      metricOptions.forEach((metric) => {
        const opt = document.createElement('option');
        opt.value = `${this.metricValuePrefix}${metric.id}`;
        opt.textContent = `${metric.label} (${metric.valueLabel})${metric.cached ? '' : ' (calculate)'}`;
        metricGroup.appendChild(opt);
      });
      dropdown.appendChild(metricGroup);
    }

    dropdown.onchange = async () => {
      const value = dropdown.value;
      const metricSource = this.getMetricSource(value);
      if (metricSource) {
        await this.selectProperty(value, { isCategory: false }, metricSource);
      } else {
        await this.selectProperty(value, filters.get(value));
      }
    };
  }

  async selectProperty(property, filterObj, metricSource = null) {
    if (!property) return;

    const selectedElements =
      this.elementType === 'nodes' ? this.cache.selectedNodes : this.cache.selectedEdges;
    const elementRef = this.elementType === 'nodes' ? this.cache.nodeRef : this.cache.edgeRef;
    if (property.startsWith(this.metricValuePrefix) && !metricSource) {
      const metricId = property.slice(this.metricValuePrefix.length);
      metricSource = await this.cache.metrics.ensureMetricValues(metricId);
      filterObj = { isCategory: false };
    }
    if (property.startsWith(this.metricValuePrefix) && !metricSource) {
      this.cache.ui.warning('Metric values not available yet. Calculate the metric first.');
      return;
    }
    if (!filterObj) {
      this.cache.ui.warning('No values found for selected property');
      return;
    }
    this.activeMetricSource = metricSource;

    const values = [];
    const elementsWithProperty = Array.from(selectedElements).filter((id) => {
      if (metricSource) {
        const value = metricSource.values.get(id);
        if (value !== undefined) {
          values.push(value);
          return true;
        }
        return false;
      }
      const element = elementRef.get(id);
      const value = element?.featureValues.get(property);
      if (value !== undefined) {
        values.push(value);
        return true;
      }
      return false;
    });

    const totalElements = selectedElements.length;
    const elementsWithPropertyCount = elementsWithProperty.length;

    if (!filterObj.isCategory && values.length === 0) {
      this.cache.ui.warning('No numeric values found for selected property');
      return;
    }

    const elementTypeLabel = this.elementType === 'nodes' ? 'nodes' : 'edges';
    const propertyDisplayName = metricSource
      ? `${metricSource.label} (${metricSource.valueLabel})`
      : property.includes('::')
        ? property.split('::').pop()
        : property;
    const targetProperty = this.currentProperty || 'color';

    let infoHTML = `<div class="picker-info-summary">
      Coloring <strong>${targetProperty}</strong> for <strong>${elementsWithPropertyCount}</strong> of <strong>${totalElements}</strong> ${elementTypeLabel}`;

    if (!filterObj.isCategory) {
      const minVal = Math.min(...values);
      const maxVal = Math.max(...values);
      infoHTML += `</div><div class="picker-info-range">
        <strong>${propertyDisplayName}</strong> min: ${minVal.toFixed(2)}
        &nbsp;&nbsp;
        <strong>${propertyDisplayName}</strong> max: ${maxVal.toFixed(2)}
      </div>`;
    } else {
      infoHTML += `</div>`;
    }

    this.dom.infoSection.innerHTML = infoHTML;
    this.dom.infoSection.style.display = '';

    if (elementsWithPropertyCount < totalElements) {
      this.dom.defaultColorContainer.style.display = '';
    } else {
      this.dom.defaultColorContainer.style.display = 'none';
    }

    this.dom.applyButton.classList.remove('disabled');

    if (filterObj.isCategory) {
      this.categories = [...(filterObj.categories || [])].map((name) => ({
        name,
        color: this.generateRandomColor(),
      }));
      this.renderCategories();
    } else {
      this.initializeGradient(property);
    }
  }

  renderCategories() {
    this.dom.gradient.style.display = 'none';
    this.dom.handleContainer.style.display = 'none';
    this.dom.controls.style.display = 'none';
    this.dom.categoryContainer.innerHTML = '';
    this.dom.categoryContainer.style.display = '';

    this.categories.forEach((cat) => {
      const row = document.createElement('div');
      row.className = 'picker-category-row';

      const label = document.createElement('span');
      label.textContent = cat.name;

      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = cat.color;
      colorInput.oninput = (e) => {
        cat.color = e.target.value;
      };

      row.append(label, colorInput);
      this.dom.categoryContainer.appendChild(row);
    });
  }

  generateRandomColor() {
    return `#${Math.floor(Math.random() * 0xffffff)
      .toString(16)
      .padStart(6, '0')}`;
  }

  initializeGradient(property) {
    const selectedElements =
      this.elementType === 'nodes' ? this.cache.selectedNodes : this.cache.selectedEdges;
    const elementRef = this.elementType === 'nodes' ? this.cache.nodeRef : this.cache.edgeRef;
    const values = this.activeMetricSource
      ? Array.from(selectedElements)
          .map((id) => this.activeMetricSource.values.get(id))
          .filter((v) => v !== undefined)
      : Array.from(selectedElements)
          .map((id) => elementRef.get(id)?.featureValues.get(property))
          .filter((v) => v !== undefined);

    this.minValue = Math.min(...values);
    this.maxValue = Math.max(...values);

    this.handles = [
      { pos: 0, color: this.defaultColors.min, value: this.minValue, fixed: true },
      { pos: 100, color: this.defaultColors.max, value: this.maxValue, fixed: true },
    ];

    this.dom.gradient.style.display = '';
    this.dom.handleContainer.style.display = '';
    this.dom.controls.style.display = '';
    this.dom.categoryContainer.style.display = 'none';

    this.renderHandles();
    this.updateGradient();
  }

  setupHandleDragging() {
    const container = this.dom.handleContainer;

    container.addEventListener('mousedown', (e) => {
      const handleEl = e.target.closest('.picker-handle');
      if (!handleEl) return;

      const idx = parseInt(handleEl.dataset.index, 10);
      const handleObj = this.handles[idx];
      if (handleObj.fixed) return;

      const onMove = (moveEvent) => {
        const rect = container.getBoundingClientRect();
        let pos = ((moveEvent.clientX - rect.left) / rect.width) * 100;
        pos = Math.max(0, Math.min(100, pos));
        this.updateHandlePosition(handleObj, pos);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener(
        'mouseup',
        () => {
          document.removeEventListener('mousemove', onMove);
        },
        { once: true }
      );
    });
  }

  updateHandlePosition(handle, newPos) {
    handle.pos = newPos;
    handle.value = this.minValue + (newPos / 100) * (this.maxValue - this.minValue);

    this.handles.sort((a, b) => a.pos - b.pos);

    this.renderHandles();
    this.updateGradient();
  }

  renderHandles() {
    this.dom.handleContainer.innerHTML = '';

    this.handles.forEach((handle, i) => {
      const element = document.createElement('div');
      element.className = 'picker-handle';
      element.style.left = `${handle.pos}%`;
      element.style.backgroundColor = handle.color;
      element.dataset.index = i;
      element.dataset.fixed = handle.fixed;
      element.style.zIndex = handle.fixed ? 1 : 2;

      const value = document.createElement('div');
      value.className = 'picker-handle-value';
      value.textContent = handle.value.toFixed(2);

      const colorPicker = document.createElement('input');
      colorPicker.type = 'color';
      colorPicker.value = handle.color;
      colorPicker.className = 'picker-handle-color';

      colorPicker.addEventListener('input', (e) => {
        handle.color = e.target.value;
        element.style.backgroundColor = e.target.value;
        this.updateGradient();
      });

      if (!handle.fixed) {
        element.style.cursor = 'move';
      }

      element.appendChild(value);
      element.appendChild(colorPicker);
      this.dom.handleContainer.appendChild(element);
    });
  }

  updateGradient() {
    const stops = [...this.handles]
      .sort((a, b) => a.pos - b.pos)
      .map((h) => `${h.color} ${h.pos}%`)
      .join(', ');
    this.dom.gradient.style.background = `linear-gradient(to right, ${stops})`;
  }

  addHandle() {
    if (this.handles.length >= 10) return;

    const newColor = this.generateRandomColor();
    const sortedHandles = [...this.handles].sort((a, b) => a.pos - b.pos);
    let maxGap = 0;
    let insertIndex = 1;

    for (let i = 0; i < sortedHandles.length - 1; i++) {
      const gap = sortedHandles[i + 1].pos - sortedHandles[i].pos;
      if (gap > maxGap) {
        maxGap = gap;
        insertIndex = i + 1;
      }
    }

    const pos = (sortedHandles[insertIndex - 1].pos + sortedHandles[insertIndex].pos) / 2;
    const value = this.minValue + (pos / 100) * (this.maxValue - this.minValue);

    this.handles.push({ pos, color: newColor, value, fixed: false });
    this.handles.sort((a, b) => a.pos - b.pos);

    this.renderHandles();
    this.updateGradient();
  }

  removeHandle() {
    if (this.handles.length <= 2) return;
    this.handles.splice(Math.floor(this.handles.length / 2), 1);
    this.renderHandles();
    this.updateGradient();
  }

  apply() {
    const dropdown = this.dom.dropdown;
    const colorMap = new Map();

    const selectedElements =
      this.elementType === 'nodes' ? this.cache.selectedNodes : this.cache.selectedEdges;
    const elementRef = this.elementType === 'nodes' ? this.cache.nodeRef : this.cache.edgeRef;

    const metricSource = this.getMetricSource(dropdown.value);
    const filterObj = metricSource
      ? { isCategory: false }
      : this.cache.data.layouts[this.cache.data.selectedLayout].filters.get(dropdown.value);
    const isCategory = filterObj?.isCategory;

    if (isCategory) {
      const categoryColorMap = new Map(this.categories.map((cat) => [cat.name, cat.color]));

      Array.from(selectedElements).forEach((elementId) => {
        const element = elementRef.get(elementId);
        const valueSet = element?.featureValues.get(dropdown.value);
        const value = valueSet instanceof Set ? Array.from(valueSet)[0] : valueSet;

        if (value !== undefined && categoryColorMap.has(value)) {
          colorMap.set(elementId, categoryColorMap.get(value));
        }
      });
    } else {
      Array.from(selectedElements).forEach((elementId) => {
        const element = elementRef.get(elementId);
        const value = metricSource
          ? metricSource.values.get(elementId)
          : element?.featureValues.get(dropdown.value);

        if (value !== undefined) {
          const normalizedValue = ((value - this.minValue) / (this.maxValue - this.minValue)) * 100;
          const color = this.getColorForValue(normalizedValue);
          colorMap.set(elementId, color);
        }
      });
    }

    if (this.resolvePromise) {
      this.resolvePromise(colorMap);
      this.resolvePromise = null;
    }
    this.close();
  }

  cancel() {
    if (this.resolvePromise) {
      this.resolvePromise(null);
      this.resolvePromise = null;
    }
    this.close();
  }

  getColorForValue(normalizedValue) {
    const sortedHandles = [...this.handles].sort((a, b) => a.pos - b.pos);
    let lower = sortedHandles[0];
    let upper = sortedHandles[sortedHandles.length - 1];

    for (let i = 0; i < sortedHandles.length - 1; i++) {
      const currentHandle = sortedHandles[i];
      const nextHandle = sortedHandles[i + 1];

      if (currentHandle.pos === nextHandle.pos) {
        continue;
      }

      if (currentHandle.pos <= normalizedValue && nextHandle.pos >= normalizedValue) {
        lower = currentHandle;
        upper = nextHandle;
        break;
      }
    }

    if (lower.pos === upper.pos) {
      return upper.color;
    }

    const t = (normalizedValue - lower.pos) / (upper.pos - lower.pos);
    return this.interpolateColor(lower.color, upper.color, t);
  }

  interpolateColor(color1, color2, t) {
    t = Math.max(0, Math.min(1, isNaN(t) ? 0 : t));

    const r1 = parseInt(color1.slice(1, 3), 16);
    const g1 = parseInt(color1.slice(3, 5), 16);
    const b1 = parseInt(color1.slice(5, 7), 16);

    const r2 = parseInt(color2.slice(1, 3), 16);
    const g2 = parseInt(color2.slice(3, 5), 16);
    const b2 = parseInt(color2.slice(5, 7), 16);

    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);

    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }

  close() {
    if (this.popup) {
      this.popup.close();
      this.popup = null;
    }
  }

  getMetricSource(property) {
    if (!property || !property.startsWith(this.metricValuePrefix)) return null;
    const metricId = property.slice(this.metricValuePrefix.length);
    return this.cache.metrics.getMetricScaleValues(metricId);
  }
}

function replaceColorScale(obj, elemID, colorMap) {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  for (let key in obj) {
    const value = obj[key];

    if (value === 'set_continuous_color_scale') {
      if (colorMap.has(elemID)) {
        obj[key] = colorMap.get(elemID);
      } else {
        delete obj[key];
      }
    } else if (typeof value === 'object') {
      replaceColorScale(value, elemID, colorMap);
    }
  }

  return obj;
}

export { ColorScalePicker, replaceColorScale };
