# export

Writes pages, sections, and notebooks to files. An export reads from a `NoteSource` and writes into a new folder named after what it exports, so it never overwrites anything.

## Exports

| Function | Writes |
|---|---|
| `export_files` and `export_files_with` | A folder of Markdown or HTML pages in the notebook's structure, with assets in `assets/`. The HTML form adds an `index.html` |
| `export_html_single` | One self-contained `.html` file. A section or notebook gets a list of contents and jump links between pages |
| `export_docx` and `export_docx_with` | One `.docx` file. Section names and page titles keep the structure, and page links become bookmarks |
| `export_pdf_bundle` | A folder of PDF files, one for each page, with an `index.html` |

The `_with` forms take a `Control` for progress and Cancel. A canceled export deletes the folder it made, and a Word export writes nothing until every page has been read.

## Handwriting

A page with strokes gets one picture of all its handwriting. The core's `render_ink_svg` draws it as SVG, the same drawing as the page's `ink.svg`. The Markdown and web page folders write it to `assets/` and link it where the first handwriting block sits. The single web page file embeds it as a `data:` address.

The picture cannot be edited and does not sit beside the text, so the report marks it as simplified and points to PDF for the exact layout. Word exports leave handwriting out, and the report says so. A `Resolver` that does not implement `ink` gets the same result.

## The PDF seam

`export_pdf_bundle` plans the folders and names, asks a `PdfRenderer` for the bytes of each page, and reports page by page. It does not draw. Phase 6 implements `PdfRenderer` with the PDF writer of the architecture decision record (ADR) 0006. Until then the app passes `NoPdfRenderer`, whose `available` is false, and the export fails before it creates anything with a message that says PDF export is not in this version yet.

## Files

- `plan.rs` lists the pages in scope and gives each a folder and a file name that is unique in its folder.
- `convert.rs` turns a core page into document blocks. It decides where assets and linked pages end up through a `Resolver`, and tallies what came over, what was simplified, and what was skipped.
- `files.rs`, `word.rs`, `single.rs`, and `pdf.rs` write the formats.
- `names.rs` makes file names that are safe and unique in their folder. It also makes relative paths.

## What the UI wiring needs

Flush open pages first (`Core::flush_all`), then open a `DiskSource`. Offer Markdown, web page folder, one web page file, Word, and PDF. Show the returned `Report` after the export, and `Exported::files` for "Show in folder". Handwriting goes into Markdown and HTML as a picture and never into Word, and the report says so for each page.
