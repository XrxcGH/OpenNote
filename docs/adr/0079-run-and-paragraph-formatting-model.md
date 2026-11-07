# ADR 0079: Run formatting lives in the Markdown, paragraph formatting beside it by element ID, in points

- Status: Proposed
- Date: 2026-11-01

## Context

Word and Docs format characters (font, size, underline style, caps, spacing, position, effects, language) and paragraphs (alignment, indents, spacing, line spacing, tab stops, borders, shading, direction, list formats). OpenNote stores text as semantic Markdown with element metadata beside it (spec 6.6), and its named styles in `notebook.json` (spec 4.1). The model must round-trip DOCX exactly, merge and undo with the existing ops (`EditText` and `PatchBlock`), and keep `page.md` readable.

## Decision

- **Run formats are marks written as inline tags** in the reserved grammar of ADR 0076, one tag per mark: `data-font`, numeric `data-size`, `<u data-line>` and `data-line-color`, `<del data-line="double">`, `data-caps`, `data-tracking`, `data-scale`, `data-shift`, `data-kern`, `data-otf`, `data-effect`, `data-box`, `data-shade`, hex highlight colors, `lang`, and `dir`. DESIGN.md section 2.2 gives each value's grammar and the canonical nesting order.
- **Paragraph formats live in `data.paras`**, a map from element ID to attributes, beside `styles` and `tags`. List definitions live in `data.lists`. A continued list writes the start number its item shows, so version 1 readers show the right numbers.
- **Typographic quantities are points** with at most two decimals, and sizes in steps of 0.5. Word's half-points and twips and Docs' points convert exactly. Version 1 style keys in page units keep their meaning, and `sizePt` is added beside `size`.
- **The stored vocabulary is the reference apps'.** For example, all 17 `ST_Underline` values and all `ST_NumberFormat` list formats are stored, even where CSS approximates them on screen.

## Options considered

| Option | For | Against |
|---|---|---|
| Tags for runs, `paras` by element ID for paragraphs (chosen) | Paragraph formatting is safe for version 1 readers; run formatting moves with its text in every edit, copy, and diff | Imported documents can carry many tags (reduced by page style sheets, ADR 0082) |
| Everything inline, with paragraph attributes as a trailing `{...}` block | One place | Every paragraph format would make pages read-only in version 1 apps; braces show in other Markdown tools |
| Everything beside the Markdown as ranges | Clean Markdown | Ranges go stale on edits by older apps and by tools that edit the text |
| Page units (1/96 inch) for typography | Matches spec 2.6 | 11 pt is 14.666... units, so DOCX round trips need rounding rules |

## Consequences

The schema (`app/src/editor/schema/`), the four tag readers, the core's `TextData`, and the interop document model all change. `paras` needs the same ID hygiene as `styles`: writers drop keys for elements that no longer exist.

## Implementation notes

The interface's schema and Markdown layer implement the run half of this decision.

- **One mark per kind.** Each row of spec 7.10 is a mark in `app/src/editor/schema/marks.ts`, ranked in the nesting order of `R-MRK-24`. The `weight` mark (100 to 900, without 400 and 700) sits after strong emphasis. `**` stays the only bold form.
- **Values stay text.** A mark attribute holds its value exactly as the tag writes it, such as `"10.5"` for a size. Each value has one canonical text form (`R-VAL-1`), so reading and writing never round a number.
- **One grammar.** `app/src/editor/schema/constants.ts` holds the value grammars of Appendix D. `app/src/editor/markdown/tags.ts` holds the tag grammar of spec 7.9. The Markdown reader, the writer, and the schema's DOM rules all use them.
- **Foreign marks.** A tag in the grammar that is not a known mark becomes a `foreign` mark holding its exact opening tag. It draws as a plain `<span data-foreign>`, so no value of a later version reaches the page as a style.
- **CSS from one place.** Every mark's DOM comes from its `renderHTML`, which asks `app/src/editor/render/runStyle.ts` for declarations. The static view and the editor therefore draw the same.
- **Footnote references.** `[^ID]` is the inline atom node `footnoteRef`, with marks like any other inline node.
