# Pages: views and export

The pure parts of Phase 6, "Page views and export". Everything here works on page units (1/96 inch) and plain data, with no React and no page view, so the page view, the print dialog, and the exporters can be wired on top of it after Phase 4 merges. Only `print/prepare.ts`, `print/dom.ts`, and `print/browser.ts` need a live document, and only the `testing` folder needs Node.

| Folder                               | What it does                                                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [`gallery`](gallery/README.md)       | The page gallery: the thumbnail grid, keyboard movement, the drop slot, and page reordering                                               |
| [`layout`](layout/README.md)         | Reads and writes a page's `view` (paper, margins, mode, background), derives the sheet geometry, and plans where blocks land              |
| [`pagination`](pagination/README.md) | Sheet geometry and the paginator: where sheets start, with the rules for headings, lines, tables, and breaks                              |
| [`paper`](paper/README.md)           | Plain, ruled, grid, dot, isometric, Cornell, staff, and template backgrounds as vector paths and SVG                                      |
| [`reading`](reading/README.md)       | Reading aids: the line focus band, page tints, spacing, line width, and syllable breaks. Display only                                     |
| [`selection`](selection/README.md)   | Export selection: lasso geometry, smart select, a selection as a page for PDF, and as an SVG picture                                      |
| [`slides`](slides/README.md)         | Present as slides: a page split at its headings or divider lines                                                                          |
| [`zoom`](zoom/README.md)             | Zoom steps, gestures, fitting, view limits, switching between infinite and paginated view, and sheet navigation                           |
| [`elements`](elements/README.md)     | The elements library: save a selection as an element, put it back scaled to fit, folders and search, and a file to share                  |
| [`export`](export/README.md)         | Markdown and HTML export of a page, and the ink shapes both use                                                                           |
| [`print`](print/README.md)           | Turns a page into the document that prints, one box for each sheet                                                                        |
| [`pdf`](pdf/README.md)               | The PDF export job, the reader that checks the file, and the golden tests                                                                 |
| [`testing`](testing/README.md)       | The Edge print surface, sample pages, and the benchmark (numbers in [`docs/perf/phase-6-core.md`](../../../../docs/perf/phase-6-core.md)) |

Import from `features/pages`, not from a folder inside it.

## One layout for screen and paper

The paginator in `pagination` is the only place that decides where a sheet ends. The page view asks it through `layout`, and print asks it through `print`. A page break, a keep-together block, a repeated table header, and the two-line minimum therefore land in the same place on screen and in the PDF (ADR 0006).

## Wired into the app

Phase 6's screen and shell side lives in the folders `host`, `live`, `ui`, and `register.ts`. Everything above stays pure.

| Folder or file    | What it does                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `register.ts`     | The only registration file: the View tab, the Export menu, the commands, and the hook that attaches to a mounted page              |
| `flags.ts`        | The flags `pages.view`, `pages.pdf`, `pages.exportText`, `pages.exportImage`, `pages.gallery`, `pages.slides`, and `pages.reading` |
| `live/`           | The paginated view on screen: sheets, spacers, paper, the view patch, and the reading aids                                         |
| `host/`           | The page as export data, the export jobs, and the print surface over the platform's `exports` client                               |
| `ui/`             | The print dialog, the picture dialog, the gallery, the slide player, and the reading panel                                         |
| `print/window.ts` | The script of the hidden print window (`app/print.html`)                                                                           |

The shell side is `app/src-tauri/src/page_export.rs`: `print_prepare`, `print_render`, `print_close`, `export_pick_save`, `export_write`, and `export_open`. A PDF is made by `PrintToPdf` on a hidden second window, and a save goes through the Windows Save dialog.

Handwriting reaches export through `exportStrokeSources` in `host/strokes.ts`. Phase 5's ink feature registers a source that returns a page's live strokes; until then a page exports without ink.

## Not built yet

- **Lock entry** (FEATURES.md, Phase 6). The format has no page-level lock or history entry for it. Format spec 6.1 has only a lock on each block. It needs a format decision first, then the notes service.
- **Manual page breaks and keep together.** The paginator handles both, but the page view has no break block or switch to set them.
- **Tagged PDF and bookmarks.** `PrintToPdf` writes neither (ADR 0006). The DevTools route can, and `exportPdfFile` is where to ask for it.
- **The lasso.** Export as picture takes the selected blocks or the whole page. The lasso tool needs a pointer tool that Phase 5 owns.
- **Syllable breaks** change the text nodes of an editor, so they wait for a display layer that does not touch the document.
- **The elements library pane.** `elements/` is pure and has no pane yet.
