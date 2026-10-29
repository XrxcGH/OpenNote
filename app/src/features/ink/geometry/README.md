# Ink geometry

This folder holds the pure functions that every ink tool relies on. It has no React, no browser calls, and no platform code, so a worker, the page view, and a Node test all load it directly. Strokes are plain data, and nothing here changes a stroke: each edit returns new strokes.

## What it does

- Strokes and space: `types.ts` defines points, strokes, boxes, and capsules. `matrix.ts` and `bounds.ts` handle affine transforms and boxes. A stroke's raw points never change. Moving, scaling, or rotating it sets its transform, and `transform.ts` composes the new matrix.
- Finding strokes: `strokeIndex.ts` holds a page's strokes with a spatial index (`spatialIndex.ts`). `hitTest.ts` answers point and capsule queries, and a point hit returns the topmost stroke with highlighters below the rest.
- Erasers: `erase.ts` finds the strokes an eraser path touches. `partialErase.ts` cuts a stroke at the eraser circle and keeps the slices outside it, with one interpolated point at each cut.
- Lasso: `lasso.ts` selects strokes inside a path, using a coarse mask (`lassoMask.ts`) so most strokes need no point test. A stroke can be selected when most of it is inside, any part of it is inside, or all of it is.
- Shaping a stroke: `outline.ts` turns points with pressure and tilt into the polygon a canvas fills. `pressure.ts` builds the pressure curve table. `stabilizer.ts` is the steady pen. `simplify.ts` and `lod.ts` thin paths, and `lod.ts` also chooses the level of detail for a tile scale and smooths a path.
- Shapes: `shapes/` recognizes lines, arrows, rectangles, triangles, circles, and ellipses, and gives their exact geometry.

## Public API

Import from the feature's `index.ts`. These are the entry points the page view uses most.

| Name                                                                            | Use                                                   |
| ------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `createStrokeIndex(strokes)`                                                    | One for each page: `put`, `remove`, `query`, `find`   |
| `hitPoint(index, point, radius)`, `hitCapsules(index, capsules)`                | Click selection, the eraser hover preview             |
| `eraseStrokes`, `partialErase`, `splitStroke`, `capsulesAlong`                  | The erasers, usually through the sessions in `edits/` |
| `lassoSelect(index, path, options)`, `rectanglePath(a, b)`                      | The lasso and the marquee                             |
| `strokeOutline(points, options)`, `outlinePath(outline)`                        | Drawing a stroke                                      |
| `buildPressureTable(settings)`, `mapPressure(table, p)`                         | The pressure curve                                    |
| `createStabilizer(options)`, `stabilize(points, options)`                       | The steady pen                                        |
| `simplifyStroke(points, tolerance)`, `detailLevel(scale)`, `smoothPath(points)` | Level of detail and mouse or touch smoothing          |
| `recognizeShape(points, options)`                                               | Hold-to-snap                                          |
| `moveStrokes`, `scaleStrokes`, `rotateStrokes`, `boxToBox`, `selectionBounds`   | Selection handles                                     |

## What the interface needs

- Keep one stroke index for each page view, in the engine worker, and update it from the core's confirmed changes. A stroke is a new object whenever it changes, because the index caches boxes and page points for each stroke object.
- Pass one screen pixel in page units as `pixel` to the lasso, and size eraser radii from the zoom.
- Strokes with no per-point times are exact shapes. Do not smooth, resample, or simplify their points.
- Draw highlighter strokes below the other strokes of their block (`drawOrder`), and draw a stroke's outline with the width scale of its transform (`widthScale`).
- Property tests in `properties.test.ts` state what must hold for any input. A new operation needs one there.
