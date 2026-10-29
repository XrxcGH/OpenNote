# ADR 0053: Import from Goodnotes, Notability, and Samsung Notes reads what the packages show, and the PDF export is the dependable route

- Status: Proposed
- Date: 2026-10-29

## Context

People moving from handwriting apps on tablets and phones asked to bring their notes along (the owner's list from looking at DeriveNotes, 2026-10-28). The three apps they name save their own files: Goodnotes (`.goodnotes`), Notability (`.note`), and Samsung Notes (`.sdocx`). None of the makers documents its format. Each app can also export a PDF, which OpenNote's PDF import (A4-10) already turns into pages to write on. No real export files were available while this was built.

## Decision

- **One reader for the three apps** lives in `crates/interop/src/import/notes_apps/`. The file driver in `files.rs` runs it, so each file becomes a section. A folder or ZIP file of them, such as a Goodnotes backup, keeps its folders in the section names. `detect` tells the files by extension and by the ZIP signature, as `SourceKind::NotesApp`.
- **Clean-room, from public descriptions and from what the containers show.** No code from another project was read or copied. The sources:
  - Apple's public description of the binary property list (`bplist00`) layout, and of NSKeyedArchiver's `$objects`, `$top`, and UID references.
  - Google's public protocol buffers encoding guide: varint keys, wire types, and length-delimited fields.
  - The published ZIP signatures, and the magic numbers of PNG, JPEG, GIF, WebP, HEIF, PDF, WAV, MP4 and M4A, CAF, MP3, AAC, and AMR.
  - Notability: Julia Evans, "Reverse engineering the Notability file format" (jvns.ca, 2018), and trueskawka, "Retrieving drawings from Notability" (2019). They describe a ZIP package whose `Session.plist` holds the keys `curvespoints`, `curvesnumpoints`, `curveswidth`, and `curvescolors`. Only facts were used: the key names, and that the points pair up as x and y.
  - Goodnotes: a public discussion of the format (r/RELounge, "GoodNotes 5 files discussion", 2020 onward) and file-type references. They agree that a document is a ZIP package with page data in `notes/`, attachments in `attachments/`, and protobuf index files, and that nobody has decoded the page data.
  - Samsung Notes: file-type references (fileinfo.com, docs.fileformat.com) that describe `.sdocx` as a ZIP package holding the note's parts and a media folder.
- **What comes over.** Notability's curves become strokes (spec 8.2) in a handwriting layer, with their color and width. Pressure comes from `curvesfractionalwidths`, where a factor of 1.0 is half pressure. Curves that are clearly see-through become highlighter strokes, and other pens keep their alpha. Erasing is expected to be applied already in what the app saves, which a real file has yet to confirm. Typed text (archived `NSAttributedString` objects), pictures, recordings, and PDF files come over. Goodnotes and Samsung Notes pages come over in the order their index (`index.notes.pb`, `pageIdInfo.dat`) names them. Each page gets the attachments its data names by ID or file name, and the rest go on the first page. Samsung Notes text kept as XML comes over.
- **What does not, and the route around it.** The import report lists these as not imported, each with how to export a PDF from that app: Goodnotes' and Samsung Notes' handwriting, Notability's shapes, and Goodnotes' bookmarks and outline. PDF backgrounds inside the packages come over as attached files. The import dialog lists the three apps with their file types and the PDF steps. It has an **Import a PDF…** button, and a PDF chosen in the dialog offers the same button.
- **Hostile files.** Nothing is unpacked to disk, and every part of a file is read under a cap, listed in [Limits on hostile files](#limits-on-hostile-files).
- **Behind a flag.** `interop.notesApps` is on in development, nightly, and Beta builds. It stays off in Stable until the owner has tried real files. Settings lists it with the other experimental switches.

### Limits on hostile files

Entries are read into memory under these caps:

- each entry, 128 MiB;
- all entries together, 512 MiB;
- the number of entries, 20,000;
- expansion, 200 times the stored size, for entries over 1 MiB.

Names that are absolute, name a drive, or climb out with `..` are refused. Reading one file has a 120-second budget.

The readers have their own caps:

- The property list reader keeps a flat table of objects, with ranges into the input, so shared references are never copied. It checks every offset, width, count, and reference. It allows at most 2 million objects and 8 million references.
- The protobuf walker caps its depth at 12 and the total bytes it walks at 64 MiB. A UID lookup follows at most 8 references.
- A page takes at most 50,000 strokes and 2 million points. A longer curve splits into joined strokes of at most 200,000 points.
- The Notability reader applies the page's caps while it reads. It decodes only the points of the curves it keeps, and it counts curves of no points as left out without keeping them. It reads at most 16 curve lists; a real note has one.
- Samsung Notes' `pageIdInfo.dat` is read in one pass for all the pages, and only up to 4 MiB. A larger one leaves the pages in the package's order.
- The loops over a property list's objects check the time budget and Cancel.

All arithmetic is checked, and all parsing can fail without a panic. Tests cover it: a cargo-fuzz target (`notes_app`), the stable fuzz entry with synthetic seeds, and property tests. A corpus of malformed packages (`tests/corpus/notes-apps`) must import quickly, and `tests/notes_apps_memory.rs` measures the memory its hostile curve lists take.

## Options considered

| Option                                                                                            | For                                                                                 | Against                                                                                                   |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Read the packages where they are described, report the rest, and point to the PDF export (chosen) | Notability's writing stays editable; nothing is guessed; the PDF route always works | Goodnotes and Samsung Notes handwriting stays behind until someone describes their formats                |
| PDF export only                                                                                   | Simple and dependable                                                               | Loses Notability's editable strokes, pictures, and recordings                                             |
| Guess the private page formats from samples                                                       | Could bring more handwriting                                                        | There are no real files to check against, and a wrong guess draws wrong strokes, which is worse than none |

## Consequences

- The fixtures are synthetic. They are built from the structure above and named as synthetic in the tests. A real export may differ, and the reader then reports what it could not read instead of failing.
- When public descriptions of the Goodnotes or Samsung Notes page data appear, their strokes can go through the same `ink::strokes` path.
- Owner follow-up: test with real exports from each app (a Goodnotes document and a backup, a Notability note with a recording, a Samsung Notes note), and compare each import with the app's PDF export.
