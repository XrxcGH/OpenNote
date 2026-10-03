# Input

This folder turns pointer input into strokes and decides which input is allowed to draw. It has no React, no browser calls, and no platform code. Each piece takes plain data and the time, so a recorded pen session replays to the same result and a Node test can drive it.

The page view reads pointer events, copies their fields into the plain types here, and acts on what comes back. The gesture detectors have their own README in `gestures/`.

## What it does

- `samples.ts` turns one raw sample into a stroke point. `normalizeInto` writes into a reused scratch object, so the pen path allocates only the points a stroke stores. Touch and mouse samples carry no pressure and no tilt. Positions are clamped to the range a record holds. Tilt comes from `tiltX` and `tiltY`, or from the altitude and azimuth angles.
- `strokeBuilder.ts` builds one stroke from samples. It runs pressure through the pen's curve table, steadies the path if the steady pen is on, and drops samples a record could not tell apart. It decides zero pressure per stroke: once a stroke reports pressure, a leading 0 takes the first real value and a later 0 repeats the previous one. A stroke that never reports pressure keeps the middle pressure. At the 200,000-point limit it ends the stroke and continues from the same point in a new stroke.
- `palm/` is palm rejection: an evidence classifier with provisional touch ink and retractable camera moves. Its README describes the rules.
- `touchNav.ts` holds the math of managed scroll, pan, and pinch: the camera step for each move, the fling glide, and the total applied.
- `pipeline.ts` wires the palm filter, the multi-tap detector, `touchNav`, and the touch stroke builders to the page view. The replayer in `testing/` drives the same pipeline, so measured accuracy describes the shipped wiring.
- `buttons.ts` decides what the pen's barrel button and eraser end do, per pen, and when to block the press-and-hold menu.
- `testing/` has the labeled session format, device profiles, the hand model and scenario generators, the replayer, the metrics, and the capture recorder. `palm.accuracy.test.ts` gates accuracy in CI.

## Public API

| Name                                                                  | Use                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------- |
| `normalizeSample(raw, table?)`, `tiltFromAngles(altitude, azimuth)`   | A single sample, outside a stroke                             |
| `createStrokeBuilder(options)`                                        | One per stroke: `push`, `snapshot`, `takeCompleted`, `finish` |
| `createInkPipeline(host, settings, profile, learned?)`                | One per page view: `handle(record)`, `system`, `tick`         |
| `createPalmFilter(settings?, profile?, learned?)`                     | Inside the pipeline; see `palm/README.md`                     |
| `resolvePenAction(event, settings)`, `buttonsForPen(saved, deviceId)` | The action chosen at `pointerdown`                            |
| `suppressContextMenu(state)`                                          | The `contextmenu` handler for pens                            |

## What the interface needs

1. Feed pen events from window-level capture listeners, hover included, with all coalesced samples. Never commit predicted samples. A `hover` is a `pointermove` with no buttons; `pointerover`, `pointerenter`, `pointerout`, and `pointerleave` on an element are never hover. A pen `leave` is `pointerleave` on the document root, or `pointerout` with no `relatedTarget`. On the `windows-pen-as-mouse` profile, feed mouse events too: the pipeline treats them as the pen.
2. Feed touch events from the page and from the controls outside it, each with its surface.
3. Apply the pipeline's touch policy. Under `managed`, page surfaces and the editable blocks over them keep `touch-action: none` while an ink tool is active, which also keeps OS handwriting from taking strokes. On WebKit, also call `preventDefault` on `touchstart` and `touchmove` there.
4. Snapshot the camera at every touch down, restore it on `revert`, and stop any fling. Freeze the camera while a pen is down. A pen down that ends a touch scroll reaches the host after the scroll's `revert`, so the stroke's first point maps with the camera it keeps.
5. Draw provisional touch ink on the live layer only, and send no progress record for it. Act on `commit`, `retract`, `uncommit` (a delete that does not enter the undo stack), and `show` (a stroke that may now be seen, with its whole path).
6. Run each `gesture`. A `silent` one is the inverse of the last, taken back because a pen arrived within a second in the hand region of taps that were themselves likely a palm: apply it with no toast. Undo, then rewriting where the taps were, keeps the undo.
7. Swallow `click`, `contextmenu`, and long press for contacts the pipeline does not allow. On controls, stop the pointer events of ignored contacts in the capture phase.
8. Run one 100 ms interval while the pipeline needs ticks, plus a timeout at `nextDue()` so a held stroke commits on time. Send `system` for window blur, page hidden, and page switch, and for a pen capture lost while the pen is still down. Never send it for the capture release that follows a normal `pointerup`. Save `learned()` to device state on page hide.
9. Pass a fresh `Date.now() - performance.now()` origin to each stroke's builder at contact. On WebKit without coalesced events, read Apple Pencil samples from Touch Events (`touchType`, `force`, `altitudeAngle`). Treat a pen whose pressure never varies as having none.
10. Give the builder the camera cached at contact. Positions are page units, so a scroll mid-stroke must update the cache. The replayer models the camera and gates that it never moves between a pen stroke's first sample and its lift.
11. Read the pen's curve table and steady pen strength from device state, keyed by `persistentDeviceId` when the browser reports one. Pass the active tool's width, the palette slot, and the light-theme color from the pen palette. Make stroke IDs with the shared ID generator.
