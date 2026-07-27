import {Popup} from './popup.js';

class NumericScalePicker {
  constructor(cache) {
    this.resolvePromise = null;
    this.minValue = 0;
    this.maxValue = 0;
    this.minOutput = 0;
    this.maxOutput = 100;
    this.elementType = "nodes";
    this.propertyName = null;
    this.dom = {};
    this.cache = cache;
    this.metricValuePrefix = "__metric__:";
    this.activeMetricSource = null;
    this.popup = null;
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

    const rangeConfig = document.createElement('div');
    rangeConfig.className = 'picker-range-config';
    rangeConfig.style.display = 'none';
    this.dom.rangeConfig = rangeConfig;

    const outputLabel = document.createElement('div');
    outputLabel.className = 'picker-range-label';
    outputLabel.innerHTML = `Set <strong>${this.propertyName || 'output'}</strong> range:`;
    this.dom.outputLabel = outputLabel;
    rangeConfig.appendChild(outputLabel);

    const outputRow = document.createElement('div');
    outputRow.className = 'picker-range-row';

    const minOutputInput = document.createElement('input');
    minOutputInput.type = 'number';
    minOutputInput.className = 'picker-range-input';
    minOutputInput.value = this.minOutput;
    minOutputInput.step = 'any';
    minOutputInput.oninput = () => {
      this.minOutput = parseFloat(minOutputInput.value) || 0;
    };
    this.dom.minOutputInput = minOutputInput;

    const arrow = document.createElement('span');
    arrow.className = 'picker-range-arrow';
    arrow.textContent = '→';

    const maxOutputInput = document.createElement('input');
    maxOutputInput.type = 'number';
    maxOutputInput.className = 'picker-range-input';
    maxOutputInput.value = this.maxOutput;
    maxOutputInput.step = 'any';
    maxOutputInput.oninput = () => {
      this.maxOutput = parseFloat(maxOutputInput.value) || 100;
    };
    this.dom.maxOutputInput = maxOutputInput;

    outputRow.append(minOutputInput, arrow, maxOutputInput);
    rangeConfig.appendChild(outputRow);
    container.appendChild(rangeConfig);

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

  async pickNumericScale(elementType = 'nodes', propertyName = null) {
    this.elementType = elementType;
    this.propertyName = propertyName;
    this.setDefaultOutputRange();
    return new Promise(resolve => {
      this.resolvePromise = resolve;
      const content = this.buildContent();
      if (this.dom.minOutputInput) {
        this.dom.minOutputInput.value = this.minOutput;
      }
      if (this.dom.maxOutputInput) {
        this.dom.maxOutputInput.value = this.maxOutput;
      }
      this.popup = new Popup(content, {
        title: 'Map Property to Numeric Scale',
        width: '440px',
        showFullscreenButton: false,
        closeOnClickOutside: false,
        onClose: () => {
          if (this.resolvePromise) {
            this.resolvePromise(null);
            this.resolvePromise = null;
          }
          this.popup = null;
        }
      });
      this.initializeFilters();
    });
  }

  setDefaultOutputRange() {
    if (this.elementType === 'nodes') {
      const defaults = this.cache.DEFAULTS.NODE;
      switch (this.propertyName) {
        case 'Node Size':
          this.minOutput = defaults.SIZE;
          this.maxOutput = 50;
          break;
        case 'Node Border Size':
          this.minOutput = defaults.LINE_WIDTH;
          this.maxOutput = 10;
          break;
        case 'Node Label Font Size':
          this.minOutput = defaults.LABEL.FONT_SIZE;
          this.maxOutput = 30;
          break;
        case 'Node Opacity':
          this.minOutput = 0.2;
          this.maxOutput = defaults.OPACITY;
          break;
        default:
          this.minOutput = 0;
          this.maxOutput = 100;
      }
    } else {
      const defaults = this.cache.DEFAULTS.EDGE;
      switch (this.propertyName) {
        case 'Edge Width':
          this.minOutput = defaults.LINE_WIDTH;
          this.maxOutput = 10;
          break;
        case 'Edge Dash':
          this.minOutput = defaults.LINE_DASH;
          this.maxOutput = 40;
          break;
        case 'Edge Label Font Size':
          this.minOutput = defaults.LABEL.FONT_SIZE;
          this.maxOutput = 30;
          break;
        case 'Edge Halo Width':
          this.minOutput = defaults.HALO.WIDTH;
          this.maxOutput = 10;
          break;
        case 'Edge Opacity':
          this.minOutput = 0.2;
          this.maxOutput = defaults.OPACITY;
          break;
        default:
          this.minOutput = 0;
          this.maxOutput = 100;
      }
    }
  }

  initializeFilters() {
    const dropdown = this.dom.dropdown;
    const filters = new Map(this.cache.data.layouts[this.cache.data.selectedLayout].filters);
    const available = new Set();

    const selectedElements = this.elementType === 'nodes' ? this.cache.selectedNodes : this.cache.selectedEdges;

    selectedElements.forEach(elementId => {
      const element = this.elementType === 'nodes'
        ? this.cache.nodeRef.get(elementId)
        : this.cache.edgeRef.get(elementId);

      element?.features.forEach(f => {
        const filterObj = filters.get(f);
        if (filterObj && !filterObj.isCategory && !filterObj.unusable) {
          available.add(f);
        }
      });
    });

    const metricOptions = this.elementType === 'nodes'
      ? this.cache.metrics.getMetricScaleOptions()
      : [];

    dropdown.innerHTML = '<option value="">Select property...</option>';
    const propertyOptions = Array.from(available).sort();
    if (propertyOptions.length > 0) {
      const dataGroup = document.createElement('optgroup');
      dataGroup.label = 'Data Properties';
      propertyOptions.forEach(prop => {
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
      metricOptions.forEach(metric => {
        const opt = document.createElement('option');
        opt.value = `${this.metricValuePrefix}${metric.id}`;
        opt.textContent = `${metric.label} (${metric.valueLabel})${metric.cached ? '' : ' (calculate)'}`;
        metricGroup.appendChild(opt);
      });
      dropdown.appendChild(metricGroup);
    }

    dropdown.onchange = async () => this.selectProperty(dropdown.value);
  }

  async selectProperty(property) {
    if (!property) return;

    const selectedElements = this.elementType === 'nodes' ? this.cache.selectedNodes : this.cache.selectedEdges;
    const elementRef = this.elementType === 'nodes' ? this.cache.nodeRef : this.cache.edgeRef;
    let metricSource = this.getMetricSource(property);
    if (property.startsWith(this.metricValuePrefix) && !metricSource) {
      const metricId = property.slice(this.metricValuePrefix.length);
      metricSource = await this.cache.metrics.ensureMetricValues(metricId);
    }
    if (property.startsWith(this.metricValuePrefix) && !metricSource) {
      this.cache.ui.warning('Metric values not available yet. Calculate the metric first.');
      return;
    }
    this.activeMetricSource = metricSource;

    const values = [];
    let elementsWithProperty = 0;

    if (metricSource) {
      Array.from(selectedElements).forEach(id => {
        const value = metricSource.values.get(id);
        if (value !== undefined && !isNaN(value)) {
          values.push(value);
          elementsWithProperty += 1;
        }
      });
    } else {
      Array.from(selectedElements).forEach(id => {
        const value = elementRef.get(id)?.featureValues.get(property);
        if (value !== undefined && !isNaN(value)) {
          values.push(value);
          elementsWithProperty += 1;
        }
      });
    }

    if (values.length === 0) {
      this.cache.ui.warning('No numeric values found for selected property');
      return;
    }

    this.minValue = Math.min(...values);
    this.maxValue = Math.max(...values);

    const totalElements = selectedElements.length;
    const elementTypeLabel = this.elementType === 'nodes' ? 'nodes' : 'edges';
    const propertyDisplayName = metricSource
      ? `${metricSource.label} (${metricSource.valueLabel})`
      : (property.includes('::') ? property.split('::').pop() : property);

    this.dom.infoSection.innerHTML = `
      <div class="picker-info-summary">
        Scaling <strong>${this.propertyName || 'property'}</strong> for <strong>${elementsWithProperty}</strong> of <strong>${totalElements}</strong> ${elementTypeLabel}
      </div>
      <div class="picker-info-range">
        <strong>${propertyDisplayName}</strong> min: ${this.minValue.toFixed(2)}
        &nbsp;&nbsp;
        <strong>${propertyDisplayName}</strong> max: ${this.maxValue.toFixed(2)}
      </div>
    `;
    this.dom.infoSection.style.display = '';

    if (this.dom.outputLabel) {
      this.dom.outputLabel.innerHTML = `Set <strong>${this.propertyName || 'output'}</strong> range:`;
    }

    this.dom.rangeConfig.style.display = '';
    this.dom.applyButton.classList.remove('disabled');
  }

  apply() {
    const property = this.dom.dropdown.value;

    if (!property) {
      this.cancel();
      return;
    }

    const selectedElements = this.elementType === 'nodes' ? this.cache.selectedNodes : this.cache.selectedEdges;
    const elementRef = this.elementType === 'nodes' ? this.cache.nodeRef : this.cache.edgeRef;
    const metricSource = this.getMetricSource(property);

    const scaleMap = new Map();

    Array.from(selectedElements).forEach(elementId => {
      const element = elementRef.get(elementId);
      const value = metricSource ? metricSource.values.get(elementId) : element?.featureValues.get(property);

      if (value !== undefined && !isNaN(value)) {
        const normalizedValue = (value - this.minValue) / (this.maxValue - this.minValue);
        const scaledValue = this.minOutput + normalizedValue * (this.maxOutput - this.minOutput);
        scaleMap.set(elementId, scaledValue);
      }
    });

    if (this.resolvePromise) {
      this.resolvePromise(scaleMap);
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

function replaceNumericScale(obj, elemID, scaleMap) {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  for (let key in obj) {
    const value = obj[key];

    if (value === "set_numeric_scale") {
      if (scaleMap.has(elemID)) {
        obj[key] = scaleMap.get(elemID);
      } else {
        delete obj[key];
      }
    } else if (typeof value === 'object') {
      replaceNumericScale(value, elemID, scaleMap);
    }
  }

  return obj;
}

export { NumericScalePicker, replaceNumericScale };
