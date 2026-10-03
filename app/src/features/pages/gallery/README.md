# Page gallery

The page gallery (FEATURES.md, Phase 6, "Page gallery"): a section's pages as a grid of thumbnails that show the title and the date of each page. Pages reorder by drag, or with Move up and Move down, and selecting several works as in the tree. This folder is the arithmetic behind it: the grid, the keyboard, the drop slot, and the reordering. It has no DOM and no React. The thumbnails themselves are drawn by the page view (paper, ink, and text at the `thumbnail` detail level of the [zoom](../zoom/README.md) module).

## Public API

All of it is re-exported from `features/pages`.

| Name                                                         | Purpose                                                                          |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `gridLayout({ width, count, ... })`                          | Columns, cell size, rows, and total height for a width                           |
| `cellRect(layout, index)`, `indexAt(layout, x, y)`           | Where a cell sits, and the cell under a point                                    |
| `visibleRange(layout, scrollTop, viewportHeight, overscan?)` | The cells to draw, so a section of hundreds of pages draws a few dozen           |
| `dropSlot(layout, x, y)`                                     | The gap a dragged thumbnail drops into, from 0 to the page count                 |
| `moveGridFocus(layout, index, key, rowsPerPage?)`            | The cell an arrow key, Home, End, Page Up, or Page Down goes to                  |
| `rangeBetween(anchor, index)`                                | The cells of a shift-click                                                       |
| `dropPages(order, moving, slot)`                             | The new order after a drop, and the page the moved pages sit before (`beforeId`) |
| `stepPages(order, selected, 'up' or 'down')`                 | Move up and Move down for the selected pages                                     |
| `clickSelection(order, selected, anchor, id, how)`           | The selection after a plain, control, or shift click                             |

## Rules

- **The notes service gets `beforeId`.** `dropPages` and `stepPages` return the order they produce and the page the moved ones go before (null for the end). That is the `Placement` the notes service takes (`{ parentId, beforeId }`), the same call the tree makes, so the order key work stays in the service.
- **Several pages move together** and keep the order they had. A move that changes nothing returns null, so the view makes no call and writes no history.
- **Left and right do not wrap** from one row to the next; they stop at the first and last page. Down from a short last row goes to the last page rather than nowhere.
- **A drop lands in the nearest gap:** before a cell in its left half, after it in its right half, and at the ends outside the grid.

## What the UI wiring needs

1. A gallery view of a section, using `gridLayout` with the pane's width (re-run on resize) and `visibleRange` with the scroll position. Each cell shows a thumbnail, the page title, and its date. The thumbnail's `aspect` is the page's sheet height over width for a paginated page, and 4 by 3 for an infinite one.
2. Thumbnails from the page view's own renderer at the thumbnail detail level, drawn lazily for the visible cells and cached by page ID and modified time.
3. The keyboard: `moveGridFocus` on arrow keys, Enter to open, Alt+Up and Alt+Down for `stepPages`, and Ctrl+A for all. Mouse and touch: `clickSelection`, and a drag that shows the drop slot as a bar between cells and calls `dropPages` on release.
4. Send the result as a move through the notes service in one undo step, and read the new order back from the service.
5. Strings for "Move up", "Move down", the cell labels, and the gallery's empty state belong in `app/src/strings`.
