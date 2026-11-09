# Design

Decisions and patterns for Graph Lens Lite's interface. Colour, surface and
z-index values live as tokens at the top of `src/style.css` (`:root` and
`[data-theme="dark"]`); use them, never literals.

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

## Editable tables (Data editor)

- A workbench tab keeps its toolbar inside its pane, not in the dark header:
  view switches and the filter on the left, a count next to them, then the
  tab's actions as `.insp-btn` at the right. One filled `.insp-btn.primary`
  per surface, for the action the surface exists for.
- Subsets of one table are segmented controls with counts (Rows: Selection |
  All; Type: Nodes | Edges | Both), never a row of tabs.
- The table is an APG grid: one Tab stop, arrow keys between cells, Enter, F2,
  typing or double-click to edit, Enter commits and moves down, Tab commits
  and moves right, Escape cancels. The active cell is ringed for the mouse too.
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

- Light-mode neutrals are pure greys and the accent is the brand red, which also
  marks destructive actions. Moving to cool slate neutrals with an indigo accent
  is an open token-level change.
- The Query and Assistant toolbars still sit in the workbench's dark header
  as coloured buttons; only the Data tab follows the table pattern above.
  Query's four actions (Apply, Select, Sync, Clear text) need their own
  review, not just a restyle.
- The data editor renders every row (2,500 rows take about 44ms); past
  ~20,000 rows it will need virtual scrolling with `aria-rowcount` /
  `aria-rowindex`.
- Filter rows add matches to the selection in two clicks (⋯ › Add matches);
  the old inline ± did it in one.
