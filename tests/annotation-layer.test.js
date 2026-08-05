// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { AnnotationLayer } from '../src/graph/annotation_layer.js';
import { ANNOTATION_DEFAULTS } from '../src/graph/annotation_geometry.js';

// ==========================================================================
// The DOM note layer: divs reconciled from the selected workspace's
// annotations, anchored via graphToViewport with a 1/ratio zoom scale, plus
// the placement tool, drag/click routing and the PNG-export repaint. Sigma
// is faked with a linear projection; the layer's own math is real.
// ==========================================================================

const K = 100; // viewport px per graph unit at ratio 1
const CX = 400;
const CY = 300;

function makeSigma(ratio = 1) {
  const handlers = {};
  return {
    handlers,
    on: (event, fn) => {
      handlers[event] = fn;
    },
    off: (event) => {
      delete handlers[event];
    },
    // Linear stand-in for sigma's projection: graph y-up → screen y-down.
    graphToViewport: (p) => ({ x: CX + (p.x * K) / ratio, y: CY - (p.y * K) / ratio }),
    viewportToGraph: (p) => ({ x: ((p.x - CX) * ratio) / K, y: ((CY - p.y) * ratio) / K }),
    getCamera: () => ({ getState: () => ({ ratio }) }),
  };
}

function makeCache(annotations = []) {
  return {
    data: { selectedLayout: 'Default', layouts: { Default: { annotations } } },
    ui: { info: () => {}, error: () => {} },
    history: {
      commits: [],
      commit(label) {
        this.commits.push(label);
      },
    },
  };
}

function makeLayer({ annotations = [], ratio = 1 } = {}) {
  const sigma = makeSigma(ratio);
  const cache = makeCache(annotations);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const layer = new AnnotationLayer({ sigma }, cache, container);
  return { layer, sigma, cache, container };
}

