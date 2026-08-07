# Graph Lens Lite — Payload Reference

Build the JSON your application `POST`s to Graph Lens Lite (GLL) so it renders a
**meaningful, analysable** graph: nodes and edges, plus labels, styling,
**filters** (from your data), and **bubble groups**.

This is the payload contract only. Running, configuring, and deploying the
server you POST to lives in **[SERVICE.md](SERVICE.md)**.

The payload is the native GLL JSON format — the exact shape produced by
**Export → JSON** and accepted by **File → Open**. Anything the desktop app can
build, a payload can express. When unsure about an advanced shape, build it once
in the app, export it, and copy the result.

---

## Rules for a robust payload

Read these first — they are the whole game.

1. **Only `nodes` and `edges` are required.** Everything else is optional; GLL
   reconstructs headers, filters, and layout from the node/edge data when absent.
2. **Recommended fields fail gracefully.** A wrong colour, size, or attribute is
   ignored, never fatal. You can generate them with confidence.
3. **One thing can blank the whole graph: a malformed `query`.** It is not
   ignored — it throws and the entire graph fails to render. **Never
   hand-author or generate a `query`** (§10). Almost nothing else can break a
   render.
4. **To make a graph analysable, attach data via `D4Data` (§6).** Every property
   you attach becomes an interactive filter. A flat `{id, label}` graph renders
   but offers nothing to explore.
5. **To show a subset, send only those nodes.** Per-node `visibility: hidden` is
   not a reliable hide-on-load control through the API (§4).
6. **Don't compute metrics into the data.** Centrality and PageRank are derived
   by GLL from the topology at render time — don't put them in `D4Data` (§6).
7. **For advanced view state, export — don't author.** Pre-set filters, saved
   queries, and custom layout algorithms are runtime-serialized; build them in
   the desktop app and **Export → JSON** (§10).

### The three tiers

| Tier | What it covers | Safety |
| ---- | -------------- | ------ |
| **Recommended** (§4–§7) | `nodes`/`edges`, styling, labels, `D4Data` filters, bubble groups | Safe to generate. Build every payload from here. |
| **Optional** (§8–§9) | Fixed coordinates, hiding disconnected nodes | Safe. Omit freely; setting them won't break anything. |
| **Advanced** (§10) | Pre-set filter state, saved queries, custom layout algorithms, per-view style overrides | Error-prone. Use only when necessary, and prefer **Export → JSON** over hand-authoring. |

---

## 1. Quickstart

```bash
TOKEN=your-token
curl -X POST http://127.0.0.1:7637/api/graph \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nodes":[{"id":"A"},{"id":"B"}],"edges":[{"source":"A","target":"B"}]}'
# → {"success":true,"nodes":2,"edges":1,"subscribers":1}
```

The body replaces the current graph and pushes it live to every connected
viewer. Minimum accepted body: a JSON object with `nodes` and `edges` arrays.

---

## 2. Request & responses

```
POST http://<host>:<port>/api/graph[?session=<id>]
Authorization: Bearer <GLL_API_TOKEN>
Content-Type: application/json
```

| Status | Meaning                                                                            |
| ------ | ---------------------------------------------------------------------------------- |
| `200`  | `{ "success": true, "session": "<id>", "nodes": N, "edges": M, "subscribers": K }` |
| `400`  | Body is not valid JSON, **or** the `session` id is malformed (see §2.1).            |
| `401`  | Missing or invalid bearer token.                                                   |
| `403`  | Request carried an `Origin` header (browser CSRF defence).                         |
| `413`  | Body exceeds the max body size (25 MB default).                                    |
| `422`  | JSON is valid but missing `nodes`/`edges` arrays.                                  |

