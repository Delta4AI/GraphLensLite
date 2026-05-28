// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { openBudgetModal } from "../src/managers/assistant/budget_modal.js";

describe("openBudgetModal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  function baseBudget() {
    return {
      system: 1000,
      history: 4000,
      graph: 14000,
      user: 200,
      total: 19200,
      numCtx: 16384,
      ratio: 19200 / 16384,
      overBudget: true,
    };
  }

  function open(overrides = {}) {
    const budget = { ...baseBudget(), ...(overrides.budget || {}) };
    return openBudgetModal({
      budget,
      numCtx: overrides.numCtx ?? 16384,
      selectionInfo: overrides.selectionInfo ?? { nodes: 87, edges: 152 },
      estimates: overrides.estimates ?? {
        excludeHistoryTotal: 15200,
        minimalSelectionTotal: 5700,
      },
    });
  }

  function findButton(label) {
    return [...document.querySelectorAll("button")].find(b => b.textContent === label);
  }

  it("renders the summary, breakdown, and all action buttons", () => {
    open();
    expect(document.querySelector(".assistant-budget-modal-title").textContent)
      .toBe("Request exceeds model context");
    expect(document.querySelector(".assistant-budget-modal-detail").textContent)
      .toMatch(/19,200 tokens/);
    expect(document.querySelector(".assistant-budget-modal-detail").textContent)
      .toMatch(/16,384/);
    expect(findButton("Send without chat history")).toBeTruthy();
    expect(findButton("Send without selection details")).toBeTruthy();
    expect(findButton("Open Settings")).toBeTruthy();
    expect(findButton("Send anyway")).toBeTruthy();
    expect(findButton("Cancel")).toBeTruthy();
  });

  it("lists the biggest contributor first in the breakdown", () => {
    open();
    const rowNames = [...document.querySelectorAll(".assistant-budget-modal-row-name")]
      .map(el => el.textContent);
    expect(rowNames[0]).toBe("graph_state");
  });

  it("shows post-action estimates next to the two remediation buttons", () => {
    open();
    const estimates = [...document.querySelectorAll(".assistant-budget-modal-action-estimate")]
      .map(el => el.textContent);
    // Only the two token-saving remediations carry estimates. Open Settings
    // and Send anyway do not.
    expect(estimates).toHaveLength(2);
    expect(estimates[0]).toMatch(/15,200/);
    expect(estimates[0]).toMatch(/fits/); // 15,200 < 16,384
    expect(estimates[1]).toMatch(/5,700/);
    expect(estimates[1]).toMatch(/fits/);
  });

  it("excludeHistoryTotal < numCtx marks that action as fits", async () => {
    open({ estimates: { excludeHistoryTotal: 14000, minimalSelectionTotal: 5000 } });
    const estimates = [...document.querySelectorAll(".assistant-budget-modal-action-estimate")];
    expect(estimates[0].textContent).toMatch(/fits/);
    expect(estimates[0].classList.contains("assistant-budget-modal-fits")).toBe(true);
  });

  it("excludeHistoryTotal > numCtx marks that action as still over", () => {
    open({ estimates: { excludeHistoryTotal: 20000, minimalSelectionTotal: 5000 } });
    const estimates = [...document.querySelectorAll(".assistant-budget-modal-action-estimate")];
    expect(estimates[0].textContent).toMatch(/still over/);
    expect(estimates[0].classList.contains("assistant-budget-modal-overflow")).toBe(true);
  });

  it("resolves with {excludeHistory: true} when that button is clicked", async () => {
    const p = open();
    findButton("Send without chat history").click();
    await expect(p).resolves.toEqual({ excludeHistory: true });
  });

  it("resolves with {minimalSelection: true} when that button is clicked", async () => {
    const p = open();
    findButton("Send without selection details").click();
    await expect(p).resolves.toEqual({ minimalSelection: true });
  });

  it("resolves with {openSettings: true} when Open Settings is clicked", async () => {
    const p = open();
    findButton("Open Settings").click();
    await expect(p).resolves.toEqual({ openSettings: true });
  });

  it("resolves with {overrideBudget: true} when Send anyway is clicked", async () => {
    const p = open();
    findButton("Send anyway").click();
    await expect(p).resolves.toEqual({ overrideBudget: true });
  });

  it("resolves with null when Cancel is clicked", async () => {
    const p = open();
    findButton("Cancel").click();
    await expect(p).resolves.toBeNull();
  });

  it("surfaces the selection counts in the breakdown note", () => {
    open();
    const countRow = [...document.querySelectorAll(".assistant-budget-modal-row")]
      .find(r => r.textContent.includes("graph_state"));
    expect(countRow.textContent).toMatch(/87 nodes/);
    expect(countRow.textContent).toMatch(/152 edges/);
  });
});
