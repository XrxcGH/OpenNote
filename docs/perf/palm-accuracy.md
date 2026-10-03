# Palm rejection accuracy

This page is the output of `palm.accuracy.test.ts` in `app/src/features/ink/input`. It replays 38 adversarial scenarios on every simulated device profile, plus the labeled recordings in `tests/fixtures/palm`, through the same input pipeline the page view uses. The labels say what each contact was and what the person meant, and the metrics count every way the result differs from that.

All sessions so far are synthetic, from the seeded hand and handwriting model in `testing/hands.ts`. Each contact that nobody meant has at least one physical tell a page can see, so these numbers show that the rules handle the cases they were designed for. They do not show how often real hands lack a tell. Recordings from the Palm lab on each device must join the corpus before release, and the [competitor baseline](palm-competitors.md) must be measured before any claim against other apps.

## Results

Regenerate with `OPENNOTE_PALM_REPORT=<file>` set when running the test.

| Profile | Sessions | Pen strokes | Non-intent contacts | Palm ink committed | Stray actions per non-intent contact | Intended touch lost | Longest stray ink shown (ms) | Late retracts | Touch ink commit delay (ms) | Stray actions per pen stroke | Pipeline µs per event |
|---|---|---|---|---|---|---|---|---|---|---|---|
| surface-pen | 108 | 400 | 184 | 0 | 0.0% (≤2.0%) | 0.0% (≤7.4%) | 0 | 0 | 532 | 0.0000 | 3.8 |
| slim-pen-2 | 108 | 400 | 186 | 0 | 0.0% (≤2.0%) | 0.0% (≤7.4%) | 0 | 0 | 532 | 0.0000 | 2.8 |
| oem-mpp | 108 | 400 | 184 | 0 | 0.0% (≤2.0%) | 0.0% (≤7.4%) | 0 | 0 | 532 | 0.0000 | 2.9 |
| wacom-aes | 108 | 400 | 182 | 0 | 0.0% (≤2.1%) | 0.0% (≤7.4%) | 0 | 0 | 532 | 0.0000 | 3.2 |
| wacom-emr | 108 | 400 | 186 | 0 | 0.0% (≤2.0%) | 0.0% (≤7.4%) | 0 | 0 | 532 | 0.0000 | 2.8 |
| s-pen | 108 | 400 | 70 | 0 | 0.0% (≤5.2%) | 0.0% (≤7.4%) | 0 | 0 | 532 | 0.0000 | 2.2 |
| pencil-1 | 108 | 400 | 65 | 0 | 0.0% (≤5.6%) | 0.0% (≤7.4%) | 0 | 0 | 532 | 0.0000 | 2.7 |
| pencil-2-hover | 108 | 400 | 72 | 0 | 0.0% (≤5.1%) | 0.0% (≤7.4%) | 0 | 0 | 532 | 0.0000 | 2.4 |
| pencil-usb-c | 108 | 400 | 75 | 0 | 0.0% (≤4.9%) | 0.0% (≤7.4%) | 0 | 0 | 532 | 0.0000 | 2.3 |
| pencil-pro | 108 | 400 | 73 | 0 | 0.0% (≤5.0%) | 0.0% (≤7.4%) | 0 | 0 | 532 | 0.0000 | 2.1 |
| usi-fire-max | 109 | 403 | 185 | 0 | 0.0% (≤2.0%) | 0.0% (≤7.4%) | 0 | 0 | 532 | 0.0000 | 3.1 |
| usi-chromebook | 108 | 400 | 182 | 0 | 0.0% (≤2.1%) | 0.0% (≤7.4%) | 0 | 0 | 532 | 0.0000 | 2.6 |
| passive-stylus | 160 | 0 | 64 | 0 | 0.0% (≤5.7%) | 0.0% (≤0.6%) | 0 | 0 | 0 | 0.0000 | 7.3 |
| tablet-finger | 160 | 0 | 64 | 0 | 0.0% (≤5.7%) | 0.0% (≤0.6%) | 0 | 0 | 0 | 0.0000 | 6.4 |
| phone-finger | 176 | 0 | 64 | 0 | 0.0% (≤5.7%) | 0.0% (≤0.6%) | 0 | 0 | 0 | 0.0000 | 6.7 |

Total: 1793 sessions, 4803 pen strokes, 1836 non-intent contacts, 2416 intended touch actions.

## Columns

- Stray actions per non-intent contact: committed ink, a camera move over 1.5 mm or any zoom after reverts, or an allowed tap or menu, from a contact labeled as meaning nothing. The figure in brackets is the upper end of the Wilson 95% interval, so a small corpus cannot claim more than it shows.
- Intended touch lost: touch ink dropped or cut short, and scrolls, pans, pinches, taps, or gestures that never happened, out of all intended touch actions.
- Longest stray ink shown: how long provisional ink from a non-intent contact stayed on screen. It is 0 because touch ink stays hidden until its contact moves 0.5 mm, and a dot shows only when it commits.
- Touch ink commit delay: the longest wait from lift to commit for intended touch ink. With no pen digitizer it is 0; on a device with a pen, finger ink waits `graceMs` plus 32 ms.
- Stray actions per pen stroke: Schwarz et al. report 0.016 for their classifier; the gate is under that.
- Pipeline µs per event: wall time of the whole replay per event, with stroke builders and a recording host, on a shared machine. The filter alone is in [phase-5-core.md](phase-5-core.md).
