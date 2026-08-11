// JSON Schema + renderer for the AI assistant's structured query pipeline.
//
// The model emits a structured AST instead of hand-writing GLL query strings.
// Advantages: Ollama's `format` parameter constrains the decoder so the model
// literally cannot emit an unsupported operator (=, ==, LIKE, etc.), and the
// renderer turns the AST into a guaranteed-valid query string.
//
// Scope rule (implemented as a connector-level lint — NOT a query-level
// constraint, because GLL itself is more permissive than the old system
// prompt suggested):
//   - Every leaf has a scope derived from its field prefix (Node filters::…
//     or Edge filters::…).
//   - `AND` and `NOT` between disjoint scopes are guaranteed-empty per GLL's
//     per-element evaluation semantics, so we reject them with a clear error
//     (the generator's retry loop then repairs).
//   - `OR` across scopes is fine and useful: each element matches its own
//     side independently. The user's "one big OR" pattern (node clauses ∪
//     edge clauses) lives here.

const FIELD_PATTERN = '^(Node filters|Edge filters)::[^:]+::[^:]+$'

// Flatten the 3-level hierarchy into a list of fully-qualified field paths.
// Anything outside the two known sections is dropped — the schema's `field`
// is constrained to those two prefixes and the renderer rejects others.
export function flattenHierarchy(hierarchy) {
  if (!hierarchy || typeof hierarchy !== 'object') return []
  const paths = []
  for (const section of ['Node filters', 'Edge filters']) {
    const subs = hierarchy[section]
    if (!subs || typeof subs !== 'object') continue
    for (const [sub, props] of Object.entries(subs)) {
      if (!props || typeof props !== 'object') continue
      for (const prop of Object.keys(props)) {
        paths.push(`${section}::${sub}::${prop}`)
      }
    }
  }
  return paths
}

// Schema object handed to Ollama via the `format` parameter. Scope is NOT a
// top-level field — field prefixes are authoritative. A `title` still helps
// the UI label each suggestion.
//
// This static schema is the safe fallback: it constrains `field` to the
// Section::Group::Name SHAPE via a regex pattern. The real harness uses
// `buildQuerySchema(hierarchy)` instead, which swaps the pattern for an
// `enum` of the actual valid paths so the decoder physically cannot emit a
// property that doesn't exist in the current graph.
export const QUERY_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    queries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: {type: 'string'},
          expr: {$ref: '#/$defs/Expr'},
        },
        required: ['title', 'expr'],
      },
    },
  },
  required: ['queries'],
  $defs: {
    Expr: {
      type: 'object',
      properties: {
        kind: {enum: ['condition', 'binary']},
        field: {type: 'string', pattern: FIELD_PATTERN},
        // ↑ shape only. `buildQuerySchema` replaces this with an `enum` of
        // real paths drawn from the current graph's hierarchy.
        op: {enum: ['BETWEEN', 'LT_OR_GT', 'IN', 'IS_TRUE', 'IS_FALSE']},
        min: {type: 'number'},
        max: {type: 'number'},
        lt: {type: 'number'},
        gt: {type: 'number'},
        values: {type: 'array', items: {type: 'string'}, minItems: 1},
        bop: {enum: ['AND', 'OR', 'NOT']},
        left: {$ref: '#/$defs/Expr'},
        right: {$ref: '#/$defs/Expr'},
      },
      required: ['kind'],
    },
  },
}

class QueryShapeError extends Error {}

// Compute the set of scopes reachable from an expr subtree.
// Returns a Set with zero, one, or both of 'node', 'edge'.
function scopesOf(expr) {
  if (!expr || typeof expr !== 'object') return new Set()
  if (expr.kind === 'condition') {
    if (typeof expr.field !== 'string') return new Set()
    if (expr.field.startsWith('Node filters::')) return new Set(['node'])
    if (expr.field.startsWith('Edge filters::')) return new Set(['edge'])
    return new Set()
  }
  if (expr.kind === 'binary') {
    return new Set([...scopesOf(expr.left), ...scopesOf(expr.right)])
  }
  return new Set()
}

function intersects(a, b) {
  for (const x of a) if (b.has(x)) return true
  return false
}

// Walk the tree, rejecting cross-scope AND/NOT at any depth. OR is always
// permitted because it matches each element against its own-scope leaves
// and lets the other-scope leaves safely short-circuit to false.
function lintExpr(expr) {
  if (!expr || typeof expr !== 'object') return
  if (expr.kind !== 'binary') return
  lintExpr(expr.left)
  lintExpr(expr.right)
  if (expr.bop !== 'AND' && expr.bop !== 'NOT') return
  const ls = scopesOf(expr.left)
  const rs = scopesOf(expr.right)
  // Non-empty scope sets that don't overlap → the operation can never be
  // true for any element.
  if (ls.size > 0 && rs.size > 0 && !intersects(ls, rs)) {
    throw new QueryShapeError(
      `${expr.bop} between disjoint scopes (${[...ls].join('+')} on the left, ${[...rs].join('+')} on the right) is guaranteed to return zero results. Use OR, or split into two queries.`
    )
  }
}

function renderNumber(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new QueryShapeError(`expected finite number, got: ${n}`)
  }
  return String(n)
}

