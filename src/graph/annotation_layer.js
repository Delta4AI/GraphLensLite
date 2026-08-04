/**
 * Browser-only text-annotation ("note") layer.
 *
 * Unlike the bubble/heatmap layers this one is DOM, not canvas: each note is
 * an absolutely-positioned div over the sigma canvases, which buys native
 * text rendering, contenteditable editing, CSS borders and per-note pointer
 * events for free — a canvas layer would need hand-rolled hit-testing and a
 * text-input overlay anyway. The divs are re-anchored on every afterRender
 * via graphToViewport and scaled by 1/camera.ratio (transform-origin 0 0),
 * so a note pans and zooms with the drawing it annotates.
 *
 * State lives in the CURRENT workspace's layout object
 * (cache.data.layouts[selected].annotations, app-model y-down coordinates,
 * flipY at this boundary like layout.positions) — mutating it IS persistence:
 * buildExportPayload serializes cache.data wholesale, parseLayouts sanitizes
 * on the way back in (annotation_geometry.js). Workspace switches need no
 * events: every sync re-reads the selected layout.
 *
 * Exports: the flattened sigma PNG and the SVG document carry no DOM, so
 * drawExport (canvas) and exportPlacements (SVG primitive input) repaint the
 * notes from the same annotationLayout metrics the DOM element uses.
 */
import { flipY } from './graph_model.js';
import {
  ANNOTATION_DEFAULTS,
  ANNOTATION_SHADOW,
  ANNOTATION_FONT_FAMILY,
  ANNOTATION_LINE_HEIGHT,
  ANNOTATION_PADDING_PX,
  MAX_TEXT_LENGTH,
  annotationLayout,
} from './annotation_geometry.js';
import { clampPopoverLeft } from '../utilities/popover_position.js';

// A press that travels less than this many screen px is a click (open the
// style popover), not a drag.
const DRAG_THRESHOLD_PX = 3;
const POPOVER_OFFSET_PX = 8;

class AnnotationLayer {
  /**
   * @param {object} adapter  SigmaAdapter (owns sigma + graphology)
   * @param {object} cache    app cache (layout state, ui toasts)
   * @param {HTMLElement} container  the sigma container (#innerGraphContainer)
   */
  constructor(adapter, cache, container) {
    this.adapter = adapter;
    this.cache = cache;
    this.container = container;
    this.killed = false;
    // Layer visibility, driven by the inspector's Overlays stack. Runtime
    // state like heatmapEnabled — never persisted, resets with the adapter.
    this.visible = true;

    /** @type {Map<string, HTMLElement>} note id → element */
    this.els = new Map();
    this.editingId = null;
    this.popover = null;
    this.popoverId = null;
    this.placementOverlay = null;
    this.rafHandle = null;

    this.root = document.createElement('div');
    this.root.className = 'annotation-layer';
    container.appendChild(this.root);

    this.renderHandler = () => this.scheduleSync();
    adapter.sigma.on('afterRender', this.renderHandler);
  }

  /**
   * Show or hide every note, on screen and in both export paths. Hiding also
   * closes the styling popover — it would otherwise float over a note that is
   * no longer on screen.
   */
  setVisible(visible) {
    if (this.visible === visible) return;
    this.visible = visible;
    this.root.hidden = !visible;
    if (!visible) {
      this.cancelPlacement();
      this.#closePopover();
    }
  }

  destroy() {
    if (this.killed) return;
    this.killed = true;
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.adapter.sigma.off('afterRender', this.renderHandler);
    this.cancelPlacement();
    this.#closePopover();
    this.root.remove();
    this.els.clear();
  }

  // ------------------------------------------------------------------- state

  /** The selected workspace's annotations (read-only view; [] when absent). */
  annotations() {
    return this.cache.data?.layouts?.[this.cache.data.selectedLayout]?.annotations ?? [];
  }

