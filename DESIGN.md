# Design

Decisions and patterns for Graph Lens Lite's interface. Colour, surface and
z-index values live as tokens at the top of `src/style.css` (`:root` and
`[data-theme="dark"]`); use them, never literals.

## Colour

- Neutrals lean toward the brand slate in both themes: cool slate greys in
  light, violet-tinted surfaces in dark. No pure greys.
- The brand red (`--accent-text`) is the one accent: the selected pill or
  segment, the focus ring, a narrowed filter, section eyebrows. It also marks
  destructive actions; a separate indigo accent was considered and declined
  (2026-11). The brand slate (`--brand-border`) carries checkboxes, primary
  buttons and the Overlays bars, so a column of defaults stays quiet.

## Mental model

Filter (what is visible) → Select (the working set) → Act (style, group,
arrange). The inspector's three contexts follow it: **Filters**, **Overlays**,
**Selection**.

## Inspector rows

- Every property is one row: a muted label column (84px) and a control column
  (`propRow` in `src/managers/ui_style_div.js`, `.prop-row` in CSS). Rows are
  28px tall, top-aligned, so a row whose controls wrap keeps its label on line one.
- Labels are plain text tied to their control (`<label for>` or
  `aria-labelledby`), never filled chips; nothing that is not clickable may
  look like a button.
- Sub-groups inside a section get a small heading with a hairline above it
  (`propSubhead`: "Label", "Badges", "Start arrow"; level 3 below). The command palette names
  a row by its sub-group ("Label size") so repeated labels stay distinct.
- Headings come in three distinct levels, never two at the same weight:
  1. Section: an uppercase eyebrow in the accent colour (`.insp-section-title`:
     "Actions", "Appearance"). Every card sits under one.
  2. Card: 13px semibold in the text colour with a 1px hairline below
     (`.flat-card`, `.appearance-card`: "Nodes", "Act on Selection").
  3. Sub-group: 12px semibold with a soft hairline above (`propSubhead`).
- The dark bar is reserved for the Overlays layer stack, where it carries the
  layer's on/off switch.

## Controls

- One control height, 24px (WCAG 2.5.8), one radius, 6px, one button family:
  `.insp-btn` (hairline border, accent on hover). Palette swatches are 20px with
  a 4px gap, inside the 2.5.8 spacing exception.
- Pick the control by property type:
  - 2–6 options that fit on the row: segmented control (`.prop-seg`, pressed
    state = value). Longer enums: `<select>`.
  - On/off: native checkbox (`.prop-check`). Every checkbox takes the brand
    slate from one global rule, so a column of ticked defaults stays quiet and
    the red accent is left for what changed (a narrowed filter). Never a hidden
    input under a drawn box.
  - Pick several values from a list: a field button that opens a checkbox
    group (`DropdownChecklist`, built on `RailMenu`), never a native
    multi-select. It shows "All", "None", the one kept value, or "4 of 6"; the
    list has an All box that goes mixed (and acts on the search results while
    a search is typed), a count per value, search from 10 values with a live
    "3 of 42 values" line under it, and "Only" on each value (Enter on a
    focused value, or Alt-click, does the same).
  - Number with a range: slider plus number field; arrow keys step.
  - Colour: painted well over the native picker, hex field, palette, then
    **Map…** when the property can be driven by data.