function noteEls(container) {
  return [...container.querySelectorAll('.annotation-note')];
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('sync', () => {
  it('creates one styled, positioned div per annotation', () => {
    const ann = {
      id: 'a',
      text: 'hello',
      x: 1,
      y: 2, // app-model y-down → graph y-up is -2
      fontSize: 20,
      fontColor: '#111111',
      borderColor: '#222222',
      borderWidth: 2,
    };
    const { layer, container } = makeLayer({ annotations: [ann] });
    layer.sync();

    const els = noteEls(container);
    expect(els).toHaveLength(1);
    const el = els[0];
    expect(el.textContent).toBe('hello');
    // graphToViewport({1, -2}) at ratio 1 → (500, 500); scale 1/ratio = 1.
    expect(el.style.transform).toBe('translate(500px, 500px) scale(1)');
    expect(el.style.color).toBe('rgb(17, 17, 17)');
    expect(el.style.borderWidth).toBe('2px');
  });

  it('applies card styles: radius, background, and shadow only with a fill', () => {
    const ann = {
      id: 'a', text: 't', x: 0, y: 0, fontSize: 14,
      fontColor: '#000', borderColor: '#000', borderWidth: 1,
      borderRadius: 10, bgColor: '#fffbe6', shadow: true,
    };
    const { layer, container } = makeLayer({ annotations: [ann] });
    layer.sync();
    const el = noteEls(container)[0];
    expect(el.style.borderRadius).toBe('10px');
    expect(el.style.background).toBe('rgb(255, 251, 230)');
    expect(el.style.boxShadow).toContain('8px');

    // Shadow without a background must not render (exports can't mirror it).
    ann.bgColor = null;
    layer.sync();
    expect(el.style.boxShadow).toBe('none');
    expect(el.style.background).toBe('transparent');
  });

  it('scales the note by 1/camera ratio (zoom-in doubles it)', () => {
    const ann = { id: 'a', text: 't', x: 0, y: 0, fontSize: 14, fontColor: '#000', borderColor: '#000', borderWidth: 1 };
    const { layer, container } = makeLayer({ annotations: [ann], ratio: 0.5 });
    layer.sync();
    expect(noteEls(container)[0].style.transform).toBe('translate(400px, 300px) scale(2)');
  });

  it('removes divs for deleted notes and reflects workspace switches', () => {
    const a = { id: 'a', text: 'a', x: 0, y: 0, fontSize: 14, fontColor: '#000', borderColor: '#000', borderWidth: 1 };
    const { layer, cache, container } = makeLayer({ annotations: [a] });
    layer.sync();
    expect(noteEls(container)).toHaveLength(1);

    cache.data.layouts.Other = { annotations: [] };
    cache.data.selectedLayout = 'Other';
    layer.sync();
    expect(noteEls(container)).toHaveLength(0);
  });

  it('renders text via textContent, never as markup', () => {
    const ann = { id: 'a', text: '<img src=x onerror=alert(1)>', x: 0, y: 0, fontSize: 14, fontColor: '#000', borderColor: '#000', borderWidth: 1 };
    const { layer, container } = makeLayer({ annotations: [ann] });
    layer.sync();
    const el = noteEls(container)[0];
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('placement tool', () => {
  it('armPlacement + click creates a note at the clicked graph position and arms editing', () => {
    const { layer, cache, container } = makeLayer();
    layer.armPlacement();
    const overlay = container.querySelector('.annotation-placement-overlay');
    expect(overlay).toBeTruthy();

    overlay.dispatchEvent(
      new MouseEvent('pointerdown', { button: 0, clientX: 500, clientY: 200, bubbles: true })
    );

    const anns = cache.data.layouts.Default.annotations;
    expect(anns).toHaveLength(1);
    // viewportToGraph(500,200) → graph (1, 1) → app-model y flips to -1.
    expect(anns[0].x).toBeCloseTo(1);
    expect(anns[0].y).toBeCloseTo(-1);
    expect(anns[0].text).toBe(ANNOTATION_DEFAULTS.text);
    // Overlay is one-shot.
    expect(container.querySelector('.annotation-placement-overlay')).toBeNull();
    expect(noteEls(container)[0].classList.contains('editing')).toBe(true);
  });

  it('Escape cancels an armed placement without creating anything', () => {
    const { layer, cache, container } = makeLayer();
    layer.armPlacement();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(container.querySelector('.annotation-placement-overlay')).toBeNull();
    expect(cache.data.layouts.Default.annotations).toHaveLength(0);
  });
});

describe('drag and popover', () => {
  const baseAnn = () => ({
    id: 'a',
    text: 'note',
    x: 0,
    y: 0,
    fontSize: 14,
    fontColor: '#000000',
    borderColor: '#000000',
    borderWidth: 1,
  });

  it('dragging past the threshold moves the annotation in app-model coordinates', () => {
    const ann = baseAnn();
    const { layer, container } = makeLayer({ annotations: [ann] });
    layer.sync();
    const el = noteEls(container)[0];

    el.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 400, clientY: 300, bubbles: true }));
    el.dispatchEvent(new MouseEvent('pointermove', { clientX: 500, clientY: 400, bubbles: true }));
    el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));

    // +100px right → +1 graph x; +100px down → graph y -1 → app-model y +1.
    expect(ann.x).toBeCloseTo(1);
    expect(ann.y).toBeCloseTo(1);
    // A real drag must not open the style popover.
    expect(document.querySelector('.annotation-popover')).toBeNull();
  });

  it('a click (no movement) opens the style popover; delete removes the note', () => {
    const ann = baseAnn();
    const { layer, cache, container } = makeLayer({ annotations: [ann] });
    layer.sync();
    const el = noteEls(container)[0];

    el.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 400, clientY: 300, bubbles: true }));
    el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));

    const popover = document.querySelector('.annotation-popover');
    expect(popover).toBeTruthy();

    popover.querySelector('.annotation-popover-delete').click();
    expect(cache.data.layouts.Default.annotations).toHaveLength(0);
    expect(document.querySelector('.annotation-popover')).toBeNull();
    expect(noteEls(container)).toHaveLength(0);
  });

  it('popover inputs write through to the annotation', () => {
    const ann = baseAnn();
    const { layer, container } = makeLayer({ annotations: [ann] });
    layer.sync();
    const el = noteEls(container)[0];
    el.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 400, clientY: 300, bubbles: true }));
    el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));

    const popover = document.querySelector('.annotation-popover');
    const [fontSize, , , borderWidth] = popover.querySelectorAll('input');
    fontSize.value = '30';
    fontSize.dispatchEvent(new Event('input'));
    borderWidth.value = '999';
    borderWidth.dispatchEvent(new Event('input'));

    expect(ann.fontSize).toBe(30);
    expect(ann.borderWidth).toBe(20); // clamped to the input's max
  });
});

