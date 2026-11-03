# Spreadsheet data

Each file holds one case for `data.sheet` (spec 6.3). Between them they show every key, every style key and named value, and values at the edge of their range and just past it. They also hold the limits of spec section 16, and pages that Beta 8 wrote or edited. Every case names the rules it tests, so a reader can find the fixture for a rule, and the other way round.

| Key | Meaning |
|---|---|
| `name`, `rules` | What the case shows, and the rule IDs it tests |
| `page` | A `page.json` whose first block is the table |
| `stamp` | The version keys a writer of version 2 gives the page |
| `problems` | Values a reader must find invalid. Without this key, the page has none |
| `expect` | What a reader must compute from the table, as below |

| Key of `expect` | Meaning |
|---|---|
| `formulaCells` | The formula cells, as `[row ID, column ID]` in table order (`R-SHT-5`) |
| `styleIds` | Styles, the IDs already in the table, and the ID a writer gives each one (`R-SHT-6`) |
| `activeMerges` | The merges a reader uses, by ID (`R-SHT-12`) |
| `applyOrder` | The order conditional formats apply in (`R-SHT-15`) |
| `fingerprint`, `fresh` | The fingerprint of the cells, and whether `values` may be used (`R-SHT-18`) |
| `orphans` | Entries that name rows or columns the table no longer has (`R-SHT-2`) |
| `layers` | The layers of a cell's look, lowest first (`R-SHT-9`) |
| `roundTrip` | `true` when a reader of version 1 must read the page and write it back with every key it had (`beta8-smart.json`) |
| `smartKeys` | The keys of `data.smart` the page holds, all kept (`beta8-smart.json`) |

## Files

| File | What it shows | Rules |
|---|---|---|
| `cells.json`, `styles.json` | Cell styles, the style sheet, and the IDs a writer derives | `R-SHT-3`, `R-SHT-6`, `R-SHT-7` |
| `style-keys.json` | Every key of a style, with values a reader finds invalid | `R-SHT-7`, `R-VAL-1` |
| `style-enums.json` | One style for each named value: alignment, underline, strike, script, the 18 patterns, the 14 border styles, colors, fonts, number formats | `R-SHT-7`, `R-VAL-2` |
| `style-boundaries.json`, `style-past.json` | Every number of a style at the edge of its range, and just past it | `R-VAL-1`, `R-VAL-3`, `R-VAL-4` |
| `table.json`, `table-look-object.json`, `table-flags.json` | Table settings: a look as a name and as an object, banding, emphasis, freeze, padding, gridlines, and the name | `R-SHT-10` |
| `cols.json`, `rows.json`, `outline.json`, `outline-past.json` | Column and row settings: styles, hidden, outline levels 0 to 7, collapsed, and heights at 1 and 10,000 | `R-SHT-11` |
| `merges.json` | Merges, and which ones a reader uses | `R-SHT-12` |
| `names.json`, `names-kinds.json`, `names-invalid.json` | Names: a range, a constant, a formula, a LAMBDA, both scopes, every way a name may start, and names that are cell references or repeat | `R-SHT-13` |
| `validation.json`, `validation-kinds.json`, `validation-past.json` | Every kind, operator, and shape of range of data validation, and rules just outside the grammar | `R-SHT-14`, `R-SHT-22` |
| `conditional.json`, `conditional-types.json`, `conditional-past.json` | The 15 types of conditional format with every operator, period, and icon set, the order at 1 and 256, and rules just outside the grammar | `R-SHT-15` |
| `notes.json` | Notes on cells, which stay at version 1 | `R-SHT-16` |
| `v.json`, `values.json`, `valuesOf.json`, `spill.json` | `v`, cached values, fingerprints, spilled cells, and every shape of cached value, among them the unknown error `#LATER!` and numbers written with an exponent | `R-SHT-4`, `R-SHT-5`, `R-SHT-17`, `R-SHT-18` |
| `links.json` | The pages that cross-page references name | `R-SHT-19` |
| `beta8-before.json`, `beta8-after.json` | A page of version 2 that Beta 8 edited: the entries of deleted rows stay, and the cached values are stale | `R-SHT-20`, `R-SHT-2` |
| `beta8-smart.json` | A page as Beta 8 writes it today: a smart table with `data.smart` holding every key the app keeps (typed columns, choices, a unit, filters, two charts, a board view, a sort, a saved view) and formulas in its cells. It stays at version 1 and a reader keeps every key | `R-SHT-1`, `R-STAMP-1` |
| `smart-and-sheet.json`, `smart-edited-stale.json` | `data.smart` beside `data.sheet`. The fingerprint covers the smart settings, so changing one makes the cached values stale | `R-SHT-1`, `R-SHT-18` |
| `limits/cases.json` | Each limit of spec section 16, once at its boundary and once past it | `R-SHT-3` and others |

## Limits

`limits/cases.json` has a `page` (the table every case uses) and a list of `cases`. A case at a limit is too big to keep as text, such as a million cells. So its `sheet` says how to build it, with the directives that `docs/format/tools/sheet_limits.py` defines. Each case has a boundary, `at`, and one past it, `past`. A page built with the `at` count has no problems. A page built with the `past` count has exactly the `problems` of the case. Both have the case's `stamp`. A reader that implements the directives can build the same pages in any language.

Counts of entries (styles, merges, names, rules, notes, links, and cells) are counts of the map's entries, whatever IDs they hold. A cell or a note counts once, however many rows hold them. Lengths of strings are characters, except a note of Markdown, which is counted in bytes (`R-SHT-16`), so one case builds a note out of two-byte characters.
