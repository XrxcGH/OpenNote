# Selection

This folder holds the lasso's hit testing for blocks, and the combined lasso over ink and blocks (design 9.3, 9.4, and 12.5). It has no React, no browser calls, and no platform code. The lasso over strokes is in `geometry/lasso.ts`.

## What it does

- `lassoBlocks` selects blocks, such as text boxes and images, whose geometry lives in the page layout. It lays an 8 by 8 grid of points over each block's frame and counts how many fall inside the lasso. The setting is the same as for ink: mostly inside (60 percent by default), any part, or all. In "any part" mode a block also counts when a corner of the lasso lies inside its frame, so a small lasso inside a big block selects it.
- `lassoAll` runs the lasso over strokes and blocks together and applies the filter: ink, highlighter, shapes, typed text, and images, each on or off.
- `selectionFrame` gives the box that selection handles hug, covering the centerlines of the strokes and the frames of the blocks.

## Public API

| Name                                                    | Use                                         |
| ------------------------------------------------------- | ------------------------------------------- |
| `lassoBlocks(path, blocks, options?)`                   | The marquee and the lasso over blocks       |
| `lassoAll(index, blocks, path, { filter, ...options })` | The lasso tool                              |
| `selectionFrame(strokes, blocks)`                       | Selection handles                           |
| `frameGrid(frame)`                                      | The 64 test points, for a debugging overlay |

## What the interface needs

- Build `BlockItem` records from the page layout. Each has a frame in page units and a kind: `text` for text boxes and tables, `image` for images and files, and `other` for the rest. It also says whether the block is locked. A locked block can be selected, but a move leaves it in place with the note "1 locked item stays in place."
- Rectangle lasso and the page marquee send four points. A freeform lasso sends its path, and the functions simplify it to one screen pixel. Pass `pixel` as one screen pixel in page units.
- When a text block is selected, its anchored ink comes along. That lookup belongs to the anchoring code, not here.
- Save the filter and the "how much must be inside" choice in settings.
