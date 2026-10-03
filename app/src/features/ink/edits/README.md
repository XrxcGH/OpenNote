# Edits

This folder holds the logic of editing gestures that remove or cut ink: the stroke eraser, the partial eraser, and their filters. It has no React, no browser calls, and no platform code. Nothing here changes the stroke index. The engine updates its index when the core confirms a transaction.

## What it does

- `eraseSession.ts` has one session for each erase gesture, from pen-down to pen-up. The stroke eraser session collects the strokes the pen crosses and previews what a hover would remove. The partial eraser session cuts strokes at the eraser circle and shows the parts at once. A stroke can be cut many times, and its parts can be cut again.
- Each session gives the core one transaction at the end, and interim transactions about every 500 ms for a long pen gesture. `cancel()` abandons a gesture and says what the picture must show again and which parts to hide. For a partial erase, the transaction lists the strokes that existed before and are now gone, and the parts that replace them. Parts that were cut again before any transaction never appear, and each part's `origin` names the nearest stroke the core has.
- `filters.ts` turns the eraser filter (all ink, only highlighter, only pens, or one tool) and the lasso filter (ink, highlighter, shapes, text, images) into the `skip` predicates that the hit tests take. Strokes in locked ink blocks are never erased.

## Public API

| Name                                                           | Use                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------- |
| `createStrokeEraseSession(index, options?)`                    | `move(samples, radius)`, `preview(point, radius)`, `commit()`, `cancel()` |
| `createPartialEraseSession(index, newId, options?)`            | `move`, `parts`, `isGone`, `checkpoint`, `commit`, `cancel`             |
| `eraserSkip(filter, locked?)`, `eraserAccepts(filter, stroke)` | The eraser's `skip` option                                    |
| `lassoSkip(filter, extra?)`, `strokeKind(stroke)`              | The lasso's `skip` option                                     |

## What the interface needs

- Send each `pointermove`'s coalesced samples, in page units, to `move`. Redraw the tiles under the boxes of the strokes it reports, so they change within a frame or two.
- The eraser's radius is 1.5 mm on screen for the stroke eraser, and 1, 2, 4, 8, or 16 mm for the partial eraser. Convert with the zoom.
- A touch-driven erase (finger drawing with the eraser) sends no interim transaction. Its final `commit()` waits for the palm filter's `Fx.Commit` for that contact, and an `Fx.Retract` or a `pointercancel` calls `cancel()` instead, so a palm never removes ink.
- Send `commit()` as one `page_apply` at pen-up (`removeStrokes` for the removed ids, and the parts as stroke records). Coalesce interim transactions under the same key, so one undo reverses the gesture.
- Make part IDs with the shared ID generator, through the `newId` argument.
- For hover, call `preview` at most every 50 ms, and outline the strokes it names in the focus ring color.
