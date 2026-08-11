// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { initRail } from '../src/managers/rail.js';

// ==========================================================================
// The rail's ◈ Select menu: host for the re-parented "Select Elements" card.
// The ◐ Overlays menu it used to sit beside is gone — the overlays are a layer
// stack in the inspector now (see overlay-layers.test.js).
// ==========================================================================

function makeCache() {
  return { initialized: true };
}

function railDom() {
  document.body.className = '';
  document.body.innerHTML = `
    <header id="rail">
      <button id="selectMenuBtn"></button>
    </header>
  `;
}

const menuFor = (rail, id) => rail.menus.find((m) => m.anchor.id === id).el;

describe('rail ◈ Select menu', () => {
  beforeEach(railDom);

  it('provides a persistent mount for the Select Elements card', () => {
    initRail(makeCache());
    // Static build: the mount exists before the menu is ever opened, because
    // buildStylingPanelUI re-parents into it on every graph load.
    const mount = document.getElementById('selectMenuMount');
    expect(mount).not.toBeNull();
    expect(mount.closest('.rail-menu')).not.toBeNull();
  });

  it('keeps the re-parented card across open/close cycles', () => {
    const rail = initRail(makeCache());
    const card = document.createElement('div');
    card.id = 'Select Elements';
    document.getElementById('selectMenuMount').appendChild(card);

    const btn = document.getElementById('selectMenuBtn');
    btn.click();
    btn.click();
    expect(document.getElementById('Select Elements')).not.toBeNull();
    expect(menuFor(rail, 'selectMenuBtn').contains(card)).toBe(true);
  });
});
