// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { UIComponentManager } from '../src/managers/ui_components.js';

const PAYLOAD = '<img src=x onerror=alert(1)>';

/**
 * A cache holding one node whose label, id, description and one property are
 * all attacker-controlled — the shape an imported file can produce.
 */
function cacheWithNode(overrides = {}) {
  const propID = `${PAYLOAD}::${PAYLOAD}::${PAYLOAD}`;
  const node = {
    id: 'n1',
    label: PAYLOAD,
    description: PAYLOAD,
    D4Data: { [PAYLOAD]: { [PAYLOAD]: { [PAYLOAD]: PAYLOAD } } },
    ...overrides,
  };
  return {
    nodeRef: new Map([[node.id, node]]),
    edgeRef: new Map(),
    CFG: { SORT_TOOLTIPS: false, TOOLTIP_HIDE_NULL_VALUES: false, TOOLTIP_MAX_COLUMNS: 2 },
    data: { filterDefaults: new Map([[propID, {}]]) },
  };
}

/** Parse the tooltip HTML the way metrics.js does — a detached div. */
function parse(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

describe('buildToolTipText escapes imported text', () => {
  it('smuggles no element through label, id, description, section or property', () => {
    const cache = cacheWithNode();
    const html = new UIComponentManager(cache).buildToolTipText('n1', false);
    const div = parse(html);

    expect(div.querySelector('img')).toBeNull();
    expect(div.querySelector('.tooltip-header-title').textContent).toBe(PAYLOAD);
    expect(div.querySelector('.tooltip-description').textContent).toBe(PAYLOAD);
    expect(div.querySelector('li').textContent).toBe(`${PAYLOAD}: ${PAYLOAD}`);
  });

  it('escapes the id shown when a label is present', () => {
    const cache = cacheWithNode({ id: PAYLOAD, label: 'safe' });
    const div = parse(new UIComponentManager(cache).buildToolTipText(PAYLOAD, false));

    expect(div.querySelector('img')).toBeNull();
    expect(div.querySelector('.tooltip-header-id').textContent).toBe(`ID: ${PAYLOAD}`);
  });
});
