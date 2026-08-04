# Changelog

## 1.17.0 — 2026-08-04

Saved graph files, workspaces, filters, styles and bubble groups all load unchanged, including files written before this release — but **the interface is rearranged**, so it is worth reading the first section below before looking for a control where it used to be. The short version: the filter sidebar, styling sidebar, selection HUD and workspace bar are now a **rail** across the top, one **inspector** on the right with Filters / Overlays / Selection contexts, and a **workbench** of tabs (Data, Query, Metrics, Assistant) at the foot of the stage. `⌘K` / `Ctrl+K` finds any control by name and tells you where it lives, which is the fastest way to relearn the layout.

(The Neo4j connector and its follow-ups were originally released as 1.16.0–1.16.3 on the `feat/neo4j-connector` branch; they are renumbered into this release because `main` published its own 1.16.x line in the meantime.)

### Features

* **The interface is now a rail, a stage and one inspector.** The four panels that used to compete for the screen — filter sidebar, styling sidebar, selection HUD, workspace bar — are gone, replaced by three surfaces with one job each. Saved graphs, workspaces, filters and styles are unaffected; only where you reach for things changed.
  * **The rail** (top, 52 px, always there) carries the session-level verbs: the **◆ app menu** (open, template, STRING, Neo4j, tour, start over), the **workspace chip** with live shown/total counts and switch/new/rename/delete, **⊡ Fit**, **↻ Layout** — labelled with the workspace's current algorithm, so it is no longer invisible until you open a dialog — **➰ Lasso**, **✨ Hover**, **◈ Select**, **✎ Note**, the **selection chip** (counts, focus, clear, undo/redo, plus a warning when filters hide part of your selection), the Data/Query/Metrics/Assist tabs, **⤓ Export**, **⛶ presentation mode**, the theme toggle and **?**.
  * **The inspector** (right, resizable) is the app's single panel, with three contexts. **Filters** holds one filter per property; **Overlays** is a layer stack, one row per thing drawn over the graph; **Selection** holds group membership, act-on-selection, arrange and appearance. **No context ever opens itself.** When the selection changes while you are somewhere else — *Add to selection* on a filter row, a click on the canvas — the **Selection** pill flashes and waits; it never takes the panel out from under the row you are working in.
  * **Nothing hides behind a toggle any more.** The **⚙ Details** switch is gone: exact min/max inputs and the per-row group/selection buttons are always rendered. The floating selection HUD and its **Tools ▾** drawer are gone: its contents are permanent inspector sections. Fold a section with its **▾** chevron when a list gets long.
  * **◈ Select** promotes the app's biggest hidden surface — select all/no nodes and edges, or by node/edge ID or label with an include/exclude switch — to one click on the rail.
  * **Overlays is a layer stack.** One row each for **Groups**, the **density heatmap** (previously three levels deep inside the styling panel), **Notes** and the **minimap**. Every row carries its own on/off switch and opens onto its own settings, so switching a layer on and tuning it are the same gesture in the same place — the heatmap's parameters are no longer a greyed card whose switch lives on the far side of the window. Hiding a layer hides it in PNG and SVG exports too. A layer with nothing in it yet — no groups, no notes — greys its switch and says why, rather than offering a toggle with no visible effect.
  * **Presentation mode** (**⛶** on the rail, **⇧F**, Escape to leave) hides the rail and the inspector for a clean screenshot — a better answer than the old HUD's ✕, which could strand you behind a 90 px restore chip.
  * **Group membership has its own section** under **Selection**: one **＋ Add to group** button opening a list of your groups by name.
  * **SVG export is a visible row** in the ⤓ Export menu alongside PNG 1×/2×/4×, JSON and Excel, instead of hiding inside the 📷 popover.
  * **The workbench** (bottom, over the stage) hosts **Data**, **Query**, **Metrics** and **Assistant** as four tabs that never close each other — Query and Data used to silently evict one another from a single slot, and the assistant was a fifth docked panel competing for width. It occludes the canvas and never the inspector, remembers a height per tab, and **⤢** expands it to full height for spreadsheet work. Metrics and the assistant moved in with it; the assistant now reads in a centred 720 px column with **⚙ Settings** and **🗑 Clear** in the workbench toolbar.
  * **⌘K / Ctrl+K finds anything by name.** One search box over every control in the app, plus every node and edge: type `heat` for the density heatmap and its nine parameters, `arrow` for the edge arrow fields, an airport's name to centre the graph on it. Each row prints **where the control lives** — `Inspector › Overlays › Density Heatmap` — and its accelerator, so the palette teaches the layout instead of replacing it; **↵** runs a command, **⇥** just takes you to it and rings it. The index is read from the interface itself, so nothing can be missing from it. The old *Focus Elements* card, two datalists under an inspector section, is gone — the palette does its job.
  * **⤢ expands the filters over the stage.** The inspector's filter list lifts onto a full-width surface with search and multi-column layout, active filters first, so a graph with 40 properties is readable without scrolling a 356 px column. It stops at the top of the workbench, so filters and the query editor can be used together.
  * **Messages come to you.** Loading results, warnings and errors appear as a **toast over the stage** and fade on their own (errors linger longest, ✕ dismisses early) instead of only accumulating in a strip at the foot of the panel that could be off screen when it mattered. Nothing is lost: every message still lands in the **Activity log** at the foot of the inspector, which is now a collapsed disclosure with a line count — open it to read back the session, including the Neo4j Cypher trace.
  * **A keyboard cheat sheet** opens with **?**. `Y` now jumps the inspector to the appearance controls rather than toggling a panel.
  * **The filter panel is half the height, with nothing removed.** Node and edge filters are a **Nodes | Edges** segment carrying live counts rather than two full-width accordions — the split is always exactly those two, so it never needed the panel's loudest treatment. Sub-groups are a small-caps label and a hairline instead of a second filled bar. A numeric filter is **one line**: its exact min and max sit at the two ends of the slider, rounded while you read them and exact the moment you click into one, so the hover value bubbles that used to show the same two numbers a second time are gone. **Search moved into the panel**, so you no longer have to expand over the stage to find a property among 40 — searching spans both nodes and edges. On a 15-property template the panel went from 855 px to 362 px.
  * **Nothing selected now offers buttons, not prose.** The Selection context's empty state named three ways to build a selection and made two of them clickable; **➰ Lasso**, **◈ By name or ID** and **📝 Query editor** are all one click now.
