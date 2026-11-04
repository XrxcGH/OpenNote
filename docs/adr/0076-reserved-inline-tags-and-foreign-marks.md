# ADR 0076: OpenNote Markdown 2 reserves one inline tag grammar, and readers keep tags they do not know

- Status: Proposed
- Date: 2026-11-01

## Context

The owner asked for every kind of text formatting that Word and Google Docs offer. OpenNote Markdown 1 (format spec 7.4) allows only exact tags: `<u>`, `<sub>`, `<sup>`, `<mark data-color>`, `<span data-color>`, and `<span data-size>`. Every other tag is literal text to a reader, and a writer escapes its `<` on save. So a version 1 app that edits a page with a new tag turns the formatting into visible text and saves it that way. The format must grow many new run formats now (font, numeric size, underline styles, caps, spacing, language, direction, comments, suggestions), and more later, without that loss.

Four readers parse the inline tags today: `app/src/editor/markdown/parseInline.ts`, `app/src/features/pages/export/markdown/inline.ts`, `crates/interop/src/doc/html_tags.rs`, and the matches in `crates/interop/src/html.rs` and `import/enml.rs`.

## Decision

We will define, in OpenNote Markdown 2, one grammar for every inline tag, and require readers to keep a tag they do not know.

- An opening tag is `<NAME ATTR="VALUE" ...>`, where NAME is `span`, `u`, `del`, `mark`, `ins`, or `s`. Each ATTR is `lang`, `dir`, or `data-` followed by 1 to 16 characters from `a-z0-9-`. Attributes appear in code point order. A VALUE is at most 200 characters and has no `"`, `<`, `>`, `&`, or control characters. Tags must nest and close within one paragraph, heading, or cell (as in spec 7.4).
- A reader turns a tag it knows into its mark. It turns a tag it does not know, but which matches the grammar, into a **foreign mark**. The foreign mark keeps the exact opening tag, does not exclude itself, sits innermost in the canonical order, and is written back byte for byte. The text inside stays editable and shows unformatted.
- Any other raw HTML is still literal text, as in version 1.
- All four readers and the Python reference reader implement the rule, and they are tested against one shared fixture set (`docs/format/fixtures/markdown/inline-v2/`).
- The first release (T0) ships the readers before any control creates a new tag (T1).

## Options considered

| Option | For | Against |
|---|---|---|
| One reserved grammar and foreign marks (chosen) | Future tags never lose data in an app that knows version 2; one rule for four readers; values never need escaping | Beta 8 and older still see raw tags (read-only) |
| A new exact tag for each format, like version 1 | Simplest parser | Every new format breaks every older app again |
| Formatting as ranges in `data` beside the Markdown, keyed by offsets | Older apps see clean text | Offsets go stale when an older app or another tool edits the text, so formatting silently moves or vanishes |
| Pandoc-style `[text]{.class key=val}` attributes | Readable in Markdown tools that support it | `[` and `{` change how links parse; CommonMark tools show the braces; hard to nest with the existing tags |

## Consequences

- Format spec sections 7.4, 7.6, 7.7, and Appendix C change, and `formatVersion` 2 is defined (ADR 0078 decides which files carry it).
- The editor schema gains the `foreign` mark. The Markdown serializer must place it innermost and must not merge two foreign marks with different tags.
- Hostile-input tests cover attribute injection, quotes, and deep nesting.
- Revisit if a later format needs an inline element that holds something other than text.
