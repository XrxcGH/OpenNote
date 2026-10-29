# Stroke model

This folder connects the note file's ink records to the strokes the geometry works on. It has no React, no browser calls, and no platform code.

## What it does

A stroke record (format spec 9.3) stores points as small whole numbers: positions in 1/64 page unit, pressure from 0 to 65535, tilt in 1/100 degree, and time in 100-microsecond steps. The geometry works with page units, fractions, degrees, and milliseconds. The adapters in `convert.ts` move between the two. Quantizing a stroke twice gives the same record, so saving and loading never drift.

- `types.ts` defines `InkStroke`: the geometry's stroke plus the block, palette slot, color, and the flags a record carries.
- `convert.ts` has `strokeFromRecord` and `recordFromStroke`. It also has `recordBounds`, which gives a stroke's page-space box from its record header alone, without decoding any points. The engine builds its index from these boxes at page open.
- `table.ts` folds a page's records, in order, into a table of strokes: a stroke record adds or replaces, a property record changes some fields, and a remove record deletes.
- `restyle.ts` recolors strokes, makes them thicker or thinner, and sets a width, without touching their points.
- `fixtures.ts` makes valid IDs and sample strokes for tests and benchmarks.

## Rules the adapters keep

- Positions that pass the format's range are clamped, not rejected. Pressure and tilt are clamped too.
- A point's time never goes backward. The first point's time is the part of the start time below one millisecond. A slice cut from the middle of a stroke by the partial eraser therefore still starts under one millisecond.
- A stroke with no pressure, tilt, or time keeps those channels off. A recognized shape stays exact.
- A tool byte this version does not know stays in `toolCode`, and the stroke draws as a pen. The record encodes back with the same byte.

## Public API

| Name                                                            | Use                                                  |
| --------------------------------------------------------------- | ---------------------------------------------------- |
| `strokeFromRecord(record)`                                      | Decode a record for drawing and hit tests            |
| `recordFromStroke(stroke)`                                      | Encode a finished stroke for `page_add_strokes`      |
| `canEncode(stroke)`                                             | Check the point count (1 to 200,000) before encoding |
| `recordBounds(record)`                                          | Index a stroke without decoding it                   |
| `foldRecords(records, table?)`, `applyRecord(table, record)`    | Build and update the stroke table                    |
| `recolor(strokes, color, kind?)`                                | The Recolor menu                                     |
| `scaleWidths(strokes, factor)`, `setDrawnWidth(strokes, width)` | Thicker, Thinner, and the width picker               |

## What the interface needs

- Give every new stroke an ID from the shared ID generator (change C7). The adapters never make IDs.
- Recolor and width changes are `restyleStrokes` edits for the core. These functions give the new strokes to show at once, and the core stores the result.
- Decode strokes lazily. At page open, index every record with `recordBounds`, and decode only the strokes that meet the viewport.
