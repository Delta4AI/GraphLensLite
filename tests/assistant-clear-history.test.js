// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { AssistantManager } from '../src/managers/assistant/index.js';

// ==========================================================================
// 🗑 Clear used to drop a whole conversation on one click, with no undo and no
// confirm — the assistant's history is not part of the layout snapshot, so
// undo/redo cannot bring it back. An empty conversation still clears silently:
// there is nothing to lose and nothing to ask about.
// ==========================================================================

function makeAssistant() {
  document.body.innerHTML = '<div id="assistantMessages"><div class="bubble">hi</div></div>';
  window.localStorage.clear();
  return new AssistantManager({ ui: {}, data: { layouts: {}, selectedLayout: 'L' } });
}

const okButton = () => document.querySelector('.p-button-primary');
const cancelButton = () => document.querySelector('.p-button-secondary');

describe('AssistantManager.clearHistory', () => {
  let assistant;

  beforeEach(() => {
    assistant = makeAssistant();
  });

  it('keeps the conversation when the confirm is declined', async () => {
    assistant._history = [{ role: 'user', content: 'hello' }];
    const pending = assistant.clearHistory();

    cancelButton().click();
    await pending;

    expect(assistant._history).toHaveLength(1);
    expect(document.getElementById('assistantMessages').children).toHaveLength(1);
  });

  it('clears the conversation and the transcript once confirmed', async () => {
    assistant._history = [{ role: 'user', content: 'hello' }];
    const pending = assistant.clearHistory();

    okButton().click();
    await pending;

    expect(assistant._history).toEqual([]);
    expect(document.getElementById('assistantMessages').innerHTML).toBe('');
  });

  it('does not interrupt for an empty conversation', async () => {
    assistant._history = [];
    await assistant.clearHistory();

    expect(okButton()).toBeNull();
    expect(document.getElementById('assistantMessages').innerHTML).toBe('');
  });
});
