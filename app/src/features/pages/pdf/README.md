# PDF export

This folder runs the export of a page to PDF and checks the file. It does not draw the PDF. The renderer is WebView2's `PrintToPdf` in a hidden window (ADR 0006), and [`print/`](../print/README.md) prepares the document it prints. The job here connects the two, reports progress, stops on request, and compares the file with the plan.

## Public API

Re-exported from `features/pages`.

| Name | Purpose |
|---|---|
| `exportPdf(surface, request)` | Prepares, renders, and checks. Returns the bytes, the file's `PdfInfo`, the plan, and a list of problems |
| `PrintSurface` | What the host implements: `prepare`, `toPdf`, and `dispose` |
| `checkPdf(info, plan, options)` | Finds a file that does not match its plan |
| `inspectPdf(bytes)` | Reads a PDF: pages and sizes, the text of each page, images and vector shapes, tags, language, title, bookmarks, and fonts |
| `exportFileName(title, extension)`, `fileStem(title)` | A name that Windows and every other file system accept |

## What the checks find

- **Errors:** the page count differs from the sheets the plan printed, or a page is not the size of the sheet box.
- **Warnings:** the file has no structure tags or no language although tags were asked for, or fonts are embedded as Type 3 glyph outlines, as variable fonts become (ADR 0006, rule 3).

An export that has errors is not saved without telling the person. A warning is shown in the export report.

## The reader

`inspectPdf` reads what Chromium writes: plain objects, Flate streams, and font maps that turn the codes in a page into text. It finds objects by scanning, so it also reads a file whose table is damaged. It does not read encrypted files or object streams. It is tested on hand-made files and on the files Edge writes, and the golden tests use it to compare the text layer of each page with the document that was printed.

## Tests

- `pdf.test.ts` tests the reader, the file names, and the job with a fake surface.
- `golden.test.ts` prints sample pages with the installed Edge. It checks page count and size, the text layer against the sheets, tags, language, bookmarks, vector ink, and approved text per page. Approved results are in `testing/golden/<platform>`. Write them again with `OPENNOTE_BLESS=1`. A platform without a file checks the rules only.
- `paper.test.ts` prints the lecture page at Letter, A4, A5, Legal, Tabloid, both landscape sizes, and a custom size. It checks that breaks fall inside the content box, that no sheet ends with a heading, that no text is lost, that a table's header repeats, and that an image is not cut.

## What the UI wiring needs

1. A `PrintSurface` for the app: a hidden WebView2 window that loads the print page. `prepare` sends it the `PrepareInput` and waits. `toPdf` calls `PrintToPdf` (or the DevTools route when tags are needed) and reads the file. `dispose` closes the window.
2. A save dialog with `exportFileName(title, 'pdf')`, and a writer that saves the bytes safely (format spec 17).
3. A progress indicator from `onProgress` and a cancel button wired to the abort signal. The job runs in the background, and the main window never waits for it.
4. A report that lists `problems` with the strings for each kind.
5. A manual check on the reference laptop and a Surface Pro: the exported PDF opens in Edge, Acrobat, and a phone viewer, with text that searches and copies, and a printed sheet measured with a ruler (ADR 0006, consequences).
