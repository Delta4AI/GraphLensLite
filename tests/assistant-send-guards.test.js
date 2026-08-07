// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AssistantManager } from '../src/managers/assistant/index.js';

// ==========================================================================
// What a turn leaves behind when it does NOT complete. Cancelling the
// over-budget modal used to keep the user's bubble (already rendered), throw
// away the typed question (the input was cleared before the gate) and leave the
// budget pill on a stale number. A turn that streamed nothing finalized as a
// blank bubble AND pushed an empty assistant message into history, which then
// went back on the wire on every later request.
// ==========================================================================

function mountPanel() {
  document.body.innerHTML = `
    <div id="assistantPanel">
      <div id="assistantMessages"></div>
      <textarea id="assistantInput"></textarea>
      <button id="assistantSendBtn">Send</button>
      <div id="assistantBudgetMeter"><div id="assistantBudgetFill"></div></div>
    </div>`;
}

function makeAssistant({ numCtx = 16384 } = {}) {
  mountPanel();
  window.localStorage.clear();
  const assistant = new AssistantManager({
    ui: {},
    data: { layouts: { L: { filters: new Map() } }, selectedLayout: 'L' },
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
  // Past the setup gate without a real endpoint.
  assistant._endpoint = 'http://localhost:11434';
  assistant._model = 'llama3';
  assistant._settings = { ...assistant._settings, numCtx };
  return assistant;
}

const bubbles = () => [...document.querySelectorAll('#assistantMessages .assistant-bubble')];
const input = () => document.getElementById('assistantInput');
const cancelModal = () =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === 'Cancel').click();

describe('over-budget cancel', () => {
  let assistant;

  beforeEach(() => {
    assistant = makeAssistant({ numCtx: 1 }); // any question is over budget
    assistant._client = { chat: vi.fn() };
  });

  it('leaves no bubble behind and puts the question back in the box', async () => {
    input().value = 'why is this graph empty?';
    const pending = assistant.sendFromInput();

    // The modal is up; the bubble must not be.
    expect(bubbles()).toHaveLength(0);
    cancelModal();
    await pending;

    expect(bubbles()).toHaveLength(0);
    expect(input().value).toBe('why is this graph empty?');
    expect(assistant._client.chat).not.toHaveBeenCalled();
  });

  it('does not clobber a question the user typed while the modal was open', async () => {
    input().value = 'first question';
    const pending = assistant.sendFromInput();

    input().value = 'second question';
    cancelModal();
    await pending;

    expect(input().value).toBe('second question');
  });
});

describe('a turn that streams nothing', () => {
  let assistant;

  beforeEach(() => {
    assistant = makeAssistant();
    assistant._client = { chat: vi.fn(async () => {}) };
  });

  it('says "(no reply)" and keeps the empty turn out of history', async () => {
    await assistant.send('anything');

    const reply = bubbles().at(-1);
    expect(reply.textContent).toContain('(no reply)');
    expect(reply.classList.contains('assistant-bubble-streaming')).toBe(false);
    expect(assistant._history).toEqual([]);
  });

  it('still records a turn that did reply', async () => {
    assistant._client = {
      chat: vi.fn(async (_messages, onChunk) => onChunk({ content: 'because it is' })),
    };
    await assistant.send('why');

    expect(assistant._history).toEqual([
      { role: 'user', content: 'why' },
      { role: 'assistant', content: 'because it is' },
    ]);
  });
});

describe('_friendlyError', () => {
  let assistant;

  beforeEach(() => {
    assistant = makeAssistant();
  });

  it('reads a 404 as the missing model', () => {
    const err = new Error('Ollama error 404: {"error":"model \\"x\\" not found"}');
    err.status = 404;
    expect(assistant._friendlyError(err)).toMatch(/ollama pull/);
  });

  it('does not call an out-of-memory error a missing model', () => {
    const err = new Error('Ollama error 500: model requires more system memory');
    err.status = 500;
    const msg = assistant._friendlyError(err);
    expect(msg).not.toMatch(/ollama pull/);
    // Packaged Electron has no console, so the message itself has to carry it.
    expect(msg).toContain('model requires more system memory');
  });
});

describe('_openQueryInEditor', () => {
  let assistant;

  beforeEach(() => {
    assistant = makeAssistant();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<button id="queryToggleBtn" class="highlight"></button><div id="q"></div>'
    );
    const textEl = document.getElementById('q');
    assistant.cache.query = { text: textEl, valid: true };
    assistant.cache.qm = {
      clearQuery: vi.fn(() => {
        textEl.textContent = '';
      }),
      handleQueryValidationEvent: vi.fn(),
      moveCaretToEnd: vi.fn(),
    };
  });

  it('asks before replacing a hand-typed query, and keeps it on cancel', async () => {
    assistant.cache.query.text.textContent = 'Node filters::A::B IN [1]';
    const pending = assistant._openQueryInEditor('Node filters::C::D IN [2]');

    document.querySelector('.p-button-secondary').click();
    await pending;

    expect(assistant.cache.query.text.textContent).toBe('Node filters::A::B IN [1]');
    expect(assistant.cache.qm.clearQuery).not.toHaveBeenCalled();
  });

  it('replaces without asking when the editor is empty', async () => {
    await assistant._openQueryInEditor('Node filters::C::D IN [2]');

    expect(assistant.cache.query.text.textContent).toBe('Node filters::C::D IN [2]');
  });
});
