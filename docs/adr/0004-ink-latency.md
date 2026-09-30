# ADR 0004: Ink latency

- Status: Accepted, pending the owner's camera check and budget review
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

The app stack only shapes parts 2 and 3. This spike measures them with synthetic input, compares them with a native window, and estimates the rest. Phase 1 also asks for a camera check with a Surface Pen and a Wacom tablet, which covers all four parts. It hasn't been done yet.

## Decision

We will keep ADR 0001, and the Flutter fallback doesn't trigger. The gap to native ink is at most about one compositor frame, and two untested fixes could close it inside Tauri.

The budget as written isn't met as measured:

- A desynchronized 2D canvas that draws in the pointer event handler shows ink 13.7 ms after the injected input at the median, and 16.1 ms at the 95th percentile (p95). On this 120 Hz screen, that is 1.6 and 1.9 frames.
- Only 4% of those moves reach the desktop within one frame, against 59% for a plain native window that draws with the Windows Graphics Device Interface (GDI). So WebView2 ink often lands one compositor frame after native ink.
- At the median, WebView2 costs 2.8 ms more than the native window counting only single-update frames, or 6.2 ms counting all frames. At p95, the two are within 1 ms. The native baseline itself is uncertain by about 3 ms.
- At p95, every stack measured is estimated to miss the 60 Hz end-to-end figure, native included. At the median, the native window could meet it, but WebView2 is already at 24 ms before scan-out and the digitizer, so it can't. Flutter wasn't measured.

Two fixes remain untested, and both keep Tauri:

1. Delegated ink trails with a real pen. The operating system compositor draws the trail ahead of the page. Synthetic input drew no trail, which may be a limit of injection.
2. A native low-latency ink layer above the WebView while the pen is down, such as a transparent DirectComposition or Windows Ink surface. Strokes pass to the page when the pen lifts.

Phase 5 will draw live ink on a desynchronized 2D canvas in the pointermove handler, with coalesced events and perfect-freehand. Nothing the pen needs will wait for an animation frame while the pen is down. Finished strokes move into cached tiles after the pen lifts. Phase 5 must try fix 1 with a real pen, and build fix 2 if the camera check fails.

The status stays pending until the owner runs the camera check and reviews the budget.

## Options considered

| Option | For | Against |
|---|---|---|
| Desynchronized 2D canvas, drawn in the handler (chosen) | Fastest WebView2 path, with 96% of moves within 2 frames | Only 4% within 1 frame. Animation frames nearly stop during a fast stroke on an idle page. |
| Plain 2D canvas, drawn in the handler | Steady frame rate | Input waits for the next frame, so only 73% of moves are within 2 frames |
| Plain canvas, drawn in the next animation frame | The usual pattern in web apps | Slowest, with a p95 of 26.3 ms |
| `pointerrawupdate` on a desynchronized canvas | Same speed as pointermove | No predicted points. During development, it also seemed to stop predictions on later pages in a shared WebView. The recorded run doesn't show this. |
| Desynchronized WebGL | Draws many strokes on the graphics processor | Slower tail, and 6 of 200 moves timed out |
| Delegated ink trails (fix 1) | The operating system compositor draws the trail ahead of the page, even a busy one | Drew no trail for injected input, so its effect couldn't be measured here. The camera check's trail-only run decides. |
| Native ink layer above the WebView (fix 2) | Native ink speed while the pen is down, inside Tauri | Not built or measured. Needs a handoff of strokes to the page, and its own code on each platform. |
| Predicted tail from `getPredictedEvents` | About 5 predicted points per event | No gain for single moves |
| Switch the interface to Flutter | One canvas on every platform | Not measured here, and its windows go through the same compositor. Gives up the web editor and the rest of ADR 0001. |

## Consequences

