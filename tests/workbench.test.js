// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initWorkbench, TAB_NAMES } from '../src/managers/workbench.js';

// ==========================================================================
// The workbench (Concept C phase 5): four tabs over one bottom surface that
// occludes the stage and never the inspector. The load-bearing property is
// that no tab can close another — the old bottom bar let Query and Data
// silently evict each other, and the assistant was a fifth panel entirely.
// ==========================================================================

function workbenchDom() {
  document.body.innerHTML = `
    <div id="outerGraphContainer" style="height: 800px">
      <div id="innerGraphContainer"></div>
      <section id="workbench" hidden>
        <div class="resize-handle"></div>
        <div class="panel-header">
          <span id="workbenchTitle"></span>
          <div class="query-buttons"></div>
          <div class="data-buttons" style="display: none;"></div>
          <div class="assistant-buttons" style="display: none;"></div>
          <button id="workbenchHelpBtn"></button>
          <button id="workbenchExpandBtn" aria-pressed="false">⤢</button>
          <button id="workbenchCloseBtn"></button>
        </div>
        <div class="wb-content">
          <div id="queryEditor" class="wb-pane"></div>
          <div id="dataEditor" class="wb-pane" hidden></div>
          <div id="metricsContainer" class="wb-pane" hidden></div>
          <div id="assistantPane" class="wb-pane" hidden></div>
        </div>
      </section>
    </div>
    <button id="dataToggleBtn"></button>
    <button id="queryToggleBtn"></button>
    <button id="metricsToggleBtn"></button>
    <button id="assistantToggleBtn"></button>
    <button class="add-to-query-button"></button>
  `;
}

function makeCache() {
  return {
    graph: { resize: vi.fn() },
    ui: { debug: vi.fn() },
    qm: { showQueryHelp: vi.fn() },
    dataTable: { help: vi.fn() },
    metrics: { setWorkbenchVisible: vi.fn() },
    assistant: { setWorkbenchVisible: vi.fn() },
  };
}

const paneOf = { data: 'dataEditor', query: 'queryEditor', metrics: 'metricsContainer', assistant: 'assistantPane' };
const visible = (tab) => !document.getElementById(paneOf[tab]).hasAttribute('hidden');
const highlighted = (id) => document.getElementById(id).classList.contains('highlight');

describe('workbench tabs', () => {
  let cache;
  let wb;

  beforeEach(() => {
    window.localStorage.clear();
    workbenchDom();
    cache = makeCache();
    wb = initWorkbench(cache);
  });

  it('returns null in DOMs without the workbench markup', () => {
    document.body.innerHTML = '<div></div>';
    expect(initWorkbench(makeCache())).toBeNull();
  });

  it('starts closed', () => {
    expect(wb.isOpen).toBe(false);
    expect(document.getElementById('workbench').hasAttribute('hidden')).toBe(true);
  });

  it('opens on the requested tab and titles itself', () => {
    wb.show('query');
    expect(wb.isOpen).toBe(true);
    expect(visible('query')).toBe(true);
    expect(document.getElementById('workbenchTitle').textContent).toBe('Query Editor');
    expect(highlighted('queryToggleBtn')).toBe(true);
  });

  it('shows exactly one pane at a time, for every tab', () => {
    for (const tab of TAB_NAMES) {
      wb.show(tab);
      expect(TAB_NAMES.filter(visible)).toEqual([tab]);
      expect(TAB_NAMES.filter((t) => highlighted(`${t}ToggleBtn`))).toEqual([tab]);
    }
  });

  it('switching tabs never closes the workbench', () => {
    wb.show('query');
    wb.show('data');
    expect(wb.isOpen).toBe(true);
    expect(wb.tab).toBe('data');
  });

  it('toggle() closes only when the same tab is already up', () => {
    wb.toggle('query');
    expect(wb.isTabOpen('query')).toBe(true);
    wb.toggle('data'); // different tab — switches, does not close
    expect(wb.isOpen).toBe(true);
    expect(wb.tab).toBe('data');
    wb.toggle('data'); // same tab — closes
    expect(wb.isOpen).toBe(false);
  });

  it('close() drops every rail highlight', () => {
    wb.show('metrics');
    wb.close();
    expect(TAB_NAMES.some((t) => highlighted(`${t}ToggleBtn`))).toBe(false);
  });

  it('swaps the tab-scoped toolbar with the tab', () => {
    wb.show('query');
    expect(document.querySelector('.query-buttons').style.display).toBe('flex');
    expect(document.querySelector('.data-buttons').style.display).toBe('none');
    wb.show('data');
    expect(document.querySelector('.query-buttons').style.display).toBe('none');
    expect(document.querySelector('.data-buttons').style.display).toBe('flex');
  });

  it('routes the help button to the open tab, and hides it where there is no help', () => {
    const help = document.getElementById('workbenchHelpBtn');
    wb.show('query');
    help.onclick();
    expect(cache.qm.showQueryHelp).toHaveBeenCalled();
    wb.show('data');
    help.onclick();
    expect(cache.dataTable.help).toHaveBeenCalled();
    wb.show('metrics');
    expect(help.hidden).toBe(true);
  });

  it('reveals the add-to-query affordances only for the query tab', () => {
    const btn = document.querySelector('.add-to-query-button');
    wb.show('query');
    expect(btn.classList.contains('show')).toBe(true);
    wb.show('data');
    expect(btn.classList.contains('show')).toBe(false);
    wb.show('query');
    wb.close();
    expect(btn.classList.contains('show')).toBe(false);
  });
});

