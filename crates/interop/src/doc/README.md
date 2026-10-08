# doc

The neutral document tree that every converter reads or writes. Blocks hold runs of text, and each run carries its marks.

## What it does

- `mod.rs` defines `Block` (paragraph, heading, list, quote, callout, code, break, table), `Inline` (text with marks, line break, image), and `Marks` (link, strong, emphasis, strikethrough, underline, highlight, color, size, script, code).
- `parse.rs` reads Markdown into the tree. It accepts CommonMark with GitHub task lists, tables, and strikethrough, Obsidian wiki links and callouts, `==highlights==`, and the HTML tags of spec 7.4. Quotes and lists nest at most `MAX_NESTING` (64) deep. Deeper ones keep their content flat, so a hostile note cannot overflow the stack.
- `write.rs` writes the tree as OpenNote Markdown (spec 7). The writer reads its own output back, and falls back to HTML tags when a parser could read the delimiters differently.
- `escape.rs`, `inline.rs`, and `html_tags.rs` hold the escaping rules, the inline writer, and the HTML tag and entity handling.

## Public API

`parse::parse`, `write::to_markdown`, `write::inlines_to_markdown`, `plain_text`, `visit_inlines`, `visit_inlines_mut`, and `push_text`.

## What the UI wiring needs

Nothing. This is a library for the converters. The page builder turns its blocks into core blocks.
