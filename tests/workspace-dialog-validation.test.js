// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openWorkspaceCreationDialog } from '../src/graph/workspace_dialog.js';

// ==========================================================================
// Empty-name validation in the workspace creation dialog. It used to call
// window.alert() — the only native dialog left in the codebase, and one that
// blocks the renderer thread outright (an automation harness hangs with no
// diagnostic). Contract: an empty submit marks the input invalid via the
// constraint-validation API, keeps the dialog open, and never touches
// alert(); typing clears the mark.
// ==========================================================================

const INTERNALS = { force: {}, grid: {}, circular: {} };

beforeEach(() => {
  document.body.innerHTML = '';
  window.alert = vi.fn(() => {
    throw new Error('window.alert must not be called');
  });
});

function clickCreate() {
  const buttons = [...document.querySelectorAll('button')];
  buttons.find((b) => b.textContent === 'Create').click();
}

describe('workspace creation dialog — empty name', () => {
  it('flags the input instead of alert(), and stays open', async () => {
    let settled = false;
    const dialog = openWorkspaceCreationDialog(INTERNALS).then((r) => {
      settled = true;
      return r;
    });
    await Promise.resolve();

    clickCreate();
    await Promise.resolve();

    const nameInput = document.querySelector('input[type="text"]');
    expect(window.alert).not.toHaveBeenCalled();
    expect(nameInput.validationMessage).toBe('Please enter a name for the workspace');
    expect(settled).toBe(false);

    // Typing clears the mark; submitting then resolves normally.
    nameInput.value = 'My workspace';
    nameInput.dispatchEvent(new Event('input'));
    expect(nameInput.validationMessage).toBe('');

    clickCreate();
    await expect(dialog).resolves.toMatchObject({ name: 'My workspace', mode: 'clone' });
  });
});
