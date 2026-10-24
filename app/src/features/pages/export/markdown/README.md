# OpenNote Markdown for export

This folder reads the Markdown of text blocks (format spec 7) into the neutral document tree and renders the tree as HTML. The page export, the print document, and the HTML export all use it. It is pure TypeScript with no Document Object Model (DOM) and no React.

The editor in Phase 4 has its own parser and serializer, which edit text. This parser only reads, and it never writes Markdown.

## What it reads

- Blocks: paragraphs, ATX and setext headings, bullet, numbered, and task lists with nesting, block quotes, callouts (`> [!tip]`, with `-` and `+` folds), fenced and indented code, thematic breaks, and `$$` math blocks. Math is a `math` block, and `$math$` is an inline `math` atom. Both are drawn as their source text until Phase 10.
- Inlines: emphasis and strong emphasis with CommonMark's flanking rules, `~~strike~~`, `==highlight==`, code spans, links, images, autolinks, hard breaks, backslash escapes, and character references.
- The HTML tags of spec 7.4: underline, subscript, superscript, `mark` and `span` with `data-color` or `data-size`, and the long forms of emphasis. Any other raw HTML stays plain text.
- Lazy continuation lines, tabs, and CRLF line ends, because text can come from hand edits.

Reference-style links, footnotes, raw HTML blocks, and GFM tables in text are not supported and read as paragraphs. Writers never produce them.

The parser passes the shared fixtures in `docs/format/fixtures/markdown`: every document case, and every escape case read back as its plain text.

## Public API

Re-exported from `features/pages`.

| Name                                   | Purpose                                                          |
| -------------------------------------- | ---------------------------------------------------------------- |
| `parseMarkdown(markdown)`              | A text block's Markdown to the tree (`Document`)                 |
| `parseInline(markdown)`                | Inline Markdown, such as a table cell, to runs                   |
| `renderHtml(document, options)`        | The tree as HTML                                                 |
| `renderInlineHtml(runs, options)`      | Runs as HTML                                                     |
| `documentText`, `inlineText`           | The plain text of a tree, for titles, summaries, and text checks |
| `escapeHtml`, `escapeAttr`, `safeHref` | Escaping and the link rule                                       |

`HtmlOptions` lets the caller decide what the markup refers to.

- `link` maps a destination to an `href`. The default follows only `https:`, `http:`, and `mailto:` links.
- `image` maps an image destination to a source. The default leaves images out, because an export must map each asset.
- `penColor` maps a pen name to a color, and `labels` and `calloutTitle` supply words.
- `foldable` shows folded callouts in a `details` element.

## Rules worth knowing

- Marks nest in the order of spec 7.7, so the tree and the markup are the same whichever way the text was written.
- A task item's checkbox is a `span` with `role="img"` and a label, drawn with CSS and no border, so print layout does not depend on the screen's pixel density (ADR 0006, rule 1).
- A tight list renders its text without paragraphs. A list with an item of two paragraphs renders them.
- Markup carries classes, never styles, except a validated `#rrggbb` pen color.

## What the UI wiring needs

1. Strings for `labels.done`, `labels.open`, and the callout titles.
2. A stylesheet for the classes (`hl-*`, `pen-*`, `size-*`, `callout-*`, `box`). The print and HTML export modules supply one for export. The page view can reuse it.
3. A `link` function that maps `opennote:page/ID` links to something followable in the place the markup is shown.
