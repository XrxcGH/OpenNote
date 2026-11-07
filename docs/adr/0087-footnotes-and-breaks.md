# ADR 0087: Footnotes use `[^id]` with their text in data.notes, and page breaks are `break` blocks

- Status: Proposed
- Date: 2026-11-01

## Context

Word and Pages have footnotes and endnotes, and Docs has footnotes. OpenNote's LaTeX export reads typed `[^key]` definitions (`crates/interop/src/export/footnotes.rs`), but the page has no notes of its own, and spec 7.2 says writers never write footnotes. Page breaks exist in the paginator but not in the format: "the page view has no break block" (`app/src/features/pages/README.md`). The type name `break` is reserved in spec 6.4.

## Decision

- A footnote or endnote reference is `[^ID]` in the Markdown. It cannot be confused with text, because version 1 always escapes `[` (spec 7.6). The editor shows it as an inline atom with its number.
- The note's text is `data.notes[ID] = {kind: "foot" | "end", markdown}`. Numbers follow reading order across the page, with the format and restart rule in `view.text`.
- Deleting a reference removes its note in the same step.
- The `break` block type is defined with `data.kind` set to `page` or `column`, and the fallback `{"markdown": "---"}`.
- Pages with notes or breaks are version 2 (ADR 0078).

## Options considered

| Option                                                | For                                                                                                                                 | Against                                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `[^id]` and `data.notes`; `break` blocks (chosen)     | Syntax close to GFM, which other tools partly understand; notes stay editable outside the flow; the break type was already reserved | Version 1 apps open such pages read-only                                                 |
| GFM footnote definitions in the Markdown              | Fully standard Markdown                                                                                                             | A definition would sit in one text block of a page made of many blocks, and move with it |
| A break as a paragraph attribute only (`breakBefore`) | No new block                                                                                                                        | Can't break before a table or an image block                                             |

## Consequences

The Markdown parsers, the paginator, DOCX (`footnotes.xml`, `endnotes.xml`, `w:br w:type="page"`), HTML, and LaTeX change. `page.md` shows `[^ID]` and lists the notes at the end, as GFM tools expect.

## Implementation notes (footnotes, Beta 12)

- **Settings.** The format and restart rule are `view.text.notes`: `{"foot": {"format", "start", "restart"}, "end": {...}}`. `format` is `decimal`, `lowerRoman`, `upperRoman`, `lowerLetter`, `upperLetter`, or `chicago` (`*`, `†`, `‡`, `§`, then doubled), the `ST_NumberFormat` names, so DOCX maps them one to one. `start` is 0 to 32,767, default 1. `restart` is `continuous` (the default) or `heading`, which starts again at each level 1 heading, the page's closest thing to a Word section. Footnotes default to `decimal` and endnotes to `lowerRoman`, as in Word. An invalid value reads as missing (`R-VIEW-4`); a version 1 reader keeps the key (`R-STAMP-4`).
- **Numbers.** Each kind counts from its start across the page's text blocks in reading order. A note referred to twice keeps its first number. A reference whose note is missing counts as a footnote (`R-FN-5`). One style sheet per page view draws each number after its atom, with an accessible name such as "Footnote 3", so the static text and the editor agree. The atom has `role="doc-noteref"`.
- **Notes area.** Footnotes, then endnotes, under the flow column. Each note's text opens in an editor of its own; its number goes back to the reference. A double-click on a reference, or the Go to note or reference command, goes to the note.
- **One undo step.** The text sync takes riders: edits sent in the same batch as a block's new Markdown. The notes rider removes the note of every reference that left the block and brings back the note of every reference that came in (a new one from Insert, or one cut and pasted, or moved to another block). So Ctrl+Z after a deletion restores the reference and its text together, and notes no reference names are dropped (`R-NOTE-2`).
- **Convert.** Convert all footnotes to endnotes, Convert all endnotes to footnotes, and Convert this note patch only `kind`, in one batch.
- **Not yet.** Breaks belong to the page-layout lane. Notes in table cells are kept but not numbered or listed. Print does not restart numbers per sheet. Word's Ctrl+Alt+F and Ctrl+Alt+D are taken by other commands, so the insert commands have no default keys.
