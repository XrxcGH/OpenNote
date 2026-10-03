# Palm rejection accuracy

This page is the output of `palm.accuracy.test.ts` in `app/src/features/ink/input`. It replays 61 adversarial scenarios on every simulated device profile, plus the labeled recordings in `tests/fixtures/palm`, through the same input pipeline the page view uses. The labels say what each contact was and what the person meant, and the metrics count every way the result differs from that. Each scenario runs with each hand, and the seeds turn through the four grips.

All sessions so far are synthetic, from the seeded hand and handwriting model in `testing/hands.ts`. The model's ranges straddle every threshold of the classifier they meet (a test holds them to it): palms grow to 10 to 60 mm, drift 0 to 20 mm as they settle, and split into 1 to 3 parts, and the other hand acts from the moment the pen lifts. Contacts that no signal a page can see tells apart are labeled as known limits and reported below, not gated. These numbers still do not show how often real hands lack a tell. Recordings from the Palm lab on each device must join the corpus before release, and the [competitor baseline](palm-competitors.md) must be measured before any claim against other apps.

## Results

Regenerate with `OPENNOTE_PALM_REPORT=<file>` set when running the test.

| Profile | Sessions | Pen strokes | Non-intent contacts | Palm ink committed | Stray actions per non-intent contact | Intended touch lost | Longest stray ink shown (ms) | Camera moves taken back | Largest taken-back move (mm) | Longest taken-back move shown (ms) | Late retracts | Touch ink commit delay (ms) | Stray actions per pen stroke | Pipeline µs per event |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| surface-pen | 304 | 1136 | 660 | 0 | 0.0% (≤0.6%) | 0.0% (≤2.1%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 15.0 |
| slim-pen-2 | 312 | 1160 | 698 | 0 | 0.0% (≤0.5%) | 0.0% (≤2.0%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 12.8 |
| oem-mpp | 296 | 1120 | 454 | 0 | 0.0% (≤0.8%) | 0.0% (≤2.2%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 10.2 |
| oem-mpp-notilt | 248 | 920 | 376 | 0 | 0.0% (≤1.0%) | 0.0% (≤3.1%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 11.2 |
| wacom-aes | 296 | 1120 | 484 | 0 | 0.0% (≤0.8%) | 0.0% (≤2.1%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 8.9 |
| wacom-aes-notilt | 272 | 1040 | 443 | 0 | 0.0% (≤0.9%) | 0.0% (≤2.5%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 9.9 |
| wacom-emr | 312 | 1160 | 725 | 0 | 0.0% (≤0.5%) | 0.0% (≤2.0%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 7.5 |
| wacom-emr-mouse | 296 | 1112 | 660 | 0 | 0.0% (≤0.6%) | 0.0% (≤2.4%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 9.5 |
| s-pen | 312 | 1160 | 171 | 0 | 0.0% (≤2.2%) | 0.0% (≤1.9%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 7.0 |
| pencil-1 | 312 | 1160 | 258 | 0 | 0.0% (≤1.5%) | 0.0% (≤2.0%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 13.6 |
| pencil-2-hover | 312 | 1160 | 270 | 0 | 0.0% (≤1.4%) | 0.0% (≤1.9%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 12.1 |
| pencil-usb-c | 312 | 1160 | 263 | 0 | 0.0% (≤1.4%) | 0.0% (≤1.9%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 12.4 |
| pencil-usb-c-hover | 312 | 1160 | 277 | 0 | 0.0% (≤1.4%) | 0.0% (≤2.0%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 7.5 |
| pencil-pro | 312 | 1160 | 287 | 0 | 0.0% (≤1.3%) | 0.0% (≤2.0%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 7.2 |
| usi-fire-max | 297 | 1099 | 665 | 0 | 0.0% (≤0.6%) | 0.0% (≤2.1%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 13.5 |
| usi-chromebook | 280 | 1048 | 658 | 0 | 0.0% (≤0.6%) | 0.0% (≤2.2%) | 0 | 0 | 0.0 | 0 | 0 | 532 | 0.0000 | 12.7 |
| passive-stylus | 576 | 0 | 302 | 0 | 0.0% (≤1.3%) | 0.0% (≤0.2%) | 0 | 0 | 0.0 | 0 | 0 | 0 | 0.0000 | 9.0 |
| tablet-finger | 544 | 0 | 276 | 0 | 0.0% (≤1.4%) | 0.0% (≤0.2%) | 0 | 0 | 0.0 | 0 | 0 | 0 | 0.0000 | 8.7 |
| phone-finger | 576 | 0 | 291 | 0 | 0.0% (≤1.3%) | 0.0% (≤0.2%) | 0 | 0 | 0.0 | 0 | 0 | 0 | 0.0000 | 6.6 |
| iphone-finger | 416 | 0 | 171 | 0 | 0.0% (≤2.2%) | 0.0% (≤0.3%) | 0 | 0 | 0.0 | 0 | 0 | 0 | 0.0000 | 6.2 |
| ipad-finger | 544 | 0 | 292 | 0 | 0.0% (≤1.3%) | 0.0% (≤0.2%) | 0 | 0 | 0.0 | 0 | 0 | 0 | 0.0000 | 5.8 |
| ipad-stylus | 544 | 0 | 297 | 0 | 0.0% (≤1.3%) | 0.0% (≤0.2%) | 0 | 0 | 0.0 | 0 | 0 | 0 | 0.0000 | 5.8 |
| win-touch | 512 | 0 | 181 | 0 | 0.0% (≤2.1%) | 0.0% (≤0.3%) | 0 | 0 | 0.0 | 0 | 0 | 0 | 0.0000 | 8.3 |
| win-stylus | 480 | 0 | 160 | 0 | 0.0% (≤2.3%) | 0.0% (≤0.3%) | 0 | 0 | 0.0 | 0 | 0 | 0 | 0.0000 | 8.4 |

Total: 8977 sessions, 17875 pen strokes, 9319 non-intent contacts, 15337 intended touch actions.

## Known limits

Not gated, but replayed and counted here: contacts the generators label as having no tell (`labels` in `tests/fixtures/palm/known-limits.json`, with the intents lost beside them), and the scenarios some profiles cannot pass (`scenarios` there, with the reason for each). Stray actions are per non-intent contact, intents lost per intended touch action.

| Known limit | Sessions | Stray actions | Intended touch lost |
|---|---|---|---|
| labeled limits on surface-pen | 106 | 1.5% (≤4.2%) | 0.0% (≤29.9%) |
| labeled limits on slim-pen-2 | 108 | 1.0% (≤3.6%) | 0.0% (≤25.9%) |
| labeled limits on oem-mpp | 168 | 6.1% (≤8.9%) | 0.0% (≤15.5%) |
| labeled limits on oem-mpp-notilt | 158 | 5.9% (≤8.6%) | 5.7% (≤18.6%) |
| labeled limits on wacom-aes | 146 | 5.6% (≤8.5%) | 11.8% (≤34.3%) |
| labeled limits on wacom-aes-notilt | 156 | 6.1% (≤9.0%) | 13.3% (≤29.7%) |
| labeled limits on wacom-emr | 91 | 0.6% (≤3.5%) | 0.0% (≤29.9%) |
| labeled limits on wacom-emr-mouse | 108 | 3.3% (≤7.0%) | 3.7% (≤18.3%) |
| labeled limits on s-pen | 18 | 4.5% (≤21.8%) | 0.0% (≤79.3%) |
| labeled limits on pencil-1 | 36 | 5.6% (≤15.1%) | 0.0% (≤79.3%) |
| labeled limits on pencil-2-hover | 29 | 5.1% (≤16.9%) | 0.0% (≤79.3%) |
| labeled limits on pencil-usb-c | 29 | 2.3% (≤12.1%) | 0.0% (≤79.3%) |
| labeled limits on pencil-usb-c-hover | 31 | 2.3% (≤12.1%) | 0.0% (≤56.2%) |
| labeled limits on pencil-pro | 34 | 0.0% (≤7.6%) | 0.0% (≤56.2%) |
| labeled limits on usi-fire-max | 107 | 4.6% (≤8.8%) | 0.0% (≤24.3%) |
| labeled limits on usi-chromebook | 116 | 1.5% (≤4.4%) | 16.7% (≤56.4%) |
| liftBetweenLines on oem-mpp-notilt | 8 | 4.2% (≤20.2%) | n/a |
| palmDoubleSettleAway on oem-mpp-notilt | 8 | 0.0% (≤11.0%) | n/a |
| palmDoubleSettleAway on wacom-aes-notilt | 8 | 0.0% (≤14.3%) | n/a |
| palmBounceNewLine on usi-fire-max | 8 | 25.0% (≤59.1%) | n/a |
| palmBounceNewLine on usi-chromebook | 8 | 25.0% (≤59.1%) | n/a |
| otherHandPinchWhileHover on oem-mpp-notilt | 8 | 0.0% (≤35.4%) | 12.5% (≤47.1%) |
| otherHandPinchWhileHover on wacom-aes-notilt | 8 | 0.0% (≤25.9%) | 12.5% (≤47.1%) |
| otherHandScrollRecent on oem-mpp-notilt | 8 | 0.0% (≤25.9%) | 28.6% (≤64.1%) |
| otherHandScrollRecent on wacom-emr-mouse | 8 | 0.0% (≤32.4%) | 0.0% (≤39.0%) |
| otherHandScrollRecent on usi-chromebook | 8 | 0.0% (≤22.8%) | 12.5% (≤47.1%) |
| otherHandTapRecent on surface-pen | 8 | 0.0% (≤21.5%) | 14.3% (≤51.3%) |
| otherHandTapRecent on oem-mpp | 8 | 0.0% (≤43.4%) | 16.7% (≤56.4%) |
| otherHandTapRecent on oem-mpp-notilt | 8 | 0.0% (≤35.4%) | 16.7% (≤56.4%) |
| otherHandTapRecent on wacom-aes | 8 | 0.0% (≤24.3%) | 16.7% (≤56.4%) |
| otherHandTapRecent on wacom-aes-notilt | 8 | 0.0% (≤29.9%) | 40.0% (≤76.9%) |
| otherHandTapRecent on wacom-emr-mouse | 8 | 0.0% (≤22.8%) | 12.5% (≤47.1%) |
| otherHandTapRecent on usi-fire-max | 8 | 0.0% (≤24.3%) | 14.3% (≤51.3%) |
| otherHandTapRecent on usi-chromebook | 8 | 0.0% (≤27.8%) | 20.0% (≤62.4%) |
| gestureAfterPen on oem-mpp-notilt | 8 | 0.0% (≤35.4%) | 6.3% (≤28.3%) |
| otherHandChromeTap on oem-mpp-notilt | 8 | 0.0% (≤25.9%) | 25.0% (≤69.9%) |
| otherHandChromeTap on wacom-aes-notilt | 8 | 0.0% (≤20.4%) | 16.7% (≤56.4%) |
| otherHandChromeTap on wacom-emr-mouse | 8 | 0.0% (≤19.4%) | 14.3% (≤51.3%) |
| otherHandChromeTap on usi-chromebook | 8 | 0.0% (≤16.8%) | 28.6% (≤64.1%) |
| labeled limits on passive-stylus | 44 | 50.0% (≤63.6%) | 73.9% (≤82.8%) |
| labeled limits on tablet-finger | 45 | 49.0% (≤62.3%) | 50.8% (≤62.7%) |
| labeled limits on phone-finger | 44 | 56.0% (≤68.8%) | 47.6% (≤59.7%) |
| labeled limits on iphone-finger | 49 | 37.9% (≤50.8%) | 21.3% (≤33.1%) |
| labeled limits on ipad-finger | 38 | 43.9% (≤59.0%) | 27.1% (≤41.0%) |
| labeled limits on ipad-stylus | 39 | 37.0% (≤51.4%) | 19.6% (≤32.5%) |
| labeled limits on win-touch | 106 | 68.6% (≤75.8%) | 81.0% (≤86.1%) |
| labeled limits on win-stylus | 118 | 70.9% (≤77.5%) | 90.2% (≤93.4%) |
| fingerDrawKnuckles on iphone-finger | 32 | 6.9% (≤22.0%) | 6.9% (≤12.2%) |
| passiveStylusPalmFirst on passive-stylus | 32 | 0.0% (≤11.7%) | 0.0% (≤3.2%) |
| passiveStylusPalmFirst on iphone-finger | 32 | 3.8% (≤18.9%) | 1.0% (≤5.2%) |
| passiveStylusPalmFirst on win-stylus | 32 | 7.7% (≤33.3%) | 7.7% (≤18.2%) |
| passiveStylusSmallPalmFirst on iphone-finger | 32 | 0.0% (≤12.1%) | 0.0% (≤3.3%) |
| passiveStylusSmallPalmFirst on win-touch | 32 | 6.7% (≤29.8%) | 1.7% (≤8.9%) |
| passiveStylusSmallPalmFirst on win-stylus | 32 | 6.7% (≤29.8%) | 6.7% (≤15.9%) |
| loneRest on ipad-finger | 32 | 0.0% (≤8.2%) | n/a |
| loneRest on ipad-stylus | 32 | 0.0% (≤8.2%) | n/a |
| loneSlide on iphone-finger | 32 | 10.3% (≤26.4%) | n/a |
| restingHandParts on tablet-finger | 32 | 0.0% (≤7.6%) | 0.0% (≤4.0%) |
| restingHandParts on phone-finger | 32 | 0.0% (≤7.4%) | 1.1% (≤6.0%) |
| restingHandParts on iphone-finger | 32 | 0.0% (≤7.3%) | 1.0% (≤5.7%) |
| restingHandParts on win-touch | 32 | 0.0% (≤8.4%) | 1.0% (≤5.4%) |
| restingHandParts on win-stylus | 32 | 0.0% (≤7.6%) | 1.0% (≤5.4%) |

## Columns

- Stray actions per non-intent contact: committed ink, a camera move over 1.5 mm or any zoom after reverts, or an allowed tap or menu, from a contact labeled as meaning nothing. The figure in brackets is the upper end of the Wilson 95% interval, so a small corpus cannot claim more than it shows.
- Intended touch lost: touch ink dropped or cut short, and scrolls, pans, pinches, taps, or gestures that never happened, out of all intended touch actions.
- Longest stray ink shown: how long provisional ink from a non-intent contact stayed on screen. It is 0 because touch ink stays hidden until its contact moves like a stroke rather than a palm settling. A fingertip that keeps its size on a digitizer with real sizes shows at once. On a pen device without real sizes, a dot shows only when it commits.
- Camera moves taken back: camera moves over 1.5 mm by a non-intent contact that a later verdict reverted, with the largest such move and how long it stayed on screen. The page jumped and snapped back, so each counts against the gate as a stray scroll would.
- Touch ink commit delay: the longest wait from lift to commit for intended touch ink. With no pen digitizer it is 0; on a device with a pen, finger ink waits `graceMs` plus 32 ms.
- Not in the table but gated on every profile:
  - Pen strokes during which the camera moved: 0. The replayer models the camera, and a pen down reverts a touch scroll before its first sample.
  - Time to first visible touch ink: the 95th percentile from a stroke's first 1 mm to its first shown point, with no pen, on a digitizer with real sizes. At most 60 ms.
- Stray actions per pen stroke: Schwarz et al. report 0.016 for their classifier; the gate is under that.
- Pipeline µs per event: wall time of the whole replay per event, with stroke builders and a recording host, on a shared machine. The filter alone is in [phase-5-core.md](phase-5-core.md).
