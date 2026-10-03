# Markdown documents

`cases.json` pairs canonical OpenNote Markdown (spec 7) with the document it stands for, written as a neutral tree. The serializer and parser in the interface must pass every case both ways: parsing `markdown` gives `document`, and serializing `document` gives `markdown` byte for byte (spec 7.8).

Each case has a `name`, the `markdown` of one text block, and the `document`, an array of blocks.

## Blocks

| Block | Keys |
|---|---|
| Paragraph | `"type": "paragraph"` and `content`, an array of inlines |
| Heading | `"type": "heading"`, `level` from 1 to 6, and `content` |
| List | `"type": "list"`, `ordered`, `start` for numbered lists, and `items` |
| Block quote | `"type": "quote"` and `blocks` |
| Callout | `"type": "callout"`, `callout` (the type, such as `tip`), `fold` (null, `folded`, or `open`), `title` (inlines), and `blocks` |
| Code block | `"type": "code"`, `language` (empty for none), and `text` |
| Thematic break | `"type": "break"` |
| Display math | `"type": "math"` and `source`, the text between the `$$` lines (spec 7.2) |

A list item has `task` (null, `open`, or `done`) and `blocks`. A list whose items each hold one block is tight. A list with an item that holds more than one block is loose, with one blank line between items (spec 7.7).
A callout writes a paragraph that comes first in its blocks on the line after its head line. Any other first block follows a `>` line, because some, such as a thematic break, would change the head line.

## Inlines

An inline is a run of text, a hard break, an image, or inline math:

- A run of text is `{"text": "...", "marks": [...]}`. A mark is a string: `strong`, `emphasis`, `strike`, `underline`, `highlight`, `sub`, `sup`, or `code`. It can also be an object with one key: `{"link": "<destination>"}`, `{"highlight": "<highlighter name>"}`, `{"color": "<pen name or #rrggbb>"}`, or `{"size": "small" | "large" | "xlarge"}`.
- A hard break is `{"hardBreak": true}`.
- An image is `{"image": "asset:<asset ID>", "alt": "..."}`.
- Inline math is `{"math": "<source>"}`, the text between the `$` delimiters (spec 7.3).

Marks are listed in the nesting order of spec 7.7, outermost first. Text holds no escapes: the serializer escapes it as spec 7.6 says.

## Documents that are not canonical

A document never holds two lists of one kind next to each other, because the blank line between them would read back as one loose list (spec 7.7). A case may have `alsoWrittenFrom`, an array of documents that do hold such lists. A serializer must write each of them as the case's `markdown`, which means it joins the lists first: the items of the later list follow those of the earlier one, and the earlier list's `start` is kept. Parsing `markdown` still gives `document`.
