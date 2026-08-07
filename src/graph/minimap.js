/**
 * Browser-only minimap for the sigma renderer. Deliberately minimal: visible nodes as
 * dots over a graph-space bounding-box fit, the current viewport as a
 * rectangle, click/drag pans the camera. No edges, no labels.
 *
 * Position: bottom-right — the G6 plugin was configured "bottom-left" but
 * style.css always overrode it to bottom-right, so that is the shipped
 * position this port preserves (CSS class .gll-minimap).
 */
import { FrameCoalescer } from './overlay_frame.js';

const MINIMAP_WIDTH = 200;
const MINIMAP_HEIGHT = 120;
const MINIMAP_PADDING = 8;
const DOT_RADIUS = 1.5;
const DOT_COLOR = "#403C53";
const DOT_COLOR_DARK = "#AAA3C4"; // brand purple is invisible on the dark thumb
const VIEWPORT_STROKE = "#C33D35";

class Minimap {
  /**
   * @param {object} adapter  SigmaAdapter (owns sigma + graphology)
   * @param {HTMLElement} container  the sigma container (#innerGraphContainer)
   */
  constructor(adapter, container) {
    this.adapter = adapter;
    this.killed = false;
    this.frame = new FrameCoalescer(() => this.#draw());
    this.dragging = false;
    // Graph-space fit of the last draw; #panTo inverts it for clicks.
    this.fit = null;

    const canvas = document.createElement("canvas");
    canvas.className = "gll-minimap";
    canvas.width = MINIMAP_WIDTH;
    canvas.height = MINIMAP_HEIGHT;
    canvas.addEventListener("pointerdown", (e) => this.#onPointerDown(e));
    canvas.addEventListener("pointermove", (e) => this.#onPointerMove(e));
    canvas.addEventListener("pointerup", (e) => this.#onPointerUp(e));
    canvas.addEventListener("pointercancel", () => {
      this.dragging = false;
    });
    container.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");

    this.renderHandler = () => this.scheduleRedraw();
    adapter.sigma.on("afterRender", this.renderHandler);
    this.scheduleRedraw();
  }

  /** Show or hide the overview thumbnail (inspector's Overlays stack). */
  setVisible(visible) {
    this.canvas.hidden = !visible;
    if (visible) this.scheduleRedraw();
  }

  get visible() {
    return !this.canvas.hidden;
  }

  destroy() {
    if (this.killed) return;
    this.killed = true;
    this.frame.kill();
    this.adapter.sigma.off("afterRender", this.renderHandler);
    this.canvas.remove();
  }

  scheduleRedraw() {
    this.frame.schedule();
  }

  // ------------------------------------------------------------------ draw

  /** Graph-space bbox of visible nodes → thumbnail transform (y flipped:
   *  graph space is y-up, canvas is y-down — matches the main view). */
  #computeFit() {
    const graph = this.adapter.graph;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    graph.forEachNode((id, attrs) => {
      if (attrs.hidden) return;
      if (attrs.x < minX) minX = attrs.x;
      if (attrs.x > maxX) maxX = attrs.x;
      if (attrs.y < minY) minY = attrs.y;
      if (attrs.y > maxY) maxY = attrs.y;
    });
    if (!isFinite(minX)) return null;
    const scale = Math.min(
      (MINIMAP_WIDTH - 2 * MINIMAP_PADDING) / Math.max(maxX - minX, 1e-9),
      (MINIMAP_HEIGHT - 2 * MINIMAP_PADDING) / Math.max(maxY - minY, 1e-9),
    );
    return {
      scale,
      midX: (minX + maxX) / 2,
      midY: (minY + maxY) / 2,
    };
  }

  #toThumb(fit, x, y) {
    return {
      x: MINIMAP_WIDTH / 2 + (x - fit.midX) * fit.scale,
      y: MINIMAP_HEIGHT / 2 - (y - fit.midY) * fit.scale,
    };
  }

  #toGraph(fit, tx, ty) {
    return {
      x: fit.midX + (tx - MINIMAP_WIDTH / 2) / fit.scale,
      y: fit.midY - (ty - MINIMAP_HEIGHT / 2) / fit.scale,
    };
  }

  #draw() {
    if (this.killed) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT);

    const fit = this.#computeFit();
    this.fit = fit;
    if (!fit) return;

    const graph = this.adapter.graph;
    const isDark = document.documentElement.dataset.theme === "dark";
    ctx.fillStyle = isDark ? DOT_COLOR_DARK : DOT_COLOR;
    graph.forEachNode((id, attrs) => {
      if (attrs.hidden) return;
      const p = this.#toThumb(fit, attrs.x, attrs.y);
      ctx.fillRect(p.x - DOT_RADIUS, p.y - DOT_RADIUS, 2 * DOT_RADIUS, 2 * DOT_RADIUS);
    });

    // Current viewport rectangle (viewport corners → graph → thumbnail).
    // Axis-aligned rect assumes camera.angle === 0 (the app never rotates the camera).
    const sigma = this.adapter.sigma;
    const { width, height } = sigma.getDimensions();
    const a = this.#toThumb(fit, ...corner(sigma, 0, 0));
    const b = this.#toThumb(fit, ...corner(sigma, width, height));
    ctx.strokeStyle = VIEWPORT_STROKE;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.min(a.x, b.x),
      Math.min(a.y, b.y),
      Math.abs(b.x - a.x),
      Math.abs(b.y - a.y),
    );
  }

  // ----------------------------------------------------------- interaction

  #panTo(event) {
    if (!this.fit) return;
    const rect = this.canvas.getBoundingClientRect();
    const graphPoint = this.#toGraph(
      this.fit,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
    const sigma = this.adapter.sigma;
    // Round-trip through the current camera yields the camera-independent
    // framed coordinate of the graph point (same pattern as focusElement).
    const framed = sigma.viewportToFramedGraph(sigma.graphToViewport(graphPoint));
    sigma.getCamera().setState({ x: framed.x, y: framed.y });
  }

  #onPointerDown(event) {
    if (event.button !== 0) return;
    event.stopPropagation();
    this.dragging = true;
    this.canvas.setPointerCapture(event.pointerId);
    this.#panTo(event);
  }

  #onPointerMove(event) {
    if (!this.dragging) return;
    this.#panTo(event);
  }

  #onPointerUp(event) {
    this.dragging = false;
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
  }
}

function corner(sigma, x, y) {
  const p = sigma.viewportToGraph({ x, y });
  return [p.x, p.y];
}

export { Minimap };
