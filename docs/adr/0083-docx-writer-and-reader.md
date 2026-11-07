# ADR 0083: Keep the hand-written DOCX writer and reader, and extend them to full formatting fidelity

- Status: Accepted for the writer (Beta 10). The reader half lands with the Word import lane.
- Date: 2026-11-04

## Context

The Word export (`crates/interop/src/docx/`, 952 lines) and import (`crates/interop/src/import/word/`, 2,195 lines) are hand-written over the crate's own ZIP and XML code. They wrote 9 run properties and read 8. They also disagreed on sizes: `large` showed as 15 pt and exported as 14 pt. Every export wrote Letter paper, whatever the page's paper was. The owner wants every format to round-trip.

## Decision

We extend the existing writer and reader rather than adopt a library.

- The writer writes every run mark of format version 2 (`w:rPr`) and every `data.paras` key (`w:pPr`).
- `styles.xml` comes from the notebook's styles with a page's own sheet over them. `numbering.xml` has one `w:abstractNum` per list definition and a `w:lvlOverride` per restart. `theme1.xml` comes from the notebook's and page's `theme`, and `fontTable.xml` names every font with its class and pitch.
- Notes go to `footnotes.xml` and `endnotes.xml`. Comments go to `comments.xml`, with replies and resolved state in `commentsExtended.xml`. Suggestions are tracked changes: `w:ins`, `w:del`, and `w:rPrChange`.
- Each page is a section with its paper, margins, orientation, and page numbers. Its saved header and footer use `PAGE`, `NUMPAGES`, and `DATE` fields, with a first-sheet variant. A text block with columns is a continuous section of its own. Break blocks are page or column breaks.
- Children of each element are written in the order of the ECMA-376 sequence. Values convert exactly: half-points, twips, eighths of a point, and 240ths of a line.
- A weight other than regular and bold has no Word property. The writer writes `w:b` from 600 up, and names the device's face (such as "Segoe UI Semibold") when the caller passes the device's face list.
- Font files are never embedded by default. On request, only the bundled fonts under the SIL Open Font License or the Apache License that the document uses are embedded, obfuscated as ECMA-376 Part 1, 17.8.1 requires. A font whose OS/2 `fsType` restricts embedding is refused.
- "Remove personal information" replaces every author with "Author", drops dates from comments, changes, and the document properties, and sets Word's `removePersonalInformation` and `removeDateAndTime`.
- The reader resolves styles in ECMA-376 order with toggle-property semantics, theme fonts and colors, numbering overrides, notes, comments, and tracked changes. A named face such as "Segoe UI Semibold" maps back to the family and weight.
- The theme font tokens `+body` and `+heading` do not come back from an export. The writer writes them as `w:asciiTheme="minorHAnsi"` and `"majorHAnsi"`, the same attributes Word writes for a run in the theme's fonts. The reader cannot tell an export's token from Word's own theme font, so it resolves both to the concrete theme font, which shows the same. The export-then-import property leaves `font` out on purpose.
- Known-answer tests take their values from ECMA-376 units and its enumerations, worked by hand (`crates/interop/tests/fixtures/word-v2/export/known-xml.json`).

### Schema validation (owner decision 11)

The ECMA-376 schema files are not vendored. Rust has no mature XSD validator, a binding to libxml2 would add a C dependency only for a test, and the schemas add several megabytes of fixtures. Decision 11 named the fallback: a hand-written subset. The owner did not answer before B10.2, so that default applied (NEXT-PLAN 6.2, text D11). The test transcribes the sequences of the complex types the writer uses (`CT_RPr`, `CT_PPr`, `CT_SectPr`, `CT_Style`, `CT_Settings`, `CT_Font`, `CT_Lvl`, numbering, tables, and the DrawingML theme), the enumerations of the values it writes, and the counts the theme needs. It checks every written part for order, enumerations, colors, declared prefixes, and well-formed XML.

## Options considered

| Option | For | Against |
|---|---|---|
| Extend the hand-written code (chosen) | No dependency; the code already handles OneNote's exports and the import report; full control of each element | More code to write |
| `docx-rs` (MIT) | Many properties ready-made | Writer only, so the reader stays hand-written anyway; a second document model to map into; less control over XML that Word is strict about |
| Convert through LibreOffice | Broad fidelity | A large external program that is impractical to bundle |

## Consequences

The interop document model (`crates/interop/src/doc.rs`) carries every format. The export takes options (`WordOptions`): the device's faces, fonts to embed, and removing personal information. The export dialog offers Remove personal information. The device's faces and embedded fonts wait on B11.1, so the app passes empty lists for them. Word has one set of styles per file, so a page's own style sheet applies when one page is exported; a larger export uses the notebook's styles and says so in its report. Equations as OMML stay with the math design, through a hook in the writer.