> Read the current graph back with `GET /api/graph[?session=<id>]` (no auth). See
> [SERVICE.md](SERVICE.md#endpoints).

### 2.1 Sessions (multi-tenant handoff)

By default every caller shares **one** live graph: a POST replaces it and pushes
to every connected viewer. To give independent callers their own isolated graph,
pass a `session` query param consistently on **all three** endpoints:

```
POST /api/graph?session=<id>      # writes that session's graph
GET  /api/graph?session=<id>      # reads it back
GET  /api/events?session=<id>     # SSE stream scoped to that session
```

- **Id format:** 1–64 characters from `A–Z a–z 0–9 _ -`. Anything else → `400`.
- **Omitted / empty `session`** → the implicit `"default"` session, i.e. the
  original single-graph behaviour. Existing callers need no changes.
- **The producer owns the id.** Generate one (e.g. `crypto.randomUUID()`),
  POST with it, then open the viewer at `/?session=<id>` so the viewer
  subscribes to the matching stream. (Same handoff shape as OntoloViz.)
- **Bounded:** the server holds at most a fixed number of sessions
  (`MAX_SESSIONS`, 64) and evicts least-recently-used ones — preferring sessions
  with no connected viewer. The global live-viewer cap (100) spans all sessions.

---

## 3. Payload envelope

```jsonc
{
  "nodes": [ /* Node[]  — required, see §4 */ ],
  "edges": [ /* Edge[]  — required, see §5 */ ],

  // ── optional ──────────────────────────────────────────────────────────────
  "nodeDataHeaders": [ /* declares which filters appear — see §6 */ ],
  "edgeDataHeaders": [ /* declares which filters appear — see §6 */ ],
  "layouts":         { /* bubble groups (§7), hide-dangling (§9), advanced state (§10) */ },
  "selectedLayout":  "Default"   /* which named view to show on load */
}
```

There is **no `version` field** — it is neither written nor checked. A `stash`
key, if sent, is ignored.

---

# Part A — Recommended

Everything here is safe to generate programmatically.

## 4. Nodes

A node is an object. Only `id` is required; everything else tunes appearance and
attaches data.

| Field         | Type            | Default      | Meaning                                                            |
| ------------- | --------------- | ------------ | ------------------------------------------------------------------ |
| `id`          | string          | **required** | Unique identifier. Duplicate ids are skipped with a warning.       |
| `label`       | string          | _(id shown)_ | Display text. Drives tooltips and label rendering.                 |
| `description` | string          | —            | Tooltip text shown on hover.                                       |
| `type`        | string          | `"hexagon"`  | Shape: `circle`, `diamond`, `hexagon`, `rect`, `triangle`, `star`. |
| `style`       | object          | —            | Visual styling — see below.                                        |
| `D4Data`      | object          | —            | Data attributes that define filters — see §6.                      |

### `node.style` — appearance

| Path        | Type            | Default     | Meaning                               |
| ----------- | --------------- | ----------- | ------------------------------------- |
| `size`      | number          | `20`        | Node radius / half-size.              |
| `fill`      | hex (`#rrggbb`) | `"#C33D35"` | Fill colour.                          |
| `stroke`    | hex or `null`   | `null`      | Border colour. `null` = no border.    |
| `lineWidth` | number          | `1`         | Border width (px).                    |
| `x` / `y`   | number          | —           | Fixed coordinates — optional, see §8. |

> **Showing a subset:** to start with only some nodes on screen, **send only
> those nodes**. A per-node `style.visibility: "hidden"` is kept in the data
> model but the initial render re-shows every node that passes the active
> filters, so it is **not** a reliable hide-on-load control through the API.

### `node.style` — label

Applies when the node has a `label` (and labels aren't auto-hidden, which happens
above ~1000 nodes). Set any subset; unset fields fall back to the defaults below.

| Path                    | Type            | Default     | Meaning                                                                 |
| ----------------------- | --------------- | ----------- | ----------------------------------------------------------------------- |
| `labelText`             | string          | `label`     | Rendered text (normally derived from `label`).                          |
| `labelFontSize`         | number          | `12`        | Font size (pt).                                                         |
| `labelFill`             | hex             | `"#000000"` | Text colour.                                                            |
| `labelPlacement`        | string          | `"bottom"`  | `top`/`bottom`/`left`/`right`/`center` + corner variants (`top-right`). |
| `labelBackground`       | boolean         | `false`     | Draw a filled pill behind the label.                                    |
| `labelBackgroundFill`   | hex or `null`   | `null`      | Pill colour (when `labelBackground` is true).                           |
| `labelBackgroundRadius` | number          | `5`         | Pill corner radius (px).                                                |
| `labelPadding`          | number          | `2`         | Pill inner padding (px).                                                |
| `labelOffsetX`          | number          | `0`         | Horizontal offset from anchor.                                          |
| `labelOffsetY`          | number          | `0`         | Vertical offset from anchor.                                            |
| `labelMaxLines`         | number          | `1`         | Lines before truncation.                                                |
| `labelMaxWidth`         | string\|number  | `"200%"`    | Max width (CSS value or % of node size).                                |
| `labelWordWrap`         | boolean         | `false`     | Wrap long text.                                                         |
| `labelTextAlign`        | string          | `"middle"`  | Text alignment.                                                         |

---

## 5. Edges

An edge is an object. `source` and `target` are required and must match node
`id`s.

| Field         | Type   | Default                | Meaning                                                   |
| ------------- | ------ | ---------------------- | --------------------------------------------------------- |
| `source`      | string | **required**           | `id` of the source node.                                  |
| `target`      | string | **required**           | `id` of the target node.                                  |
| `id`          | string | `"<source>::<target>"` | Explicit edge id. Auto-generated if omitted.              |
| `label`       | string | —                      | Display text along the edge.                              |
| `description` | string | —                      | Tooltip text.                                             |
| `type`        | string | `"line"`               | `line` (straight); also `cubic`, `quadratic`, `polyline`. **Note:** since the Sigma renderer, `polyline` renders as a curve (same as `cubic`/`quadratic`). |
| `style`       | object | —                      | Visual styling — see below.                               |
| `D4Data`      | object | —                      | Data attributes that define filters — see §6.             |

### `edge.style` — line, arrows, halo, flow

| Path             | Type    | Default       | Meaning                                              |
| ---------------- | ------- | ------------- | ---------------------------------------------------- |
| `stroke`         | hex     | `"#403C5390"` | Line colour (last 2 hex digits = alpha).             |
| `lineWidth`      | number  | `0.75`        | Line thickness (px).                                 |
| `lineDash`       | number  | `0`           | Dash length. **Note:** kept in the data model and round-trips through export, but the Sigma renderer draws all edges solid (dashes are not rendered in v1). |
| `startArrow`     | boolean | `false`       | End marker at the source end.                        |
| `startArrowType` | string  | `"arrow"`     | `arrow`/`rect`/`diamond`/`circle`/`tee` (⊣ inhibition bar). Legacy G6 names still load and round-trip unchanged (`triangle`/`vee`/`simple` → arrow, `triangleRect`/`square` → rect). |
| `startArrowSize` | number  | `8`           | Source marker length (graph px). Unset/0 → sized proportionally to the line width. |
| `startArrowColor`       | hex    | `null` | Source marker fill. `null` → inherits the edge stroke colour. |
| `startArrowBorderColor` | hex    | `null` | Source marker border colour. `null` → no border (transparent). |
| `startArrowBorderSize`  | number | `0`    | Source marker border thickness (px). `0` → auto (~20% of the marker). |
| `endArrow`       | boolean | `false`       | End marker at the target end.                        |
| `endArrowType`   | string  | `"arrow"`     | Same enum as `startArrowType`.                       |
| `endArrowSize`   | number  | `8`           | Target marker length (graph px).                     |
| `endArrowColor`       | hex    | `null` | Target marker fill. `null` → inherits the edge stroke colour. |
| `endArrowBorderColor` | hex    | `null` | Target marker border colour. `null` → no border (transparent). |
| `endArrowBorderSize`  | number | `0`    | Target marker border thickness (px). `0` → auto (~20% of the marker). |
| `halo`           | boolean | `false`       | Glow drawn under the edge (total width = line + 2 × `haloLineWidth`), on straight and curved edges. Selecting an edge widens line and halo together. |
| `haloStroke`     | hex     | `"#403C53"`   | Halo colour.                                         |
| `haloLineWidth`  | number  | `3`           | Halo thickness (px).                                 |
| `flow`           | boolean | `false`       | Enable the animated source→target flow overlay.      |
| `flowType`       | string  | `"dash"`      | `dash` / `pulse` / `comet` / `chevron`.              |
| `flowSpeed`      | number  | `1`           | Animation speed multiplier.                          |
| `flowStroke`     | hex     | `null`        | Flow colour. `null` → derived from the edge stroke (lightened). |
| `flowOpacity`    | number  | `1`           | Multiplies into the overlay colour's alpha (0–1).    |
| `flowDensity`    | number  | `1`           | Scales the pattern period (higher = sparser dashes/dots). |

Edge labels use the same `label*` fields as nodes (§4), with edge-specific
defaults: `labelPlacement` defaults to `"center"` (`start`/`center`/`end`),
`labelAutoRotate` (boolean, follows edge direction), `labelOffsetX` `4`.

---

## 6. Filters — data attributes (`D4Data`)

This is how you make a graph **analysable**. Every property you attach via
`D4Data` automatically becomes a filter control in the panel: a **range slider**
for numbers, a **category dropdown** for text. Users then filter interactively.

### Structure

`D4Data` is a fixed three-level nesting:

```jsonc
"D4Data": {
  "<section>": {        // MUST be "Node filters" for nodes, "Edge filters" for edges
    "<subGroup>": {     // a grouping label you choose, e.g. "Metrics", "Org"
      "<property>": <value>   // string | number
    }
  }
}
```

- **section** — the top-level key **must** be the literal string `"Node filters"`
  on nodes and `"Edge filters"` on edges. Any other section key is silently
  ignored by the filter engine.
- **subGroup** — a grouping label you choose. Use `"Uncategorized Properties"`
  if you have no grouping.
- **property** — the attribute name.
- **value** — a `number` (→ range slider) or a `string` (→ category filter).

### Value rules

- **Numeric vs categorical** is auto-detected per property: numbers (and numeric
  strings like `"3.14"`) become sliders; other strings become category filters.
- **Multiple categories** on one property: join with `|`. `"high|medium"` becomes
  two categories, `high` and `medium`.
- **Do not mix types** for the same property across items. If a property is
  numeric on one node and a string on another, GLL drops it from filtering.

### Declaring which filters appear (`nodeDataHeaders` / `edgeDataHeaders`)

Headers tell GLL which `(subGroup, property)` pairs to surface as filter controls
and in what order. Each entry is exactly `{ "subGroup": "<subGroup>", "key":
"<property>" }`.

> Headers are **optional** — if omitted, GLL derives the filters by scanning
> every node's/edge's `D4Data`. Send them when you want a guaranteed set/order of
> controls, or to surface a property that only some nodes carry.

### Filterable node — complete example

```jsonc
{
  "id": "node-001",
  "label": "Acme Corp",
  "D4Data": {
    "Node filters": {
      "Metrics": {
        "Score": 4.7,            // numeric → range slider
        "Risk":  "high|medium"   // categorical → two categories
      },
      "Org": {
        "Region": "EMEA"
      }
    }
  }
}
```

Matching headers (optional, for explicit ordering):

```jsonc
"nodeDataHeaders": [
  { "subGroup": "Metrics", "key": "Score"  },
  { "subGroup": "Metrics", "key": "Risk"   },
  { "subGroup": "Org",     "key": "Region" }
]
```

Internally these become the filter keys `Node filters::Metrics::Score`,
`Node filters::Metrics::Risk`, and `Node filters::Org::Region` — the
`section::subGroup::property` path form you'll see again in §7 and §10.

> **Metrics are not data.** Degree/betweenness/closeness/eigenvector centrality
> and PageRank are computed by GLL from the topology at render time. Do not put
> them in `D4Data`.

---

## 7. Bubble groups

Bubble groups draw a coloured, labelled outline around a set of nodes. There are
exactly **four** named groups: `groupOne`, `groupTwo`, `groupThree`, `groupFour`.

Group data lives **inside a layout entry** under `layouts`, but you only need the
group fields — none of the advanced state from §10. Each group has two
independent membership mechanisms, combined at render time:

- **Manual** — `group<N>ManualMembers`: an array of node `id`s, always included.
- **Property-based** — `group<N>Props`: an array of filter keys
  (`section::subGroup::property`, §6); every visible node carrying a matching
  property is included dynamically, tracking filter changes.

Per-group appearance is set under `bubbleSetStyle.<group>`. Send only the fields
you want to change; the rest inherit defaults.

### Example — outline nodes A and B as "My Cluster"

```jsonc
{
  "nodes": [ { "id": "A" }, { "id": "B" }, { "id": "C" } ],
  "edges": [ { "source": "A", "target": "B" }, { "source": "B", "target": "C" } ],
  "layouts": {
    "Default": {
      "groupOneManualMembers": ["A", "B"],
      "groupOneProps": [],
      "bubbleSetStyle": {
        "groupOne": {
          "fill": "#403C53",
          "fillOpacity": 0.25,
          "stroke": "#C33D35",
          "label": true,
          "labelText": "My Cluster",
          "labelFill": "#ffffff",
          "labelBackground": true,
          "labelBackgroundFill": "#403C53"
        }
      }
    }
  },
  "selectedLayout": "Default"
}
```

To group by data instead of by id, use `groupOneProps` — e.g.
`["Node filters::Status::State"]` outlines every node carrying that property
(handy with §6 categorical values).

Useful `bubbleSetStyle.<group>` fields: `fill`, `fillOpacity`, `stroke`,
`strokeOpacity`, `padding`, `corridor`, `avoidance`, `label` (boolean), `labelText`,
`labelFill`, `labelFontSize`, `labelBackground`, `labelBackgroundFill`,
`labelBackgroundRadius`, `labelPlacement`.

---

# Part B — Optional, safe

Optional knobs you can set by hand without risk. Omit them and the graph still
renders and filters fine; set them and nothing breaks.

## 8. Fixed positions (coordinates)

To pin nodes instead of running a layout algorithm, set **both** `style.x` and
`style.y` on each node. GLL switches the active layout to `"custom"` and places
nodes exactly there.

```jsonc
{
  "nodes": [
    { "id": "A", "style": { "x": 150, "y": 150 } },
    { "id": "B", "style": { "x": 600, "y": 150 } }
  ],
  "edges": [ { "source": "A", "target": "B" } ]
}
```

Setting only one of `x`/`y` has no effect. **Prefer omitting coordinates** and
letting GLL auto-layout (force-directed) — a generated layout is usually better
than hand-picked coordinates, and you avoid overlap/scaling mistakes. Supply
positions only when you have a genuinely meaningful arrangement to preserve.

## 9. Hide disconnected ("dangling") nodes

Set `hideDisconnectedNodes: true` on a named view to start with every node that
has no visible edge hidden:

```jsonc
{
  "nodes": [ { "id": "A" }, { "id": "B" }, { "id": "C" } ],
  "edges": [ { "source": "A", "target": "B" } ],
  "layouts": { "Default": { "hideDisconnectedNodes": true } },
  "selectedLayout": "Default"
}
```

Here `C` (no edges) loads hidden; `A` and `B` show. Users can toggle this from
the viewer at any time.

---

# Part C — Advanced & error-prone

Verbose view/session state that is **easy to get wrong**. Use it **only when you
explicitly need it and there's no simpler way**. Don't hand-author it: build the
view in the desktop app and **Export → JSON**, then copy the result.

## 10. Saved view state — filters, queries, custom layouts

Beyond the safe `hideDisconnectedNodes` toggle, a named view (`layouts.<name>`)
can carry pre-applied **filter state**, a saved **query**, a non-default **layout
algorithm**, and per-view **style overrides**. These are runtime-serialized and
best obtained from an **Export → JSON** rather than written by hand.

```jsonc
"layouts": {
  "Default": {
    "internals": null,                 // layout-algorithm config; null for position-based
    "isCustom": true,                  // true when positions are explicit
    "hideDisconnectedNodes": false,    // safe toggle (§9)
    "positions": { "A": { "style": { "x": 150, "y": 150 } } },
    "filters":   { /* filterKey → filter state — see below */ },
    "nodeStyles":{ /* nodeId → { type, style } per-view overrides */ },
    "edgeStyles":{ /* edgeId → { type, style } per-view overrides */ },
    "query":     "...",                // saved query — see warning

    // bubble groups (the safe part — see §7)
    "bubbleSetStyle": { /* per-group visual style */ },
    "groupOneManualMembers": [], "groupOneProps": []
    /* …Two / …Three / …Four likewise */
  }
},
"selectedLayout": "Default"
```

GLL supports several layout algorithms — `force` (default), `circular`,
`radial`, `concentric`, `grid`, `mds`, and `custom` (explicit positions). To
ship a non-default algorithm, set it up in the desktop app and **Export → JSON**;
the `internals` block it produces is the reliable way to express it.

### Filter state (`filters`)

Each entry keys a filter (`section::subGroup::property`, §6) to its saved state —
an `active` flag plus slider thresholds or selected categories.

- An `active: true` filter with a full-range slider / all categories selected
  hides **nothing**; `active: false` simply means the filter is not applied.
  Toggling `active` alone has **no visible effect** — to actually hide nodes you
  must also set the threshold/category constraint, which is the verbose part.
- Reproduce the exact object shape from an **Export → JSON**; don't invent it.
- If you only want the data to *be* filterable, you don't need this at all — ship
  `D4Data` (§6) and users filter interactively.

### Saved query (`query`)

> ⚠️ **Do not hand-author or generate a `query`.** The grammar is strict, and a
> malformed query is **not** ignored — it throws while the graph is applied and
> the **entire graph fails to render** (`0/N nodes` plus a console error). If a
> saved query is genuinely required, copy one **verbatim from Export → JSON**.
> Otherwise omit it and let users filter interactively.
>
> Grammar, for reference only: a property path `section::subGroup::property`
> followed by exactly one condition — `BETWEEN <low> AND <high>`,
> `LOWER THAN <a> OR GREATER THAN <b>` (always two-sided — there is **no**
> standalone `LOWER THAN`), `IN [value1, value2]`, or the unary `IS MISSING`
> (true when the property is absent/empty or belongs to the other element type;
> emitted automatically by the filter panel's non-strict AND join) or
> `IS FOREIGN` (true only when the property belongs to the other element type;
> emitted by the AND join's "complete cases only" mode) — with
> clauses combined by `AND` / `OR` / `NOT` and grouped in parentheses. There are
> no `<`, `>`, or `=` operators.

---

## 11. Worked examples by fidelity

### Minimal — renders, nothing to analyse

```json
{
  "nodes": [{ "id": "A" }, { "id": "B" }],
  "edges": [{ "source": "A", "target": "B" }]
}
```

### Labelled & styled

```json
{
  "nodes": [
    { "id": "A", "label": "Start", "type": "circle",
      "style": { "size": 40, "fill": "#403C53" } },
    { "id": "B", "label": "End" }
  ],
  "edges": [
    { "source": "A", "target": "B", "label": "flows to",
      "style": { "endArrow": true, "lineWidth": 1.5 } }
  ]
}
```

### Recommended — filterable + grouped (the sweet spot)

```json
{
  "nodes": [
    { "id": "A", "label": "Acme",
      "D4Data": { "Node filters": { "Metrics": { "Score": 4.7, "Risk": "high" }, "Status": { "State": "active" } } } },
    { "id": "B", "label": "Globex",
      "D4Data": { "Node filters": { "Metrics": { "Score": 2.1, "Risk": "low" }, "Status": { "State": "active" } } } },
    { "id": "C", "label": "Legacy",
      "D4Data": { "Node filters": { "Metrics": { "Score": 0.4, "Risk": "high" }, "Status": { "State": "inactive" } } } }
  ],
  "edges": [
    { "source": "A", "target": "B", "D4Data": { "Edge filters": { "Link": { "Weight": 0.8 } } } },
    { "source": "C", "target": "A", "D4Data": { "Edge filters": { "Link": { "Weight": 0.2 } } } }
  ],
  "nodeDataHeaders": [
    { "subGroup": "Metrics", "key": "Score" },
    { "subGroup": "Metrics", "key": "Risk" },
    { "subGroup": "Status", "key": "State" }
  ],
  "edgeDataHeaders": [
    { "subGroup": "Link", "key": "Weight" }
  ],
  "layouts": {
    "Default": {
      "groupOneManualMembers": ["C"],
      "groupOneProps": [],
      "bubbleSetStyle": {
        "groupOne": { "label": true, "labelText": "Decommission candidates", "fill": "#9A9A9A", "fillOpacity": 0.22, "stroke": "#C33D35" }
      }
    }
  },
  "selectedLayout": "Default"
}
```

This renders all three nodes, exposes four filters for users to drive, and
outlines the legacy node — with nothing fragile that could break the render.

---

## 12. Client snippets

### Python

```python
import os, requests

graph = {
    "nodes": [
        {"id": "A", "label": "Acme",
         "D4Data": {"Node filters": {"Metrics": {"Score": 4.7, "Risk": "high"}}}},
        {"id": "B", "label": "Globex",
         "D4Data": {"Node filters": {"Metrics": {"Score": 2.1, "Risk": "low"}}}},
    ],
    "edges": [{"source": "A", "target": "B", "label": "supplies"}],
    "nodeDataHeaders": [
        {"subGroup": "Metrics", "key": "Score"},
        {"subGroup": "Metrics", "key": "Risk"},
    ],
}

resp = requests.post(
    "http://127.0.0.1:7637/api/graph",
    json=graph,
    headers={"Authorization": f"Bearer {os.environ['GLL_API_TOKEN']}"},
    timeout=10,
)
resp.raise_for_status()
print(resp.json())  # {'success': True, 'nodes': 2, 'edges': 1, 'subscribers': 1}
```

### JavaScript (Node)

```js
await fetch("http://127.0.0.1:7637/api/graph", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.GLL_API_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    nodes: [{ id: "A", label: "Acme" }, { id: "B", label: "Globex" }],
    edges: [{ source: "A", target: "B" }],
  }),
});
```

---

## Quick reference

| You want…                           | Send…                                                                      | Tier         |
| ----------------------------------- | -------------------------------------------------------------------------- | ------------ |
| A graph to appear                   | `nodes[]` with `id`, `edges[]` with `source`/`target`                      | ✅           |
| Labels                              | `node.label` / `edge.label`                                                | ✅           |
| Colours, sizes, shapes, arrows      | `node.style` / `edge.style`                                                | ✅           |
| Filters (sliders & dropdowns)       | `D4Data` under `"Node filters"` / `"Edge filters"` (§6)                    | ✅           |
| A guaranteed set of filter controls | `nodeDataHeaders` / `edgeDataHeaders` (§6)                                  | ✅           |
| Bubble outlines around node sets    | `layouts.<name>.group<N>ManualMembers` / `…Props` + `bubbleSetStyle` (§7)  | ✅           |
| To show only a subset of nodes      | Send only those nodes (per-node hide isn't reliable via the API, §4)       | ✅           |
| Hide disconnected / dangling nodes  | `layouts.<name>.hideDisconnectedNodes: true` (§9)                          | ✅ optional  |
| Fixed positions                     | `node.style.x` + `node.style.y` — or omit and auto-layout (§8)             | ✅ optional  |
| Pre-set filter state                | `layouts.<name>.filters` — **only if needed; prefer Export → JSON** (§10)  | ⚠️ advanced |
| A non-default layout algorithm       | `layouts.<name>.internals` — **prefer Export → JSON** (§10)               | ⚠️ advanced |
| A pre-applied query                 | **Don't generate one** — omit it, or Export → JSON (§10)                   | ⚠️ advanced |
