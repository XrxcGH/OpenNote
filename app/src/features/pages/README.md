# Pages: views and export

The pure parts of Phase 6, "Page views and export". Everything here works on page units (1/96 inch) and plain data, with no React and no page view, so the page view, the print dialog, and the exporters can be wired on top of it after Phase 4 merges. Only `print/prepare.ts`, `print/dom.ts`, and `print/browser.ts` need a live document, and only the `testing` folder needs Node.

| Folder                               | What it does                                                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [`gallery`](gallery/README.md) | The page gallery: the thumbnail grid, keyboard movement, the drop slot, and page reordering |
| [`layout`](layout/README.md)         | Reads and writes a page's `view` (paper, margins, mode, background), derives the sheet geometry, and plans where blocks land              |
| [`pagination`](pagination/README.md) | Sheet geometry and the paginator: where sheets start, with the rules for headings, lines, tables, and breaks                              |
| [`paper`](paper/README.md)           | Plain, ruled, grid, dot, isometric, Cornell, staff, and template backgrounds as vector paths and SVG                                      |
| [`reading`](reading/README.md) | Reading aids: the line focus band, page tints, spacing, line width, and syllable breaks. Display only |
| [`selection`](selection/README.md) | Export selection: lasso geometry, smart select, a selection as a page for PDF, and as an SVG picture |
| [`slides`](slides/README.md) | Present as slides: a page split at its headings or divider lines |
| [`zoom`](zoom/README.md)             | Zoom steps, gestures, fitting, view limits, switching between infinite and paginated view, and sheet navigation                           |
| [`elements`](elements/README.md) | The elements library: save a selection as an element, put it back scaled to fit, folders and search, and a file to share |
| [`export`](export/README.md)         | Markdown and HTML export of a page, and the ink shapes both use                                                                           |
| [`print`](print/README.md)           | Turns a page into the document that prints, one box for each sheet                                                                        |
| [`pdf`](pdf/README.md)               | The PDF export job, the reader that checks the file, and the golden tests                                                                 |
| [`testing`](testing/README.md)       | The Edge print surface, sample pages, and the benchmark (numbers in [`docs/perf/phase-6-core.md`](../../../../docs/perf/phase-6-core.md)) |

Import from `features/pages`, not from a folder inside it.

## One layout for screen and paper

The paginator in `pagination` is the only place that decides where a sheet ends. The page view asks it through `layout`, and print asks it through `print`. A page break, a keep-together block, a repeated table header, and the two-line minimum therefore land in the same place on screen and in the PDF (ADR 0006).

## Not built here

- **Lock entry** (FEATURES.md, Phase 6). The format has no page-level lock or history entry for it. Format spec 6.1 has only a lock on each block. It needs a format decision first, then the notes service.
- **Anything that draws or listens.** That means the page view, the print dialog, the reading panel, the elements pane, the gallery view, and the slide player. The README of each folder ends with what its wiring needs.
- **The WebView2 side of PDF export.** The host opens the hidden print window and calls `PrintToPdf`. The timings, memory, and fidelity there still need the checks that ADR 0006 lists, on the reference laptop and a Surface Pro.
