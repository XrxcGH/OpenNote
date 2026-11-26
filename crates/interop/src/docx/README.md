# docx

Writes a Word file (`.docx`) by hand, so the crate needs no Word library (ADR 0083). A document is a set of XML parts in a ZIP archive.

## What it does

- `mod.rs` builds the archive from a `WordInput`: a title, dates, the body as `Part` values, the pictures, and a `Setup` (styles, theme, text settings, and `WordOptions`). Each page ends in a `Part::Section` with its paper, header, and footer. A `Part::Text` carries a text block's records (`paras`, `lists`, `notes`, `comments`, `suggestions`, `layout`).
- `rpr.rs` writes run properties for every mark of format version 2, and `ppr.rs` paragraph properties for every `data.paras` key, each in the schema's order. `units.rs` converts points to Word's units and colors to Word's values.
- `body.rs` writes blocks as paragraphs, lists, and tables, and finds each element's formatting by its path. `runs.rs` writes runs with links, pictures, note references, comment ranges, and suggestions, and collects the notes and comments. Notes and comments get relationships parts of their own for their links and pictures.
- `styles.rs` writes `styles.xml` from the app's style values with the notebook's and page's styles over them. `numbering.rs` writes the list definitions. `fonts.rs` writes `fontTable.xml` and `theme1.xml`, and embeds bundled fonts on request. `section.rs` writes section properties, headers, and footers. `parts.rs` holds the package parts.
- `zip.rs` is a small ZIP writer that stores or deflates each file. The reader for Word files lives in `import/word`, and `crate::archive` reads archives.

## Public API

`docx::build(&WordInput)` returns the bytes. `export_docx`, `export_docx_with`, and `export_docx_options` in `export/word.rs` build the input from a notebook. `WordOptions` holds the device's font faces, fonts offered for embedding (`bundled_embeds()` gives every bundled face), and whether personal information is removed. `split_weight_face` is the inverse of `weight_face`, for the Word import.

## What the UI wiring needs

The export dialog offers "Remove personal information" and "Embed bundled fonts" for Word. The app sends them as `word.removePersonal` and `word.embedFonts`, and `app/src-tauri/src/interop/export.rs` turns them into `WordOptions`. The device's faces (`WordOptions.faces`) are not reachable yet: `fonts_list` reports PostScript names and weights, not the full face names Word uses.

## Tests

`tests.rs` checks the known XML of every property against `tests/fixtures/word-v2/export/known-xml.json`, every written part against a hand-written subset of the ECMA-376 schemas (`tests/schema.rs`), and two round-trip properties (`tests/props.rs`): a strict read-back (`tests/readback.rs`) and the crate's own Word import. `tests/roundtrip.rs` takes notes, comments, suggestions, headers, footers, and the paper through the import.
