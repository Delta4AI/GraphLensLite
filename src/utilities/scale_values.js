/**
 * What the "Map by data" pickers (numeric_scale_picker, color_scale_picker)
 * read off an element, and where a value falls on the scale — one rule for
 * both, so a size and a colour mapped from the same column never disagree on
 * which elements have a value.
 */
import { StaticUtilities } from './static.js';

/** An element's raw value: from the picked network metric if any, else its data. */
function rawScaleValue(metricSource, elementRef, property, id) {
  return metricSource ? metricSource.values.get(id) : elementRef.get(id)?.featureValues.get(property);
}

/** The same value as a finite number, or undefined (blank, null, text). */
function numericScaleValue(metricSource, elementRef, property, id) {
  return StaticUtilities.numericValue(rawScaleValue(metricSource, elementRef, property, id));
}

/**
 * Where `value` sits between `min` and `max`, from 0 to 1. When every value is
 * the same there is no range to place it in; it goes to the top, so it stays
 * apart from the missing-value output, which defaults to the bottom.
 */
function scalePosition(value, min, max) {
  const span = max - min;
  return span === 0 ? 1 : (value - min) / span;
}

export { rawScaleValue, numericScaleValue, scalePosition };