- Phase 5 builds ink on the chosen design. Its latency benchmark reuses this harness: `npm run spikes -- ink --auto`.
- The owner should decide whether BRAND.md restates the pen budget in frames at p95, such as "ink within 2 frames of the input at p95".
- On an idle page, animation frames nearly stop during a fast stroke on a desynchronized canvas: 37 frames in 2 seconds instead of 257. Gaps reach 640 to 850 ms, breaking the rule of never two dropped frames in a row. The busy modes kept 257 frames. Work that runs on animation frames, such as tiles, scrolling, or a lasso, must wait for the pen to lift or move to a worker.
- In every mode but the plain canvas drawn in the handler (99%), 4 to 8% of synthetic pen moves at 240 Hz never reached the page. That includes the plain canvas drawn in animation frames (93%). Moves sent through the Chrome DevTools Protocol (CDP) all arrived. So the loss may come from synthetic injection, not desynchronized canvases. Phase 5 should check it, and stroke shape, with a real pen.
- A busy main thread, with 10 ms tasks every 16 ms, raised the p95 from 16.1 to 22.5 ms. Heavy work stays off the main thread while the pen draws.
- Revisit this record if the camera check fails and neither fix closes the gap, if a WebView2 update changes these paths, or if a Flutter prototype beats the native window.

## Measurements

### Machine

A Microsoft Surface Laptop Studio 2 with 20 logical processors, Windows 11 Pro 25H2 (build 26200.9550), WebView2 154.0.4258.37, and a 120 Hz screen at 150% scale. The registry calls it Windows 10 Pro, as it does on every Windows 11 system. The run was on 2026-09-30. The full data is in [`spikes/results/ink.json`](../../spikes/results/ink.json).

### Method

The harness in `spikes/harness/src/ink/` opens the page in a new window for each renderer mode. The window is 1200 by 800 logical pixels, or 1800 by 1200 on screen, and stays on top. For each of 200 moves per input path, the harness:

1. picks the next point on short strokes spread over the page, with changing pressure and tilt;
2. waits a pseudo-random 0 to 2 frames, so moves don't line up with the display;
3. watches a 24-pixel square on screen (16 logical pixels) around the point with the Desktop Duplication API;
4. sends the move, and times it to the present time of the first desktop frame in which the square changes.

Moves go two ways. A synthetic pen goes through the Windows pointer stack (`InjectSyntheticPointerInput`). CDP skips Windows. All times use the Windows performance counter. The page's own timestamps split each latency into parts, and a steady 240 Hz stroke records frame pacing. The native window gets the same synthetic pen moves. One frame is 8.33 ms, from the page's idle animation frames.

### Results

Input to present, 200 moves per path, synthetic pen unless noted. Times count only moves that showed ink, and shares count all 200 moves:

| Mode | Median | p95 | Frames (median, p95) | Within 1 frame | Within 2 frames | CDP median, p95 |
|---|---|---|---|---|---|---|
| Native GDI window (baseline) | 7.5 ms | 16.8 ms | 0.9, 2.0 | 59% | 95% | – |
| Plain canvas | 15.4 ms | 22.0 ms | 1.8, 2.6 | 0% | 73% | 15.0, 21.0 ms |
| Plain canvas, drawn in the next frame | 17.0 ms | 26.3 ms | 2.0, 3.2 | 0% | 49% | 15.0, 27.5 ms |
| Desynchronized canvas | 13.7 ms | 16.1 ms | 1.6, 1.9 | 4% | 96% | 12.6, 15.2 ms |
| Desynchronized, `pointerrawupdate` | 13.4 ms | 16.2 ms | 1.6, 1.9 | 4% | 96% | 12.3, 15.0 ms |
| Desynchronized WebGL | 15.7 ms | 22.7 ms | 1.9, 2.7 | 0.5% | 61%, 6 timed out | 12.0, 15.2 ms, 4 timed out |
| Desynchronized, delegated ink | 14.1 ms | 16.7 ms | 1.7, 2.0 | 1% | 94% | 11.9, 15.0 ms |
| Delegated trail only | no ink in 12 moves | – | – | – | – | no ink in 12 moves |
| Desynchronized, predicted tail | 13.7 ms | 17.7 ms | 1.6, 2.1 | 4% | 93% | 12.2, 15.0 ms |
| Desynchronized, busy page | 14.6 ms | 22.5 ms | 1.8, 2.7 | 4% | 72% | 14.0, 21.5 ms |
| Delegated ink, busy page | 14.5 ms | 23.0 ms | 1.7, 2.8 | 3.5% | 73% | 14.0, 22.4 ms |

