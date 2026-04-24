// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { updateBudgetMeter } from "../src/managers/assistant/budget_meter.js";

function mountMeterDom() {
  document.body.innerHTML = `
    <div id="assistantBudget" class="assistant-budget">
      <span class="assistant-budget-dot"></span>
      <span class="assistant-budget-text">— / —</span>
    </div>`;
  return document.getElementById("assistantBudget");
}

describe("updateBudgetMeter", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders estimated tokens as `~total / budget` in the pill", () => {
    const el = mountMeterDom();
    updateBudgetMeter({
      systemChars: 4000,
      historyChars: 0,
      historyCount: 0,
      graphChars: 4000,
      userChars: 0,
      numCtx: 16384,
      selection: { nodes: 0, edges: 0 },
    });
    // 4000 + 4000 = 8000 chars → ~2000 tokens → "2.0k / 16k"
    expect(el.querySelector(".assistant-budget-text").textContent).toBe("~2.0k / 16k");
  });

  it("applies the OK tier below the warn threshold", () => {
    const el = mountMeterDom();
    updateBudgetMeter({
      systemChars: 4000,
      historyChars: 0,
      historyCount: 0,
      graphChars: 4000,
      userChars: 0,
      numCtx: 16384,
      selection: { nodes: 0, edges: 0 },
    });
    expect(el.classList.contains("assistant-budget-ok")).toBe(true);
    expect(el.classList.contains("assistant-budget-warn")).toBe(false);
    expect(el.classList.contains("assistant-budget-danger")).toBe(false);
  });

  it("applies the warn tier at 60–85% usage", () => {
    const el = mountMeterDom();
    // Target ~70%: 16384 * 0.7 = 11469 tokens → ~45876 chars
    updateBudgetMeter({
      systemChars: 6000,
      historyChars: 10000,
      historyCount: 6,
      graphChars: 28000,
      userChars: 1000,
      numCtx: 16384,
      selection: { nodes: 5, edges: 0 },
    });
    expect(el.classList.contains("assistant-budget-warn")).toBe(true);
  });

  it("applies the danger tier above 85%", () => {
    const el = mountMeterDom();
    // Target ~95%: 16384 * 0.95 * 4 ~= 62259 chars
    updateBudgetMeter({
      systemChars: 8000,
      historyChars: 14000,
      historyCount: 10,
      graphChars: 38000,
      userChars: 2000,
      numCtx: 16384,
      selection: { nodes: 25, edges: 10 },
    });
    expect(el.classList.contains("assistant-budget-danger")).toBe(true);
  });

  it("sets a short click-for-breakdown tooltip when under budget", () => {
    const el = mountMeterDom();
    updateBudgetMeter({
      systemChars: 6283,
      historyChars: 0,
      historyCount: 0,
      graphChars: 8322,
      userChars: 43,
      numCtx: 16384,
      selection: { nodes: 3, edges: 1 },
    });
    expect(el.title).toBe("Click for context-budget breakdown");
  });

  it("flags the tooltip as over-budget when total exceeds num_ctx", () => {
    const el = mountMeterDom();
    updateBudgetMeter({
      systemChars: 80000,
      historyChars: 0,
      historyCount: 0,
      graphChars: 0,
      userChars: 0,
      numCtx: 16384,
      selection: { nodes: 0, edges: 0 },
    });
    expect(el.title).toMatch(/Over budget/i);
    expect(el.title).toMatch(/breakdown/);
  });

  it("is a no-op when the meter element is absent", () => {
    // No DOM setup — function must not throw.
    expect(() => updateBudgetMeter({
      systemChars: 0, historyChars: 0, historyCount: 0,
      graphChars: 0, userChars: 0, numCtx: 16384,
      selection: { nodes: 0, edges: 0 },
    })).not.toThrow();
  });
});
