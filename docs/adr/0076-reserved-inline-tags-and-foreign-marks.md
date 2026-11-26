# ADR 0076: OpenNote Markdown 2 reserves one inline tag grammar, and readers keep tags they do not know

- Status: Proposed
- Date: 2026-11-02

## Context

The owner asked for the text formatting that Word and Google Docs offer, and for spreadsheet-grade tables whose cells use the same run formatting. OpenNote Markdown 1 ([format spec](../format/README.md) section 7.4) allows only exact tags: `<u>`, `<sub>`, `<sup>`, `<mark data-color>`, `<span data-color>`, and `<span data-size>`. Every other tag is literal text to a reader, and a writer escapes its `<` on save. So an app that edits a page with a tag it does not know turns the formatting into visible text and saves it that way.

The format must now grow many run formats at once: font, size in points, weight, underline styles, caps, spacing, language, direction, comments, and suggestions. Later versions will add more. Each addition must not cost data in an app that is one version behind.

Four readers parse inline tags today: `app/src/editor/markdown/parseInline.ts`, `app/src/features/pages/export/markdown/inline.ts`, `crates/interop/src/doc/html_tags.rs`, and the matches in `crates/interop/src/html.rs` and `import/enml.rs`. The Python reference reader in `docs/format/tools` is the fifth.

## Decision

We will define, in OpenNote Markdown 2, one grammar for every inline tag, and require readers of version 2 to keep a tag they do not know as a foreign mark.

- An opening tag is `<NAME ATTR="VALUE" ...>` with 1 to 8 attributes. NAME is `span`, `u`, `del`, `mark`, `ins`, or `s`. Each ATTR is `lang`, `dir`, or `data-` followed by 1 to 16 characters from `a-z0-9-`, in increasing code point order, each once. A VALUE has at most 200 characters and no `"`, `<`, `>`, `&`, or control characters, so it never needs escaping. Spec section 7.9 gives the grammar, and rules `R-INL-1` to `R-INL-12` state it.
- Tags pair like brackets within one paragraph, heading, cell, or note, and nest at most 32 deep. A tag that does not pair is literal text, as the interface's reader already does for version 1 tags.
- A pair whose name, exact set of attributes, and values match a mark of spec section 7.10 is that mark. Any other pair is a foreign mark: it keeps the exact opening tag, is written back byte for byte, sits innermost (just outside code), and shows its text unformatted and editable. Foreign marks don't exclude each other, and they nest in code point order of their opening tags. A known attribute with a value outside its grammar makes a foreign mark too, so a later version can widen a value range without loss.
- Any other raw HTML is still literal text, as in version 1.
- All readers implement the rule against one shared fixture set, `docs/format/fixtures/markdown/inline-v2/`, which includes foreign tags, overlaps, every value boundary, and hostile input that must stay literal.
- The release that first reads version 2 ships before any control creates a new tag (`text.v2Controls` stays off in Beta 9).

## Options considered

| Option | For | Against |
|---|---|---|
| One reserved grammar and foreign marks (chosen) | Future tags never lose data in an app that knows version 2; one rule for every reader; values never need escaping | Beta 8 and older still see raw tags, so those pages open read-only there |
| A new exact tag for each format, as in version 1 | Simplest parser | Every new format breaks every older app again |
| Formatting as ranges in `data` beside the Markdown, keyed by offsets | Older apps see clean text | Offsets go stale when an older app or another tool edits the text, so formatting moves or vanishes without notice |
| Pandoc-style `[text]{.class key=val}` attributes | Readable in Markdown tools that support it | `[` and `{` change how links parse; CommonMark tools show the braces; hard to nest with the existing tags |

## Consequences

- Format spec sections 7.4, 7.6, 7.7, and Appendix C change, and sections 7.9 to 7.13 and Appendix D are added. ADR 0078 decides which files carry `formatVersion` 2.
- The editor schema gains the `foreign` mark. The Markdown serializer places it innermost and never merges two foreign marks with different opening tags. The value grammars live once in `app/src/editor/schema/constants.ts`, which both text and tables use.
- Hostile-input tests cover attribute injection, quotes, unpaired and crossed tags, and deep nesting.
- Revisit if a later format needs an inline element that holds something other than text, such as an embedded object.
