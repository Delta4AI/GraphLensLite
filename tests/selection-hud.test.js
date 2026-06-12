// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { nearestCell, SelectionHud } from "../src/utilities/selection_hud.js";

// ==========================================================================
// Selection HUD placement: 3×3 grid geometry (pure) + the drag/snap-preview/
// hide/persist wiring of the SelectionHud class. The bottom-right region is
// reserved for the minimap and resolves to "abm" (above) / "blm" (left of) it.
// ==========================================================================

const RECT = { left: 0, top: 0, width: 1000, height: 800 };

describe("nearestCell", () => {
  it("maps the four corners (bottom-right excluded)", () => {
    expect(nearestCell(100, 100, RECT)).toBe("tl");
    expect(nearestCell(900, 100, RECT)).toBe("tr");
    expect(nearestCell(100, 700, RECT)).toBe("bl");
  });

  it("maps the edge-centers and dead-center", () => {
    expect(nearestCell(500, 100, RECT)).toBe("tc");
    expect(nearestCell(100, 400, RECT)).toBe("ml");
    expect(nearestCell(500, 400, RECT)).toBe("mc");
    expect(nearestCell(900, 400, RECT)).toBe("mr");
    expect(nearestCell(500, 700, RECT)).toBe("bc");
  });

  it("never returns the minimap corner for bottom-right points", () => {
    for (const [x, y] of [[700, 560], [990, 560], [700, 780], [990, 780]]) {
      expect(["abm", "blm"]).toContain(nearestCell(x, y, RECT));
    }
  });

  it("leans to 'blm' near the bottom edge and 'abm' near the right edge", () => {
    expect(nearestCell(700, 790, RECT)).toBe("blm"); // hugging the bottom
    expect(nearestCell(990, 560, RECT)).toBe("abm"); // hugging the right
  });

  it("respects a non-origin rect offset", () => {
    const offset = { left: 200, top: 100, width: 400, height: 400 };
    expect(nearestCell(250, 150, offset)).toBe("tl");
    expect(["abm", "blm"]).toContain(nearestCell(580, 480, offset));
  });
});

function buildDom() {
  document.body.innerHTML = `
    <div id="outerGraphContainer">
      <div id="selectedElementsContainer" class="sel-hud-tl">
        <div class="sel-hud-header">
          <span class="sel-hud-title">Selection</span>
          <button id="selHudHideBtn">x</button>
        </div>
      </div>
      <button id="selHudRestoreBtn" class="sel-hud-tl"></button>
    </div>`;
  const container = document.getElementById("selectedElementsContainer");
  const handle = container.querySelector(".sel-hud-header");
  const bounds = document.getElementById("outerGraphContainer");
  const hideBtn = document.getElementById("selHudHideBtn");
  const restoreBtn = document.getElementById("selHudRestoreBtn");
  handle.setPointerCapture = () => {};
  bounds.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800 });
  container.getBoundingClientRect = () => ({ left: 10, top: 10, width: 256, height: 120 });
  return { container, handle, bounds, hideBtn, restoreBtn };
}

const pointerEvent = (type, props) => {
  const e = new Event(type, { bubbles: true });
  Object.assign(e, props);
  return e;
};

const drag = (handle, from, to) => {
  handle.dispatchEvent(pointerEvent("pointerdown", { clientX: from[0], clientY: from[1], pointerId: 1 }));
  handle.dispatchEvent(pointerEvent("pointermove", { clientX: to[0], clientY: to[1], pointerId: 1 }));
  handle.dispatchEvent(pointerEvent("pointerup", { clientX: to[0], clientY: to[1], pointerId: 1 }));
};