describe('editing', () => {
  it('committing empty text deletes the note', () => {
    const ann = { id: 'a', text: 'x', x: 0, y: 0, fontSize: 14, fontColor: '#000', borderColor: '#000', borderWidth: 1 };
    const { layer, cache, container } = makeLayer({ annotations: [ann] });
    layer.sync();
    const el = noteEls(container)[0];

    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(el.classList.contains('editing')).toBe(true);
    el.textContent = '   ';
    el.dispatchEvent(new Event('blur'));

    expect(cache.data.layouts.Default.annotations).toHaveLength(0);
    expect(noteEls(container)).toHaveLength(0);
  });

  it('blocks rich paste while editing (default prevented, plain text requested)', () => {
    const ann = { id: 'a', text: 'x', x: 0, y: 0, fontSize: 14, fontColor: '#000', borderColor: '#000', borderWidth: 1 };
    const { layer, container } = makeLayer({ annotations: [ann] });
    layer.sync();
    const el = noteEls(container)[0];
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    const requested = [];
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    paste.clipboardData = {
      getData: (type) => {
        requested.push(type);
        return 'plain';
      },
    };
    el.dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    expect(requested).toEqual(['text/plain']);
  });

  it('caps committed text at the same limit the load boundary enforces', () => {
    const ann = { id: 'a', text: 'x', x: 0, y: 0, fontSize: 14, fontColor: '#000', borderColor: '#000', borderWidth: 1 };
    const { layer, container } = makeLayer({ annotations: [ann] });
    layer.sync();
    const el = noteEls(container)[0];
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    el.textContent = 'a'.repeat(5000);
    el.dispatchEvent(new Event('blur'));
    expect(ann.text).toHaveLength(2000);
  });

  it('committing new text updates the note', () => {
    const ann = { id: 'a', text: 'old', x: 0, y: 0, fontSize: 14, fontColor: '#000', borderColor: '#000', borderWidth: 1 };
    const { layer, container } = makeLayer({ annotations: [ann] });
    layer.sync();
    const el = noteEls(container)[0];

    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    el.textContent = 'new text';
    el.dispatchEvent(new Event('blur'));

    expect(ann.text).toBe('new text');
    expect(el.classList.contains('editing')).toBe(false);
  });
});

