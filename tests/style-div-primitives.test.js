// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  createNewRow,
  createLabel,
  appendLabel,
  createSwitch,
  createButton,
  createInput,
  createColorPicker,
} from '../src/managers/ui_style_div.js';

// ==========================================================================
// The style div's generic control builders. Until they were lifted to module
// scope they were closures inside a 1556-line function with a single export,
// so none of this was reachable from a test.
// ==========================================================================

describe('createSwitch', () => {
  it('exposes the checkbox through setChecked/toggle/isChecked', () => {
    const sw = createSwitch(undefined, 'myToggle', true);

    expect(sw.isChecked()).toBe(true);
    expect(sw.querySelector('input').id).toBe('myToggle');
    expect(sw.id).toBe('myToggleLabel');

    sw.toggle();
    expect(sw.isChecked()).toBe(false);
    sw.setChecked(true);
    expect(sw.isChecked()).toBe(true);
  });

  it('fires its callback on change, and survives having none', () => {
    const onChange = vi.fn();
    const sw = createSwitch(onChange);
    sw.querySelector('input').dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledOnce();

    expect(() => createSwitch().querySelector('input').dispatchEvent(new Event('change'))).not.toThrow();
  });
});

describe('createInput', () => {
  it('commits its trimmed value on Enter only', () => {
    const onCommit = vi.fn();
    const input = createInput(120, 'label text', 'a title', '  seed  ', onCommit);

    expect(input.value).toBe('  seed  ');
    input.dispatchEvent(new KeyboardEvent('keypress', { key: 'a' }));
    expect(onCommit).not.toHaveBeenCalled();

    input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter' }));
    expect(onCommit).toHaveBeenCalledWith('seed');
  });
});

describe('createButton and createColorPicker', () => {
  it('build a labelled button that calls back', () => {
    const onClick = vi.fn();
    const btn = createButton('Apply', 'Push the changes', onClick);
    btn.click();
    expect(btn.textContent).toContain('Apply');
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('seeds the colour input with the given value', () => {
    expect(createColorPicker('#403C53').value).toBe('#403c53');
  });
});

describe('rows and labels', () => {
  it('appends a row to its parent and a titled label to a row', () => {
    const parent = document.createElement('div');
    const row = createNewRow(parent);
    expect(parent.firstChild).toBe(row);
    expect(row.className).toContain('card-row');

    appendLabel(row, 'Fill Color', 'What it does');
    expect(row.querySelector('label').textContent).toBe('Fill Color');
    expect(row.querySelector('label').title).toBe('What it does');
  });

  it('returns nothing for an empty label', () => {
    expect(createLabel('')).toBeNull();
  });
});