  #annotationById(id) {
    return this.annotations().find((a) => a.id === id) ?? null;
  }

  // ----------------------------------------------------------------- placing

  /**
   * One-shot placement: a crosshair overlay captures the next click, creates
   * a note there and opens it for editing. Escape cancels.
   */
  armPlacement() {
    if (this.placementOverlay) return;
    const overlay = document.createElement('div');
    overlay.className = 'annotation-placement-overlay';
    overlay.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const { x, y } = this.#relativePoint(event);
      this.cancelPlacement();
      this.#createAt(x, y);
    });
    this.placementEscape = (event) => {
      if (event.key === 'Escape') {
        this.cancelPlacement();
        this.cache.ui?.info?.('Note placement canceled');
      }
    };
    document.addEventListener('keydown', this.placementEscape, true);
    this.container.appendChild(overlay);
    this.placementOverlay = overlay;
  }

  cancelPlacement() {
    if (!this.placementOverlay) return;
    this.placementOverlay.remove();
    this.placementOverlay = null;
    document.removeEventListener('keydown', this.placementEscape, true);
    this.placementEscape = null;
  }

  #createAt(viewportX, viewportY) {
    const layout = this.cache.data?.layouts?.[this.cache.data.selectedLayout];
    if (!layout) return;
    const g = this.adapter.sigma.viewportToGraph({ x: viewportX, y: viewportY });
    const ann = {
      id: typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `ann-${Date.now()}`,
      ...ANNOTATION_DEFAULTS,
      x: g.x,
      y: flipY(g.y),
    };
    (layout.annotations ??= []).push(ann);
    this.sync();
    // First note: the Notes row's switch is disabled while there is nothing to
    // show, so it has to be re-read here. Not in sync() — that runs per render.
    this.cache.ui?.syncOverlays?.();
    const el = this.els.get(ann.id);
    if (el) this.#startEditing(ann, el, { selectAll: true });
  }

  /** Remove a note by id (popover delete). */
  removeAnnotation(id) {
    const layout = this.cache.data?.layouts?.[this.cache.data.selectedLayout];
    if (!layout?.annotations) return;
    layout.annotations = layout.annotations.filter((a) => a.id !== id);
    this.#closePopover();
    this.sync();
    this.cache.ui?.syncOverlays?.();
  }

  // ------------------------------------------------------------------- sync

  scheduleSync() {
    if (this.killed || this.rafHandle !== null) return;
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      this.sync();
    });
  }

  /** Reconcile the DOM notes with the selected workspace, immediately. */
  sync() {
    if (this.killed) return;
    const anns = this.annotations();
    const seen = new Set();
    for (const ann of anns) {
      seen.add(ann.id);
      let el = this.els.get(ann.id);
      if (!el) {
        el = this.#createElement(ann.id);
        this.els.set(ann.id, el);
      }
      this.#applyStyle(ann, el);
      this.#place(ann, el);
    }
    for (const [id, el] of this.els) {
      if (seen.has(id)) continue;
      el.remove();
      this.els.delete(id);
      if (this.editingId === id) this.editingId = null;
    }
    // A deleted note or a workspace switch must not leave a popover editing
    // a note that is no longer on screen.
    if (this.popoverId && !seen.has(this.popoverId)) this.#closePopover();
    else if (this.popoverId) this.#positionPopover();
  }

  #createElement(id) {
    const el = document.createElement('div');
    el.className = 'annotation-note';
    el.dataset.annotationId = id;
    // Keyboard operability for existing notes: focus with Tab, Enter to
    // edit, Delete to remove (pointer users dblclick / use the popover).
    el.setAttribute('role', 'note');
    el.setAttribute('tabindex', '0');
    el.addEventListener('pointerdown', (event) => this.#onNotePointerDown(id, el, event));
    el.addEventListener('dblclick', (event) => {
      event.preventDefault();
      const ann = this.#annotationById(id);
      if (ann) this.#startEditing(ann, el, { selectAll: false });
    });
    el.addEventListener('keydown', (event) => {
      if (this.editingId === id) return; // typing, not commanding
      if (event.key === 'Enter') {
        event.preventDefault();
        const ann = this.#annotationById(id);
        if (ann) this.#startEditing(ann, el, { selectAll: false });
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        this.removeAnnotation(id);
      }
    });
    this.root.appendChild(el);
    return el;
  }

  /** Restyle only when the note's content/style signature changed. */
  #applyStyle(ann, el) {
    const signature =
      `${ann.text}|${ann.fontSize}|${ann.fontColor}|${ann.borderColor}|${ann.borderWidth}` +
      `|${ann.borderRadius ?? 0}|${ann.bgColor ?? ''}|${ann.shadow ? 1 : 0}`;
    if (el.dataset.signature === signature) return;
    el.dataset.signature = signature;
    // Text as textContent, never innerHTML — note text is user data.
    if (this.editingId !== ann.id) el.textContent = ann.text;
    const shadow = ann.shadow && ann.bgColor; // ring shadows are unreproducible in exports
    Object.assign(el.style, {
      font: `${ann.fontSize}px ${ANNOTATION_FONT_FAMILY}`,
      lineHeight: String(ANNOTATION_LINE_HEIGHT),
      color: ann.fontColor,
      padding: `${ANNOTATION_PADDING_PX}px`,
      border: ann.borderWidth > 0 ? `${ann.borderWidth}px solid ${ann.borderColor}` : 'none',
      borderRadius: `${ann.borderRadius ?? 0}px`,
      background: ann.bgColor ?? 'transparent',
      boxShadow: shadow
        ? `0 ${ANNOTATION_SHADOW.offsetY}px ${ANNOTATION_SHADOW.blur}px ${ANNOTATION_SHADOW.color}`
        : 'none',
    });
  }

  #place(ann, el) {
    const sigma = this.adapter.sigma;
    const v = sigma.graphToViewport({ x: ann.x, y: flipY(ann.y) });
    const k = 1 / sigma.getCamera().getState().ratio;
    el.style.transform = `translate(${v.x}px, ${v.y}px) scale(${k})`;
  }

  // ---------------------------------------------------------- drag / select

  #relativePoint(event) {
    const rect = this.container.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  #onNotePointerDown(id, el, event) {
    if (event.button !== 0 || this.editingId === id) return;
    event.preventDefault();
    event.stopPropagation();
    const ann = this.#annotationById(id);
    if (!ann) return;

    const sigma = this.adapter.sigma;
    const start = this.#relativePoint(event);
    const g0 = sigma.viewportToGraph(start);
    // Grab offset in app-model coordinates: the note keeps its position
    // under the cursor for the whole drag.
    const dx = ann.x - g0.x;
    const dy = ann.y - flipY(g0.y);
    let moved = false;

    const onMove = (moveEvent) => {
      const p = this.#relativePoint(moveEvent);
      if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < DRAG_THRESHOLD_PX) return;
      moved = true;
      const g = sigma.viewportToGraph(p);
      ann.x = g.x + dx;
      ann.y = flipY(g.y) + dy;
      this.#place(ann, el);
      if (this.popoverId === id) this.#positionPopover();
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      if (!moved) this.#openPopover(ann.id);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    // jsdom (tests) lacks pointer capture; without it a fast drag can slip
    // off the note mid-move, which is tolerable there.
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      /* no pointer capture available */
    }
  }

  // ----------------------------------------------------------------- editing

  #startEditing(ann, el, { selectAll }) {
    this.#closePopover();
    this.editingId = ann.id;
    el.classList.add('editing');
    // plaintext-only strips markup from paste natively; engines that reject
    // the keyword fall back to "true", where the explicit paste handler below
    // provides the same guarantee.
    try {
      el.contentEditable = 'plaintext-only';
    } catch {
      el.contentEditable = 'true';
    }
    el.focus();
    if (selectAll && typeof window.getSelection === 'function') {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        el.blur();
      }
    };
    // Pasted markup must never render live in the note, regardless of
    // whether the engine honored plaintext-only above: always insert the
    // clipboard's plain text instead of the default rich paste.
    const onPaste = (event) => {
      event.preventDefault();
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (text) document.execCommand?.('insertText', false, text);
    };
    const onBlur = () => {
      el.removeEventListener('blur', onBlur);
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('paste', onPaste);
      this.#commitEditing(ann.id, el);
    };
    el.addEventListener('blur', onBlur);
    el.addEventListener('keydown', onKey);
    el.addEventListener('paste', onPaste);
  }

  #commitEditing(id, el) {
    this.editingId = null;
    el.contentEditable = 'false';
    el.classList.remove('editing');
    const ann = this.#annotationById(id);
    if (!ann) return;
    // innerText preserves the visual line breaks contenteditable produced.
    // Same length cap as the JSON-load boundary, so a save/load round-trip
    // never silently truncates what the user just typed.
    const text = (el.innerText ?? el.textContent ?? '')
      .replace(/\n+$/, '')
      .slice(0, MAX_TEXT_LENGTH);
    if (text.trim() === '') {
      this.removeAnnotation(id);
      return;
    }
    ann.text = text;
    delete el.dataset.signature; // force a restyle with the committed text
    this.sync();
  }

  // ----------------------------------------------------------------- popover

  #openPopover(id) {
    this.#closePopover();
    const ann = this.#annotationById(id);
    if (!ann) return;
    this.popoverId = id;

    const pop = document.createElement('div');
    pop.className = 'annotation-popover';
    pop.setAttribute('role', 'group');
    pop.setAttribute('aria-label', 'Note style');
    const row = (labelText, input) => {
      const label = document.createElement('label');
      label.className = 'annotation-popover-row';
      const span = document.createElement('span');
      span.textContent = labelText;
      label.append(span, input);
      return label;
    };
    const numberInput = (value, min, max, step, onChange) => {
      const input = document.createElement('input');
      input.type = 'number';
      Object.assign(input, { min, max, step, value });
      input.addEventListener('input', () => {
        const n = Number(input.value);
        if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        this.sync();
      });
      return input;
    };
    const colorInput = (value, onChange) => {
      const input = document.createElement('input');
      input.type = 'color';
      input.value = value;
      input.addEventListener('input', () => {
        onChange(input.value);
        this.sync();
      });
      return input;
    };

    const checkboxInput = (checked, onChange) => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = checked;
      input.addEventListener('input', () => {
        onChange(input.checked);
        this.sync();
      });
      return input;
    };

    // Background = toggle + color in one row; the toggle maps to bgColor
    // null/value (there is no "none" in <input type=color>).
    const bgColorInput = colorInput(ann.bgColor ?? '#ffffff', (v) => {
      if (ann.bgColor != null) ann.bgColor = v;
    });
    const bgToggle = checkboxInput(ann.bgColor != null, (on) => {
      ann.bgColor = on ? bgColorInput.value : null;
    });
    const bgControls = document.createElement('span');
    bgControls.className = 'annotation-popover-pair';
    bgControls.append(bgToggle, bgColorInput);
    const bgRow = document.createElement('label');
    bgRow.className = 'annotation-popover-row';
    const bgLabel = document.createElement('span');
    bgLabel.textContent = 'Background';
    bgRow.append(bgLabel, bgControls);

    // A shadow needs the fill (see ANNOTATION_SHADOW), so checking it
    // switches the background on rather than silently doing nothing.
    const shadowToggle = checkboxInput(ann.shadow === true, (on) => {
      ann.shadow = on;
      if (on && ann.bgColor == null) {
        ann.bgColor = bgColorInput.value;
        bgToggle.checked = true;
      }
    });

    pop.append(
      row('Font size', numberInput(ann.fontSize, 6, 200, 1, (v) => (ann.fontSize = v))),
      row('Font color', colorInput(ann.fontColor, (v) => (ann.fontColor = v))),
      row('Border color', colorInput(ann.borderColor, (v) => (ann.borderColor = v))),
      row('Border width', numberInput(ann.borderWidth, 0, 20, 0.5, (v) => (ann.borderWidth = v))),
      row('Corner radius', numberInput(ann.borderRadius ?? 0, 0, 40, 1, (v) => (ann.borderRadius = v))),
      bgRow,
      row('Shadow', shadowToggle)
    );
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'annotation-popover-delete';
    del.textContent = '✗ Delete note';
    del.addEventListener('click', () => this.removeAnnotation(id));
    pop.appendChild(del);

    document.body.appendChild(pop);
    this.popover = pop;
    this.#positionPopover();
    pop.querySelector('input')?.focus();

    this.popoverOutside = (event) => {
      const noteEl = this.els.get(id);
      if (pop.contains(event.target) || noteEl?.contains(event.target)) return;
      this.#closePopover();
    };
    document.addEventListener('pointerdown', this.popoverOutside, true);
    this.popoverEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      const noteEl = this.els.get(id);
      this.#closePopover();
      noteEl?.focus();
    };
    document.addEventListener('keydown', this.popoverEscape, true);
  }

  #positionPopover() {
    const el = this.els.get(this.popoverId);
    if (!el || !this.popover) return;
    const rect = el.getBoundingClientRect();
    this.popover.style.top = `${rect.bottom + POPOVER_OFFSET_PX}px`;
    this.popover.style.left = `${clampPopoverLeft(
      rect.left,
      this.popover.offsetWidth,
      window.innerWidth
    )}px`;
  }

  #closePopover() {
    if (!this.popover) return;
    this.popover.remove();
    this.popover = null;
    this.popoverId = null;
    document.removeEventListener('pointerdown', this.popoverOutside, true);
    this.popoverOutside = null;
    document.removeEventListener('keydown', this.popoverEscape, true);
    this.popoverEscape = null;
  }

  // ------------------------------------------------------------------ export

  /**
   * Notes with their current viewport anchor (CSS px, top-left) and zoom
   * factor — the SVG export's input, mirroring the live transform exactly.
   *
   * @returns {Array<{ann: object, x: number, y: number, k: number}>}
   */
  exportPlacements() {
    if (!this.visible) return [];
    const sigma = this.adapter.sigma;
    const k = 1 / sigma.getCamera().getState().ratio;
    return this.annotations().map((ann) => {
      const v = sigma.graphToViewport({ x: ann.x, y: flipY(ann.y) });
      return { ann, x: v.x, y: v.y, k };
    });
  }

  /**
   * Repaint the notes onto a PNG-export context at `scale` device px per CSS
   * px, ABOVE the flattened sigma image (the live DOM sits above every
   * canvas). Geometry is the shared annotationLayout metrics, so the export
   * matches the DOM box to the pixel.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} scale
   */
  drawExport(ctx, scale) {
    const placements = this.exportPlacements();
    if (placements.length === 0) return;
    ctx.save();
    try {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      for (const { ann, x, y, k } of placements) {
        const layout = annotationLayout(ann, (text, font) => {
          ctx.font = font;
          return ctx.measureText(text).width;
        });
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(k, k);
        const radius = ann.borderRadius ?? 0;
        if (ann.bgColor) {
          if (ann.shadow) {
            // Canvas shadows live in DEVICE px (the transform does not apply
            // to them), so the CSS-px values scale by the full device factor.
            ctx.shadowColor = ANNOTATION_SHADOW.color;
            ctx.shadowOffsetY = ANNOTATION_SHADOW.offsetY * scale * k;
            ctx.shadowBlur = ANNOTATION_SHADOW.blur * scale * k;
          }
          ctx.fillStyle = ann.bgColor;
          ctx.beginPath();
          ctx.roundRect(0, 0, layout.boxW, layout.boxH, radius);
          ctx.fill();
          ctx.shadowColor = 'transparent';
          ctx.shadowOffsetY = 0;
          ctx.shadowBlur = 0;
        }
        if (ann.borderWidth > 0) {
          ctx.strokeStyle = ann.borderColor;
          ctx.lineWidth = ann.borderWidth;
          ctx.beginPath();
          // Stroke centered on the border band so the outer edge lands on
          // the border-box outline, exactly like the CSS border; the corner
          // radius shrinks with the inset to keep the OUTER curve at radius.
          ctx.roundRect(
            ann.borderWidth / 2,
            ann.borderWidth / 2,
            layout.boxW - ann.borderWidth,
            layout.boxH - ann.borderWidth,
            Math.max(0, radius - ann.borderWidth / 2)
          );
          ctx.stroke();
        }
        ctx.fillStyle = ann.fontColor;
        ctx.font = layout.font;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const originX = ann.borderWidth + layout.pad;
        const originY = ann.borderWidth + layout.pad;
        layout.lines.forEach((line, i) => {
          ctx.fillText(line, originX, originY + (i + 0.5) * layout.lineHeight);
        });
        ctx.restore();
      }
    } finally {
      ctx.restore();
    }
  }
}

export { AnnotationLayer };
