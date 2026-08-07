// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { QueryManager } from '../src/managers/query.js';

// ==========================================================================
// Filter and Select go `.disabled` on an invalid query but kept the title
// "Apply the query to filter the graph" — a promise the greyed button will not
// keep. The class (not the attribute) is deliberate: `.disabled[title]` keeps
// pointer events so the delegated tooltip can be read, and that tooltip is the
// only place the reason can go.
// ==========================================================================

const BASE_TITLES = {
  queryUpdateBtn: 'Apply the query to filter the graph',
  querySelectBtn: 'Apply the query to select nodes in the graph without filtering',
};

function makeQM() {
  document.body.innerHTML = '';
  for (const [id, title] of Object.entries(BASE_TITLES)) {
    const btn = document.createElement('button');
    btn.id = id;
    btn.title = title;
    document.body.appendChild(btn);
  }
  const cache = {
    query: { valid: true, overlay: document.createElement('div') },
    uniquePropHierarchy: { 'Node filters': { g: new Set(['type']) } },
  };
  return new QueryManager(cache);
}

const btn = (id) => document.getElementById(id);

describe('query action buttons while the query is invalid', () => {
  let qm;

  beforeEach(() => {
    qm = makeQM();
  });

  it('names the reason instead of the promise', () => {
    qm.encodeQuery('Node filters::g::type IN [a] AND wat');

    for (const id of Object.keys(BASE_TITLES)) {
      expect(btn(id).classList.contains('disabled')).toBe(true);
      expect(btn(id).getAttribute('aria-disabled')).toBe('true');
      expect(btn(id).title).toBe('Fix the highlighted syntax error first');
    }
  });

  it('restores each button\'s own title once the query parses again', () => {
    qm.encodeQuery('Node filters::g::type IN [a] AND wat');
    qm.cache.query.valid = true;
    qm.encodeQuery('Node filters::g::type IN [a]');

    for (const [id, title] of Object.entries(BASE_TITLES)) {
      expect(btn(id).classList.contains('disabled')).toBe(false);
      expect(btn(id).getAttribute('aria-disabled')).toBe('false');
      expect(btn(id).title).toBe(title);
    }
  });
});