* **Bubble groups: as many as you want, and all in one place.** Groups were capped at four and built through three unlabelled glyphs in three different tabs — an 18 px four-quadrant pie on every filter row, an identical pie in the Selection tab that did something different, and a hover-✕ on a badge. The pie's four wedges *were* the cap.
  * **Overlays › Groups is now the whole feature.** One row per group carrying its colour, its name, how many nodes it holds, a **＋ / －** button, and a **⋯** menu (select members, duplicate, clear, delete). Open a row for its fill, outline, padding and label settings. A new workspace starts with **no groups** and an empty state that says what a group is, instead of four empty ones that read as decoration.
  * **Groups have names.** The row's name field *is* the label drawn on the bubble, so the list and the canvas can never disagree. No more "top-left" and "Bubble Set 3" for the same thing.
  * **Make as many as you need** — **＋ New group**, **＋ From selection**, or from a filter. Beyond the original four brand colours new groups take evenly spaced hues.
  * **One menu, both ways in.** The filter row's chip and the Selection tab's **＋ Add to group** open the same named checklist, with a ✓ for groups you are fully in and a **–** for ones you are partly in. Each also offers *New group from this filter / from selection*. The filter-row chip is hollow when unassigned, filled with the group's colour when in one, and ringed when in several — hover it for the names.
  * **A group can be fed by a filter and by a selection at once** — it always could, but nothing said so. The row now spells it out: *⚙ Node › type · +8 manual*. Changing the filter moves only the filter-driven half. Removing a node that still matches the filter says so rather than looking like a click that did nothing, and **⋯** can clear either source on its own.
  * **Auto-detect creates groups instead of overwriting them.** Choose how many communities to turn into groups; existing groups are left alone, so the confirmation dialog that used to warn you about losing them is gone.
  * **Dragging nodes stays responsive.** Fitting a bubble outline is expensive — on a 120-node group with *Avoid other nodes* on it costs about a third of a second — and it used to re-run on every frame while you dragged. A 60-step drag ran 60 fits and blocked for ~49 s. Cheap fits still track the node live; past one frame's budget the hull coasts on its last shape during the drag and re-fits once, when you let go. The same drag now runs **0 fits while dragging and one on release, ~3 s**.
  * Saved graphs load unchanged, including files written before this release.
