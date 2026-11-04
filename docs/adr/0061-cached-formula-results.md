# ADR 0061: Tables cache formula results in the file

- Status: Proposed
- Date: 2026-11-01

## Context

A table cell stores only its Markdown (`=B2*C2` for a formula). Results exist only while the app runs the engine. So every export (Excel, CSV, HTML, Word, Markdown, `page.md`), the search index, other readers of the format, and any cross-page reference see the formula text, never the number (CURRENT.md section 10). Excel and ODF files solve this by storing the last calculated value beside each formula.

## Decision

We will store the last results of formula cells and spilled cells in `data.sheet.values` (a map of row ID to column ID to value; errors as `{"e": "#N/A"}`) with `data.sheet.valuesOf`, a fingerprint (FNV-1a) of the table's cell Markdown when the values were written:

- The app writes `values` with the edit that changed them, in the same patch, never as a separate undo step. Volatile functions are cached at their last calculation, as Excel does.
- A reader computes the fingerprint; if it differs (an older client edited the table), `values` is stale and is not trusted.
- Exporters write cached values when fresh. Excel export always sets `fullCalcOnLoad` so Excel recalculates anyway; CSV, HTML, Word, and Markdown fall back to formula text when stale and the export report says so.
- Cross-page references read another page's fresh cached values.

## Options considered

| Option | For | Against |
|---|---|---|
| Cache in `data.sheet.values` with a fingerprint (chosen) | Every reader and exporter sees results; Rust needs no formula engine; staleness is detectable | Larger files; one more thing that changes on edit |
| A formula engine in Rust as well | Exact results anywhere | A second implementation of about 520 functions to keep identical |
| Compute in the app at export time only | No file change | Fails for the Rust exporters, the CLI, other readers, and cross-page references |

## Consequences

- A table of 10,000 formula cells grows by about 300 KiB uncompressed (page files are gzip-friendly).
- Sync traffic grows with recalculation; values are written only when they change, and volatile results only when an input changes.
- Protected sections encrypt the cache with the rest of the page.
