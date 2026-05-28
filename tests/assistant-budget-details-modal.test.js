// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { openBudgetDetailsModal } from "../src/managers/assistant/budget_details_modal.js";
import { computeBudget } from "../src/managers/assistant/budget_meter.js";

function body() {
  return document.body;
}

function rowLabels() {
  return [...document.querySelectorAll(".assistant-budget-modal-row-name")].map(el => el.textContent);
}

describe("openBudgetDetailsModal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the summary with total-of-cap and percentage", () => {
    const budget = computeBudget({
      systemChars: 4000,
      historyChars: 0,
      graphChars: 4000,
      userChars: 0,
      numCtx: 16384,
    });
    openBudgetDetailsModal({
      budget,
      selectionInfo: { nodes: 0, edges: 0 },
      historyCount: 0,
      numCtx: 16384,
    });
    const title = body().querySelector(".assistant-budget-modal-title");
    expect(title).toBeTruthy();
    expect(title.textContent).toMatch(/2,000/);
    expect(title.textContent).toMatch(/16,384/);
    expect(title.textContent).toMatch(/12%/);
  });

  it("lists rows sorted by token count, largest first", () => {
    const budget = computeBudget({
      systemChars: 2000,
      historyChars: 800,
      graphChars: 20000,
      userChars: 200,
      numCtx: 16384,
    });
    openBudgetDetailsModal({
      budget,
      selectionInfo: { nodes: 2, edges: 0 },
      historyCount: 3,
      numCtx: 16384,
    });
    expect(rowLabels()).toEqual(["graph_state", "system", "history", "your input"]);
  });

  it("annotates graph_state with selection counts when something is selected", () => {
    const budget = computeBudget({
      systemChars: 1000,
      historyChars: 0,
      graphChars: 4000,
      userChars: 0,
      numCtx: 16384,
    });
    openBudgetDetailsModal({
      budget,
      selectionInfo: { nodes: 3, edges: 1 },
      historyCount: 0,
      numCtx: 16384,
    });
    const rows = [...body().querySelectorAll(".assistant-budget-modal-row")];
    const graphRow = rows.find(r => r.querySelector(".assistant-budget-modal-row-name").textContent === "graph_state");
    expect(graphRow.textContent).toMatch(/3 nodes, 1 edge selected/);
  });

  it("omits the selection annotation when nothing is selected", () => {
    const budget = computeBudget({
      systemChars: 1000,
      historyChars: 0,
      graphChars: 4000,
      userChars: 0,
      numCtx: 16384,
    });
    openBudgetDetailsModal({
      budget,
      selectionInfo: { nodes: 0, edges: 0 },
      historyCount: 0,
      numCtx: 16384,
    });
    const rows = [...body().querySelectorAll(".assistant-budget-modal-row")];
    const graphRow = rows.find(r => r.querySelector(".assistant-budget-modal-row-name").textContent === "graph_state");
    expect(graphRow.textContent).not.toMatch(/selected/);
  });

  it("marks the summary as over-budget with a .is-over modifier when total > cap", () => {
    const budget = computeBudget({
      systemChars: 80000,
      historyChars: 0,
      graphChars: 0,
      userChars: 0,
      numCtx: 16384,
    });
    openBudgetDetailsModal({
      budget,
      selectionInfo: { nodes: 0, edges: 0 },
      historyCount: 0,
      numCtx: 16384,
    });
    const summary = body().querySelector(".assistant-budget-modal-summary");
    expect(summary.classList.contains("is-over")).toBe(true);
    expect(summary.querySelector(".assistant-budget-modal-detail").textContent).toMatch(/Over budget/i);
  });

  it("leaves the summary neutral when under budget", () => {
    const budget = computeBudget({
      systemChars: 4000,
      historyChars: 0,
      graphChars: 4000,
      userChars: 0,
      numCtx: 16384,
    });
    openBudgetDetailsModal({
      budget,
      selectionInfo: { nodes: 0, edges: 0 },
      historyCount: 0,
      numCtx: 16384,
    });
    const summary = body().querySelector(".assistant-budget-modal-summary");
    expect(summary.classList.contains("is-over")).toBe(false);
  });

  it("renders a Close button in the footer", () => {
    const budget = computeBudget({
      systemChars: 1000,
      historyChars: 0,
      graphChars: 0,
      userChars: 0,
      numCtx: 16384,
    });
    openBudgetDetailsModal({
      budget,
      selectionInfo: { nodes: 0, edges: 0 },
      historyCount: 0,
      numCtx: 16384,
    });
    const closeBtn = [...body().querySelectorAll("button")].find(b => b.textContent === "Close");
    expect(closeBtn).toBeTruthy();
  });
});