describe('workbench visibility hooks', () => {
  let cache;
  let wb;

  beforeEach(() => {
    window.localStorage.clear();
    workbenchDom();
    cache = makeCache();
    wb = initWorkbench(cache);
  });

  it('tells metrics when its tab appears and disappears', () => {
    wb.show('metrics');
    expect(cache.metrics.setWorkbenchVisible).toHaveBeenLastCalledWith(true);
    wb.show('query');
    expect(cache.metrics.setWorkbenchVisible).toHaveBeenLastCalledWith(false);
  });

  it('tells the assistant when its tab is closed outright', () => {
    wb.show('assistant');
    expect(cache.assistant.setWorkbenchVisible).toHaveBeenLastCalledWith(true);
    wb.close();
    expect(cache.assistant.setWorkbenchVisible).toHaveBeenLastCalledWith(false);
  });

  it('does not notify a manager whose tab was never open', () => {
    wb.show('query');
    wb.close();
    expect(cache.metrics.setWorkbenchVisible).not.toHaveBeenCalled();
    expect(cache.assistant.setWorkbenchVisible).not.toHaveBeenCalled();
  });

  it('resizes the renderer whenever the stage area changes', () => {
    wb.show('query');
    wb.close();
    expect(cache.graph.resize).toHaveBeenCalledTimes(2);
  });
});

describe('workbench height', () => {
  let wb;

  beforeEach(() => {
    window.localStorage.clear();
    workbenchDom();
    wb = initWorkbench(makeCache());
  });

  it('remembers a height per tab', () => {
    window.localStorage.setItem(
      'gll.workbench.heights',
      JSON.stringify({ query: 200, data: 500 })
    );
    const fresh = initWorkbench(makeCache());
    fresh.show('query');
    expect(fresh.el.style.height).toBe('200px');
    fresh.show('data');
    expect(fresh.el.style.height).toBe('500px');
  });

  it('falls back to a default for a tab with no remembered height', () => {
    wb.show('metrics');
    expect(parseInt(wb.el.style.height, 10)).toBeGreaterThan(0);
  });

  it('survives a corrupt stored value instead of refusing to open', () => {
    window.localStorage.setItem('gll.workbench.heights', 'not json');
    const fresh = initWorkbench(makeCache());
    expect(() => fresh.show('query')).not.toThrow();
    expect(fresh.isOpen).toBe(true);
  });

  it('⤢ expands and restores, and reports its state', () => {
    wb.show('query');
    const restored = wb.el.style.height;
    wb.toggleExpanded();
    const btn = document.getElementById('workbenchExpandBtn');
    expect(wb.expanded).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(parseInt(wb.el.style.height, 10)).toBeGreaterThan(parseInt(restored, 10));
    wb.toggleExpanded();
    expect(wb.expanded).toBe(false);
    expect(wb.el.style.height).toBe(restored);
  });

  it('does not carry expansion into the next tab it opens', () => {
    // close() left `expanded` set, so reopening ANY tab took the whole stage
    // and the canvas disappeared with no ⤢ state to explain it.
    wb.show('query');
    wb.toggleExpanded();
    const expandedHeight = parseInt(wb.el.style.height, 10);
    wb.close();

    expect(wb.expanded).toBe(false);
    expect(document.getElementById('workbenchExpandBtn').getAttribute('aria-pressed')).toBe(
      'false'
    );

    wb.show('metrics');
    expect(parseInt(wb.el.style.height, 10)).toBeLessThan(expandedHeight);
  });
});
