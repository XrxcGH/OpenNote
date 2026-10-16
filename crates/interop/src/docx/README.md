# docx

Writes a Word file (`.docx`) by hand, so the crate needs no Word library. A document is a handful of XML parts in a ZIP archive.

## What it does

- `mod.rs` builds the archive from a `WordInput`: a title, dates, the body as `Part` values, and the pictures. It writes the content types, relationships, styles, numbering, document, and properties.
- `body.rs` writes blocks as paragraphs, lists, and tables. `runs.rs` writes runs with their marks, links, and pictures. `parts.rs` holds the fixed parts.
- `zip.rs` is a small ZIP writer that stores or deflates each file. The reader for Word files lives in `import/word`, and `crate::archive` reads archives.

## Public API

`docx::build(&WordInput)` returns the bytes. The export code in `export/word.rs` is the only caller.

## What the UI wiring needs

Nothing. The "Export as Word" choice calls `export_docx`.
