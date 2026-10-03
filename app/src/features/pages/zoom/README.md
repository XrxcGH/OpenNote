# Zoom and view rules

This folder holds the rules for zooming and moving around a page. They cover the zoom steps and limits, wheel and pinch gestures, fitting a sheet to the window, and the view limits. They also cover switching between infinite and paginated view, sheet navigation, and how much detail to draw at a zoom. The code is pure TypeScript with no Document Object Model (DOM) and no React.

## Units

- A zoom is a factor, where 1 is actual size. The page view state in `PageViewState.zoom` stores the same factor (range 0.1 to 10). The page view offers 0.25 to 4.
- A `View` is `{ zoom, left, top }`, where `left` and `top` are the page position at the window's top-left corner, in page units (1/96 inch). Zooming then never changes what a stored scroll means. The page view state keeps `scrollX = left` and `scrollY = top`.
- Window positions are CSS pixels from the window's top-left corner.

## Public API

All of it is re-exported from `features/pages`.

| Name | Purpose |
|---|---|
| `ZOOM_STEPS`, `stepZoom(zoom, ±1)` | The 25% to 400% ladder. It steps from any zoom, including a fitted one between two steps |
| `wheelZoom`, `pinchZoom` | Smooth zoom for Ctrl+wheel and pinch. Both snap to 100% within 4% |
| `fitWidth`, `fitSheet`, `fitSpread`, `openingZoom` | The zoom that fits a sheet, a spread of sheets, or the width. `openingZoom` is 100% when the sheet fits, else the fit width, but never below 50% |
| `zoomAt(view, zoom, anchor)` | Zooms about a window position. The page position under the anchor stays under it |
| `boundsFor(mode, sheet, sheets, content?)` | What the window may show |
| `clampView`, `switchView` | Keeps a view within bounds. Switching mode keeps zoom and position, and reports `moved` when it must change them |
| `currentSheet`, `visibleSheets`, `viewOfSheet`, `viewOfWholeSheet`, `flipTarget` | The sheet counter, the sheets to render, "Go to sheet", and flipping sideways |
| `detailLevel`, `lineEvery`, `showsPaper`, `tileScale` | How much to draw at a zoom |

## Rules

- Both modes share one horizontal range, the paper's width widened to take in content that lies off the paper. A sheet narrower than the window sits centered in both. Switching views therefore changes no horizontal position.
- Infinite view adds a sheet of blank space below the content to write in. Paginated view ends at the last sheet. The vertical position moves on a switch only when it lies in that extra space.
- Ruled lines, grids, and dots draw every nth line so lines stay 6 pixels apart. They hide when n would exceed 8.
- Below 50% the view is "simplified", and below 25% a sheet is a thumbnail.
- Ink and paper tiles rasterize at a power-of-two scale at or above `zoom × pixelRatio`, so a pinch re-renders tiles only when it crosses a step.

## What the UI wiring needs

1. Keep a `View` per open page. Update it from wheel, pinch, and keyboard commands through `zoomAt`. Use the window center as the anchor for commands, and the pointer for gestures.
2. Call `clampView` after every scroll or zoom, with `boundsFor(mode, sheet, plan.sheets, inkBounds)`. Recompute the bounds when the sheet count or the content changes.
3. On a view switch, call `switchView` and apply `view` with no animation. If `moved` is not 0, animate only that difference.
4. The sheet counter and the navigator strip read `currentSheet` and `visibleSheets`. A thumbnail click calls `viewOfSheet`. Flip mode calls `viewOfWholeSheet` with `fitSheet`.
5. Show the zoom in the status area with `percent`. The zoom commands use `ZOOM_STEPS`. The Phase 2 page zoom list is a subset of it, and the page feature should switch to this module when Phase 4 merges.
6. Strings for the zoom announcements and the sheet counter belong in `app/src/strings`.
