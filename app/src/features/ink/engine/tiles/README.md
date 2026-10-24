# Tile cache planner

Finished strokes draw into cached tiles, so a large page scrolls and zooms without redrawing every stroke (design 7.3 to 7.8). This folder decides which tiles to draw. It has no React, no canvas, and no browser calls. The engine worker owns the canvases and asks the planner what to do on every camera message.

## What it does

- `grid.ts` is the tile arithmetic. A tile is 256 by 256 device pixels. At a scale `L` in device pixels per page unit, tile `(tx, ty)` covers `256 / L` page units. Indices are signed, so a page grows in every direction. The scale settles at exactly zoom times the pixel ratio, kept between 1/16 and 8, and tiles are redrawn only when the shown scale differs from it by more than 7 percent.
- `planner.ts` has `planTiles`, a pure function. It takes the view, the tiles that exist, a content revision, and a budget. It returns the scale, the jobs to draw, the tiles with no ink, the tiles to show, the tiles to give back, and whether the overview must show.
- `invalidate.ts` turns a change (a stroke added, removed, restyled, or moved, or a theme change) into one dirty rectangle for each tile that exists. The rectangle is the change's box grown by one device pixel, snapped outward to whole pixels, and clipped to the tile.
- `inkBox.ts` gives the box a stroke's ink reaches, taken from the outline the renderer fills. A hard press draws wider than the nominal width, a tilted pencil wider still, and a sharp turn in a sparse path swings the outline past the centerline. So tiles use this box and not the hit test box.
- `budget.ts` sizes the hidden tile cache from what is left of Phase 5's 40 MB after the fixed parts and the visible tiles. Each tile counts twice, because the compositor keeps a copy. The fixed part is provisional until check I10 measures it.

## Priorities

| Priority | Work                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| 1        | Visible tiles that are missing or stale                                                                    |
| 2        | A ring of one tile around the view, two rows ahead of a fast scroll, and a sharper set after a big zoom-in |
| 3        | Stale tiles outside the ring, refilled when idle                                                           |

Priority 0 (hand-off, erase redraws, hit tests) comes from invalidation and the sessions, not from the planner. While a pen is down, only the visible tiles are drawn. During a zoom gesture no job starts at a new scale, except that a zoom-in past twice the shown resolution requests the visible tiles at the new scale at priority 2. Tiles at the old scale stay until the new set covers the view.

## Public API

| Name                                                                         | Use                                                |
| ---------------------------------------------------------------------------- | -------------------------------------------------- |
| `planTiles(input)`                                                           | Every camera message and every change              |
| `invalidate(tiles, scale, events)`                                           | After each transaction, undo, or theme change      |
| `inkBounds(stroke)`                                                          | The box of an event                                |
| `tileBudget({ visibleTiles })`, `backgroundBudget(n)`                        | Open and resize, and a page view in the background |
| `tilesIn(rect, scale)`, `tileBounds(tx, ty, scale)`, `tileId(scale, tx, ty)` | Placement                                          |

## What the interface needs

- The engine keeps a map of tile ids to `TileInfo`, with the revision each tile was drawn at and a frame counter that it updates for every tile a plan wants. It runs the returned jobs in slices of 4 ms, and it marks `empty` tiles ready with no canvas.
- Pass `hasInk` from the stroke index: a query of the tile's rectangle that finds any stroke whose `inkBounds` meet it. A sparse page then draws far fewer tiles.
- Pass the content revision, and raise it when `invalidate` returns `all`. The cache key also includes the color scheme.
- Redraw only the dirty rectangle of a tile: clip, clear, and draw the strokes that meet it. When `onTop` is true, draw the new strokes over the tile without clearing.
- Show the overview while `overview` is true, and hide it otherwise, so a gap never shows.
- Placement uses the CSS transform of each canvas in page units. `visible` lists the tiles at the plan's scale that already exist.
