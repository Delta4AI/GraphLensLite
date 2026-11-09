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
  (`propSubhead`: "Label", "Badges", "Start arrow"). The command palette names
  a row by its sub-group ("Label size") so repeated labels stay distinct.
- Sections use a flat uppercase header with a 1px hairline below (`.flat-card`,
  `.appearance-card`). The dark bar is reserved for the Overlays layer stack,
  where it carries the layer's on/off switch.

## Controls

- One control height, 24px (WCAG 2.5.8), one radius, 6px, one button family:
  `.insp-btn` (hairline border, accent on hover). Palette swatches are 20px with
  a 4px gap, inside the 2.5.8 spacing exception.
- Pick the control by property type:
  - 2–6 options that fit on the row: segmented control (`.prop-seg`, pressed
    state = value). Longer enums: `<select>`.
  - On/off: checkbox (`.prop-check`).
  - Number with a range: slider plus number field; arrow keys step.
  - Colour: painted well over the native picker, hex field, palette, then
    **Map…** when the property can be driven by data.
- "Map by data" is always a labelled **Map…** button at the row's end, never a
  bare glyph.

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

## Known gaps

- Light-mode neutrals are pure greys and the accent is the brand red, which also
  marks destructive actions. Moving to cool slate neutrals with an indigo accent
  is an open token-level change.
- The workbench (Data, Query, Metrics, Assistant) and the filter rows have not
  been moved onto these patterns yet.
