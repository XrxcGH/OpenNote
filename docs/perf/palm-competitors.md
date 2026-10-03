# Palm rejection: competitor baseline

The owner's bar is palm rejection more accurate than any major competitor. This page holds the numbers that make that claim checkable. Each row is the manual checklist in [palm-rejection.md](../testing/palm-rejection.md), steps 1 to 8, run by hand in another app on the same device as OpenNote. Nothing has been measured yet, so every cell is empty.

## How to measure

- Use the same device, the same hand, and the same prompted text for every app.
- Do each step 20 times, and count faults as the checklist defines them.
- Note the app's version and any palm or stylus setting you changed. Leave settings at their defaults unless the app asks on first run.
- Repeat before each beta, because apps change.

## Faults per 100 tries

| Device | App | Version | Stray marks | Stray scrolls or zooms | Stray taps, menus, or gestures | Dropped or cut strokes | Dead-finger seconds | Date |
|---|---|---|---|---|---|---|---|---|
| Surface Laptop Studio 2, Surface Pen | OneNote | | | | | | | |
| Surface Laptop Studio 2, Surface Pen | Microsoft Journal | | | | | | | |
| Surface Laptop Studio 2, Surface Pen | OpenNote | | | | | | | |
| iPad, Apple Pencil | Goodnotes | | | | | | | |
| iPad, Apple Pencil | Notability | | | | | | | |
| iPad, Apple Pencil | Apple Notes | | | | | | | |
| iPad, Apple Pencil | OpenNote | | | | | | | |
| Galaxy Tab, S Pen | Samsung Notes | | | | | | | |
| Galaxy Tab, S Pen | OpenNote | | | | | | | |
| Fire Max 11, USI pen | OneNote | | | | | | | |
| Fire Max 11, USI pen | OpenNote | | | | | | | |

## Setting the CI thresholds

When a device family has numbers, set the gates in `tests/fixtures/palm/thresholds.json` at or below the best competitor's rate for that family, and record the change in the pull request. The gates may only tighten.
