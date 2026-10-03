# Phase 6 core performance

Numbers for the pure modules of the pages feature (`app/src/features/pages`) and for the PDF export, measured by `app/src/features/pages/testing/bench.test.ts`. They are the baseline for the page view and the print dialog when Phase 6 wires them in.

## How to repeat it

```
OPENNOTE_BENCH=1 OPENNOTE_BENCH_OUT=bench.json npx vitest run --config app/vitest.config.ts --project unit app/src/features/pages/testing/bench.test.ts
```

Without `OPENNOTE_BENCH`, the same file runs on small inputs with budgets about ten times looser than the numbers below, so an ordinary test run still catches a step that turns quadratic. With it, the file measures the full sizes and drives the installed Edge for the export rows. Each row is the median of five runs (three for the export), after one warm-up run. The machine must be otherwise idle: the same code ran four to eight times slower while other jobs shared it.

## Machine

Surface Laptop Studio 2, Core i7-13800H, 32 GB, Windows 11 Pro 25H2, Node 24.16, Edge 154.0.4258.48. The export rows use Playwright's `page.pdf()`, which is the DevTools route (`Page.printToPDF`) of the same Chromium that WebView2 runs. It is not `PrintToPdf` in a hidden WebView2, so the rows say how the pipeline behaves, not what the shipped export will measure (see "What this does not show").

## Results

A letter-size flow page. A "block" in the sample pages is a heading, a paragraph of about eight lines, and a two-item list, so 6 blocks fill about one sheet.

### Layout, pagination, and paper

| Step                                    | Input                              | Median                |
| --------------------------------------- | ---------------------------------- | --------------------- |
| Paginate a flow (`planFlow`)            | 100 blocks, 26 sheets              | 3.7 ms                |
|                                         | 1,000 blocks, 298 sheets           | 23 ms                 |
|                                         | 10,000 blocks, 2,913 sheets        | 133 ms                |
| Draw one sheet of paper (paths and SVG) | plain, ruled, grid, Cornell, staff | 0.1 to 0.5 ms         |
|                                         | dots (18.9 spacing)                | 4.3 ms                |
|                                         | isometric                          | 3.0 ms                |
| Zoom about a point and clamp the view   | 10,000 gestures                    | 4.6 ms (0.46 µs each) |

A re-plan after an edit costs well under the 16 ms typing budget for any realistic page (a 100-block page is 4 ms), so the page view can re-plan on the next frame. It never needs to run in a worker.

### Markdown and HTML export

| Step             | 12 blocks | 120 blocks | 1,200 blocks |
| ---------------- | --------- | ---------- | ------------ |
| `exportMarkdown` | 0.6 ms    | 2.1 ms     | 17.5 ms      |
| `exportHtml`     | 3.1 ms    | 15 ms      | 90 ms        |

Both grow in proportion to the page.

### PDF export (measure, plan, print, read)

| Step                                     | 2 sheets    | 18 sheets   | 86 sheets   |
| ---------------------------------------- | ----------- | ----------- | ----------- |
| Measure the layout in the print document | 208 ms      | 260 ms      | 513 ms      |
| Plan the sheets                          | 17 ms       | 81 ms       | 362 ms      |
| Build the print document                 | 4 ms        | 8 ms        | 41 ms       |
| `page.pdf()` in Edge                     | 844 ms      | 817 ms      | 1,774 ms    |
| Read and check the file (`inspectPdf`)   | 35 ms       | 167 ms      | 750 ms      |
| Total                                    | about 1.1 s | about 1.3 s | about 3.4 s |
| File size                                | 61 KiB      | 228 KiB     | 970 KiB     |

The Edge steps dominate, as ADR 0006 found. The first export of a browser session pays about a second more for starting its print path, so every row leaves out a warm-up run.

Every export step grows in proportion to the number of sheets (planning is 4.5 times slower for 4.8 times the sheets).

## What the benchmark found

The first run of this benchmark showed the PDF reader (`pdf/inspect.ts`) taking 3.3 s for the 86-sheet file, longer than printing it. These changes brought it to 0.75 s:

- The lexer in `pdf/objects.ts` made a string and ran a regular expression for every byte class test and every number, and lexed each operator twice. It now classifies bytes through lookup tables and reads numbers straight from the bytes.
- `readObjects` scanned the binary data of every stream for the text `n g obj`. It now skips past each stream it has read.
- The content streams of a chunk of 16 pages inflate at once.

`exportPdf` also closes the print window before it reads the file. An open window competes for the processor, and nothing needs it once the bytes are in hand.

## Budgets

| Budget (BRAND.md section 10 and ADR 0006)           | Status                                                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Typing and drawing never wait for an export         | Holds by construction: the export runs in a separate print window. Not yet measured with the real WebView2 and live typing |
| Re-plan inside one 16 ms frame                      | Holds up to about 700 blocks (23 ms for 1,000). A larger page would need an incremental plan (see the last point below)    |
| A 50-sheet export finishes without freezing the app | 3.4 s for 86 sheets here, against 6.25 s for 50 sheets in the spike's hidden WebView                                       |

## What this does not show

- **Not `PrintToPdf` in a hidden WebView2.** ADR 0006 measured that route taking a third longer than the visible one, and Phase 6's wiring has to repeat it on the reference laptop and a Surface Pro.
- **No ink in the benchmark pages.** The golden tests print ink, and the spike measured 83 strokes. A page with thousands of strokes needs its own row once the notes service feeds real ones.
- **Fonts.** The sample pages inline the three bundled fonts as the screen does, so their layout matches. The static-font embedding check in ADR 0006's consequences still waits for static font files.
- **Whole-page re-plan.** `planFlow` re-plans the whole flow. At 133 ms for 10,000 blocks, a page of that size would need an incremental plan (re-plan from the first changed block, since earlier sheets cannot move). No real page is near that size, so this is deferred.
