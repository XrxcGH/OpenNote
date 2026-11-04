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

| Option | For | Against |
|---|---|---|
| `[^id]` and `data.notes`; `break` blocks (chosen) | Syntax close to GFM, which other tools partly understand; notes stay editable outside the flow; the break type was already reserved | Version 1 apps open such pages read-only |
| GFM footnote definitions in the Markdown | Fully standard Markdown | A definition would sit in one text block of a page made of many blocks, and move with it |
| A break as a paragraph attribute only (`breakBefore`) | No new block | Can't break before a table or an image block |

## Consequences

The Markdown parsers, the paginator, DOCX (`footnotes.xml`, `endnotes.xml`, `w:br w:type="page"`), HTML, and LaTeX change. `page.md` shows `[^ID]` and lists the notes at the end, as GFM tools expect.
