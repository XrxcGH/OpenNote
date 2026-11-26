# Markdown 2 inline cases

`cases.json` tests OpenNote Markdown 2 (spec sections 7.9 to 7.13): the reserved tag grammar, foreign marks, the marks of version 2 at every value boundary, overlaps, spaces at mark edges, footnote references, and hostile input that must stay literal text. Every reader and writer of format version 2 must pass every case. Version 1 readers do not read these files.

Each case has:

| Key | Meaning |
|---|---|
| `name` | What the case shows |
| `rules` | The rule IDs of the spec that it tests (spec 1.5) |
| `markdown` | The Markdown of one paragraph, as a reader gets it |
| `tree` | The document it reads as, in the neutral tree of [the documents README](../documents/README.md), with the marks below |
| `canonical` | Present when `markdown` is not canonical: what a writer writes for `tree`. Reading it gives `tree` again |
| `alsoWrittenFrom` | Documents that are not canonical, such as a range with spaces that move outside it, which a writer writes as `markdown` |
| `text` | The readable text of `markdown` (spec 7.13) |
| `stamp` | The version keys of a page whose only text block holds `markdown` (spec 15.6) |
| `hostile` | `true` for input whose tags must stay literal text |

A reader must turn `markdown` into `tree`. A writer must turn `tree` into `canonical`, or into `markdown` when there is no `canonical`.

## Marks of version 2

Marks are listed in the nesting order of spec 7.10, outermost first. Values are the exact text of the tag's attribute.

| Mark | Neutral form |
|---|---|
| Font | `{"font": "Georgia"}` |
| Size | `{"size": "10.5"}` (the version 1 names keep their form) |
| Underline | `"underline"` for single, or `{"underline": {"line": "double", "color": "brick"}}` with either key |
| Strike | `"strike"` for single, or `{"strike": "double"}` |
| Weight, caps, tracking, scale, shift, kern, OpenType features, effects | `{"weight": "600"}`, `{"caps": "small"}`, `{"tracking": "-0.75"}`, `{"scale": "150"}`, `{"shift": "3"}`, `{"kern": "14"}`, `{"otf": "lnum tnum"}`, `{"effect": "outline shadow"}` |
| Box | `{"box": {"style": "single", "color": "indigo"}}`, with `color` optional |
| Highlight, shade, text color | `{"highlight": "#ffee00"}`, `{"shade": "theme:accent2"}`, `{"color": "rose"}` |
| Language, direction | `{"lang": "fr-CA"}`, `{"dir": "rtl"}` |
| Comment, insertion, deletion, format change | `{"comment": ID}`, `{"ins": ID}`, `{"del": ID}`, `{"fmt": ID}` |
| Character style | `{"style": "u-key-term"}` |
| Image float | `{"float": "start"}` or `{"float": "end"}` (`R-MRK-29`), the outermost mark |
| Foreign mark | `{"foreign": "<span data-glow=\"soft\">"}`, the exact opening tag |

A run holds at most one mark of each kind, except comments and foreign marks (`R-MRK-28`). The cases of nested marks of one kind show that the innermost value wins.

The Python reference reader does not read images, so no case here holds one. The cases of `float` pin its grammar and its stamp, around text.

A footnote reference is the inline `{"footnote": ID, "marks": [...]}`. It adds nothing to the readable text.
