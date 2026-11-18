// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { QueryManager } from '../src/managers/query.js'
import { StaticUtilities } from '../src/utilities/static.js'

// Query text reaches the overlay's innerHTML from files (layouts.<name>.query),
// the live API and the clipboard; markup in it must stay text.

function makeQM() {
  for (const id of ['queryUpdateBtn', 'querySelectBtn']) {
    const btn = document.createElement('button')
    btn.id = id
    document.body.appendChild(btn)
  }
  const cache = {
    query: { valid: true, overlay: document.createElement('div') },
    uniquePropHierarchy: { 'Node filters': { g: new Set(['name']) }, 'Edge filters': {} },
  }
  return new QueryManager(cache)
}

describe('query overlay never renders markup from query text', () => {
  let qm
  beforeEach(() => {
    document.body.innerHTML = ''
    qm = makeQM()
  })

  it.each([
    ['plain tag', '<img/src="x"/onerror=alert`1`>'],
    ['tag posing as an encoded span', '<span/data-encoded/onmouseover=alert`1`>x</span>'],
    ['tag inside a valid query', '(Node filters::g::name IN ["a"]) <img/src=x/onerror=alert`1`>'],
  ])('%s', (_label, query) => {
    const overlay = qm.cache.query.overlay
    overlay.innerHTML = qm.encodeQuery(query)
    expect(overlay.querySelector('img')).toBeNull()
    expect(overlay.querySelector('[onmouseover], [onerror]')).toBeNull()
    expect(overlay.textContent.replace(/\u00a0/g, ' ')).toBe(query)
  })

  it('round-trips a category containing angle brackets', () => {
    const cat = '<b>bold</b> & co'
    const queryStr = `(Node filters::g::name IN [${StaticUtilities.escapeQueryValue(cat)}])`
    qm.cache.query.overlay.innerHTML = qm.encodeQuery(queryStr)
    const strs = []
    const walk = (n) => (Array.isArray(n) ? n.forEach(walk) : n?.type === 'STR' && strs.push(n.value))
    walk(qm.decodeQuery())
    expect(qm.cache.query.valid).toBe(true)
    expect(strs).toEqual([cat])
  })
})

describe('workspace dropdown', () => {
  it('shows a markup-looking workspace name as text', async () => {
    const { UIComponentManager } = await import('../src/managers/ui_components.js')
    document.body.innerHTML = '<select id="selectView"></select>'
    const evil = '</select><img src=x onerror=alert(1)>'
    const ui = new UIComponentManager({
      data: { layouts: { Default: {}, [evil]: {} }, selectedLayout: evil },
    })
    ui.buildDropdownOptions()
    const select = document.getElementById('selectView')
    expect(document.querySelector('img')).toBeNull()
    expect([...select.options].map((o) => o.text)).toEqual(['Default', evil])
    expect(select.value).toBe(evil)
  })
})
