# doc

The neutral document tree that every converter reads or writes. Blocks hold runs of text, and each run carries its marks.

## What it does

- `doc.rs` defines `Block`, `Inline`, and `Marks`. Blocks are paragraphs, headings, lists, quotes, callouts, code, breaks, and tables. Inlines are text with marks, line breaks, images, and footnote references. `Marks` holds the marks of version 1 and every run format of version 2 (spec 7.10). Foreign marks keep the exact tags of a later version.
- `parse.rs` reads Markdown into the tree. `parse` takes Markdown from other apps. It accepts CommonMark with GitHub task lists, tables, and strikethrough, Obsidian wiki links and callouts, `==highlights==`, and the HTML tags of spec 7.4. `parse_page` takes an OpenNote page's Markdown. Its tags pair like brackets within a paragraph (spec 7.9). A tag outside the grammar is literal text, and an unknown tag in the grammar becomes a foreign mark. `[^ID]` is a footnote reference. `parse_note` reads notes and comments, where `[^ID]` stays text. Quotes and lists nest at most `MAX_NESTING` (64) deep, and tags at most 32. Deeper ones keep their content flat, so a hostile note cannot overflow the stack.
- `write.rs` writes the tree as canonical OpenNote Markdown (spec 7.7 and 7.10 to 7.12): marks nest in one order, whitespace moves outside marks that do not show on spaces, and foreign tags write back byte for byte. The writer reads its own output back, and falls back to HTML tags when a parser could read the delimiters differently.
- `data.rs` reads the records of a text block's `data`: `paras`, `lists`, `notes`, `comments`, `suggestions`, and `layout` (spec 6.8 to 6.11). `TextData::elements` ties each element of the tree (spec 6.6) to its ID, style, and paragraph formatting.
- `cell_style.rs` is the sheet style slot of a table cell (`Block::Table::cell_styles`), which the reader of `data.sheet` fills.
- `values.rs` holds the value grammars of spec Appendix D. `size_points` gives the points of a size: `small` 10, `large` 15, and `xlarge` 18 at the 12 point body.
- `escape.rs`, `inline.rs`, and `html_tags.rs` hold the escaping rules, the inline writer, and the HTML tag and entity handling.

## Public API

`parse::parse`, `parse::parse_page`, `parse::parse_note`, `write::to_markdown`, `write::inlines_to_markdown`, `data::TextData`, `cell_style::CellStyle`, `Block::table`, `size_points`, `size_value`, `plain_text`, `visit_inlines`, `visit_inlines_mut`, and `push_text`. `export::page_to_document` converts a page with the `TextData` of each text block.

## What the UI wiring needs

Nothing. This is a library for the converters. The page builder turns its blocks into core blocks. The Word, HTML, and PDF writers of version 2 formatting read the new marks, `Inline::Note`, `TextData`, and the cell styles in later lanes. Until then they write the text without them.
