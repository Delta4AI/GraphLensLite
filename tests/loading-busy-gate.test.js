// @vitest-environment jsdom
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { UIManager } from "../src/managers/ui.js";
import { GraphCoreManager } from "../src/graph/core.js";

// ==========================================================================
// Loading "busy" gate. A computationally heavy layout now runs off the main
// thread (layout_algorithms worker), so the loading overlay stays painted and
// keeps swallowing pointer input while the graph settles. Pointer is covered
// by the overlay element itself; keydown hotkeys are NOT, so the hotkey
// handler gates on ui.isBusy() — the hole that let a user fire export/toggle
// actions against a half-loaded graph. These tests pin both pieces.
// ==========================================================================

function mountOverlay(display) {
  const overlay = document.createElement("div");
  overlay.id = "loadingOverlay";
  overlay.style.display = display;
  document.body.appendChild(overlay);
  return overlay;
}

describe("UIManager.isBusy", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("is true while the overlay is shown (display:flex)", () => {
    // Arrange
    mountOverlay("flex");
    const ui = new UIManager({});

    // Act + Assert
    expect(ui.isBusy()).toBe(true);
  });

  it("is false while the overlay is hidden (display:none)", () => {
    // Arrange
    mountOverlay("none");
    const ui = new UIManager({});

    // Act + Assert
    expect(ui.isBusy()).toBe(false);
  });

  it("is false when the overlay element is absent", () => {
    // Arrange: no overlay in the DOM
    const ui = new UIManager({});

    // Act + Assert
    expect(ui.isBusy()).toBe(false);
  });
});

describe("loading overlay hold/release", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps the overlay up while held, drops it after release", async () => {
    // Arrange
    const overlay = mountOverlay("flex");
    const ui = new UIManager({});

    // Act: a nested hideLoading() (e.g. render's #postRefresh) while held
    ui.holdLoading();
    await ui.hideLoading();

    // Assert: still blocking
    expect(overlay.style.display).toBe("flex");
    expect(ui.isBusy()).toBe(true);

    // Act: orchestrator releases and drops it at the true end
    ui.releaseLoading();
    await ui.hideLoading();

    // Assert
    expect(overlay.style.display).toBe("none");
    expect(ui.isBusy()).toBe(false);
  });

  it("composes nested holds — overlay drops only when the last releases", async () => {
    // Arrange
    const overlay = mountOverlay("flex");
    const ui = new UIManager({});

    // Act + Assert: two holds, one release still pins
    ui.holdLoading();
    ui.holdLoading();
    ui.releaseLoading();
    await ui.hideLoading();
    expect(overlay.style.display).toBe("flex");

    // Act + Assert: final release drops it
    ui.releaseLoading();
    await ui.hideLoading();
    expect(overlay.style.display).toBe("none");
  });

  it("release never underflows past zero", async () => {
    // Arrange
    const overlay = mountOverlay("flex");
    const ui = new UIManager({});

    // Act: stray releases must not bank negative counts
    ui.releaseLoading();
    ui.releaseLoading();
    ui.holdLoading();
    await ui.hideLoading();

    // Assert: the single real hold still pins the overlay
    expect(overlay.style.display).toBe("flex");
  });

  it("hideLoading is idempotent once already hidden", async () => {
    // Arrange
    const overlay = mountOverlay("none");
    const ui = new UIManager({});

    // Act + Assert
    await ui.hideLoading();
    expect(overlay.style.display).toBe("none");
  });
});

describe("hotkey handler — gated on ui.isBusy()", () => {
  // registerHotkeyEvents has a module-level once-guard: the keydown listener is
  // attached exactly once and its closure binds this single cache. Per-test
  // state is mutated on `state` (read live by the stubbed cache) rather than
  // re-registering — a second registration would be a silent no-op.
  const exportJSON = vi.fn();
  const state = { busy: false };

  function pressKey(key, modifiers = {}) {
    document.dispatchEvent(new KeyboardEvent("keydown", { key, ...modifiers }));
    // hotkey switch branches are async; let the microtask queue drain.
    return Promise.resolve();
  }

  // The 1.17 additions: the target methods are unit-tested, the key → action
  // mapping was not, so a typo in the switch would go unnoticed.
  const showAppearance = vi.fn();
  const togglePresentationMode = vi.fn();
  const toggleKeyboardSheet = vi.fn();

  beforeAll(() => {
    const cache = {
      ui: {
        isBusy: () => state.busy,
        togglePresentationMode,
        toggleKeyboardSheet,
      },
      inspector: { showAppearance },
      io: { exportGraphAsJSON: exportJSON, exportPNG: vi.fn() },
    };
    new GraphCoreManager(cache).registerHotkeyEvents();
  });

  beforeEach(() => {
    document.body.innerHTML = ""; // body stays activeElement → hotkeys apply
    exportJSON.mockClear();
    state.busy = false;
  });

  it("suppresses the action while busy", async () => {
    // Arrange
    state.busy = true;

    // Act
    await pressKey("s");

    // Assert
    expect(exportJSON).not.toHaveBeenCalled();
  });

  it("runs the action once loading clears", async () => {
    // Arrange
    state.busy = false;

    // Act
    await pressKey("s");

    // Assert
    expect(exportJSON).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['y', () => showAppearance],
    ['F', () => togglePresentationMode],
    ['?', () => toggleKeyboardSheet],
  ])('dispatches %s to its action', async (key, target) => {
    target().mockClear();
    await pressKey(key);
    expect(target()).toHaveBeenCalledTimes(1);
  });

  it('gates the new shortcuts on busy too', async () => {
    state.busy = true;
    showAppearance.mockClear();
    await pressKey('y');
    expect(showAppearance).not.toHaveBeenCalled();
  });

  // The switch matches the BARE key, so every chord that shares a letter with a
  // hotkey used to fire it: Ctrl+S exported JSON over the browser's own save
  // dialog, Ctrl+P over its print dialog.
  it.each([
    ["ctrlKey", { ctrlKey: true }],
    ["metaKey", { metaKey: true }],
    ["altKey", { altKey: true }],
  ])("leaves %s chords to the browser", async (_name, modifiers) => {
    await pressKey("s", modifiers);
    expect(exportJSON).not.toHaveBeenCalled();
  });
});