- A control that is frozen (filters held by an edited query) is `disabled`,
  not just dimmed, so the keyboard skips it too. What only reads (fold a
  group, switch Node/Edge, search, the row's ⋯ menu) stays live.
- "Map by data" is always a labelled **Map…** button at the row's end, never a
  bare glyph.
- A "select all in this group" control is one tri-state checkbox (ticked,
  mixed, empty), not separate enable/disable buttons.

## Row actions

- A row with more than two actions puts them behind one visible **⋯** button
  at its end (`.filter-row-more`, `.group-row-more`), opening a `RailMenu` of
  labelled items. The button is always visible, not revealed on hover.
- Inline next to it only what also shows state (the group dot on a filter
  row). An inline control that is empty by default may hide until the row is
  hovered or the control is focused, as long as it stays in the tab order.
- Popups (`RailMenu`) open from Enter, Space or ↓ on their trigger, move focus
  inside, and return it to the trigger on Escape.

## Editing the selection

- Controls show what the selection carries: the shared value when every
  selected element agrees, **Mixed** when they differ (empty field with a
  "Mixed" placeholder, outline slider thumb, a well sliced from the actual
  colours, no segment pressed, a disabled "Mixed" option). Users never pick
  "Mixed"; any edit applies to every selected element.
- Edits apply on commit (slider release, Enter or leaving a field, a click on a
  swatch or segment), each one undo step. There is no Apply/Save button in the
  inspector; undo is the safety net.
- When a colour is mixed, an **In selection** row lists each distinct colour
  with its count; recolouring one changes only those elements.

## Top bar

- Only everyday, workspace-wide controls sit on the bar: File, workspace,
  undo/redo, Fit, Layout, Search, the selection chip, the four workbench tabs,
  Export, theme, help. It has to fit a 900px window with labels hidden (they
  drop at 1200px); a control that would push it past that belongs somewhere
  else.
- The selection chip is the selection's one home: it shows the counts, × clears,
  and clicking it opens everything that builds, frames or walks back a
  selection (lasso, select all/none/by name, zoom to, undo/redo selection).
- Modes without a button of their own (lasso, placing a note) announce
  themselves in the stage's mode line, with how to leave them.
- View preferences that change what is drawn (hover highlight, minimap, notes)
  are switch rows in the Overlays tab, not bar buttons.

## Saving

- File holds **Open graph file…** and, right under it, **Save as JSON** (S),
  the format that keeps everything. Export lists the other formats.
- Work is unsaved from the first recorded change after a load or a save, and
  while the data editor has staged edits. Closing then asks first: the
  browser's own "Leave site?" prompt on the web, a Close without saving /
  Cancel dialog in the desktop app. An action that already confirmed it
  discards everything (start over) does not ask twice.

## Narrow windows

- 761–860px: the full bar, tighter. ≤760px (phones): the graph takes the whole
  width; the bar keeps File, workspace, undo/redo, ▤ Panel and ⋯ More, and
  ⋯ More lists the rest by name (menus it reaches open under ⋯ More).
- The inspector is a bottom sheet at half or full height, opened by ▤ Panel,
  closed by ×, Escape, ▤ Panel or the phone's Back gesture; the grabber switches
  heights. It never opens itself: the Panel button shows the selection count
  instead, plus "N hidden" when filters hide part of the selection (the
  Selection context says the same in a sentence, at every width).
- The tour opens the sheet for the steps that explain the inspector, points at
  ⋯ More for rail controls the bar hides, and adds an "On a narrow screen" line
  where the phone layout differs.
- The workbench and the sheet share the bottom edge: opening one closes the
  other.

## Workbench tabs

- The dark header holds only the tab's title, ⓘ help, ⤢ expand and × close.
  Every tab's own actions sit in a `.wb-toolbar` inside its pane: state or view
  switches on the left, then the actions as neutral `.insp-btn` at the right.
  One filled `.insp-btn.primary` per surface, for the action the surface exists
  for; buttons are never colour-coded by action.
- A toolbar that drives the graph says what it is doing in words, on its left.
  The query toolbar's status pill reads **Synced** (box = filter panel),
  **Edited** (not applied yet), **Applied** (the query filters the graph and
  locks the panel) or **Error**, followed by the problem it found
  ("Not recognised: …").
- A blocked action keeps focus (`aria-disabled`) and its reason is shown inline,
  not only in a tooltip. Actions with a keyboard path say so in their tooltip
  (Ctrl/⌘+Enter = Filter graph).

## Editable tables (Data editor)

- The Data tab's toolbar: Rows and Type switches and the filter on the left, a
  count next to them, + Add / Import / Export at the right.
- Subsets of one table are segmented controls with counts (Rows: Selection |
  All; Type: Nodes | Edges | Both), never a row of tabs.
- The table is an APG grid: one Tab stop, arrow keys between cells, Enter, F2,
  typing or double-click to edit, Enter commits and moves down (Shift+Enter
  up), Tab commits and moves right, Escape cancels. The active cell is ringed
  for the mouse too. Keys pressed in the grid never reach app shortcuts.
- Export saves the rows shown (Rows, Type and the filter). Import is blocked
  (`aria-disabled`, with the reason) while changes are staged; Apply confirms
  with "Applied N changes"; a blocked Apply moves to the row that blocks it,
  switching view or clearing the filter if needed.
- Edits that only reach the graph together are staged and always visible:
  edited cell = amber wash with the old value in its tooltip, new row = green
  with a "New" pill, deleted row = red strikethrough that stays listed with
  ↺ Restore. Colours come from the `--edited-*`, `--added-*`, `--deleted-*`
  tokens; the pill and the bar say it in words too.
- A bar under the table exists only while something is staged: "N unsaved
  changes", the breakdown (or the first problem blocking Apply), **Review**
  (each change with its own Undo), **Discard** (confirms, since nothing else
  keeps the work), **Apply N changes**. Deleting a row never confirms; it is
  staged and undoable.
- Adding something is a small form in a popover with an explicit button and
  the error under its field, never a text prompt or a toast.
- An empty view says why in one sentence and offers the one way out ("Show
  all 1000 nodes", "Clear filter").

## Known gaps

- The data editor renders every row (2,500 rows take about 44ms); past
  ~20,000 rows it will need virtual scrolling with `aria-rowcount` /
  `aria-rowindex`.
- Filter rows add matches to the selection in two clicks (⋯ › Add matches);
  the old inline ± did it in one.
