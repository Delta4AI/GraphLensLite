// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { QueryManager } from '../src/managers/query.js'
import { StaticUtilities } from '../src/utilities/static.js'

// ==========================================================================
// Categorical values containing the query-DSL grammar characters
// ( [ ] , ( ) \ ) must survive a full encodeQuery -> decodeQuery round-trip.
// Regression: bracketed "Relations detail" / prose "Evidence sample" values
// broke the auto-generated query and hid every node and edge (0/N shown).
// ==========================================================================

function makeQM() {
  for (const id of ['queryUpdateBtn', 'querySelectBtn']) {
    const btn = document.createElement('button')
    btn.id = id
    document.body.appendChild(btn)
  }
  const cache = {
    query: { valid: true, overlay: document.createElement('div') },
    uniquePropHierarchy: {
      'Edge filters': { relation: new Set(['Relations detail']) },
    },
  }
  return new QueryManager(cache)
}

// Pull every decoded STR (category) token value out of the nested instructions.
function collectCategories(instructions) {
  const out = []
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (node && node.type === 'STR') out.push(node.value)
  }
  walk(instructions)
  return out
}

describe('categorical query escaping (encode -> decode round-trip)', () => {
  let qm
  beforeEach(() => {
    document.body.innerHTML = ''
    qm = makeQM()
  })

  it('preserves bracketed, comma, paren and backslash categories exactly', () => {
    const cats = [
      'protects [B,12]; located_in [B,4]; binds [B,2]',
      'Jacob et al. (HES vs saline) [PMID 30654825]',
      'weird \\ backslash, and (paren)',
    ]
    // Build the query string exactly as updateQueryTextArea does.
    const list = cats.map((c) => StaticUtilities.escapeQueryValue(c)).join(',')
    const queryStr = `(Edge filters::relation::Relations detail IN [${list}])`

    qm.cache.query.overlay.innerHTML = qm.encodeQuery(queryStr)
    const decoded = collectCategories(qm.decodeQuery())

    expect(qm.cache.query.valid).toBe(true)
    expect(decoded).toEqual(cats)
  })
})
