# Page export

This folder turns a page into other forms: Markdown, standalone HTML, and the semantic HTML and vector ink that the print and PDF modules lay out on sheets. It is pure TypeScript over page data, with no Document Object Model (DOM) and no React. The Markdown parser it uses is in [`markdown/`](markdown/README.md).

## What it does

- Reads a page as plain data (`readExportPage`). A damaged block becomes a placeholder, so export always has a page to work from.
- Finds the reading order of format spec 6.2 (`readingOrder`). Every export follows it: flowing blocks, then floating blocks in rows, with `view.readingOrder` first.
- Writes Markdown (`exportMarkdown`): the body of `page.md` from format spec 11.1, with escaping, links, tables, images, files, drawings, and unknown blocks as the Rust writer does. The readable copies of the shared fixtures match byte for byte.
- Writes standalone HTML (`exportHtml`): one document that reads in order, with a stylesheet, the language, and a policy that forbids scripts.
- Turns ink into vector shapes (`inkShapes`, `inkSvg`): one closed, filled path per stroke in its pen color. Width follows pressure for pens and stays fixed for markers and highlighters.
- Builds the document styles (`documentCss`) from the brand's light tokens and the notebook's named styles (format spec 4.1).

## Public API

All of it is re-exported from `features/pages`. The Markdown tree and renderers are under the `markdown` namespace.

| Name | Purpose |
|---|---|
| `readExportPage(json, strokes?, language?)` | A page.json as `ExportPage` |
| `exportStrokes(records)` | The live strokes of a page from its ink segment records, in page units |
| `readingOrder(blocks, preferred?)` | Blocks in reading order |
| `exportMarkdown(page, options?)` | `{ markdown, parts, assets }` |
| `exportHtml(page, options?)` | `{ html, assets }` |
| `renderBlock(block, context)` | One block as HTML, for the print document |
| `inkShapes`, `inkSvg`, `shapesInBand` | Ink as shapes, and the svg for one band of the page |
| `documentCss(theme, styles?)`, `lightTheme(fontFaces?)`, `readStyles(raw)` | The stylesheet and its inputs |
| `escapeText`, `rewriteLinks`, `writeDestination` | Markdown escaping and link rewriting (format spec 7.5, 7.6) |
| `dataUri(mime, bytes)` | A data URI, so HTML can hold its images |

## Rules worth knowing

- `assets` in the results lists the asset IDs the output refers to. The caller copies those files next to the output, or passes `assetUrl` and `assetPath` to point at a different place.
- Export always uses the light theme and the pens' light values. The stored stroke color is the authority for printing (format spec 8.2).
- Links follow only `https:`, `http:`, and `mailto:` destinations. `opennote:` links need a `link` or `pagePath` function that maps them to something that exists in the output.
- Nothing is drawn with a border. Lines use inset shadows and backgrounds so layout does not depend on pixel density (ADR 0006, rule 1). A test checks this.
- A drawing or image without a description gets a stand-in, so tagged PDF always has some text. The accessibility checker in Phase 11 reports the missing description.

## What the UI wiring needs

1. A notes service call that returns a page's `page.json` and its live strokes. `exportStrokes` decodes them from the segment records.
2. The strings for `ExportLabels`: handwriting, newer version, done, not done, no description, and untitled.
3. The font files as `@font-face` rules for `lightTheme(fontFaces)`. The export must use the same static font files as the screen (ADR 0006, rule 3).
4. For a self-contained HTML file, the asset bytes, turned into data URIs with `dataUri` and passed through `assetUrl`.
5. A save dialog and a folder writer in the host. This module returns text and the list of asset IDs, and writes no files.