// Notes persist by mutating the layout, so an uncommitted note change is one
// the next unrelated undo silently reverts. One entry per user gesture — not
// per mutation, or a colour drag would bury the history.
describe('undo entries', () => {
  const baseAnn = () => ({
    id: 'a',
    text: 'note',
    x: 0,
    y: 0,
    fontSize: 14,
    fontColor: '#000000',
    borderColor: '#000000',
    borderWidth: 1,
  });

  const openPopover = (container) => {
    const el = noteEls(container)[0];
    el.dispatchEvent(
      new MouseEvent('pointerdown', { button: 0, clientX: 400, clientY: 300, bubbles: true })
    );
    el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    return document.querySelector('.annotation-popover');
  };

  it('records a placed note even when its default text is left untouched', () => {
    const { layer, cache, container } = makeLayer();
    layer.armPlacement();
    layer.placementOverlay.dispatchEvent(
      new MouseEvent('pointerdown', { button: 0, clientX: 500, clientY: 200, bubbles: true })
    );
    const el = noteEls(container)[0];
    el.dispatchEvent(new Event('blur'));

    expect(cache.data.layouts.Default.annotations).toHaveLength(1);
    expect(cache.history.commits).toEqual(['Add note']);
  });

  it('records nothing when a fresh note is abandoned without typing', () => {
    const { layer, cache, container } = makeLayer();
    layer.armPlacement();
    layer.placementOverlay.dispatchEvent(
      new MouseEvent('pointerdown', { button: 0, clientX: 500, clientY: 200, bubbles: true })
    );
    const el = noteEls(container)[0];
    el.textContent = '';
    el.dispatchEvent(new Event('blur'));

    // Nothing was added and nothing was lost, so an undo slot here would be a
    // step that changes nothing.
    expect(cache.data.layouts.Default.annotations).toHaveLength(0);
    expect(cache.history.commits).toEqual([]);
  });

  it('records an edit only when the text actually changed', () => {
    const { layer, cache, container } = makeLayer({ annotations: [baseAnn()] });
    layer.sync();
    const el = noteEls(container)[0];

    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    el.dispatchEvent(new Event('blur'));
    expect(cache.history.commits).toEqual([]);

    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    el.textContent = 'changed';
    el.dispatchEvent(new Event('blur'));
    expect(cache.history.commits).toEqual(['Edit note']);
  });

  it('records a move on drag, but not a click that only opens the popover', () => {
    const { layer, cache, container } = makeLayer({ annotations: [baseAnn()] });
    layer.sync();
    const el = noteEls(container)[0];

    el.dispatchEvent(
      new MouseEvent('pointerdown', { button: 0, clientX: 400, clientY: 300, bubbles: true })
    );
    el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(cache.history.commits).toEqual([]);

    el.dispatchEvent(
      new MouseEvent('pointerdown', { button: 0, clientX: 400, clientY: 300, bubbles: true })
    );
    el.dispatchEvent(new MouseEvent('pointermove', { clientX: 500, clientY: 400, bubbles: true }));
    el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(cache.history.commits).toEqual(['Move note']);
  });

  it('collapses a whole popover styling session into one entry, on close', () => {
    const { layer, cache, container } = makeLayer({ annotations: [baseAnn()] });
    layer.sync();
    const popover = openPopover(container);
    const [fontSize] = popover.querySelectorAll('input');

    for (const value of ['20', '30', '40']) {
      fontSize.value = value;
      fontSize.dispatchEvent(new Event('input'));
    }
    expect(cache.history.commits).toEqual([]); // still open — nothing recorded yet

    document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(cache.history.commits).toEqual(['Style note']);
  });

  it('records nothing when a popover is opened and closed untouched', () => {
    const { layer, cache, container } = makeLayer({ annotations: [baseAnn()] });
    layer.sync();
    openPopover(container);

    document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(cache.history.commits).toEqual([]);
  });

  it('records a delete from the popover', () => {
    const { layer, cache, container } = makeLayer({ annotations: [baseAnn()] });
    layer.sync();
    const popover = openPopover(container);

    popover.querySelector('.annotation-popover-delete').click();
    expect(cache.history.commits).toEqual(['Delete note']);
  });
});

describe('keyboard access', () => {
  const baseAnn = () => ({
    id: 'a',
    text: 'note',
    x: 0,
    y: 0,
    fontSize: 14,
    fontColor: '#000000',
    borderColor: '#000000',
    borderWidth: 1,
  });

  it('notes are focusable and Enter starts editing', () => {
    const { layer, container } = makeLayer({ annotations: [baseAnn()] });
    layer.sync();
    const el = noteEls(container)[0];
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('role')).toBe('note');

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(el.classList.contains('editing')).toBe(true);
    // While editing, Enter/Delete must type, not command.
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(noteEls(container)).toHaveLength(1);
  });

  it('Delete on a focused note removes it', () => {
    const { layer, cache, container } = makeLayer({ annotations: [baseAnn()] });
    layer.sync();
    noteEls(container)[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(cache.data.layouts.Default.annotations).toHaveLength(0);
    expect(noteEls(container)).toHaveLength(0);
  });

  it('Escape closes the style popover', () => {
    const { layer, container } = makeLayer({ annotations: [baseAnn()] });
    layer.sync();
    const el = noteEls(container)[0];
    el.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 400, clientY: 300, bubbles: true }));
    el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(document.querySelector('.annotation-popover')).toBeTruthy();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.annotation-popover')).toBeNull();
  });
});

