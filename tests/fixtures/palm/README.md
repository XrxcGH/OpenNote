# Palm corpus

Labeled pen and touch sessions that measure palm rejection. `palm.accuracy.test.ts` in `app/src/features/ink/input` replays every session here through the shipped input pipeline, together with the synthetic scenarios in `testing/scenarios.ts`, and fails CI when a gate in `thresholds.json` is missed.

## Files

| File | Holds |
|---|---|
| `**/*.session.jsonl` | One session: a header line, then events in delivery order, labels, and reviewer notes. Gzip a file over 256 KB as `*.session.jsonl.gz`. No file may exceed 1 MB |
| `session.schema.json` | The line formats. `testing/session.ts` checks the same rules in CI |
| `thresholds.json` | The gates, and the baseline measured per device profile |
| `known-limits.json` | Recorded sessions whose stray contacts have no physical tell a page can see. They are reported but not gated, and the list may only shrink |
| `synthetic/` | A generated example of the format |

## The format

The header names the device, the simulated profile it matches (see `testing/profiles.ts`), what the device reports (hover, pressure, tilt, contact size, rate), the screen's CSS pixels per millimeter, the hand, the grip, the posture, the settings, the device state, and the prompted task. `consent` must be true.

Each event line has `seq`, the delivery order, and `t`, the event's `timeStamp`. Pointer events carry `id`, `pt` (pen, touch, or mouse), client `x` and `y` in CSS px, `w`, `h`, `p`, tilt or altitude and azimuth, `b` and `bs` for the buttons, coalesced (`co`) and predicted (`pr`) samples, and `target`: the page, a control, or the document root. System events are `blur`, `focus`, `visibility`, `pageswitch`, and `lostpointercapture`. A `native` line is a hint from the platform.

A label line says what a contact was (`cls`) and what the person meant (`intent`) between two times. A contact may carry several labels, such as a fingertip that becomes a palm. An `expect` line marks a spot a reviewer saw: a stray mark, a missed stroke, or a stray scroll.

## Thresholds

| Gate | Threshold |
|---|---|
| G1 Committed ink from a contact meant as nothing | 0 |
| G2 Provisional ink shown from such a contact | 0 with a pen about; at most 1% in finger modes; each gone within 500 ms |
| G3 Camera moved over 1.5 mm, or any zoom, by such a contact, after reverts | 0 |
| G4 Taps, menus, or gestures nobody meant | 0 |
| G5 Pen samples not passed straight to the tool | 0 |
| G7 Intended touch ink dropped or truncated | Under 0.1%; 0 truncated |
| G8 Intended pan, pinch, scroll, tap, or gesture missed | Under 1% |
| G9 Delay from passing slop to the camera moving | p95 at most `graceMs` + 100 ms |
| G10 Commit delay of touch ink | 0 ms with no pen digitizer; at most `graceMs` + 32 ms otherwise |
| G11 Stray palm actions per pen stroke (Schwarz et al.) | Under 0.016 |

The test also checks that no gate is looser than these, and that no profile does worse than its baseline. When a change makes a profile better, run the test with `OPENNOTE_PALM_BASELINE=write` to tighten the baseline, and commit the new values.

## Recording sessions

Record with the Palm lab in a dev build: calibrate the scale along a bank card, pick a prompted task, and perform it. The lab labels every contact from the task, and you correct the labels in its replay view before export. Write only the prompted text, never anything private, because the files are committed to the repository. The manual checklist in `docs/testing/palm-rejection.md` lists the tasks per device.
