# ADR 0047: Choice columns keep their options in the column schema and their values as plain text

- Status: Proposed
- Date: 2026-10-21

## Context

Smart tables had no column type for a value picked from a short list, such as a status or a tag. People used a text column and typed the same words each time. A board over such a column worked, but typing "Doing" and "doing" made two lanes, there was no color, and nothing offered the choices. The owner decided on 2026-10-21 that smart tables get a choice column in two kinds, pick one and pick several, with named colored options.

## Decision

- **Options live in the column schema.** `data.smart.columns[columnId]` gets `"type": "choice"`, `options` (a list of `{name, color}`, at most 50, in the order the person set), and `multi` (boolean). Colors are the seven names of the brand's pens (`indigo`, `amber`, `ink`, `fern`, `brick`, `walnut`, `plum`), so a theme change recolors them. The format needs no new version: `smart` was already a pass-through key (`docs/format/README.md` section 6.3), and a page without these fields loads unchanged.
- **Values are plain text.** A cell stores the option's name. With `multi`, it stores names joined by a comma and a space, in the order of the options. Option names cannot contain a comma. Every other reader, every export, and every formula sees the words, and a formula reads a choice as its text (`[Status] = "Done"`).
- **A rename rewrites the cells.** Renaming an option changes the text in every cell that holds it, and in filters and saved views that name it, in the same undo step as the change to `options`. Deleting an option leaves the cells' text alone, drawn with a dashed outline, so deleting never loses a value.
- **Sorting follows the options.** A choice column sorts by the place of its option (first option, for several), blanks last in both directions. A board over a choice column has one lane per option, in order, including empty ones. Filtering uses a new `has` operation that matches one whole name in a cell.
- **Editing.** Alt+Down (or Data, Choose a value) opens a menu of the options for the cell with the caret, a radio list for one and a checkbox list for several. Data, Edit choices opens a dialog with a name field, a color list, and Up, Down, and Delete buttons for each option. Text can still be typed or pasted into a cell. Text that is no option's name is kept.
- **Chips.** The editor draws each option a cell names as a chip with inline decorations over the real text. The chip has a border in the full pen color and the primary text color on a light tint of it, so contrast holds in light, dark, and high-contrast themes, and the name is always in the text, so color is never the only sign.
- **Export.** Markdown, Word, HTML, and every other text format write the names. An Excel export writes a drop-down list (a `list` data validation on the cells below the header) for a column that picks one, when its names fit the 255 characters Excel allows; the cells themselves are the text. A column that picks several is plain text in Excel. Import keeps the text, because that is all a file holds.

## Options considered

| Option | For | Against |
|---|---|---|
| Options in the column schema, text in cells (chosen) | Old pages load unchanged; every reader and formula sees words; no new cell format | A rename must rewrite cells; commas are not allowed in names |
| An option ID in each cell | A rename touches only the schema | Other readers would see IDs; a merge of two devices could orphan IDs |
| A new cell node in the editor | Chips as real elements | A new schema node for every table reader, and Markdown export would need its own rule |
| Infer the list from the cells | No setup | No colors, order, or empty options, and typos make new options |

## Consequences

- Names with a comma are not possible; creating a choice column from a text column replaces commas in the names it finds with spaces.
- A multi-select column converted to single-select keeps its text, which then reads as one name that is no option's.
- The Excel drop-down is a hint for people editing the file. It does not stop other text (`showErrorMessage` is off), so a round trip never loses a value.
