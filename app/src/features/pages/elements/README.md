# Elements library

The elements library (FEATURES.md, Phase 6, "Elements library"): lasso ink, shapes, text, and images, and "Save as element" keeps them for reuse, such as a header, a signature, a labeled axis, or part of a flowchart. Elements sit in folders, are found by name, scale to fit when inserted, and export as a file to share. This folder is the pure part: the element, the library of them, and the file. It has no DOM, no React, and no storage.

## Public API

All of it is re-exported from `features/pages`.

| Name                                                                                            | Purpose                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `makeElement(page, selection, options)`                                                         | An element from a [selection](../selection/README.md): text, tables, images, and ink, positioned from the content's top-left corner. Returns the element and how many blocks it had to skip (attachments, blocks of unknown types, images whose bytes are not at hand) |
| `fitScale(element, space, grow?)`                                                               | The scale that fits an element into a space. It shrinks an element that is too large and leaves a smaller one at 1, unless `grow` is set                                                                                                                               |
| `insertElement(element, options)`                                                               | The blocks, strokes, and assets that put an element on a page at a point and scale, with new IDs from the caller's `ids` function                                                                                                                                      |
| `elementSvg(element, options)`, `elementPage(element)`                                          | The element as a picture for the library's thumbnails, and as a one-sheet `ExportPage`                                                                                                                                                                                 |
| `ElementLibrary`, `EMPTY_LIBRARY`, `ElementEntry`                                               | The folders and elements, as plain data                                                                                                                                                                                                                                |
| `addElement`, `renameElement`, `moveElement`, `removeElement`                                   | Element changes. Each returns `{ library, error? }` and leaves the library unchanged on an error                                                                                                                                                                       |
| `createFolder`, `renameFolder`, `moveFolder`, `removeFolder(library, path, 'keep' or 'delete')` | Folder changes. `keep` lifts what is inside to the parent                                                                                                                                                                                                              |
| `listFolder(library, folder)`, `allFolders(library)`, `uniqueName(...)`                         | What a folder shows, every folder, and a sibling-free name                                                                                                                                                                                                             |
| `searchElements(library, query)`                                                                | Elements whose name has every word of the query, best match first                                                                                                                                                                                                      |
| `writeElementFile(name, element)`, `readElementFile(text)`                                      | The shareable file as text, and a reader that never throws                                                                                                                                                                                                             |

## Rules

- **An element carries its images.** Image bytes are base64 inside the element, so it works in any notebook and as a file. `insertElement` returns the images to add to the page, with new asset IDs.
- **Scale changes positions and sizes, not type.** A text box scaled to half its width wraps at that width, and the page's type scale decides its size. Ink, images, and table column widths scale. Pressure and pen width follow.
- **Nothing is invented on insert.** IDs come from the `ids` function and times from `start`, so the same call gives the same result, and the notes service gives blocks their order keys.
- **Names.** A name has control characters removed and spaces collapsed, up to 80 characters. A folder name is up to 40 and has no slash. Folders go six deep. A name no sibling has gets a number: "Axis", "Axis 2".
- **Search ignores case and accents.** A name equal to the word beats one that starts with it, which beats one with a word that starts with it, which beats one that contains it. The folder path matches last. Every word must match.
- **A file from someone else is untrusted.** The reader checks every number and string, refuses a file over 40 million characters, with more than 500 blocks, 20,000 strokes, or a million points, or written by a newer version, and keeps only PNG, JPEG, GIF, and WebP images with valid base64. A block or stroke it cannot use is dropped and reported in `warnings`. SVG images are refused because they can carry scripts.

## Tests

`elements.test.ts` covers making an element from a selection, inserting at a scale (and back at the original place), the thumbnail picture, every library operation and error, search ranking, and the file: a round trip, the refusals, the dropped parts, and a property test that the reader never throws on any JSON.

## What the UI wiring needs

1. A store for the library, as `elements.json` in the app's data folder or the notebook's, holding `ElementLibrary`. Writing it is the notes service's job, with the same safe-write rules as other files (format spec 17).
2. A "Save as element" command on a lasso selection: call `selectArea`, then `makeElement` with an `assetData` that reads an asset's file as base64, ask for a name and folder, and `addElement`. Report `skipped`.
3. An elements pane: `listFolder` for the folders and elements, `searchElements` for the search box, `elementSvg` for thumbnails (the `assetUrl` callback returns a data URI), drag and drop or a button to insert, and the folder and element menus (rename, move, delete, new folder).
4. Insert: `fitScale` against the free space or the page's content width, `insertElement` at the pointer or the center of the view, then add the returned assets, ink block strokes, and blocks to the page in one undo step. New strokes go on the active layer.
5. "Export element" and "Import element" with `writeElementFile` and `readElementFile`, a save dialog with the `.opennote-element` extension, and the `warnings` shown after an import. Strings for the labels and errors belong in `app/src/strings`.