function assertFieldShape(field) {
  if (typeof field !== 'string') throw new QueryShapeError('condition.field must be a string')
  if (!field.startsWith('Node filters::') && !field.startsWith('Edge filters::')) {
    throw new QueryShapeError(`field "${field}" must start with "Node filters::" or "Edge filters::"`)
  }
  const parts = field.split('::')
  if (parts.length !== 3 || !parts[1] || !parts[2]) {
    throw new QueryShapeError(`field "${field}" must be Section::Group::PropertyName`)
  }
}

function renderCondition(cond) {
  const {field, op} = cond
  assertFieldShape(field)

  if (op === 'BETWEEN') {
    return `${field} BETWEEN ${renderNumber(cond.min)} AND ${renderNumber(cond.max)}`
  }
  if (op === 'LT_OR_GT') {
    return `${field} LOWER THAN ${renderNumber(cond.lt)} OR GREATER THAN ${renderNumber(cond.gt)}`
  }
  if (op === 'IN') {
    if (!Array.isArray(cond.values) || cond.values.length === 0) {
      throw new QueryShapeError('IN values must be a non-empty array')
    }
    const rendered = cond.values.map(v => {
      if (typeof v !== 'string') throw new QueryShapeError('IN values must be strings')
      if (v.includes(',') || v.includes('[') || v.includes(']')) {
        throw new QueryShapeError(`IN value "${v}" contains reserved character (, [ ])`)
      }
      return v.trim()
    })
    return `${field} IN [${rendered.join(', ')}]`
  }
  if (op === 'IS_TRUE') return `${field} IS TRUE`
  if (op === 'IS_FALSE') return `${field} IS FALSE`
  throw new QueryShapeError(`unknown condition.op: ${op}`)
}

function renderBinary(node) {
  const {bop, left, right} = node
  if (!['AND', 'OR', 'NOT'].includes(bop)) {
    throw new QueryShapeError(`unknown binary.bop: ${bop}`)
  }
  return `(${renderExpr(left)}) ${bop} (${renderExpr(right)})`
}

function renderExpr(expr) {
  if (!expr || typeof expr !== 'object') throw new QueryShapeError('expr must be an object')
  if (expr.kind === 'condition') return renderCondition(expr)
  if (expr.kind === 'binary') return renderBinary(expr)
  throw new QueryShapeError(`unknown expr.kind: ${expr.kind}`)
}

// Render one {expr} query. The top-level expression is always wrapped in a
// single pair of parentheses so the output stays consistent with the format
// the query editor shows by default (matches the LT_OR_GT parenthesisation
// rule and is neutral for everything else).
function renderSingleQuery(query) {
  if (!query || typeof query !== 'object') {
    throw new QueryShapeError('query must be an object')
  }
  lintExpr(query.expr)
  const inner = renderExpr(query.expr)
  // If the top-level is already a binary, it's already parenthesised on both
  // sides; no extra wrap needed.
  if (query.expr?.kind === 'binary') return inner
  return `(${inner})`
}

// Classify the effective scope of a rendered query for the UI label. When
// an expr touches both scopes (legal cross-scope OR), we report "mixed".
function effectiveScope(expr) {
  const s = scopesOf(expr)
  if (s.has('node') && s.has('edge')) return 'mixed'
  if (s.has('node')) return 'node'
  if (s.has('edge')) return 'edge'
  return null
}

// Render the model's response envelope into UI-ready entries. Errors are
// surfaced per-query so one malformed entry does not nuke a valid sibling.
export function renderQueries(response) {
  if (!response || !Array.isArray(response.queries)) {
    throw new QueryShapeError('response.queries must be an array')
  }
  const out = []
  for (const [idx, q] of response.queries.entries()) {
    try {
      out.push({
        title: typeof q.title === 'string' && q.title.trim() ? q.title.trim() : `Query ${idx + 1}`,
        scope: effectiveScope(q?.expr),
        text: renderSingleQuery(q),
      })
    } catch (err) {
      out.push({
        title: typeof q?.title === 'string' ? q.title : `Query ${idx + 1}`,
        scope: effectiveScope(q?.expr),
        text: null,
        error: err instanceof QueryShapeError ? err.message : String(err?.message ?? err),
      })
    }
  }
  return out
}

// Kept public for tests.
export function renderAst(query) {
  return renderSingleQuery(query)
}

// Build a schema variant whose `field` is constrained to an `enum` of the
// real Section::Group::Name paths in the current graph. When passed via
// Ollama's `format` parameter, the decoder cannot sample any field path
// outside this list — the "model invented a property name" failure becomes
// structurally impossible.
//
// Falls back to the static (pattern-only) schema when the hierarchy is
// missing or empty, so a pre-init graph state doesn't block generation.
export function buildQuerySchema(hierarchy) {
  const paths = flattenHierarchy(hierarchy)
  if (paths.length === 0) return QUERY_RESPONSE_SCHEMA
  const schema = JSON.parse(JSON.stringify(QUERY_RESPONSE_SCHEMA))
  const fieldSchema = schema.$defs.Expr.properties.field
  delete fieldSchema.pattern
  fieldSchema.enum = paths
  return schema
}

export {QueryShapeError, scopesOf, effectiveScope}
