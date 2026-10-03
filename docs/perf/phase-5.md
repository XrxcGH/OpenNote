# Phase 5 ink: pen-to-screen and frame rate on 10,000 strokes

This page records the Phase 5 exit gate as measured in the app: the time from a pen sample to the frame that draws it, and the frame rate while drawing and while scrolling, on a page of 10,000 strokes. The pure ink core has its own benchmark in [phase-5-core.md](phase-5-core.md).

## How it is measured

- The test is `tests/ui/perf/ink.perf.spec.ts`. It runs the production build in test mode (`npm run app:build:test`) with the web platform, in Playwright's Chromium, at 1440 by 900 CSS pixels. Run it with `npx playwright test ink.perf --config tests/ui/playwright.config.ts --project=perf`, and set `OPENNOTE_INK_PERF_OUT` to a path to keep the numbers as JSON.
- A test hook seeds the shown page with 10,000 strokes of 80 points each from the core benchmark's generator (`generatePage`, seed 42). The **spread** page puts them over 4,000 by 12,000 units, about 130 strokes on screen. The **dense** page puts them over 1,600 by 4,000 units, about 1,300 strokes on screen. The test then opens another page and opens this one again, so the strokes load from the page service as they would from disk.
- **Pen-to-screen** is the time from each pointer sample's timestamp to the start of the next animation frame, over 360 samples in 6 strokes. The live stroke is drawn in the event handler on a desynchronized canvas, so this is the wait for the frame that shows it. It doesn't include the digitizer, the compositor, or the display's scan-out; those need a real pen and a camera (ADR 0004).
- **Frame rate** is from every animation frame while drawing those strokes, and while scrolling the page 12 pixels a frame for 240 frames. A long frame is one longer than one and a half display frames.
- The mouse stands in for the pen. It takes the same path through the pointer router, the stroke builder, and the live canvas; pressure and tilt add no work there.
- Machine: the development laptop, a Surface Laptop Studio 2 (the reference laptop), while other builds and test runs shared it. Headless Chromium runs its frames at about 63 Hz, not the panel's 120 Hz.

## Results

The budgets in the test: pen-to-screen at most 25 ms at the 95th percentile, and drawing and scrolling at 90 percent of the display's frame rate or better. Both pages pass.

| Page | Opens in | Pen-to-screen, median | Pen-to-screen, 95th percentile | Drawing | Scrolling |
|---|---|---|---|---|---|
| Spread, 10,000 strokes | 1.1 s | 10 ms | 16 ms | 62 fps (display 63) | 63 fps, no long frames |
| Dense, 10,000 strokes | 1.4 s | 9 ms | 16 ms | 62 fps (display 63) | 62 fps, 7 long frames of 240 |

- **Pen-to-screen** sits at about one frame: a sample waits on average half a frame, and at worst one, for the frame that shows it. Nothing in the pen path depends on how much ink the page has.
- **Drawing** keeps the display's rate. Its long frames (19 and 37 of about 250) come at pen-up, when the stroke goes into the tiles it touches and to the page service.
- **Scrolling** a dense page draws one new row of tiles every 21 frames. The slowest tile took 25 ms; most take a few, because the outlines are built ahead in idle time.
- **Opening** decodes and indexes every stroke and draws the visible tiles. The outlines of the rest are built in idle time afterward, nearest the view first.

## What got it there

The first measurement scrolled the dense page at 43 fps with 44 long frames. Three changes brought it to the display's rate:

1. Stroke outlines are built point by point into a Path2D. Building an SVG path string and parsing it again took most of each tile's time.
2. Outlines of loaded strokes are built in idle time, nearest the view first, with a minimum slice so the work moves on while the page animates.
3. Tiles ask the index only as far past their edges as the widest stroke on the page reaches, not the widest pen there is.

## Still to measure

- The same test in WebView2 at 120 Hz with a real pen, through the Tauri app, and the delegated ink trail spike (`ink.delegatedTrail`, off) if the camera check of ADR 0004 asks for it.
- Pen-to-screen on a Surface Pro, the second device the phase's definition of done names.
