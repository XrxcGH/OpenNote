# Insert space

This folder plans the "Insert space" tool (design 12.1). It has no React, no browser calls, and no platform code.

## What it does

A horizontal line across the page splits it. Dragging down pushes everything below the line down by the drag distance. Dragging up closes a gap but never moves content above the line. `planInsertSpace` says what moves and by how much, and it changes nothing itself.

- Strokes whose box starts below the line move. A stroke that crosses the line stays, as in OneNote.
- Floating blocks whose top is below the line move.
- Locked strokes and blocks stay in place, and the plan counts them for the announcement "1 locked item stays in place."
- An upward drag is limited so that the highest moved item stops at the line.
- `spaceAmount` converts a value from the dialog (millimeters, inches, or lines of the paper's ruling) to page units.

## Public API

| Name                                      | Use                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `planInsertSpace(index, y, dy, options?)` | Returns the stroke ids, block ids, the distance, the locked count, and a translation matrix |
| `spaceAmount(value, unit, lineHeight)`    | The dialog's amount in page units                                                           |

## What the interface needs

- While the person drags, call the plan with the drag distance and draw the moved strokes in a sprite that covers the visible area plus one screen height below. Move blocks with a CSS transform.
- On release, send one transaction: `transformStrokes` with the matrix for the strokes (grouped by ink block), and `moveBlock` for each block. Coalesce it as one drag, so one undo reverses the whole move.
- Anchored ink moves with its text, so include the anchored blocks of every moved text block in `blocks`.
- In paginated view, coordinates run across sheets, so pushed content lands on the next sheet and nothing is lost.
- Announce the result, such as "Added 2 cm of space below the heading."
