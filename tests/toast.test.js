// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { UIManager } from "../src/managers/ui.js";
import { buildContextSnapshot } from "../src/managers/assistant/context.js";

// ==========================================================================
// Toasts + the activity log. Every message goes to BOTH: the toast is the
// transient copy over the stage, the log is the scrollback the assistant reads
// back as context (assistant/context.js readRecentActions) and where the Neo4j
// connector writes its Cypher trace. A toast that replaced the log would
// silently delete both.
// ==========================================================================

function mountDOM() {
  document.body.innerHTML = `
    <div id="outerGraphContainer">
      <div id="toasts" role="status" aria-live="polite"></div>
    </div>
    <aside id="inspector">
      <div id="inspectorLog" hidden>
        <button id="logToggleBtn" aria-expanded="false" aria-controls="sidebarStatusContainer">
          <span id="logCount"></span>
        </button>
        <div id="sidebarStatusContainer" hidden></div>
      </div>
    </aside>`;
}

const toasts = () => [...document.querySelectorAll("#toasts .toast")];
const logLines = () => [...document.querySelectorAll("#sidebarStatusContainer p")];

describe("UIManager toasts", () => {
  let ui;

  beforeEach(() => {
    vi.useFakeTimers();
    mountDOM();
    ui = new UIManager({}, false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the message as a toast AND keeps it in the log", () => {
    ui.success("Loaded 120 nodes");

    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].textContent).toContain("Loaded 120 nodes");
    expect(logLines()).toHaveLength(1);
    expect(logLines()[0].textContent).toContain("Loaded 120 nodes");
  });

  it("keeps the log readable by the assistant's context builder", () => {
    ui.info("first thing");
    ui.warning("second thing");

    const snapshot = buildContextSnapshot({
      initialized: true,
      data: { selectedLayout: "main", layouts: { main: { filters: new Map() } } },
      nodeRef: new Map(),
      edgeRef: new Map(),
      nodeIDsToBeShown: new Set(),
      edgeIDsToBeShown: new Set(),
      selectedNodes: new Set(),
      selectedEdges: new Set(),
      hiddenDanglingNodeIDs: new Set(),
      lastBubbleSetMembers: new Map(),
      uniquePropHierarchy: {},
      query: { text: null, valid: true },
      metrics: { selected: null, metricValueCache: new Map() },
    });
    expect(snapshot.recentActions.join("\n")).toContain("first thing");
    expect(snapshot.recentActions.join("\n")).toContain("second thing");
  });

  it("tones the toast by severity", () => {
    ui.error("boom");
    ui.warning("careful");
    ui.success("done");

    const classes = toasts().map((t) => t.className);
    expect(classes).toEqual([
      "toast toast-red",
      "toast toast-dark-orange",
      "toast toast-green",
    ]);
  });

  it("carries the icon prefix", () => {
    ui.error("boom");
    expect(toasts()[0].querySelector(".toast-icon").textContent).toBe("⛔");
  });

  it("does not toast trace messages, but still logs them", () => {
    // The Neo4j connector logs one grey line per Cypher statement — an expand
    // fires several at once, and a stack of toasts for a trace is noise.
    ui.logMessage("MATCH (n) RETURN n", "grey", false, "🛢️");

    expect(toasts()).toHaveLength(0);
    expect(logLines()).toHaveLength(1);
  });

  it("expires a toast on its own timer, longest for errors", () => {
    ui.success("done");
    ui.error("boom");
    expect(toasts()).toHaveLength(2);

    vi.advanceTimersByTime(4500);
    expect(toasts().map((t) => t.textContent)).toEqual([expect.stringContaining("boom")]);

    vi.advanceTimersByTime(4500);
    expect(toasts()).toHaveLength(0);
    // Expiring a toast never touches the log.
    expect(logLines()).toHaveLength(2);
  });

  it("dismisses on click without clearing the log", () => {
    ui.info("hello");
    toasts()[0].querySelector(".toast-dismiss").click();

    expect(toasts()).toHaveLength(0);
    expect(logLines()).toHaveLength(1);
  });

  it("caps the stack so a burst cannot cover the stage", () => {
    for (let i = 0; i < 9; i++) ui.info(`message ${i}`);

    expect(toasts()).toHaveLength(4);
    expect(toasts()[0].textContent).toContain("message 5");
    expect(toasts()[3].textContent).toContain("message 8");
  });

  it("evicts routine toasts before an error", () => {
    ui.error("boom");
    for (let i = 0; i < 6; i++) ui.info(`message ${i}`);

    const texts = toasts().map((t) => t.textContent);
    expect(toasts()).toHaveLength(4);
    expect(texts[0]).toContain("boom");
    expect(texts.slice(1).join(" ")).toContain("message 5");
  });

  it("evicts an error only when errors are all there is", () => {
    for (let i = 0; i < 6; i++) ui.error(`boom ${i}`);

    expect(toasts()).toHaveLength(4);
    expect(toasts()[0].textContent).toContain("boom 2");
  });

  it("survives a missing toast host (headless harnesses, tests)", () => {
    document.getElementById("toasts").remove();
    expect(() => ui.info("hello")).not.toThrow();
    expect(logLines()).toHaveLength(1);
  });
});

describe("UIManager activity log", () => {
  let ui;

  beforeEach(() => {
    vi.useFakeTimers();
    mountDOM();
    ui = new UIManager({}, false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays hidden until there is something to read", () => {
    expect(document.getElementById("inspectorLog").hidden).toBe(true);

    ui.info("hello");

    expect(document.getElementById("inspectorLog").hidden).toBe(false);
    expect(document.getElementById("logCount").textContent).toBe("1");
    // Revealing the footer does not expand the strip — the toast already said it.
    expect(document.getElementById("sidebarStatusContainer").hidden).toBe(true);
  });

  it("toggleLog expands and collapses the strip", () => {
    ui.info("hello");
    const strip = document.getElementById("sidebarStatusContainer");
    const btn = document.getElementById("logToggleBtn");

    ui.toggleLog();
    expect(strip.hidden).toBe(false);
    expect(btn.getAttribute("aria-expanded")).toBe("true");

    ui.toggleLog();
    expect(strip.hidden).toBe(true);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("is a ring — a long session cannot grow it without bound", () => {
    for (let i = 0; i < 260; i++) ui.info(`message ${i}`);

    expect(logLines()).toHaveLength(200);
    expect(logLines()[0].textContent).toContain("message 60");
    expect(logLines()[199].textContent).toContain("message 259");
  });

  it("clearLog empties it and hides the footer again", () => {
    ui.info("hello");
    ui.clearLog();

    expect(logLines()).toHaveLength(0);
    expect(document.getElementById("inspectorLog").hidden).toBe(true);
    expect(document.getElementById("logCount").textContent).toBe("");
  });

  it("clearLog is safe before the inspector exists", () => {
    document.body.innerHTML = "";
    expect(() => ui.clearLog()).not.toThrow();
  });
});