Where the time goes for the synthetic pen (median, then p95):

| Mode | Input to handler | Handler | Drawn to present |
|---|---|---|---|
| Plain canvas | 3.6, 10.2 ms | 0.1, 0.2 ms | 11.1, 14.7 ms |
| Desynchronized canvas | 2.4, 4.5 ms | 0.1, 0.2 ms | 10.7, 13.6 ms |

The Windows pointer stack adds about 1 ms over CDP, 2.4 against 1.4 ms at the median.

### End-to-end estimates

After the present time, up to one refresh may pass before the flip, if the compositor presents early. Scan-out down to the ink takes up to one more refresh, and then the panel responds. The digitizer adds its own delay.

At 60 Hz, the time from drawing to present doubles, and input and handler times stay the same. For the canvas p95, we add one more p95 drawing time (13.6 ms) to the measured p95. The native window has no page timestamps, so we assume all its time is compositor wait and double it.

Each range runs from the present time to two refreshes later. Add the panel's response and the digitizer to both ends.

| Screen and window | Median | p95 |
|---|---|---|
| This laptop at 120 Hz, desynchronized canvas | 14 to 30 ms | 16 to 33 ms |
| 60 Hz estimate, desynchronized canvas | 24 to 57 ms | 30 to 63 ms |
| 60 Hz estimate, native window, all frames | 15 to 48 ms | 34 to 67 ms |
| 60 Hz estimate, native window, single-update frames only | 21 to 54 ms | 30 to 64 ms |

### Limitations

- Screen capture may change how the compositor works, for example by keeping the canvas out of a hardware overlay.
- Some changes appeared in frames that combined several desktop updates: 13% for the desynchronized canvas and 41% for the native window. The harness treats these as overestimates. But for the native window, excluding them raises the median from 7.5 to 10.4 ms. So the direction of the error is unknown, and the native baseline is uncertain by about 3 ms.
- The native baseline is a GDI window. Flip-model or overlay presentation, which may skip a compositor frame, wasn't tried, so it may not be the floor for native apps.
- Other work kept the processor at about 42% load during the run. A run 10 minutes earlier matched the desynchronized numbers within 0.1 ms. The results file records neither.
- One laptop, one screen, and single-step moves were measured. The 60 Hz numbers are estimates, and the reference laptop needs its own run.

## Manual check with a camera

The spike can't see the digitizer, the flip, the scan-out, or the panel, but a slow-motion video sees all of them. Do this on the Surface Laptop Studio 2 with a Surface Pen, and with a Wacom tablet when one is available.

1. Run `npm run spikes -- ink --mode desync` without `--auto`. Press H to hide the panel.
2. Put the phone on a stand close to the screen, in slow motion at 240 frames per second. Frame the pen tip and a strip of the canvas in bright, even light.
3. Draw 20 quick, straight strokes at a steady speed, and a few single taps.
4. Step through the video one frame at a time, 4.17 ms each. In three frames in the middle of each stroke, measure the gap between the pen tip and the end of the ink. Divide it by how far the tip moves in one frame, and multiply by 4.17 ms. For taps, count the frames from the tip touching the glass to the first ink.
5. Take the median and the worst stroke. Repeat with `--mode canvas2d` to compare.
6. Repeat with `--mode trail-only` and the real pen. Any ink in this mode means delegated ink trails work with a real pen. If so, time the trail the same way.
7. Add the numbers for each pen to this record. Ink passes if both the median and the worst stroke are 25 ms or less. The same thresholds apply later on the reference laptop at 60 Hz, unless the owner restates the budget.
