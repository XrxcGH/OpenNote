# Export selection

"Export selection" (FEATURES.md, Phase 6, "Export a selection"): lasso any area, then save it as PDF, PNG, or SVG, or copy it as an image. A smart selection grows the lasso to take in the whole strokes, text boxes, and images that it only touches, and trims the empty margin. This folder finds what a lasso selects and turns the selection into a page (for PDF) or a picture (for SVG, PNG, and the clipboard). It is pure TypeScript over page units, with no DOM and no React. A `.docx` export belongs to Phase 11.

## Public API

All of it is re-exported from `features/pages`.

| Name                                                                                                    | Purpose                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `selectArea(page, lasso, options?)`                                                                     | The `Selection` a lasso makes, or null when it touches nothing. `mode` is `smart` (the default) or `exact`. `boxes`, `placements`, and `skip` describe what the view knows       |
| `Selection`                                                                                             | The selected block IDs and stroke IDs, the `bounds` of the content (or lasso), the `crop` (bounds plus padding, at least an inch each way), and the `clip` polygon in exact mode |
| `cropPage(page, selection, options?)`                                                                   | The selection as an `ExportPage`: one freeform sheet the size of the crop. Feed it to the PDF export                                                                             |
| `selectionSvg(page, selection, options)`                                                                | The selection as an SVG string. Ink is vector paths, images are images, and text and tables are embedded HTML                                                                    |
| `blockBox`, `inkOrigin`, `strokeLine`, `cropOf`                                                         | The pieces: a block's box on the page, an ink block's origin, a stroke's points on the page, and the crop for some bounds                                                        |
| `inPolygon`, `pathTouches`, `rectTouchesPolygon`, `segmentsCross`, `boxOfPoints`, `unionBox`, `growBox` | The lasso geometry                                                                                                                                                               |

## Rules

- **Touching is selecting.** A block or stroke is in when the lasso touches it at all: a point inside the lasso, or a segment across its edge. A stroke that only grazes the lasso comes in whole. This is what smart select means, and exact mode uses the same test.
- **Smart trims, exact does not.** Smart bounds are the box around the selected items. Exact bounds are the lasso's own box, and `clip` holds the lasso polygon so the SVG clips to it. The PDF page is the lasso's box, because a print sheet is a rectangle.
- **Flowing blocks need boxes.** A block with no frame (flowing text, a table, an image) can be selected only when the view passes its measured box in `boxes`. A floating text box with no height is taken as 300 by 24 units unless a box says otherwise.
- **Ink on skipped layers stays out.** `skip` holds block IDs, such as hidden or locked ink layers (FEATURES.md, Layers).
- **The crop is a page.** `cropPage` moves the content so the crop's corner is the origin, turns flowing blocks into floating ones where they were laid out, folds each stroke's transform into its points and width, and puts all strokes in one ink block (`selection-ink`) with the description the caller gives. It keeps only the assets the selection uses. The paper is plain, so the picture has no rules behind it.
- **Text in SVG is HTML.** `foreignObject` draws in browsers and WebView but not in vector editors. A caller that needs text in a vector editor exports PDF. For PNG, the host draws the SVG onto a canvas, which needs every image as a data URI (`assetUrl` returns one) and the fonts embedded in the `css` option.
- **The PDF page size** is the crop in points. Chromium rounds a page up to a grid of 0.96 points, so the PDF can be up to a point larger than the crop (see the `pdf` README).

## Tests

`selection.test.ts` covers the geometry, smart and exact selection, skipped layers, measured boxes, the minimum crop, the page made from a selection, and the SVG. `export.test.ts` prints a selection to PDF with the installed Edge and checks the page size, the text layer, the image, the vector ink, and the description of the handwriting in the tags.

## What the UI wiring needs

1. A lasso tool that collects page points while the pen or mouse is down, closes the polygon, and calls `selectArea` on release. Smart select is a toggle in the selection toolbar, and exact is the other state.
2. A selection menu: "Export selection" with PDF, PNG, and SVG, and "Copy as image". Each calls `cropPage` or `selectionSvg`. The host supplies the strings (`app/src/strings`) and an `assetUrl` that returns data URIs.
3. The page view's measured boxes for flowing blocks, as a `Map` of block ID to box in page units, the placements of ink blocks that are not at their frame, and the set of hidden or locked layers.
4. PDF: pass `cropPage(...)` to `exportPdf` like any page. PNG: draw `selectionSvg(...)` onto a canvas at the chosen pixel density and encode it. Copy as image: the same canvas, written to the clipboard.
5. "Smart select grows the lasso" should be visible. Draw the crop (`selection.crop`) as a dashed rectangle after the lasso is released, so a person sees what will be exported before choosing.