describe("SelectionHud", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
  });

  it("restores a stored grid cell on construction", () => {
    window.localStorage.setItem("gll.selHud.corner", "mc");
    const dom = buildDom();
    new SelectionHud(dom);
    expect(dom.container.classList.contains("sel-hud-mc")).toBe(true);
    expect(dom.container.classList.contains("sel-hud-tl")).toBe(false);
    expect(dom.restoreBtn.classList.contains("sel-hud-mc")).toBe(true);
  });

  it("defaults to top-right for an unknown or stale stored cell", () => {
    window.localStorage.setItem("gll.selHud.corner", "br"); // retired corner
    const dom = buildDom();
    new SelectionHud(dom);
    expect(dom.container.classList.contains("sel-hud-tr")).toBe(true);
    expect(dom.container.classList.contains("sel-hud-tl")).toBe(false);
  });

  it("starts hidden when the stored flag is set", () => {
    window.localStorage.setItem("gll.selHud.hidden", "1");
    const dom = buildDom();
    new SelectionHud(dom);
    expect(dom.container.classList.contains("hidden")).toBe(true);
    expect(dom.restoreBtn.classList.contains("visible")).toBe(true);
  });

  it("hides via the hide button and persists", () => {
    const dom = buildDom();
    new SelectionHud(dom);
    dom.hideBtn.click();
    expect(dom.container.classList.contains("hidden")).toBe(true);
    expect(dom.restoreBtn.classList.contains("visible")).toBe(true);
    expect(window.localStorage.getItem("gll.selHud.hidden")).toBe("1");
  });

  it("restores via the restore button and persists", () => {
    const dom = buildDom();
    const hud = new SelectionHud(dom);
    hud.hide();
    dom.restoreBtn.click();
    expect(dom.container.classList.contains("hidden")).toBe(false);
    expect(dom.restoreBtn.classList.contains("visible")).toBe(false);
    expect(window.localStorage.getItem("gll.selHud.hidden")).toBe("0");
  });

  it("snaps to a clean grid cell after a header drag", () => {
    const dom = buildDom();
    new SelectionHud(dom);
    drag(dom.handle, [20, 20], [950, 30]); // toward top-right
    expect(dom.container.classList.contains("sel-hud-tr")).toBe(true);
    expect(window.localStorage.getItem("gll.selHud.corner")).toBe("tr");
    // Inline drag offsets are cleared so the cell class drives placement.
    expect(dom.container.style.left).toBe("");
    expect(dom.container.style.transform).toBe("");
  });

  it("never snaps onto the minimap corner", () => {
    const dom = buildDom();
    new SelectionHud(dom);
    drag(dom.handle, [20, 20], [970, 770]); // toward the minimap corner
    const cell = window.localStorage.getItem("gll.selHud.corner");
    expect(["abm", "blm"]).toContain(cell);
    expect(dom.container.classList.contains("sel-hud-br")).toBe(false);
  });

  it("shows a dashed snap preview during the drag and removes it on drop", () => {
    const dom = buildDom();
    new SelectionHud(dom);
    dom.handle.dispatchEvent(pointerEvent("pointerdown", { clientX: 20, clientY: 20, pointerId: 1 }));
    dom.handle.dispatchEvent(pointerEvent("pointermove", { clientX: 500, clientY: 100, pointerId: 1 }));
    const preview = dom.bounds.querySelector(".sel-hud-snap-preview");
    expect(preview).not.toBeNull();
    expect(preview.classList.contains("visible")).toBe(true);
    expect(preview.classList.contains("sel-hud-tc")).toBe(true); // tracks target cell
    dom.handle.dispatchEvent(pointerEvent("pointerup", { clientX: 500, clientY: 100, pointerId: 1 }));
    expect(preview.classList.contains("visible")).toBe(false);
  });

  it("ignores drags that start on a header button", () => {
    const dom = buildDom();
    new SelectionHud(dom);
    dom.hideBtn.dispatchEvent(pointerEvent("pointerdown", { clientX: 20, clientY: 20, pointerId: 1 }));
    dom.handle.dispatchEvent(pointerEvent("pointermove", { clientX: 950, clientY: 760, pointerId: 1 }));
    dom.handle.dispatchEvent(pointerEvent("pointerup", { clientX: 950, clientY: 760, pointerId: 1 }));
    expect(dom.container.classList.contains("sel-hud-tr")).toBe(true); // unchanged default
  });
});
