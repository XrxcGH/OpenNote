# Gestures

These detectors recognize pen and touch gestures (design 12.4). Each takes plain points or contact data, so Node tests drive them. The page view feeds them and shows an Undo toast after each gesture. Every gesture is listed in the shortcut list and can be turned off in settings.

## What it does

- `scribble.ts` finds a scribble to erase. At pen-up, a path qualifies when it meets three tests. It is at least 3 times its box's diagonal. It turns back at least 4 times along its main axis, each turn a swing of at least a quarter of the extent. It takes under 2 seconds. `scribbleTargets` then picks the strokes with 30 percent or more of their length inside the scribble's hull. A scribble that covers no ink stays as ink, since it may be shading.
- `circleTap.ts` finds a closed loop (`detectLoop`) and the content inside it (`loopContent`). `matchCircleTap` says whether a pen tap completes the gesture. The tap must be under 200 ms, move under 4 pixels, land inside the loop, and come within a second of it.
- `multiTap.ts` is a small state machine for two-finger and three-finger double taps. Fingers must land within 150 ms of each other, 15 to 80 mm apart, lift within 250 ms, and move under 2 mm. A palm-sized contact (20 mm), a canceled contact, or a finger still down after 250 ms voids the group, so a lost lift cannot wedge it. Two taps of the same size that start within 400 ms of each other make an undo (two fingers) or a redo (three). The result waits 150 ms and comes from `poll`, so a pen event (`cancel`) or a palm verdict (`voidContact`) in that time stops it. The pipeline raises the spacing to 25 mm with `setMinSpacing` on a device that has seen a pen but reports no contact size. There the parts of a palm that settles twice sit closer.
- `corpus.ts` draws synthetic handwriting, loops, and scribbles for tests. A detector that must stay quiet on handwriting runs over it. Real recordings in `tests/fixtures/pen` should replace it when they exist.

## Public API

| Name                                                                                             | Use                                                                |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `detectScribble(points, options?)`, `scribbleTargets(index, match, options?)`                    | Pen-up of every stroke                                             |
| `detectLoop(points, options?)`, `loopContent(index, loop)`, `matchCircleTap(loop, loopEnd, tap)` | Pen-up, then the next pen contact                                  |
| `createMultiTapDetector(options?)`                                                               | Touch contacts while the pen is away; `input/pipeline.ts` feeds it |

## What the interface needs

- At pen-up, run `detectScribble` first, then `detectLoop`. If a scribble covers ink, remove those strokes in one transaction and skip adding the scribble. If a loop encloses content, hold its commit for up to a second with no progress record, and commit it as ink when the time passes with no tap.
- Show a toast such as "Erased 4 strokes" with Undo after each gesture.
- `input/pipeline.ts` feeds `multiTap` every landing that is not a palm while presence is away or absent and at least 1 s after the last pen evidence, before draw, pan, and ignore are resolved, so a three-finger tap is seen in finger drawing too. It calls `cancel` on pen evidence, `voidContact` on a palm verdict, and `poll` on every tick.
- The detectors must never fire on handwriting. Run them over every pen recording in the corpus in a test.
