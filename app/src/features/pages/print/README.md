# Print preparation

This folder turns a page into the document that prints: one box for each sheet, with everything on the sheet at the place the paginator chose. A hidden window prints that document to PDF with WebView2 (ADR 0006). The pure parts need no browser. Two files, `dom.ts` and `prepare.ts`, need a live document.

## How a page is prepared

1. `pageUnits` splits the page into units: each top-level element of a text block, each table, and each image or drawing. A heading must stay with what follows it, so it is a unit of its own. Floating blocks are their own units.
2. `measureDocument` builds a document with the flow in its column and the floating blocks where they sit, with no sheets. The window loads it.
3. `FlowMeasurer` reads the layout: a box for every line of text (and where in the text it starts), every table row, and every other unit. A line is as tall as its tallest text, picture, or task box, and a superscript or subscript is part of the line it sits on.
4. `planPage` paginates the flow and places the floating blocks, with the same paginator as the screen.
5. `planPrint` picks the sheets that print, sizes the printed box, and fills in headers and footers.
6. `printDocument` puts each slice on its sheet at its planned position. A paragraph cut between sheets is copied into two pieces with the browser's own range copy. An element a line starts, such as a list item, goes whole to the sheet of that line. A table cut between sheets becomes two tables, and the second starts with the header rows again.
7. The window shows that document, and the host prints it with `PrintToPdf`.

`preparePrint` does steps 1 to 6 in one call, and `showDocument` does step 7's loading. `browser.ts` is the script that a print window loads, and it puts both on `window.OpenNotePrint`.

## Public API

Re-exported from `features/pages`.

| Name | Purpose |
|---|---|
| `preparePrint(doc, input)` | Everything above, in the given document. Returns the print `html`, the plan, the breaks, warnings, and timings |
| `showDocument(doc, html)` | Replaces the document and waits for fonts and images |
| `planPrint(sheet, total, options)` | The sheets that print, the box size, and the bands |
| `parsePageRange(text, count, parity)` | `1-3, 5`, `6-`, odd or even sheets |
| `fillTemplate`, `fillBand`, `bandBox` | Header and footer fields (`{page}`, `{pages}`, `{title}`, `{notebook}`, `{section}`, `{date}`) and where the band sits |
| `printCss`, `measureCss`, `paperStyle` | The stylesheets |
| `measureDocument`, `printDocument` | The two documents as strings |
| `FlowMeasurer`, `settle` | Reading layout from a document, and waiting for fonts and images |
| `rotatedBounds` | The box around a rotated block, for finding its sheets |

## Rules worth knowing

- **One layout.** The paginator that plans the printed sheets is the one the screen uses, so page breaks, manual breaks, keep together, repeated table headers, and the two-line minimum land in the same places.
- **The sheet box is never larger than Chromium's page** (ADR 0006, rule 2). A4 is 594.96 points wide in WebView2 154, so the A4 box is 793.28 pixels wide, not 793.7. The page size is known for Letter and A4 in both orientations. Other sizes use the paper size. The host should probe other sizes and pass `pagePt`.
- **No borders and no screen units.** Everything is in page units (CSS pixels), and shadows and backgrounds draw the lines.
- **A block across a sheet edge shows on both sheets,** clipped at each edge. Its text appears on both pages of the PDF. A floating text box that runs off the paper loses the part past the edge, because the renderer leaves out text that is wholly outside the page.
- **Header and footer text is hidden from assistive technology,** so it does not repeat in the structure tags. The band is left out, with a warning, when the margin is under 40 page units.
- **Ink** from floating ink blocks is drawn as vector shapes above the text, and highlighters below it.
- **Paper** prints as vector lines, with the light theme's colors and no page color, so a printed sheet is white.

## What the UI wiring needs

1. **A print window.** A second window, hidden, that loads a page whose script is `browser.ts`. The same Vite build as the app can produce it as a second entry (`print.html`). It must load the same font files as the screen, as static builds (ADR 0006, rule 3), and pass them as `fontFaces` to `lightTheme`.
2. **A Tauri command** that opens that window, sends it a `PrepareInput` (the page as `ExportPage`, the asset URLs it can load, and the print options), waits for `preparePrint` and `showDocument` to finish, calls `PrintToPdf`, and closes the window. Nothing here runs on the main window, so drawing and typing never wait for an export.
3. **Asset URLs.** Images load from a path or data URI the print window may read. The host decides which, and passes `assetUrls` by asset ID.
4. **The page data.** The notes service supplies `page.json` and the live strokes (`exportStrokes`). The page's current unsaved edits must be saved first, or sent in the same form.
5. **A print dialog** with the range, odd or even, headers and footers, paper pattern, and handwriting switches, and a preview. The preview is `printDocument`'s output shown in a frame. Strings for every label belong in `app/src/strings`.
6. **Tauri `PrintToPdf` settings.** Use the page size from the document (`preferCSSPageSize` in effect), no margins, no headers or footers, and backgrounds on. Ask for tags and bookmarks (`generateTaggedPDF` and `generateDocumentOutline` on the DevTools route) if `PrintToPdf` does not write them. `inspectPdf` in the PDF module tells which it did.