describe('export', () => {
  it('exportPlacements projects each note to viewport px with the zoom factor', () => {
    const ann = { id: 'a', text: 't', x: 1, y: 2, fontSize: 14, fontColor: '#000', borderColor: '#000', borderWidth: 1 };
    const { layer } = makeLayer({ annotations: [ann], ratio: 0.5 });
    const [p] = layer.exportPlacements();
    expect(p.ann).toBe(ann);
    expect(p.x).toBeCloseTo(400 + (1 * K) / 0.5);
    expect(p.y).toBeCloseTo(300 + (2 * K) / 0.5); // app y 2 → graph -2 → below center
    expect(p.k).toBe(2);
  });

  function makeExportCtx(ops) {
    return {
      save: () => ops.push(['save']),
      restore: () => ops.push(['restore']),
      setTransform: (...a) => ops.push(['setTransform', ...a]),
      translate: (...a) => ops.push(['translate', ...a]),
      scale: (...a) => ops.push(['scale', ...a]),
      beginPath: () => ops.push(['beginPath']),
      roundRect: (...a) => ops.push(['roundRect', ...a]),
      fill: () => ops.push(['fill']),
      stroke: () => ops.push(['stroke']),
      fillText: (...a) => ops.push(['fillText', ...a]),
      measureText: (text) => ({ width: text.length * 7 }),
      set font(_v) {},
      set fillStyle(v) { ops.push(['fillStyle', v]); },
      set strokeStyle(v) { ops.push(['strokeStyle', v]); },
      set lineWidth(v) { ops.push(['lineWidth', v]); },
      set textAlign(_v) {},
      set textBaseline(_v) {},
      set shadowColor(v) { ops.push(['shadowColor', v]); },
      set shadowOffsetY(v) { ops.push(['shadowOffsetY', v]); },
      set shadowBlur(v) { ops.push(['shadowBlur', v]); },
    };
  }

  it('drawExport strokes the border box and fills each line at shared metrics', () => {
    const ann = {
      id: 'a',
      text: 'ab\ncd',
      x: 0,
      y: 0,
      fontSize: 10,
      fontColor: '#123456',
      borderColor: '#654321',
      borderWidth: 2,
    };
    const { layer } = makeLayer({ annotations: [ann] });
    const ops = [];
    layer.drawExport(makeExportCtx(ops), 2);

    expect(ops).toContainEqual(['setTransform', 2, 0, 0, 2, 0, 0]);
    expect(ops).toContainEqual(['translate', 400, 300]);
    // boxW = 14 + 12 + 4 = 30, boxH = 25 + 12 + 4 = 41; stroke inset bw/2;
    // no borderRadius field → square corners.
    expect(ops).toContainEqual(['roundRect', 1, 1, 28, 39, 0]);
    // Text origin (pad + bw = 8); line centers at 8 + (i + 0.5) × 12.5.
    expect(ops).toContainEqual(['fillText', 'ab', 8, 8 + 0.5 * 12.5]);
    expect(ops).toContainEqual(['fillText', 'cd', 8, 8 + 1.5 * 12.5]);
  });

  it('drawExport paints the card: shadowed background fill, then rounded border', () => {
    const ann = {
      id: 'a',
      text: 'ab',
      x: 0,
      y: 0,
      fontSize: 10,
      fontColor: '#123456',
      borderColor: '#654321',
      borderWidth: 2,
      borderRadius: 8,
      bgColor: '#fffbe6',
      shadow: true,
    };
    const { layer } = makeLayer({ annotations: [ann], ratio: 0.5 }); // k = 2
    const ops = [];
    layer.drawExport(makeExportCtx(ops), 3);

    // boxW = 14 + 12 + 4 = 30, boxH = 12.5 + 12 + 4 = 28.5.
    expect(ops).toContainEqual(['fillStyle', '#fffbe6']);
    expect(ops).toContainEqual(['roundRect', 0, 0, 30, 28.5, 8]);
    // Canvas shadows are device-space: CSS px × scale(3) × k(2).
    expect(ops).toContainEqual(['shadowOffsetY', 2 * 3 * 2]);
    expect(ops).toContainEqual(['shadowBlur', 8 * 3 * 2]);
    // Shadow reset before the border stroke, radius shrunk by bw/2.
    expect(ops).toContainEqual(['shadowColor', 'transparent']);
    expect(ops).toContainEqual(['roundRect', 1, 1, 28, 26.5, 7]);
  });

  it('drawExport is a no-op without annotations', () => {
    const { layer } = makeLayer();
    layer.drawExport(null, 2); // would throw on any ctx use
  });
});

describe('destroy', () => {
  it('removes the layer root and unhooks afterRender', () => {
    const { layer, sigma, container } = makeLayer({ annotations: [] });
    expect(container.querySelector('.annotation-layer')).toBeTruthy();
    expect(sigma.handlers.afterRender).toBeTruthy();
    layer.destroy();
    expect(container.querySelector('.annotation-layer')).toBeNull();
    expect(sigma.handlers.afterRender).toBeUndefined();
  });
});
