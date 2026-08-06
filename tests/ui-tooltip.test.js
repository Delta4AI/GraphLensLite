// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import { initUiTooltips, parseTip } from '../src/utilities/ui_tooltip.js';

// ==========================================================================
// The styled tooltip layer replaces every native title tooltip via event
// delegation. The load-bearing contract: while hovered the title attribute is
// stashed in data-tip (so the browser draws nothing), and it is RESTORED on
// leave — accessibility names and title-reading code (command palette,
// syncOverlays) must keep seeing the attribute.
// ==========================================================================

function hover(el) {
  el.dispatchEvent(new Event('pointerover', { bubbles: true }));
}

describe('parseTip', () => {
  it('splits a trailing shortcut into a kbd part', () => {
    expect(parseTip('Fit graph to screen (F)')).toEqual({
      lead: null, body: 'Fit graph to screen', shortcut: 'F',
    });
    expect(parseTip('Search every control (Ctrl+K)').shortcut).toBe('Ctrl+K');
    expect(parseTip('Keyboard shortcuts (?)').shortcut).toBe('?');
  });

  it('splits "Name — description" into lead and body', () => {
    expect(parseTip('Menu — load data, take the tour')).toEqual({
      lead: 'Menu', body: 'load data, take the tour', shortcut: null,
    });
  });

  it('leaves prose parentheticals alone', () => {
    expect(parseTip('Export (P: PNG, S: JSON)').shortcut).toBe(null);
  });
});

describe('initUiTooltips', () => {
  let btn, other;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <button id="a" title="Fit graph to screen (F)">⛶</button>
      <button id="b" title="Clear selection">×</button>
    `;
    initUiTooltips(document);
    btn = document.getElementById('a');
    other = document.getElementById('b');
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('stashes the title on hover and shows the styled tip after the delay', () => {
    hover(btn);
    expect(btn.hasAttribute('title')).toBe(false);
    expect(btn.dataset.tip).toBe('Fit graph to screen (F)');

    const tip = document.getElementById('uiTip');
    expect(tip.classList.contains('show')).toBe(false);
    vi.advanceTimersByTime(600);
    expect(tip.classList.contains('show')).toBe(true);
    expect(tip.textContent).toBe('Fit graph to screenF'); // kbd gap is CSS margin
    expect(tip.querySelector('kbd').textContent).toBe('F');
  });

  it('restores the title when the pointer moves on', () => {
    hover(btn);
    hover(other);
    expect(btn.getAttribute('title')).toBe('Fit graph to screen (F)');
    expect(btn.dataset.tip).toBeUndefined();
    expect(other.hasAttribute('title')).toBe(false);
  });

  it('never clobbers a title written mid-hover', () => {
    hover(btn);
    btn.title = 'Nothing to undo';
    hover(other);
    expect(btn.getAttribute('title')).toBe('Nothing to undo');
  });

  it('strips titled ancestors too, so native fallback tooltips stay off', () => {
    document.body.innerHTML = `
      <div id="group" title="How multiple active filters combine.">
        <button id="seg" title="Match any active filter">OR</button>
      </div>`;
    const seg = document.getElementById('seg');
    const grp = document.getElementById('group');
    hover(seg);
    expect(seg.hasAttribute('title')).toBe(false);
    expect(grp.hasAttribute('title')).toBe(false);
    hover(document.body);
    expect(seg.getAttribute('title')).toBe('Match any active filter');
    expect(grp.getAttribute('title')).toBe('How multiple active filters combine.');
  });

  it('re-strips when a writer rewrites the hovered title', async () => {
    hover(btn);
    btn.title = 'Fresh text';
    await Promise.resolve(); // MutationObserver delivery
    expect(btn.hasAttribute('title')).toBe(false);
    expect(btn.dataset.tip).toBe('Fresh text');
    hover(document.body);
    expect(btn.getAttribute('title')).toBe('Fresh text');
  });

  it('explains a disabled control on hover but swallows its click', () => {
    // `.disabled` used to be pointer-events: none, so the delegated layer never
    // saw the hover and the one thing worth reading — why the control is dead —
    // was unreachable. Pointer events came back; the clicks must not.
    btn.classList.add('disabled');
    btn.title = 'Nothing to undo';
    const clicked = vi.fn();
    btn.addEventListener('click', clicked);

    hover(btn);
    vi.advanceTimersByTime(600);
    expect(document.getElementById('uiTip').textContent).toContain('Nothing to undo');

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(clicked).not.toHaveBeenCalled();
  });

  it('still lets an enabled control through', () => {
    const clicked = vi.fn();
    btn.addEventListener('click', clicked);
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('hides when the pointer leaves interactive elements entirely', () => {
    hover(btn);
    vi.advanceTimersByTime(600);
    hover(document.body);
    expect(document.getElementById('uiTip').classList.contains('show')).toBe(false);
    expect(btn.getAttribute('title')).toBe('Fit graph to screen (F)');
  });
});

// The guard above is only half the fix: jsdom applies no stylesheet, so the
// rule that gives a titled disabled control its pointer events back has to be
// pinned here or it could be deleted with every test still green.
describe('style.css disabled-tooltip rule', () => {
  it('restores pointer events for titled disabled controls', () => {
    const css = fs.readFileSync('src/style.css', 'utf8'); // vitest runs at the repo root
    const rule = css.match(/\.disabled\[title\],\s*\.disabled\[data-tip\]\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).toContain('pointer-events: auto');
  });
});