* **Undo and redo, for the whole workspace.** `↶ ↷` on the rail (and `Ctrl+Z` / `Ctrl+Y`, `⌘Z` / `⌘Y` on a Mac) take back the last change to how the workspace looks: styles, filters and queries, arrange and re-layout, bubble-group membership. The button's tooltip names what it would undo — *Undo: Arrange selection (grid)* — and a toast confirms it. Selection undo/redo stays where it was, on the selection chip. Loading a file, editing the data table, and merging from Excel or Neo4j rebuild the graph itself and clear the history rather than pretending they can be reversed; the last 20 steps are kept (5 on graphs over 2,000 nodes, where a snapshot is large).
* **Boolean properties get a boolean filter.** A property whose values are all `true`/`false`/`1`/`0` is classified as boolean and rendered as an **Any / True / False** toggle, instead of a two-item dropdown or — for `1`/`0` — a range slider from 0 to 1. Classification is purely data-driven: if the column later gains a third distinct value it reverts to numeric on the next rebuild. The query language gained `IS TRUE` / `IS FALSE` to match, and saved workspaces migrate on load.
* **Mixed-type columns stay visible.** A column holding both numbers and text used to be deleted from the filter list with only a transient warning, so the property silently vanished from the app. It is now rendered as a disabled row stating the reason and the offending counts.
* **Neo4j queries are visible in the activity log.** Every Cypher statement the connector sends — the initial fetch, row-count preflights, expansions, additional queries, and stitch passes — now appears as a grey 🛢️-prefixed line in the activity log at the foot of the inspector, so it's always clear what was asked of the server. Long queries are collapsed to one line and truncated to keep the log legible.
* **Neo4j connector.** Fetch a graph straight from a Neo4j server: a new **🛢️ Neo4j Database** card on the landing page (and an entry in the rail's ◆ app menu) opens a connection dialog for server URL, credentials, optional database name, and a Cypher query returning nodes, relationships, or paths. Before fetching, the connector counts the matching rows and asks for confirmation above 2,000; after fetching, a property checklist shows each property's type and example values and lets you drop unwanted ones — long arrays such as embeddings start deselected. Nodes are colored per entity label and edges per relationship type (when there is more than one) — edge colors use a dedicated mid-lightness palette that stays legible over both the light and dark theme backgrounds. Property groups use the most specific label of a stored class hierarchy, and list properties become pipe-separated multi-value categories and booleans true/false categories so the regular filters work on them. The connection settings (never the password) are remembered locally. Uses the Neo4j HTTP API on port 7474/7473 with no driver dependency; Neo4j Aura (Bolt-only) is not supported.
* **Stack Overflow demo.** No Neo4j server at hand? The connection dialog can fill itself in: a link loads the settings for [Neo4j Labs' public read-only demo server](https://github.com/neo4j-graph-examples) with a query fetching the best-answered `neo4j`-tagged Stack Overflow questions and their askers, answers, and tags (~1,500 nodes / ~1,800 relationships) — review and press **Fetch** to try the connector, expand, and join queries without any setup. Content from [Stack Overflow](https://stackoverflow.com) contributors, licensed [CC BY-SA](https://creativecommons.org/licenses/by-sa/4.0/).
* **Growing a Neo4j graph in place.** After a Neo4j import, the graph can be extended without starting over — both features live behind the active session (the password is kept in memory only and never persisted) and disappear when another data source replaces the graph:
  * **🛢️ Expand** (inspector › Act on selection): with nodes selected, a checklist shows what surrounds them — one row per relationship type and neighbor label, with counts, everything preselected — and fetches the checked groups. New neighbors appear next to the node they connect to and float into place with a short force animation that feels the whole network but moves only them; existing nodes never move. The same **Stitch** checkbox as the join-query dialog (on by default) additionally fetches the relationships between the new neighbors and everything already loaded — including among the new neighbors themselves, which the expansion pattern alone never returns.
  * **🛢️ Add query** (rail): runs an additional Cypher query against the connected server and merges the results into the current graph, even when they are disconnected from it. The same row-count confirmation as the initial import applies. A **Stitch** checkbox (on by default) runs one extra query that fetches all relationships between the new results and everything already loaded — individual queries only return the relationships their own pattern matched, so without it two queries about different entities never reveal how their neighborhoods interconnect.
  * Merged data reuses the property exclusions chosen at import time (re-import to change them), entity colors stay stable across merges, and node identity follows Neo4j's ids — re-fetched nodes refresh their properties instead of duplicating. Filter narrowing resets on merge. Expansion requires Neo4j 5+ (`elementId`); the plain import keeps working on older servers.
* **Tooltips are the app's own.** Every hint the app carries used to be a native browser tooltip: half a second of delay, the operating system's styling, no formatting, and nothing at all for a keyboard user. One layer now intercepts them on hover *and* on keyboard focus and draws them in the app's own type — the control's name in bold ahead of its description, accelerators such as **(F)** or **(⌘K)** as key chips, and indented trees kept as written. The tip is hoverable, so a long one can be read at leisure. Nothing is lost to assistive technology: the underlying accessible names are unchanged.
* **A graphics-capable browser is checked before you pick a data source, not after.** GLL needs WebGL2. When it is missing or disabled, the landing page now says so above the buttons and disables the actions that need a renderer (open a file, STRING, Neo4j, the tour), instead of letting you choose a source, wait through the load, and find an error where the graph should be. Downloading the Excel template needs no renderer and stays available.

### Fixes

* **The density heatmap's "dim graph" now actually dims.** It never did: the switch replaced every node and edge colour with a flat, fully **opaque** grey, and an opaque grey node hides the density field underneath it exactly as much as an opaque red one did — the heat layer is painted below the graph, so no amount of ramp tuning could fix it. It is now a **Fade graph** slider: nodes fade toward transparent, and past 40% the two things that actually block the view — **labels and edges** — drop out entirely, leaving the field and the node positions. Labels were the largest occluder of all and the old switch never touched them. Selected and hovered elements keep their normal treatment throughout. The heatmap's defaults are also stronger (opacity 0.7, intensity 0.25, contrast 0.85), because the old ones read as a smudge rather than a density gradient once the graph stopped covering them — workspaces that saved their own values keep them, and a workspace saved with the old switch on loads as a 70% fade.
* **Same-named properties are distinguishable in the pie-slice picker.** When properties with the same name exist on different groups (common after a Neo4j import, where every label can carry `name`, `score`, …), the **Map Properties to Pie Slices** dialog showed identical rows with no way to tell them apart. Colliding names now show their group in parentheses — `score (Cell)` vs `score (Document)` — in both the property list and the numeric slice-color rows, every property row gets a hover tooltip with its full `group > name` path, and the list is sorted by name so ambiguous twins sit next to each other. Unique names stay short as before.
* **The AND join says which filters are actually doing work.** Under **AND** a filter only constrains the graph once you narrow it from the range or values it loaded with — one left at its default means "don't care". That rule was invisible, so an untouched panel switched to AND produced an empty query for no apparent reason, and ticking a filter's checkbox appeared to do nothing. The filter toolbar now reads *"3 of 15 filters constrain the graph"* (or names the all-defaults case outright), and filters that carry no constraint have their name muted. Under OR, where active and constraining are the same thing, nothing is shown.
* **"Complete cases only" no longer empties the graph.** With the filter join set to **AND**, ticking **Complete cases only** after narrowing filters of just one element type wiped out the other type entirely — narrow a node property and every edge vanished; narrow an edge property and every node vanished, taking the whole graph with it. Elements of a type with no narrowed filter of its own were being judged against the other type's conditions, which they can never satisfy. A type carrying no filters is now simply unconstrained, while an element of a *filtered* type that is missing the value is still excluded, which is what the setting is for. The query language gained the `IS FOREIGN` predicate — true only when a property belongs to the other element type — to express it.
* **Boolean properties now filter correctly.** A boolean data property (e.g. `mined: true` on an edge) was classified as numeric and became a degenerate range slider whose condition could never match, silently hiding every element carrying it under an **OR** filter join — while **AND** appeared to work only because un-narrowed filters don't constrain. Booleans from any data source (Neo4j, Excel boolean cells, JSON payloads, live API pushes) are now normalized to categorical `true`/`false` filters at the import boundary. Reload affected data to pick up the fix.
* **Hovering no longer highlights through a filtered-out edge.** ✨ Hover lit up every neighbour incident to the hovered node, including ones whose connecting edge the filters had already removed — a highlight asserting a connection the graph was no longer showing. The traversal now skips hidden edges and hidden nodes, so the highlighted neighbourhood is the one you can actually see.
* **Bubble outlines no longer paint a solid wedge between two corridors.** A group whose members split into two arms could fill the empty space between them, next to the group's label. Two independent causes, both fixed: the marching grid the outline is traced on is now rounded to whole pixels — a fractional cell made adjacent contour cells collapse onto the same pixel and short-circuit the traced ring, and whether a graph hit it depended on node size, since the cell is derived from the members' mean radius (sweeping radius 4–40 px on the reported layout: 15 of 145 radii wedged before, 0 after) — and the smooth curve painted from that ring no longer overshoots at a sharp notch, because each control point is now damped by how sharply the ring turns there. Raising **Padding** above ~0.3 used to hide the second cause; it no longer needs to.
* **Metrics repaint when you return to one you have already computed.** Switching to a metric worked once. Coming back to it left the previous metric's ranking, graph-level table and 🛈 popup on screen, because the cache guard skipped the repaint along with the recompute — a first visit had no cache entry and looked fine, which disguised it as "cannot go backwards". Rendering is now separate from computing; the expensive calculation still runs at most once per metric per visible subgraph. **⤢** also expands the workbench to the full stage rather than 92%, where the leftover strip of canvas read as a rendering artefact.
* **Accessibility fixes from an axe-core pass.** The two range inputs behind every numeric filter had no accessible name, so a screen reader announced two anonymous sliders per property with no way to tell the lower threshold from the upper (WCAG 4.1.2); they are named now. White on the dark theme's brand fill measured 3.43:1 on the inspector pills and the OR/AND segment (WCAG 1.4.3 AA) and is now a dark foreground, as the design specifies for dark mode. The app also draws its own focus ring: controls without one fell through to Chrome's near-black `outline: auto`, which lingered on whatever the ⌘K palette had just revealed. Known and untouched: target-size (2.5.8) on the app's 14–18 px icon buttons, which needs a global sizing decision.

## 1.16.1 — 2026-07-22

### Fixes

* **Disconnected nodes stay hidden across filter changes.** With "hide disconnected nodes" on, changing a filter could resurface a node that should have stayed hidden, and nodes that became disconnected by the change were never re-hidden. The dangling set is now recomputed against the current filtered view on every change.

### Features

* **Checkmark badge for single-value numeric filters.** Numeric properties with only one value (min === max) have no range to narrow, so they now show a read-only checkmark + value badge instead of an inert slider. The row's include/exclude checkbox still works.

Also includes manuscript revisions (docs only, no app changes).

## 1.16.0 — 2026-07-22

Saved graph files load unchanged. Stored bubble-set knob values keep applying, with two semantic shifts: padding and corridor width now scale with your configured node size (a value of 1 ≈ one node radius of margin) instead of absolute pixels, and any saved avoidance value above 0 now simply means "on".

### Features

* **Merge-import Excel files into the loaded graph.** A new ⤒ Import button in the data editor header loads a workbook *into* the current graph instead of replacing it. A preview modal shows what the merge will do before anything is applied — new/updated node and edge counts, new property columns, unchanged and skipped rows. Existing workspaces, positions, filters and styles are preserved; a single nodes or edges sheet suffices, and new edges can attach to nodes already in the graph. X/Y coordinates in the file seed positions for new nodes only.
* **Choose how an import joins the graph.** The import preview offers two modes: **Extend & add** (default) updates matching nodes/edges and adds new ones from the file, while **Extend existing only** updates matches and ignores file rows without a match — including edges onto skipped new nodes, so no dangling edges. The preview counts update live as you switch.
* **Bubble-set geometry controls.** The Bubble Sets styling card gains **Padding** (how far the body extends past its members) and **Corridor Width** (thickness of the arms reaching outlying members) sliders, range 0.01–3, plus an **Avoid Other Nodes** switch that steers the hull around non-members and carves holes for fully enclosed ones. Defaults: padding 0.1, corridor 0.25, avoidance on.
* **Smooth, organic bubble outlines at every zoom.** Hulls render as continuous curves instead of polylines — no more faceted or jagged outlines when zooming in — and the PNG and SVG exports paint the exact same curves as the live canvas.
* **Node-size-aware hulls.** The influence field scales with the group's mean member radius, so bubbles look proportional whatever node size you configure. At minimum padding the hull hugs each node at a fixed fraction of *its own* radius, and minimum-width corridors render as thin, gently arced tubes.
* **A member is never lost.** Every member circle is guaranteed inside its group's outline (measured against the curve actually painted); groups whose members drift beyond the field's reach stay connected as one shape via corridor links.

### Fixes

* **Bubble hulls no longer clip their own members.** Avoid-node pressure could squeeze the outline through a member's body while its center stayed inside; grazed members now get repaired with proper clearance.
* **Enclosed non-members are no longer silently swallowed.** With avoidance on, a non-member inside the hull gets a visible carve whenever one is geometrically possible — and one impossible hole no longer discards all the others.
* **Bubble outlines no longer wobble around dense non-member fields**, and corridors no longer reroute into phantom lobes when widening them.
* **Re-saved Excel workbooks import cleanly.** Rich cell values (formatted text, hyperlinks, formulas) are normalized to plain values on import, so matched rows no longer all report as "updated" and the filter panel no longer crashes after such an import.

## 1.15.5 — 2026-07-10

Saved graph files load unchanged; older files (and files saved by earlier versions) default the new opacity to fully opaque, so their appearance is identical.

### Features

* **Node and edge opacity.** The styling panel (under 🎨) now has an **Opacity** slider for both nodes and edges (1 = opaque, 0 = invisible). It folds into the element's color alpha, so it composes with a color that already carries transparency, and — like the other numeric style knobs — it can be **mapped by data** via the ∿ button to scale opacity from a numeric property. Opacity round-trips through both JSON and the Excel `Opacity` column (documented in the template's readme tab). Being an alpha effect, low opacity composites toward the background: light colors (e.g. the default slate edges) approach white sooner than saturated ones.

### Fixes

* **Exported images now match the on-screen bubble-group z-order.** PNG and SVG exports painted bubble-set hulls *underneath* the nodes and edges, but the live view draws them on top (since 1.15.1). On dense graphs the edge mesh buried the hulls, which also made edges read as more opaque than on screen. Both exporters now composite hulls above nodes/edges and below labels, matching the live layer. Sparse graphs were unaffected, so this was only visible on large graphs.

## 1.15.4 — 2026-07-01

Saved graph files load unchanged; older files default the two new per-view settings to the previous behavior (OR, non-strict).

### Features

* **OR / AND filter combination.** The filter panel (under ⚙ Details) can now combine active filters with **AND** as well as the default **OR**. AND counts only the filters you have actually narrowed, so switching modes while everything is at its default leaves the graph unchanged instead of emptying it. A **Complete cases only** option additionally hides elements that are missing any of those filters (evaluated per element type). The join mode and complete-cases flag are saved per workspace view in exported JSON.
* Added an `IS MISSING` query-DSL operator — true when a property is absent/empty or belongs to the other element type — used to express the non-strict AND join. The query-editor help, guided tour, and API grammar reference now document it.

## 1.15.1 — 2026-06-17

Saved graph files load unchanged — this release is bug fixes only.

### Fixes

* **Arrange Selection tools now work.** All six tools (shrink/expand/circle/force/grid/random) were silent no-ops: positions were persisted before being pushed to the graph, and the persist path re-synced node state from graphology — clobbering the freshly computed coordinates before they reached the renderer. Positions are now pushed to the graph first, then persisted. The circle/force/random geometry is also rebuilt on graphology layouts (circular/forceAtlas2/random) run over a subgraph of the selection and recentered on the selection centroid, replacing the hand-rolled force sim that drifted toward world-origin.
* **Bubble and heatmap overlays stay aligned across DPR changes.** Moving the window to a monitor with a different device-pixel-ratio left bubble groups and the heatmap field misaligned until a sidebar toggle forced a resize. A DPR watcher now forces a full sigma resize and re-render on every ratio change, and the overlay canvases own their CSS display size so they stay 1:1 with the WebGL layers regardless of resize timing.

## 1.15.0 — 2026-06-16

Existing graph files (including version-less JSON saved by 1.14.x) load unchanged — this release adds and replaces functionality without breaking the saved-file format.

### Features

#### Renderer migration: AntV G6 → Sigma.js (WebGL)

The entire rendering stack moved from AntV G6 5.x (canvas) to Sigma.js v3 (WebGL nodes/edges, canvas labels) on a graphology data model. Measured on the 6000-node / 9000-edge benchmark (see `MIGRATION.md` for the full record):

| Metric | G6 (1.14.x) | Sigma (1.15.0) |
|---|---|---|
| Load (data → rendered) | 1.6 s | 0.79 s |
| Wheel-zoom FPS | ~4 | ~60 |
| First-interaction stall | ~11 s | 64 ms |
| 500-node select | 140 ms | 46 ms |

* All six node shapes ported (circle and square as native WebGL programs; hexagon, diamond, triangle, star as crisp SVG textures)
* Selection, hover-highlight and dim states reimplemented as sigma reducers; lasso select is a custom canvas overlay; click/shift-select, node drag with position persistence, and tooltips preserved
* Bubble groups drawn natively on a canvas layer under the nodes via `bubblesets-js`; member sync, styling UI and filter/manual membership unchanged
* Minimap and PNG export (with the bubble-set layer composited) reimplemented on sigma
* Distribution is ≈0.9 MB smaller (the 1.1 MB vendored `g6.min.js` is gone; sigma + graphology + headless layouts add ≈0.2 MB)
* Documented degradations: dashed edges render solid and polyline edges render curved (no off-the-shelf WebGL programs for either)

#### Layouts

* **Live-animating ForceAtlas2** driven by a web-worker supervisor, so force layouts settle visibly without blocking the UI.
* **Dagre** layered layout, **circlepack**, and **random** added to the layout options.
* **Full-workspace re-layout** control to re-run a layout across the entire workspace, with animated transitions between layouts.
* Optional **noverlap** overlap-removal post-pass.
* Headless layouts: circular/grid (geometric), radial/concentric/mds (`@antv/layout` v2).

#### Communities & metrics

* **Louvain community detection** (weighted, with a tunable resolution) that populates manual bubble groups directly.
* Network centralities now come from **`graphology-metrics`** instead of the hand-rolled implementations.

#### Edges & flow

* **Animated directional edge flow** on both straight and curved edges, with `dash`, `pulse`, `comet` and `chevron` styles plus speed, colour, opacity and density controls.
* **Edge arrow markers and halos**, with arrow fill, border-colour and border-size controls.

#### Nodes & styling

* **Pie-chart nodes** that render proportional slices from data.
* **GLSL circle borders** via `@sigma/node-border`.
* **Node badges** with a size control and a scale-with-node option.
* **Dark-mode toggle**.

#### Heatmap

* **Density heatmap overlay** — an atmospheric node-density layer beneath the graph, off by default and toggled from the workspace toolbar, with opacity, intensity, gamma/contrast, threshold, bandwidth/radius and colour-ramp controls (default / viridis / magma / accent / grayscale) plus an optional dim-graph mode. Replaces the former selection glow.
* Bubble-group label **placement, close-to-path and auto-rotate** knobs are now honoured by the renderer (previously no-ops).

#### UI

* Reworked **selection grouping and selection-driven styling cards**.
* **Compact, density-aware filter panel** redesign; redesigned selection, styling and toolbar surfaces for clarity.
* Selection HUD now defaults to the **top-right corner** and snaps to a grid; tooltips are suppressed during shift+click multi-select.
* Subtle **top-centre loading indicator** card; compact header.

#### Export & IO

* **SVG vector export** alongside JSON and PNG; high-resolution PNG export.
* JSON saves now carry a top-level **`version`** stamp; loading a file saved by a newer app surfaces a soft notice (older and version-less files load as before).
* The **density-heatmap** overlay (enabled state + appearance settings) is saved into the JSON export and restored on load.

### Performance

* Network metrics are computed **lazily, only while the metrics panel is open**.
* Removed the automatic disabling of hover effects on large graphs (no longer needed on the WebGL renderer).

### Fixes

* Fixed slow deselection when clicking empty canvas on large graphs (antvis/G6#7195) — removed from Known Issues.
* PNG export: corrected dark-mode background, hi-res scaling and label z-order; dropped the unreliable 8× scale and added a GPU framebuffer ceiling margin so high-res exports no longer come out blurry or blank.
* Anchored popovers are clamped to the viewport so the right edge never truncates.
* Float filter sliders use a continuous step so a column's maximum value stays selectable.
* Heavy layouts keep the UI blocked on large graphs until the layout completes.
* The reset-style button no longer claims to reset node positions.
* Graceful guard when WebGL2 is unavailable, plus a redraw after container resize.

## 1.14.2

### Features

#### Per-session graph isolation (multi-tenant handoff)

The ingest service now supports optional per-session graphs, so multiple apps or users behind a reverse proxy can each load their own graph instead of overwriting one shared global graph.

* `?session=<id>` query param accepted on `POST /api/graph`, `GET /api/graph`, and `GET /api/events`; each session has its own graph and its own set of live viewers
* Omitting `session` uses a shared `"default"` session — the original single-graph behaviour, so existing callers and proxies need no changes
* `POST /api/graph` response now includes the resolved `session` and the live `subscribers` count
* The live viewer reads `?session=<id>` from its own URL and subscribes to the matching stream (works at the service root and behind a reverse-proxy sub-path)
* Session ids are bounded (`^[A-Za-z0-9_-]{1,64}$`, `400` otherwise) and the server holds at most 64 sessions with least-recently-used eviction; the live-viewer cap (100) spans all sessions
* Handoff pattern documented in [API.md](API.md) §2.1 and [SERVICE.md](SERVICE.md)
* `install-service.sh` / `update-service.sh` scripts for deploying the ingest service as a systemd unit

## 1.14.1

### Fixes

* Authored payloads with empty/missing node positions are now force-laid-out instead of rendering collapsed at the origin
* Live viewer connects to the events stream via a relative URL so it works behind a reverse-proxy sub-path

## 1.14.0

### Features

#### HTTP Ingest Service (new)

Standalone HTTP service (`npm run serve:api`) that lets other applications push graphs and watch them render live in a browser. Independent of the Electron desktop app — the desktop build never starts a server.

* `POST /api/graph` ingest endpoint protected by a bearer token; replaces the current graph and pushes it to connected viewers
* Live viewer over Server-Sent Events (`GET /api/events`) — pushes render immediately and replace the current graph without a reload
* `GET /api/graph` (latest graph, `204` until first ingest) and `GET /health` (liveness with version) endpoints
* Environment-based configuration: `GLL_API_TOKEN`, `GLL_API_PORT`, `GLL_API_HOST`, `GLL_MAX_BODY_BYTES`, `GLL_STATIC_DIR` (see [SERVICE.md](SERVICE.md) and `.env.example`)
* Payload reference for external apps and agents documented in [API.md](API.md)

### Security

* Cross-origin browser `POST`s rejected (`403` on any `Origin` header) as a CSRF defence
* Incoming JSON sanitized against prototype pollution — `__proto__`, `constructor`, and `prototype` keys stripped at every level

### Fixes

* Fixed pushed graphs not rendering reliably in the live viewer

## 1.13.0

### Features

#### Graph Assistant (new)

Local Ollama-powered chat panel with a live context snapshot of your graph, selection, and metric values.

* Safe, structured query generation — produces guaranteed-valid GLL queries grounded in your real property hierarchy, so the assistant can't invent property names or emit broken syntax
* Suggested Queries panel with Copy / Select / Open-in-editor; Select pans and zooms to matches
* Live budget meter next to Send with per-section breakdown and a pre-send modal when you'd exceed the context window
* First-run setup and settings modal with model picker, endpoint probing, and `http(s)`-only validation with local/private-IP detection
* Reasoning-trace visualization for thinking models with a live token counter
* Empty-state starter chips, resizable sidebar, and clickable in-reply action glyphs
* GFM markdown rendering with DOMPurify sanitization and per-code-block copy buttons
* Guided tour step covering query suggestions, setup, and the budget pill

### Fixes

* Fixed tooltip `z-index` rendering below overlay UI
* Fixed guided-tour teardown where `Popup.close()` could tear down open panels mid-transition

### UI

* Replaced lasso SVG mask with curly-loop glyph

## 1.12.0

### Features

* Added toggle button for hover highlight effect with hotkey (H) and auto-clear of highlight/dim states on disable
* Added fine-grained bubble-set label controls with tabbed UI
* Show data source label in header and improve export filenames

### Fixes

* Fixed edges rendering on top of nodes after dragging a node and then hovering — reset zIndex elevated by G6's `frontElement` after drag ends
* Fixed group-contiguous column order in Excel export
* Fixed new columns being inserted at end instead of next to their group
* Fixed apply button not enabling after row deletion in data editor

## 1.11.0

### Features

* Added full-page landing screen with hero layout, network background, and action cards
* Added guided tour with sample dataset and step-by-step UI walkthrough, including highlight clipping, metrics step, and panel transitions
* Redesigned popup with scrollable body, maximize/restore toggle, and smooth CSS transitions
* Redesigned tooltip header with pill badge, clean title hierarchy, and fixed positioning
* Added close button to tooltips and auto-hide expand when content fits
* Made tooltips scrollable, draggable by header, and expandable with toggle button
* Made sidebar resizable and improved filter row layout
* Added panel headers with integrated action buttons and improved layout
* Added in-app version display with automatic injection from `package.json`
* Increased default bottom bar height and persist resized height across sessions
* Added Delta4 icon to header and made header compact when data loaded
* Added screenshot tool with portrait mode, scale 1x–10x, and browser size options
* Hide file input after load and make header clickable to reload app

### Fixes

* Fixed filter sliders snapping to integers for properties with float values between integer min/max
* Fixed tooltip jump and disappear when dragging
* Fixed popup footer cutoff on short screens
* Fixed tour overlay z-index above selected elements container
* Fixed selection panel button alignment and use opaque background
* Fixed cross-browser checkbox alignment in Safari and deduplicated CSS
* Fixed `fitView` respecting hidden disconnected nodes with G6 `translateTo` bug workaround
* Fixed query editor cursor jumping, bracket processing, caret flicker, and overlay alignment
* Persisted hide-disconnected-nodes state per workspace across JSON save/load
* Fixed selection visual feedback using `setElementState` with halo styles and preserved visibility during style updates
* Fixed lasso wrapper staying visually active after data editor updates
* Persisted node positions in Excel export from data editor
* Persisted data editor warning dismissal via `localStorage`
* Fixed inline Delta4 icon in standalone HTML bundle
* Added right margin to filter lock status bar to avoid overlapping edit button

### UI

* Redesigned color scale and numeric scale picker popups to use the app's `Popup` system with consistent header, footer, buttons, and overlay styling
* Reordered header buttons to place export functions at the end
* Moved edit button to filter container and positioned it in top-right corner
