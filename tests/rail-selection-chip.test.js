// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GraphSelectionManager } from '../src/graph/selection.js';
import { GraphCoreManager } from '../src/graph/core.js';
import { GraphLayoutManager } from '../src/graph/layout.js';
import { Popup } from '../src/utilities/popup.js';

// ==========================================================================
// Rail selection chip (Concept C phase 3): live counts, the hidden-selection
// warning (filters and selection are orthogonal — spec decision 1), and the
// workspace rename added with the chip dropdown.
// ==========================================================================

function chipDom() {
  document.body.innerHTML = `
    <div id="selectionChip">
      <strong id="selectedNodes">0</strong>
      <strong id="selectedEdges">0</strong>
      <span id="selectionHiddenWarning" style="display: none;"></span>
    </div>
    <div id="selectedElementsContainer"></div>
  `;
}

function makeSelectionCache({ nodes, edges, shownNodes, shownEdges }) {
  return {
    graph: {
      getNodeData: () => nodes,
      getEdgeData: () => edges,
    },
    nodeIDsToBeShown: new Set(shownNodes),
    edgeIDsToBeShown: new Set(shownEdges),
    selectionMemory: [{ nodes: [], edges: [] }],
    selectedMemoryIndex: 0,
    CFG: { MAX_SELECTION_MEMORY: 25 },
    ui: {
      toggleDisabledElements: vi.fn(),
      toggleStyleElementsThatRequireAtLeastOneSelectedNode: vi.fn(),
      toggleStyleElementsThatRequireAtLeastOneSelectedEdge: vi.fn(),
      toggleStyleElementsThatRequireAtLeastOneSelectedNodeOrEdge: vi.fn(),
      toggleStyleElementsThatRequireMoreThanOneSelectedNode: vi.fn(),
      toggleStyleElementsThatRequireExactlyTwoSelectedNodes: vi.fn(),
      syncStylingCardsToSelection: vi.fn(),
    },
    bs: { syncGroupRows: vi.fn() },
  };
}

function smInstance(cache) {
  const sm = Object.create(GraphSelectionManager.prototype);
  sm.cache = cache;
  return sm;
}

describe('rail selection chip via updateSelectedNodesAndEdges', () => {
  beforeEach(() => chipDom());

  it('toggles the live class and writes visible counts', async () => {
    const cache = makeSelectionCache({
      nodes: [
        { id: 'a', states: ['selected'] },
        { id: 'b', states: [] },
      ],
      edges: [{ id: 'e1', states: ['selected'] }],
      shownNodes: ['a', 'b'],
      shownEdges: ['e1'],
    });
    await smInstance(cache).updateSelectedNodesAndEdges();

    expect(document.getElementById('selectedNodes').textContent).toBe('1');
    expect(document.getElementById('selectedEdges').textContent).toBe('1');
    expect(document.getElementById('selectionChip').classList.contains('live')).toBe(true);
    expect(document.getElementById('selectionHiddenWarning').style.display).toBe('none');
  });

  it('drops the live class when nothing is selected', async () => {
    document.getElementById('selectionChip').classList.add('live');
    const cache = makeSelectionCache({
      nodes: [{ id: 'a', states: [] }],
      edges: [],
      shownNodes: ['a'],
      shownEdges: [],
    });
    await smInstance(cache).updateSelectedNodesAndEdges();

    expect(document.getElementById('selectionChip').classList.contains('live')).toBe(false);
  });

  it('warns when filters hide selected elements, keeping them selected', async () => {
    const cache = makeSelectionCache({
      nodes: [
        { id: 'a', states: ['selected'] },
        { id: 'b', states: ['selected'] }, // selected but filtered out
      ],
      edges: [{ id: 'e1', states: ['selected'] }], // filtered out too
      shownNodes: ['a'],
      shownEdges: [],
    });
    await smInstance(cache).updateSelectedNodesAndEdges();

    const warning = document.getElementById('selectionHiddenWarning');
    expect(warning.style.display).toBe('');
    expect(warning.textContent).toBe('2 hidden');
    // Visible-only counts drive actions; the hidden ones are not lost.
    expect(cache.selectedNodes).toEqual(['a']);
    expect(document.getElementById('selectedNodes').textContent).toBe('1');
  });
});

describe('chip actions', () => {
  it('clearSelection clears nodes and edges in one go', async () => {
    const sm = smInstance({});
    sm.toggleSelectionForAllNodes = vi.fn();
    sm.toggleSelectionForAllEdges = vi.fn();

    await sm.clearSelection();

    expect(sm.toggleSelectionForAllNodes).toHaveBeenCalledWith(false);
    expect(sm.toggleSelectionForAllEdges).toHaveBeenCalledWith(false);
  });

  it('focusSelection focuses nodes and edges together, no-op when empty', async () => {
    const gcm = Object.create(GraphCoreManager.prototype);
    gcm.cache = { selectedNodes: ['a'], selectedEdges: ['e1'] };
    gcm.focusElements = vi.fn();

    await gcm.focusSelection();
    expect(gcm.focusElements).toHaveBeenCalledWith(['a', 'e1']);

    gcm.cache = { selectedNodes: [], selectedEdges: [] };
    gcm.focusElements.mockClear();
    await gcm.focusSelection();
    expect(gcm.focusElements).not.toHaveBeenCalled();
  });
});

describe('GraphLayoutManager.renameSelectedLayout', () => {
  function lmInstance(cache) {
    const lm = Object.create(GraphLayoutManager.prototype);
    lm.cache = cache;
    return lm;
  }

  function makeLayoutCache(selected = 'My view') {
    return {
      data: {
        selectedLayout: selected,
        layouts: { Default: { a: 1 }, 'My view': { b: 2 } },
      },
      uiComponents: { buildDropdownOptions: vi.fn() },
      rail: { refresh: vi.fn() },
      ui: { error: vi.fn(), info: vi.fn() },
    };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('moves the layout under the new name and updates selection state', async () => {
    vi.spyOn(Popup, 'prompt').mockResolvedValue('Renamed');
    const cache = makeLayoutCache();
    await lmInstance(cache).renameSelectedLayout();

    expect(cache.data.layouts.Renamed).toEqual({ b: 2 });
    expect(cache.data.layouts['My view']).toBeUndefined();
    expect(cache.data.selectedLayout).toBe('Renamed');
    expect(cache.uiComponents.buildDropdownOptions).toHaveBeenCalled();
    expect(cache.rail.refresh).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('rejects a name that already exists', async () => {
    vi.spyOn(Popup, 'prompt').mockResolvedValue('Default');
    const cache = makeLayoutCache();
    await lmInstance(cache).renameSelectedLayout();

    expect(cache.ui.error).toHaveBeenCalled();
    expect(cache.data.selectedLayout).toBe('My view');
    vi.restoreAllMocks();
  });

  it('refuses to rename the Default workspace', async () => {
    const promptSpy = vi.spyOn(Popup, 'prompt');
    const cache = makeLayoutCache('Default');
    await lmInstance(cache).renameSelectedLayout();

    expect(cache.ui.error).toHaveBeenCalled();
    expect(promptSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
