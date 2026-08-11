// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AssistantManager } from '../src/managers/assistant/index.js';

// ==========================================================================
// togglePanel / setWorkbenchVisible after the workbench redesign: the panel is
// a workbench tab now, so opening it is a delegation and the visibility
// callback owns everything that used to hang off the toggle — the budget
// poll timer and the first-run setup gate. Both were uncovered.
// ==========================================================================

function makeAssistant(overrides = {}) {
  document.body.innerHTML = '<div id="assistantMessages"></div>';
  window.localStorage.clear();
  const cache = {
    ui: {},
    data: { layouts: {}, selectedLayout: 'L' },
    workbench: { toggle: vi.fn() },
    ...overrides,
  };
  const assistant = new AssistantManager(cache);
  // The setup modal and the meter reach into DOM this test does not mount;
  // what matters here is whether they are reached at all.
  assistant._openSetup = vi.fn();
  assistant._refreshBudgetMeter = vi.fn();
  return assistant;
}

describe('AssistantManager.togglePanel', () => {
  it('delegates to the workbench tab', () => {
    const assistant = makeAssistant();
    assistant.togglePanel();

    expect(assistant.cache.workbench.toggle).toHaveBeenCalledWith('assistant');
  });

  it('leaves the setup suppression flag down again afterwards', () => {
    // The tour opens the panel with suppressSetup so the modal cannot steal
    // its focus. A flag left raised would suppress setup forever after.
    const assistant = makeAssistant();
    assistant.cache.workbench.toggle = vi.fn(() => {
      expect(assistant._suppressSetupOnce).toBe(true);
    });

    assistant.togglePanel({ suppressSetup: true });

    expect(assistant.cache.workbench.toggle).toHaveBeenCalledOnce();
    expect(assistant._suppressSetupOnce).toBe(false);
  });

  it('survives a workbench that is not wired up yet', () => {
    const assistant = makeAssistant({ workbench: undefined });
    expect(() => assistant.togglePanel()).not.toThrow();
  });
});

describe('AssistantManager.setWorkbenchVisible', () => {
  let assistant;

  beforeEach(() => {
    vi.useFakeTimers();
    assistant = makeAssistant();
  });

  afterEach(() => {
    assistant.setWorkbenchVisible(false); // no interval left behind
    vi.useRealTimers();
  });

  it('starts the budget poll while visible and stops it on hide', () => {
    assistant.setWorkbenchVisible(true);
    expect(assistant._panelOpen).toBe(true);
    expect(assistant._budgetTimer).toBeTruthy();

    assistant.setWorkbenchVisible(false);
    expect(assistant._panelOpen).toBe(false);
    expect(assistant._budgetTimer).toBe(0);
  });

  it('polls without re-rendering until the dirty key moves', () => {
    assistant.setWorkbenchVisible(true);
    assistant._refreshBudgetMeter.mockClear();
    assistant._budgetDirtyKey = assistant._computeBudgetDirtyKey();

    vi.advanceTimersByTime(2000);
    expect(assistant._refreshBudgetMeter).not.toHaveBeenCalled();

    assistant.cache.selectedNodes = ['n1'];
    vi.advanceTimersByTime(400);
    expect(assistant._refreshBudgetMeter).toHaveBeenCalled();
  });

  it('reopening does not stack a second timer', () => {
    assistant.setWorkbenchVisible(true);
    const first = assistant._budgetTimer;
    assistant.setWorkbenchVisible(true);

    expect(assistant._budgetTimer).not.toBe(first); // replaced, not added
    vi.advanceTimersByTime(400);
    // One live timer means one dirty-key check, so one refresh at most.
    expect(assistant._refreshBudgetMeter.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('prompts for setup on first open, but not when suppressed', () => {
    assistant.setWorkbenchVisible(true);
    expect(assistant._openSetup).toHaveBeenCalledOnce();

    assistant._openSetup.mockClear();
    assistant._suppressSetupOnce = true;
    assistant.setWorkbenchVisible(true);
    expect(assistant._openSetup).not.toHaveBeenCalled();
  });

  it('does not prompt once configured', () => {
    assistant._isConfigured = () => true;
    assistant.setWorkbenchVisible(true);

    expect(assistant._openSetup).not.toHaveBeenCalled();
    expect(assistant._refreshBudgetMeter).toHaveBeenCalled();
  });
});
