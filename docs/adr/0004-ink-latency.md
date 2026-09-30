# ADR 0004: Ink latency

- Status: Proposed
- Date: 2026-09-30

## Context

The architecture decision record (ADR) [0001](0001-app-stack.md) chose Tauri 2 and WebView2, as long as ink passes the [Phase 1](../../DEVELOPMENT.md#phase-1-spikes) latency spike. [BRAND.md](../../BRAND.md#10-comfort-and-performance-budgets) sets the pen budget:

> Stroke drawn in the next frame; 25 ms or less end to end on a 60 Hz screen

If ink in WebView2 misses it and can't be fixed, the interface moves to Flutter before Phase 2.

Pen-to-screen time has four parts:

1. The digitizer senses the pen and reports it to Windows.
2. Windows and WebView2 deliver the event, and the page draws.
3. The Windows compositor puts the new frame on the desktop.
4. The display scans the frame out, and the pixels change.

The app stack only shapes parts 2 and 3. This spike measures them on the owner's laptop, compares them with a native window, and estimates the rest. A camera check at the end covers all four parts.

## Decision

We will keep ADR 0001. Tauri 2 with WebView2 stands, and the Flutter fallback doesn't trigger.

- A desynchronized 2D canvas that draws in the pointer event handler shows ink 13.7 ms after the input at the median, and 16.1 ms at the 95th percentile (p95). On this 120 Hz screen that is 1.6 and 1.9 frames. The stroke is drawn in the next frame, well within 25 ms.
- A plain native window that draws with the Windows Graphics Device Interface (GDI) takes 7.5 ms and 16.8 ms. WebView2 costs 3 to 6 ms more at the median, and nothing more at p95.
- On a 60 Hz screen we estimate 24 to 41 ms end to end at the median, before the digitizer. So the 60 Hz figure is missed. The native window misses it too at p95, because the compositor and the scan-out take most of the time. Flutter uses the same compositor and display, so switching wouldn't fix this.

Phase 5 will draw live ink on a desynchronized 2D canvas in the pointermove handler, with coalesced events and perfect-freehand. Nothing the pen needs will wait for an animation frame while the pen is down. Finished strokes move into cached tiles after the pen lifts.

One condition applies: the camera check below must show 25 ms or less at the median on this 120 Hz screen. The owner should also decide whether BRAND.md should state the pen budget in frames, such as "ink within 2 frames of the input at p95". Even the native window is estimated to miss the 60 Hz figure.

## Options considered

| Option | For | Against |
|---|---|---|
| Desynchronized 2D canvas, drawn in the handler (chosen) | Fastest WebView2 path, with 96% of moves within 2 frames | Animation frames nearly stop during a fast stroke, and about 6% of pen points are lost |
| Plain 2D canvas, drawn in the handler | Keeps every point and a steady frame rate | Input waits for the next frame, so only 73% of moves are within 2 frames |
| Plain canvas, drawn in the next animation frame | The usual pattern in web apps | Slowest, with a p95 of 26.3 ms |
| `pointerrawupdate` on a desynchronized canvas | Same speed as pointermove | No predicted points. In a shared WebView it also stopped predictions on later pages. |
| Desynchronized WebGL | Draws many strokes on the graphics processor | Slower tail, and 6 of 200 moves timed out |
| Delegated ink trails | Meant to hide a busy main thread | Drew no trail for injected input, and didn't help a busy page |
| Predicted tail from `getPredictedEvents` | About 5 predicted points per event | No gain for single moves |
| Switch the interface to Flutter | One canvas on every platform | Same compositor and display, and not measured here. Gives up the web editor and the rest of ADR 0001. |

## Consequences

- Phase 5 builds ink on the chosen design. Its latency benchmark reuses this harness: `npm run spikes -- ink --auto`.
- Animation frames nearly stop during a fast stroke on a desynchronized canvas: 37 frames in 2 seconds instead of 257. Work that runs on animation frames, such as tiles, scrolling, or a lasso, must wait for the pen to lift or move to a worker.
- About 6% of pen points at 240 Hz never reached the desynchronized page, while the plain canvas kept 99%. Phase 5 should check whether stroke shape suffers.
- A busy main thread, with 10 ms tasks every 16 ms, raised the p95 from 16.1 to 22.5 ms. Heavy work stays off the main thread while the pen draws.
- Revisit this record if the camera check shows more than 25 ms, if a WebView2 update changes these paths, or if a Flutter prototype beats the native window.

## Measurements

### Machine

A Microsoft Surface Laptop Studio 2 with 20 logical processors, Windows 11 Pro 25H2 (build 26200.9550), WebView2 154.0.4258.37, and a 120 Hz screen at 150% scale. The registry calls it Windows 10 Pro, as it does on every Windows 11 system. The run was on 2026-09-30. The full data is in [`spikes/results/ink.json`](../../spikes/results/ink.json).

### Method

The harness in `spikes/harness/src/ink/` opens the page in a new window for each renderer mode. The window is 1200 by 800 pixels and stays on top. For each of 200 moves per input path, the harness:

1. picks the next point on short strokes spread over the page, with changing pressure and tilt;
2. waits 0 to 2 frames at random, so moves don't line up with the display;
3. watches a 24-pixel square around the point with the Desktop Duplication API;
4. sends the move, and times it to the first desktop frame in which the square changes.

Moves go two ways. A synthetic pen goes through the Windows pointer stack (`InjectSyntheticPointerInput`). The Chrome DevTools Protocol (CDP) skips Windows. All times use the Windows performance counter. The page's own timestamps split each latency into parts, and a steady 240 Hz stroke records frame pacing. The native window gets the same synthetic pen moves. One frame is 8.33 ms, from the page's idle animation frames.

### Results

Input to present, 200 moves per path, synthetic pen unless noted:

| Mode | Median | p95 | Frames (median, p95) | Within 2 frames | CDP median, p95 |
|---|---|---|---|---|---|
| Native GDI window (baseline) | 7.5 ms | 16.8 ms | 0.9, 2.0 | 95% | – |
| Plain canvas | 15.4 ms | 22.0 ms | 1.8, 2.6 | 73% | 15.0, 21.0 ms |
| Plain canvas, drawn in the next frame | 17.0 ms | 26.3 ms | 2.0, 3.2 | 49% | 15.0, 27.5 ms |
| Desynchronized canvas | 13.7 ms | 16.1 ms | 1.6, 1.9 | 96% | 12.6, 15.2 ms |
| Desynchronized, `pointerrawupdate` | 13.4 ms | 16.2 ms | 1.6, 1.9 | 96% | 12.3, 15.0 ms |
| Desynchronized WebGL | 15.7 ms | 22.7 ms | 1.9, 2.7 | 63% | 12.0, 15.2 ms |
| Desynchronized, delegated ink | 14.1 ms | 16.7 ms | 1.7, 2.0 | 94% | 11.9, 15.0 ms |
| Delegated trail only | no ink in 12 moves | – | – | – | no ink |
| Desynchronized, predicted tail | 13.7 ms | 17.7 ms | 1.6, 2.1 | 93% | 12.2, 15.0 ms |
| Desynchronized, busy page | 14.6 ms | 22.5 ms | 1.8, 2.7 | 72% | 14.0, 21.5 ms |
| Delegated ink, busy page | 14.5 ms | 23.0 ms | 1.7, 2.8 | 73% | 14.0, 22.4 ms |

Where the time goes for the synthetic pen (median, then p95):

| Mode | Input to handler | Handler | Drawn to present |
|---|---|---|---|
| Plain canvas | 3.6, 10.2 ms | 0.1, 0.2 ms | 11.1, 14.7 ms |
| Desynchronized canvas | 2.4, 4.5 ms | 0.1, 0.2 ms | 10.7, 13.6 ms |

The Windows pointer stack adds about 1 ms over CDP, 2.4 against 1.4 ms at the median. On a plain canvas, input waits for the next frame before the handler runs.

### End-to-end estimates

Two parts are missing from these numbers. The scan-out and the panel add up to one refresh: 8.3 ms here, 16.7 ms at 60 Hz. The digitizer adds a delay that this spike can't see. For 60 Hz, input and handler times stay the same, and the time from drawing to present grows with the frame. The native window has no page timestamps, so all of its time grows.

| Screen | Median | p95 |
|---|---|---|
| This laptop at 120 Hz, desynchronized canvas | 14 to 22 ms + digitizer | 16 to 24 ms + digitizer |
| 60 Hz estimate, desynchronized canvas | 24 to 41 ms + digitizer | 32 to 49 ms + digitizer |
| 60 Hz estimate, native GDI window | 15 to 32 ms + digitizer | 34 to 50 ms + digitizer |

### Limitations

- Synthetic input starts after the digitizer, and the present time comes before the scan-out. The camera check covers both.
- Screen capture may change how the compositor works, for example by keeping the canvas out of a hardware overlay.
- Some changes appeared in frames that combined several desktop updates: 13% for the desynchronized canvas and 41% for the native window. That ink may have arrived a little earlier. Counting only single-update frames, the native median is 10.4 ms.
- Other work ran on the laptop during the run, at 42% processor load on average. A full run 10 minutes earlier matched the desynchronized numbers within 0.1 ms.
- One laptop, one screen, and single-step moves were measured. The 60 Hz numbers are estimates, and the reference laptop needs its own run.

## Manual check with a camera

The spike can't see the digitizer, the scan-out, or the panel, but a slow-motion video sees all of them. Do this on the Surface Laptop Studio 2, and later on the reference laptop at 60 Hz.

1. Run `npm run spikes -- ink --mode desync` without `--auto`. Press H to hide the panel, so nothing covers the canvas.
2. Put the phone on a stand close to the screen, in slow motion at 240 frames per second. Frame the pen tip and a strip of the canvas in bright, even light.
3. Draw 20 quick, straight strokes at a steady speed, and a few single taps.
4. Step through the video one frame at a time, 4.17 ms each. In three frames in the middle of each stroke, measure the gap between the pen tip and the end of the ink. Divide it by how far the tip moves in one frame, and multiply by 4.17 ms. For taps, count the frames from the tip touching the glass to the first ink.
5. Take the median and the worst stroke. Repeat with `--mode canvas2d` to compare, and with `--mode trail-only`. Any ink in trail-only mode means delegated ink trails work with a real pen.
6. Add the numbers to this record. Ink passes if the median is 25 ms or less on this screen.
