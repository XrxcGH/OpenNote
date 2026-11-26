# Format fixtures

These files test every implementation of the [note format](../README.md) against the same data, as spec Appendix B.6 describes. The Rust core, the TypeScript ink codec in `app/src/core/ink`, and the Python reference reader in `docs/format/tools` all read them.

| Folder | Contents |
|---|---|
| `nb/v1/` | A small notebook written by the version 1 writer, with its readable copies |
| `ink/` | Segment files, each with a JSON file that says what a reader must decode or report |
| `markdown/escape/` | Text and its escaped form (spec 7.6) |
| `markdown/documents/` | Canonical Markdown and the document tree it stands for (spec 7.8) |
| `reading-order/` | Pages that test the reading order of spec 6.2, each with the order a reader must find |
| `markdown/inline-v2/` | Markdown 2: tags, marks, footnote references, and hostile input, with trees, readable text, and stamps (spec 7.9 to 7.13) |
| `markdown/paras/` | Version 1 pages with paragraph formatting, lists, layout, text settings, and page styles, and their stamps |
| `markdown/downlevel/` | Pages of versions 1 to 3, the stamps a writer gives them, and what older readers do with them (spec 15) |
| `table-sheet/` | Spreadsheet data in tables, one case for each key of `data.sheet` (spec 6.3) |
| `readable/spec-example/` | The page of spec 5.5 with the exact `page.md` of spec 11.1 and `ink.svg` of spec 11.3 |
| `readable/v2-tags/` | A version 2 page and its `page.md`, worked by hand: tags and footnote references drop, their content stays (spec 11.1) |

## The version 1 notebook

The notebook in `nb/v1/` covers the parts of the format a reader meets most:

- Section groups nested two levels deep, and a section at the top level.
- A page with a subpage and a sub-subpage, a pinned page, and a page with a color.
- Handwriting over two segments, with every stroke flag, property records, and a removal.
- An image, an attachment, a table, a drawing with a description, and two extension blocks.
- An encrypted section, which readers show as locked and never turn into readable copies.
- A saved version in page history, and a page in Trash.

Each page folder holds the `page.md` and `ink.svg` that the version 1 writer made from it, and the notebook folder holds `index.md` and `README.md`. A reader that follows the spec writes the same files. The copy of the spec in `.opennote/FORMAT.md` is left out, because this folder already sits next to the spec.

Version 1 is still a draft, so the Rust tests can write these files again with `OPENNOTE_BLESS=1 cargo test -p opennote-core --all-features fixture -- --test-threads=1`. Once version 1 is frozen, the files never change. Later versions add their own folders, such as `nb/v2/`.

## Ink

Each `<name>.onk` file in `ink/` has a `<name>.json` file beside it. [The ink README](ink/README.md) describes the JSON.

## Markdown

`markdown/escape/cases.json` lists text, whether it starts a paragraph line, and its escaped form. The Rust escaper writes exactly that. Other implementations must too.

`markdown/documents/cases.json` pairs canonical Markdown with a neutral document tree. [The documents README](markdown/documents/README.md) defines the tree.

## The example of the spec

`readable/spec-example/page.json` is the `page.json` of spec 5.5, and `page.md` is the file of spec 11.1, whose checksum is the test vector of Appendix B.4. The ink segment is the file of Appendix B.2, and `ink.svg` shows its one stroke. The spec's first segment is only an illustration, so it has no file here. The image is a stand-in whose size and hash don't match the asset table.

## Format version 2

The cases of version 2 live in their own folders, never in `markdown/escape/` or `markdown/documents/`. Readers of version 1, such as the TypeScript serializer, the Rust core, and the copies in `crates/interop/tests`, read those two files and must keep passing them, so their version 1 cases never change. The Python reference reader checks the version 2 folders, and its test also checks that no version 1 case has changed. Each folder's README describes its cases, and every case names the rules of the spec it tests.
