# ADR 0056: Cell formatting lives in a style sheet in the table block's `data.sheet`

- Status: Proposed
- Date: 2026-11-01

## Context

The owner asked that tables match Excel, Google Sheets, Word, and Google Docs for padding, alignment, fill colors, borders, and the rest of cell formatting. Today formatting exists only per column (`data.smart.columns`: type, decimals, currency) and per text run (Markdown marks). There is nowhere to store a fill, a border, an alignment, a padding, a row height, or a merge.

Three facts measured on `origin/beta` constrain where new data can go:

- `readSmart` and `smartPatch` (`app/src/features/tables/smart/data.ts`) rebuild `data.smart` from the keys they know and write the whole object back, so a current client erases any new key inside `data.smart` the first time it changes a column or a filter.
- `normalizeTableData` and `docToTableData` (`app/src/editor/table/mapping.ts`) drop unknown keys on columns, rows, and cells, so a per-cell attribute would vanish at the first keystroke in a current client.
- Unknown top-level keys of a table block's `data` survive in both paths: typing sends merge patches that name only `rows`, structure changes name only `header`, `columns`, and `rows`, and the Rust model keeps `TableData.extra`.

## Decision

We will store spreadsheet formatting and rules in a new optional key, `data.sheet`, beside `data.smart`:

- A style sheet `styles` maps a short content-hash ID to a style object (number format code, font, fill, borders, alignment, padding, protection).
- `table`, `cols`, `rows`, and `cells` assign styles and settings by table, column ID, row ID, and row ID then column ID.
- `merges`, `names`, `validation`, `conditional`, `notes`, `values`, `valuesOf`, and `links` hold the other spreadsheet features (ADRs 0061, 0062, 0064).
- Every collection is a JSON object keyed by ID, never a list by position, so RFC 7396 patches touch one entry and concurrent changes to different cells merge.
- A cell's look is layered: theme, table look, table, column, row, cell, conditional formats. Applying a row or column property removes that property from the cells inside, as Excel copies row and column formats onto cells.
- Formatting never changes a cell's Markdown. Markdown marks keep drawing on top, as rich text in an Excel cell does.

In the same release we fix the two preservation defects: the table mapping keeps unknown keys and reads row and column IDs from node attributes, and `readSmart` keeps unknown keys and patches only what changed.

## Options considered

| Option | For | Against |
|---|---|---|
| `data.sheet` with a style sheet and ID-keyed maps (chosen) | Survives current clients; small notes; patches merge per cell; other readers keep clean Markdown | A second table-level key beside `data.smart`; needs garbage collection of unused styles |
| Inside `data.smart` | One key for all table extras | Erased by every current client (measured) |
| Attributes on each cell object (`cells[col].style`) | Formatting sits next to its text | Dropped by current TypeScript clients; whole-row list patches make concurrent formatting conflict |
| HTML spans in the cell's Markdown | Visible to any Markdown reader | Cannot express cell fill, borders, padding, or alignment; pollutes `page.md` and exports |
| A style per cell without a sheet | Simple | 100,000 formatted cells would repeat the same objects; notes grow by megabytes |

## Consequences

- Older clients show tables without formatting and keep the data. Whether pages that use `data.sheet` raise `formatVersion` is PLAN.md decision 1 (recommended: format version 2 for this release, written only on pages that use a version 2 feature, `minReaderVersion` 1).
- The format specification gains section 6.3 text for `data.sheet`, limits in section 16, an Appendix C entry, and fixtures under `docs/format/fixtures/table-sheet/`.
- Exporters (Rust) read `data.sheet` through a new `crates/interop/src/sheet/` module.
- Revisit if the format ever stores tables as their own files, or if a block-level CRDT replaces merge patches (ADR 0049 follow-ups).
