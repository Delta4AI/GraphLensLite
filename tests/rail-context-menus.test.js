// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initRail } from '../src/managers/rail.js';

// ==========================================================================
// The rail's two Concept C phase-4 menus: ◈ Select (host for the re-parented
// "Select Elements" card) and ◐ Overlays (heatmap / minimap / presentation).
// ==========================================================================

function makeCache({ heatmapEnabled = false, withGraph = true } = {}) {
  const minimapCanvas = document.createElement('canvas');
  return {
    initialized: true,
    minimapCanvas,
    graph: withGraph
      ? {
          heatmapLayer: {
            heatmapEnabled,
            setHeatmapEnabled: vi.fn(function (v) {
              this.heatmapEnabled = v;
            }),
          },
          minimap: { canvas: minimapCanvas },
        }
      : null,
    ui: { togglePresentationMode: vi.fn() },
  };
}

function railDom() {
  document.body.className = '';
  document.body.innerHTML = `
    <header id="rail">
      <button id="selectMenuBtn"></button>
      <button id="overlaysMenuBtn"></button>
    </header>
  `;
}

const menuFor = (rail, id) => rail.menus.find((m) => m.anchor.id === id).el;
const itemsOf = (el) => [...el.querySelectorAll('.rail-menu-item')];
const labelled = (el, text) =>
  itemsOf(el).find((i) => i.querySelector('.rail-menu-label')?.textContent.includes(text));

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

describe('rail ◐ Overlays menu', () => {
  beforeEach(railDom);

  it('toggles the density heatmap through the live layer', () => {
    const cache = makeCache({ heatmapEnabled: false });
    const rail = initRail(cache);
    document.getElementById('overlaysMenuBtn').click();
    labelled(menuFor(rail, 'overlaysMenuBtn'), 'Density heatmap').click();
    expect(cache.graph.heatmapLayer.setHeatmapEnabled).toHaveBeenCalledWith(true);
  });

  it('checks the heatmap row when the layer is already on', () => {
    const rail = initRail(makeCache({ heatmapEnabled: true }));
    document.getElementById('overlaysMenuBtn').click();
    const row = labelled(menuFor(rail, 'overlaysMenuBtn'), 'Density heatmap');
    expect(row.classList.contains('checked')).toBe(true);
  });

  it('hides and re-shows the minimap canvas', () => {
    const cache = makeCache();
    const rail = initRail(cache);
    const btn = document.getElementById('overlaysMenuBtn');

    btn.click();
    labelled(menuFor(rail, 'overlaysMenuBtn'), 'Minimap').click();
    expect(cache.minimapCanvas.style.display).toBe('none');

    btn.click();
    labelled(menuFor(rail, 'overlaysMenuBtn'), 'Minimap').click();
    expect(cache.minimapCanvas.style.display).toBe('');
  });

  it('disables the overlay rows before a graph exists', () => {
    const rail = initRail(makeCache({ withGraph: false }));
    document.getElementById('overlaysMenuBtn').click();
    const menu = menuFor(rail, 'overlaysMenuBtn');
    expect(labelled(menu, 'Density heatmap').getAttribute('aria-disabled')).toBe('true');
    expect(labelled(menu, 'Minimap').getAttribute('aria-disabled')).toBe('true');
    // Presentation mode is pure chrome — it works with or without data.
    expect(labelled(menu, 'Presentation mode').getAttribute('aria-disabled')).toBeNull();
  });

  it('routes presentation mode to the UI manager and reflects its state', () => {
    const cache = makeCache();
    const rail = initRail(cache);
    const btn = document.getElementById('overlaysMenuBtn');

    btn.click();
    labelled(menuFor(rail, 'overlaysMenuBtn'), 'Presentation mode').click();
    expect(cache.ui.togglePresentationMode).toHaveBeenCalled();

    document.body.classList.add('presentation');
    btn.click();
    expect(
      labelled(menuFor(rail, 'overlaysMenuBtn'), 'Presentation mode').classList.contains('checked')
    ).toBe(true);
  });
});
