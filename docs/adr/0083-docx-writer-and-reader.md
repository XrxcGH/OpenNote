# ADR 0083: Keep the hand-written DOCX writer and reader, and extend them to full formatting fidelity

- Status: Proposed
- Date: 2026-11-01

## Context

The Word export (`crates/interop/src/docx/`, 952 lines) and import (`crates/interop/src/import/word/`, 2,195 lines) are hand-written over the crate's own ZIP and XML code. They write 9 run properties and read 8. They also disagree on sizes: `large` shows as 15 pt and exports as 14 pt. The owner wants every format to round-trip.

## Decision

We will extend the existing writer and reader rather than adopt a library.

- The writer gains complete `w:rPr` and `w:pPr`, `styles.xml` from the style sheets, `numbering.xml` per list definition, `fontTable.xml`, `theme1.xml`, `footnotes.xml`, `endnotes.xml`, `comments.xml` with `commentsExtended.xml`, tracked changes, headers and footers with `PAGE` and `NUMPAGES` fields, page setup from the page's paper, page breaks, language, and bidi.
- The reader resolves styles in ECMA-376 order with toggle-property semantics, theme fonts and colors, numbering overrides, notes, comments, and tracked changes.
- Exact values are tested against ECMA-376 units and against fixture files saved by Word and Google Docs.

## Options considered

| Option | For | Against |
|---|---|---|
| Extend the hand-written code (chosen) | No dependency; the code already handles OneNote's exports and the import report; full control of each element | More code to write |
| `docx-rs` (MIT) | Many properties ready-made | Writer only, so the reader stays hand-written anyway; a second document model to map into; less control over XML that Word is strict about |
| Convert through LibreOffice | Broad fidelity | A large external program that is impractical to bundle |

## Consequences

The interop document model (`crates/interop/src/doc.rs`) grows to carry every format. A schema-validation test needs the ECMA-376 transitional schemas as test fixtures (PLAN.md owner decision 11). Equations as OMML stay with the math design, through a hook in the writer.
