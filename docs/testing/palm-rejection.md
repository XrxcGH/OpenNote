# Palm rejection: manual checklist

This checklist checks palm rejection by hand on each device in the [device matrix](../DEVELOPMENT.md#7-device-test-matrix). The automated gate in `palm.accuracy.test.ts` replays synthetic sessions for every device profile; this checklist is how real hands and real digitizers reach it. Run it before each beta, on each device, with each hand where possible.

## How to run it

- Use a dev build with an ink tool selected and the default settings, unless a step says otherwise.
- Do each step 20 times. Record a pass, or the number of faults out of 20, in the results table below.
- A fault is any of these:
  - a stray mark, even one that disappears
  - a stray scroll or zoom
  - a caret, menu, keyboard, undo, or redo that you did not ask for
  - a stroke, or part of a stroke, that did not appear
  - a finger that did nothing when it should have scrolled, panned, tapped, or drawn
- When the Palm lab is built, record each step as a session and export it to `tests/fixtures/palm/`. Write only the prompted text.

## Steps

1. Write three lines with the hand resting on the screen.
2. Plant the hand first, then bring the pen down and write a word.
3. Lift the pen out of range between lines and plant the hand again. Then pause for 5 seconds with the pen above the screen, and plant the hand again.
4. With the pen hovering, pinch with the other hand to zoom, and drag two fingers to move the page. Then scroll with one finger of the other hand. Keep these fingers on the side away from the pen hand: fingers where the writing hand rests (below and beside the pen tip) are held back on purpose, and scroll again a few seconds after the pen leaves.
5. With the pen down, rest the other hand on the page. While the pen hovers, tap a palette color with the other hand.
6. Rest the palm on the palette or the toolbar while writing next to it.
7. Move the hovering pen onto the toolbar and back while the hand rests on the page.
8. Put the pen away. One-finger scroll, a tap, and a two-finger double tap must work within 1 second. After 20 seconds, every reading gesture must work.
9. Finger drawing (set "Draw with finger" to on, or use a device with no pen): draw with the hand hovering, with the knuckles resting, and while holding the device by its edge.
10. Passive stylus: rest the hand first, then write. Then write with the edge of the hand landing first.
11. Switch apps in the middle of a stroke and come back. Switch pages in the middle of a stroke. Nothing may be lost, and nothing may stay stuck.
12. Left hand, and a hooked grip: repeat steps 1 to 4.

## Devices

| Device | Pen | Notes |
|---|---|---|
| Surface Laptop Studio 2 | Surface Pen (MPP) | The development machine. Check with Windows handedness set correctly and set wrong |
| Wacom AES laptop | AES pen | Hover drops out easily; the firmware helps less |
| Windows tablet with Wacom EMR | EMR pen | Also run with Windows Ink off, where the pen is a mouse |
| iPad without hover | Apple Pencil (1st generation) or USB-C | No hover; USB-C reports no pressure |
| iPad Pro M2 or later | Apple Pencil 2 or Pro | Hover; iPadOS blocks new touches while the Pencil is down |
| Galaxy Tab | S Pen | Long hover; Android 13 palm rejector |
| Fire Max 11 | USI 2.0 pen | Android 11: no system palm rejector |
| Chromebook or Android 13 tablet | USI pen | Short or no hover |
| Any tablet | Passive stylus | Reports as touch |
| Android phone, iPhone | None | Finger drawing commits at once, with no hold |

## Results

Record one row per device and hand. Leave a cell empty until the step is run.

| Device | Hand | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | Build |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Surface Laptop Studio 2 | Right | | | | | | | | | | | | | |

## The same protocol in other apps

Run steps 1 to 8 in OneNote, Goodnotes, Notability, Samsung Notes, Apple Notes, and Microsoft Journal on the same devices, where each app runs. Count faults the same way and record them in [palm-competitors.md](../perf/palm-competitors.md). The CI thresholds for a device family are set at or below the best competitor's rate on it.
