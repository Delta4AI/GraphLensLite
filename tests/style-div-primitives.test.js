// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { propRow, propFold } from '../src/managers/appearance_controls.js';
import {
  createSwitch,
  createButton,
  createInput,
  createColorPicker,
} from '../src/managers/ui_style_div.js';

// ==========================================================================
// The inspector's generic control builders: each takes only its arguments,
// so they are tested here without building a whole card.
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

  it('reports a failed action instead of dropping it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const btn = createButton('Set', 'Set it', async () => {
      throw new Error('nope');
    });
    btn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: 'nope' }));
    consoleError.mockRestore();
  });

  it('seeds the colour input with the given value', () => {
    expect(createColorPicker('#403C53').value).toBe('#403c53');
  });
});

describe('propRow', () => {
  it('appends a label | control row and names controls after it, with its section and sub-group', () => {
    const card = document.createElement('div');
    card.dataset.propSection = 'Edge';
    const plain = propRow(card, 'Color', 'What it does');
    expect(card.firstChild.className).toBe('prop-row');
    expect(card.querySelector('.prop-label').textContent).toBe('Color');
    expect(card.querySelector('.prop-label').title).toBe('What it does');
    expect(plain.dataset.labelText).toBe('Edge color');

    const sub = propRow(propFold(card, 'Start arrow'), 'Color');
    expect(sub.dataset.labelText).toBe('Edge start arrow color');
    expect(sub.parentElement.dataset.name).toBe('Start arrow color');
  });
});
