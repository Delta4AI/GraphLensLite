/**
 * Selection HUD placement: lets the docked Selection panel be dragged by its
 * header and snapped to a 3×3 grid of canvas positions (corners, edge-centers
 * and dead-center), with a dashed skeleton frame previewing where it will land
 * during the drag. Also a quick hide/show toggle so it can be cleared for an OS
 * screenshot. Grid cell + hidden state persist across sessions.
 *
 * `nearestCell` is pure (node-safe) and unit-tested; the SelectionHud class is
 * the thin DOM wiring around it.
 */

// Row (t/m/b) × column (l/c/r) grid. The bottom-right cell is excluded — the
// minimap lives there — and that region instead resolves to one of two slots
// flanking the minimap: "abm" (above it) or "blm" (beside it, to its left).
const CELLS = ["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "abm", "blm"];
const CELL_CLASSES = CELLS.map((c) => `sel-hud-${c}`);
const STORAGE_CELL = "gll.selHud.corner";
const STORAGE_HIDDEN = "gll.selHud.hidden";

/**
 * Placement cell of `rect` for the point (px, py). Eight cells follow a 3×3
 * grid (corners + edge-centers + center); the bottom-right region is split
 * into "abm" (above the minimap) and "blm" (left of the minimap) by which edge
 * the pointer leans toward, so the panel never lands on the minimap.
 * @returns one of "tl"|"tc"|"tr"|"ml"|"mc"|"mr"|"bl"|"bc"|"abm"|"blm".
 */
export function nearestCell(px, py, rect) {
  const band = (value, start, size) => {
    if (value < start + size / 3) return 0;
    if (value < start + (2 * size) / 3) return 1;
    return 2;
  };
  const cx = band(px, rect.left, rect.width);
  const cy = band(py, rect.top, rect.height);

  if (cx === 2 && cy === 2) {
    // Within the bottom-right third: lean toward the bottom edge → run along
    // the bottom beside the minimap; lean toward the right edge → stack above.
    const fx = (px - (rect.left + (2 * rect.width) / 3)) / (rect.width / 3);
    const fy = (py - (rect.top + (2 * rect.height) / 3)) / (rect.height / 3);
    return fy >= fx ? "blm" : "abm";
  }

  const col = ["l", "c", "r"][cx];
  const row = ["t", "m", "b"][cy];
  return `${row}${col}`;
}

function readStored(key, fallback) {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode / quota) — placement just won't persist */
  }
}

export class SelectionHud {
  constructor({ container, handle, bounds, hideBtn, restoreBtn }) {
    this.container = container;
    this.handle = handle;
    this.bounds = bounds;
    this.hideBtn = hideBtn;
    this.restoreBtn = restoreBtn;
    this.preview = null;
    this.dragging = false;
    this.grabDX = 0;
    this.grabDY = 0;
    this.elW = 0;
    this.elH = 0;

    const stored = readStored(STORAGE_CELL);
    this.#applyCell(CELLS.includes(stored) ? stored : "tr");
    if (readStored(STORAGE_HIDDEN) === "1") this.hide();

    this.#bind();
  }

  #bind() {
    this.handle.addEventListener("pointerdown", (e) => this.#onPointerDown(e));
    this.handle.addEventListener("pointermove", (e) => this.#onPointerMove(e));
    this.handle.addEventListener("pointerup", (e) => this.#onPointerUp(e));
    this.handle.addEventListener("pointercancel", () => this.#endDrag());
    this.hideBtn?.addEventListener("click", () => this.hide());
    this.restoreBtn?.addEventListener("click", () => this.show());
  }

  #cellFromPointer(e) {
    return nearestCell(e.clientX, e.clientY, this.bounds.getBoundingClientRect());
  }

  #onPointerDown(e) {
    // Buttons inside the header (Tools, hide) keep their own click behavior.
    if (e.target.closest("button")) return;
    const rect = this.container.getBoundingClientRect();
    const b = this.bounds.getBoundingClientRect();
    this.grabDX = e.clientX - rect.left;
    this.grabDY = e.clientY - rect.top;
    this.elW = rect.width;
    this.elH = rect.height;
    this.dragging = true;
    // Pin to the current spot as free inline coordinates before dropping the
    // cell class, so the panel doesn't jump to the origin on grab.
    this.container.style.left = `${rect.left - b.left}px`;
    this.container.style.top = `${rect.top - b.top}px`;
    this.container.style.right = "auto";
    this.container.style.bottom = "auto";
    this.container.style.transform = "none";
    this.container.classList.remove(...CELL_CLASSES);
    this.container.classList.add("sel-hud-dragging");
    this.#showPreview(this.#cellFromPointer(e));
    this.handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  #onPointerMove(e) {
    if (!this.dragging) return;
    const b = this.bounds.getBoundingClientRect();
    // Position relative to the offset parent (the bounds element), clamped so
    // the panel can never be dragged fully off-canvas.
    const maxX = Math.max(0, b.width - this.elW);
    const maxY = Math.max(0, b.height - this.elH);
    const x = Math.min(Math.max(0, e.clientX - b.left - this.grabDX), maxX);
    const y = Math.min(Math.max(0, e.clientY - b.top - this.grabDY), maxY);
    this.container.style.left = `${x}px`;
    this.container.style.top = `${y}px`;
    this.#updatePreview(this.#cellFromPointer(e));
  }

  #onPointerUp(e) {
    if (!this.dragging) return;
    const cell = this.#cellFromPointer(e);
    this.#endDrag();
    this.#applyCell(cell);
    writeStored(STORAGE_CELL, cell);
  }

  #endDrag() {
    this.dragging = false;
    this.container.classList.remove("sel-hud-dragging");
    // Drop the free-drag inline offsets so the cell class drives placement.
    for (const prop of ["left", "top", "right", "bottom", "transform"]) {
      this.container.style.removeProperty(prop);
    }
    this.#hidePreview();
  }

  #applyCell(cell) {
    this.#setCell(this.container, cell);
    this.#setCell(this.restoreBtn, cell);
  }

  #setCell(el, cell) {
    if (!el) return;
    el.classList.remove(...CELL_CLASSES);
    el.classList.add(`sel-hud-${cell}`);
  }

  #ensurePreview() {
    if (this.preview) return this.preview;
    const preview = document.createElement("div");
    preview.className = "sel-hud-snap-preview";
    this.bounds.appendChild(preview);
    this.preview = preview;
    return preview;
  }

  #showPreview(cell) {
    const preview = this.#ensurePreview();
    preview.style.width = `${this.elW}px`;
    preview.style.height = `${this.elH}px`;
    this.#setCell(preview, cell);
    preview.classList.add("visible");
  }

  #updatePreview(cell) {
    if (this.preview) this.#setCell(this.preview, cell);
  }

  #hidePreview() {
    this.preview?.classList.remove("visible");
  }

  hide() {
    this.container.classList.add("hidden");
    this.restoreBtn?.classList.add("visible");
    writeStored(STORAGE_HIDDEN, "1");
  }

  show() {
    this.container.classList.remove("hidden");
    this.restoreBtn?.classList.remove("visible");
    writeStored(STORAGE_HIDDEN, "0");
  }
}

export function initSelectionHud() {
  const container = document.getElementById("selectedElementsContainer");
  const handle = container?.querySelector(".sel-hud-header");
  const bounds = document.getElementById("outerGraphContainer");
  if (!container || !handle || !bounds) return null;
  return new SelectionHud({
    container,
    handle,
    bounds,
    hideBtn: document.getElementById("selHudHideBtn"),
    restoreBtn: document.getElementById("selHudRestoreBtn"),
  });
}
