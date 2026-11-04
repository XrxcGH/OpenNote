# ADR 0062: Names, structured references, and references to other tables and pages

- Status: Proposed
- Date: 2026-11-01

## Context

Formulas can name only cells and columns of their own table (`B2`, `[Price]`, `{c1}`). Excel has workbook and sheet names, structured references to tables (`Sales[Amount]`, `[@Amount]`), and references to other sheets; Sheets and Numbers have the same ideas. OpenNote has pages with several table blocks, and many pages in a notebook.

## Decision

- **A page is the workbook; a table is a sheet and a table object at once.** Each table has a name (`data.sheet.table.name`, default `Table1`, `Table2` in page order, unique on the page).
- **Same-page references**: `Sales[Amount]`, `Sales[@Amount]`, `Sales[[#Headers],[Amount]]`, `Sales!B2:B9`. The page keeps one dependency graph over its tables.
- **Names**: `data.sheet.names` holds names with `scope` `table` (default) or `page`. A name can be a range, a constant, a formula, or a lambda function (`LAMBDA`), which is then callable. Lookup order: LET variables, LAMBDA parameters, table names, page names, column names, functions. A page-scope name defined in two tables resolves to the first table on the page and is flagged.
- **Other pages**: `'Page title'!Table[Col]`, resolved through `data.sheet.links` (title to page ID), so renaming the page rewrites the title. Values come from that page's fresh cached values (ADR 0061), refreshed when that page saves and when this page opens. A missing page or table gives `#REF!`. Read-only: no formula writes across pages.
- **Export**: table-scope names become sheet-local defined names, page-scope names workbook names, tables become ListObjects, and cross-page references become external references only when the other page is exported in the same workbook; otherwise their cached value is written.

## Options considered

| Option | For | Against |
|---|---|---|
| Page as workbook, names in tables, cross-page by cached values (chosen) | No new page-level format field; matches Excel's mental model; cross-page needs no remote recalculation | Page-scope names live in one table's data; cross-page values can lag until the other page saves |
| Notebook-wide names in `notebook.json` | One place for global names | A tree file change; merges of `notebook.json` are by entry with last change winning; heavier |
| Live recalculation across pages | Always current | Loads other pages' tables on every edit; cycles across pages; slow on large notebooks |

## Consequences

- Cross-page references need the notes service to deliver another page's table data on request and a reverse index to refresh readers (R3).
- The Name manager shows both scopes and conflicts.
