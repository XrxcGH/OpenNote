# Palm rejection accuracy

This page is the output of `palm.accuracy.test.ts` in `app/src/features/ink/input`. It replays 49 adversarial scenarios (pen scenarios with each hand) on every simulated device profile, plus the labeled recordings in `tests/fixtures/palm`, through the same input pipeline the page view uses. The labels say what each contact was and what the person meant, and the metrics count every way the result differs from that.

All sessions so far are synthetic, from the seeded hand and handwriting model in `testing/hands.ts`. Each contact that nobody meant has at least one physical tell a page can see, so these numbers show that the rules handle the cases they were designed for. They do not show how often real hands lack a tell. Recordings from the Palm lab on each device must join the corpus before release, and the [competitor baseline](palm-competitors.md) must be measured before any claim against other apps.

## Results

Regenerate with `OPENNOTE_PALM_REPORT=<file>` set when running the test.

| Profile | Sessions | Pen strokes | Non-intent contacts | Palm ink committed | Stray actions per non-intent contact | Intended touch lost | Longest stray ink shown (ms) | Camera moves taken back | Largest taken-back move (mm) | Longest taken-back move shown (ms) | Late retracts | Touch ink commit delay (ms) | Stray actions per pen stroke | Pipeline �s per event |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| surface-pen | 264 | 1024 | 480 | 0 | 0.0% (≤0.8%) | 0.0% (≤3.1%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 11.8 |
| slim-pen-2 | 264 | 1024 | 480 | 0 | 0.0% (≤0.8%) | 0.0% (≤3.1%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 14.0 |
| oem-mpp | 256 | 1008 | 470 | 0 | 0.0% (≤0.8%) | 0.0% (≤3.1%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 12.4 |
| oem-mpp-notilt | 256 | 1008 | 466 | 0 | 0.0% (≤0.8%) | 0.0% (≤3.1%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 13.2 |
| wacom-aes | 256 | 1008 | 468 | 0 | 0.0% (≤0.8%) | 0.0% (≤3.1%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 10.9 |
| wacom-aes-notilt | 256 | 1008 | 470 | 0 | 0.0% (≤0.8%) | 0.0% (≤3.1%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 13.7 |
| wacom-emr | 264 | 1024 | 486 | 0 | 0.0% (≤0.8%) | 0.0% (≤3.1%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 10.3 |
| wacom-emr-mouse | 272 | 1048 | 494 | 0 | 0.0% (≤0.8%) | 0.0% (≤3.1%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 12.3 |
| s-pen | 264 | 1024 | 206 | 0 | 0.0% (≤1.8%) | 0.0% (≤3.1%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 9.6 |
| pencil-1 | 264 | 1024 | 193 | 0 | 0.0% (≤2.0%) | 0.0% (≤3.1%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 11.3 |
| pencil-2-hover | 264 | 1024 | 199 | 0 | 0.0% (≤1.9%) | 0.0% (≤3.1%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 10.2 |
| pencil-usb-c | 264 | 1024 | 208 | 0 | 0.0% (≤1.8%) | 0.0% (≤3.1%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 11.0 |
| pencil-usb-c-hover | 264 | 1024 | 205 | 0 | 0.0% (≤1.8%) | 0.0% (≤3.1%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 10.1 |
| pencil-pro | 264 | 1024 | 218 | 0 | 0.0% (≤1.7%) | 0.0% (≤3.1%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 9.0 |
| usi-fire-max | 265 | 1027 | 479 | 0 | 0.0% (≤0.8%) | 0.0% (≤3.1%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 13.9 |
| usi-chromebook | 264 | 1024 | 478 | 0 | 0.0% (≤0.8%) | 0.0% (≤3.1%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 13.3 |
| passive-stylus | 208 | 0 | 80 | 0 | 0.0% (≤4.6%) | 0.0% (≤0.5%) | 0 | 0 | 0.0 | 0 | 0 | 0 | 0.0000 | 9.3 |
| tablet-finger | 208 | 0 | 80 | 0 | 0.0% (≤4.6%) | 0.0% (≤0.5%) | 0 | 0 | 0.0 | 0 | 0 | 0 | 0.0000 | 10.0 |
| phone-finger | 224 | 0 | 80 | 0 | 0.0% (≤4.6%) | 0.0% (≤0.4%) | 0 | 0 | 0.0 | 0 | 0 | 0 | 0.0000 | 7.9 |
| ipad-finger | 208 | 0 | 80 | 0 | 0.0% (≤4.6%) | 0.0% (≤0.5%) | 0 | 0 | 0.0 | 0 | 0 | 0 | 0.0000 | 8.4 |
| ipad-stylus | 208 | 0 | 80 | 0 | 0.0% (≤4.6%) | 0.0% (≤0.5%) | 0 | 0 | 0.0 | 0 | 0 | 0 | 0.0000 | 9.3 |
| win-touch | 208 | 0 | 80 | 0 | 0.0% (≤4.6%) | 0.0% (≤0.5%) | 0 | 0 | 0.0 | 0 | 0 | 0 | 0.0000 | 13.9 |
| win-stylus | 208 | 0 | 80 | 0 | 0.0% (≤4.6%) | 0.0% (≤0.5%) | 0 | 0 | 0.0 | 0 | 0 | 0 | 0.0000 | 12.0 |

Total: 5673 sessions, 16347 pen strokes, 6560 non-intent contacts, 7488 intended touch actions.

## Columns

- Stray actions per non-intent contact: committed ink, a camera move over 1.5 mm or any zoom after reverts, or an allowed tap or menu, from a contact labeled as meaning nothing. The figure in brackets is the upper end of the Wilson 95% interval, so a small corpus cannot claim more than it shows.
- Intended touch lost: touch ink dropped or cut short, and scrolls, pans, pinches, taps, or gestures that never happened, out of all intended touch actions.
- Longest stray ink shown: how long provisional ink from a non-intent contact stayed on screen. It is 0 because touch ink stays hidden until its contact moves like a stroke rather than a palm settling. A fingertip that keeps its size on a digitizer with real sizes shows at once. On a pen device without real sizes, a dot shows only when it commits.
- Camera moves taken back: camera moves over 1.5 mm by a non-intent contact that a later verdict reverted, with the largest such move and how long it stayed on screen. The page jumped and snapped back, so each counts against the gate as a stray scroll would.
- Touch ink commit delay: the longest wait from lift to commit for intended touch ink. With no pen digitizer it is 0; on a device with a pen, finger ink waits `graceMs` plus 32 ms.
- Stray actions per pen stroke: Schwarz et al. report 0.016 for their classifier; the gate is under that.
- Pipeline µs per event: wall time of the whole replay per event, with stroke builders and a recording host, on a shared machine. The filter alone is in [phase-5-core.md](phase-5-core.md).
