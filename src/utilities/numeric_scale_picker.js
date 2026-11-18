import {Popup} from './popup.js';
import {StaticUtilities} from './static.js';
import {numericScaleValue, scalePosition} from './scale_values.js';

class NumericScalePicker {
  constructor(cache) {
    this.resolvePromise = null;
    this.minValue = 0;
    this.maxValue = 0;
    this.minOutput = 0;
    this.maxOutput = 100;
    // What elements without a value get. Follows the minimum output until the
    // user sets it, so by default "no value" looks like the lowest value.
    this.missingOutput = 0;
    this.missingOutputEdited = false;
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
    outputLabel.innerHTML = `Set <strong>${StaticUtilities.escapeHtml(this.propertyName || 'output')}</strong> range:`;
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
      if (!this.missingOutputEdited) {
        this.missingOutput = this.minOutput;
        if (this.dom.missingOutputInput) this.dom.missingOutputInput.value = this.missingOutput;
      }
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

    const missingRow = document.createElement('div');
    missingRow.className = 'picker-range-row picker-missing-row';
    missingRow.hidden = true;
    const missingLabel = document.createElement('span');
    missingLabel.textContent = 'Without a value:';
    const missingOutputInput = document.createElement('input');
    missingOutputInput.type = 'number';
    missingOutputInput.className = 'picker-range-input';
    missingOutputInput.step = 'any';
    missingOutputInput.value = this.missingOutput;
    missingOutputInput.title = 'Applied to every selected element that has no value for the property, ' +
      'replacing whatever it had before.';
    missingOutputInput.oninput = () => {
      const parsed = parseFloat(missingOutputInput.value);
      // Not a number: keep the last good value and say so on the field,
      // rather than quietly falling back to something the user did not type.
      const valid = Number.isFinite(parsed);
      missingOutputInput.setCustomValidity(valid ? '' : 'Enter a number');
      if (!valid) {
        missingOutputInput.reportValidity();
        return;
      }
      this.missingOutput = parsed;
      this.missingOutputEdited = true;
    };
    missingRow.append(missingLabel, missingOutputInput);
    this.dom.missingRow = missingRow;
    this.dom.missingOutputInput = missingOutputInput;
    rangeConfig.appendChild(missingRow);
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
    this.missingOutput = this.minOutput;
    this.missingOutputEdited = false;
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
    for (const id of selectedElements) {
      const value = numericScaleValue(metricSource, elementRef, property, id);
      if (value !== undefined) values.push(value);
    }
    const elementsWithProperty = values.length;

    if (values.length === 0) {
      this.cache.ui.warning('No numeric values found for selected property');
      return;
    }

    this.minValue = values.reduce((a, b) => Math.min(a, b));
    this.maxValue = values.reduce((a, b) => Math.max(a, b));

    const totalElements = selectedElements.length;
    const elementTypeLabel = this.elementType === 'nodes' ? 'nodes' : 'edges';
    const propertyDisplayName = StaticUtilities.escapeHtml(
      metricSource
        ? `${metricSource.label} (${metricSource.valueLabel})`
        : (property.includes('::') ? property.split('::').pop() : property)
    );

    const missing = totalElements - elementsWithProperty;
    const missingNote = missing > 0
      ? `<div class="picker-info-missing"><strong>${missing}</strong> of ${totalElements} ${elementTypeLabel} ` +
        `have no value for <strong>${propertyDisplayName}</strong> and get the value set below.</div>`
      : '';
    const flatNote = this.minValue === this.maxValue
      ? `<div class="picker-info-missing">Every value is the same, so all of them get the maximum.</div>`
      : '';
    this.dom.infoSection.innerHTML = `
      <div class="picker-info-summary">
        Scaling <strong>${StaticUtilities.escapeHtml(this.propertyName || 'property')}</strong> for <strong>${elementsWithProperty}</strong> of <strong>${totalElements}</strong> ${elementTypeLabel}
      </div>${missingNote}${flatNote}
      <div class="picker-info-range">
        <strong>${propertyDisplayName}</strong> min: ${this.minValue.toFixed(2)}
        &nbsp;&nbsp;
        <strong>${propertyDisplayName}</strong> max: ${this.maxValue.toFixed(2)}
      </div>
    `;
    this.dom.infoSection.style.display = '';

    if (this.dom.outputLabel) {
      this.dom.outputLabel.innerHTML = `Set <strong>${StaticUtilities.escapeHtml(this.propertyName || 'output')}</strong> range:`;
    }

    this.dom.missingRow.hidden = missing === 0;
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
    // Every selected element gets a value, so nothing keeps an earlier manual
    // setting that would read as data.
    for (const elementId of selectedElements) {
      const value = numericScaleValue(metricSource, elementRef, property, elementId);
      if (value === undefined) {
        scaleMap.set(elementId, this.missingOutput);
      } else {
        const position = scalePosition(value, this.minValue, this.maxValue);
        scaleMap.set(elementId, this.minOutput + position * (this.maxOutput - this.minOutput));
      }
    }

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
