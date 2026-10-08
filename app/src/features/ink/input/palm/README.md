# Palm rejection

This folder decides what each touch contact does while a pen and fingers share the glass. It replaces the old state machine in `input/palm.ts` and section 5.5 of the architecture. [ADR 0027](../../../../../../docs/adr/0027-palm-rejection.md) records the decisions.

The design goal is to beat every major note app on stray marks, while a pen never waits and fingers keep working. Every competitor leans on the OS or the pen hardware. This filter reaches its targets with no OS help and treats OS signals as extra evidence.

## Contents

- [Principles](#principles)
- [Pen presence](#pen-presence)
- [The hand region](#the-hand-region)
- [Evidence](#evidence)
- [Roles and gates](#roles-and-gates)
- [Finger drawing](#finger-drawing)
- [Device profiles and settings](#device-profiles-and-settings)
- [API](#api)
- [Sources](#sources)

## Principles

1. A pen never waits. A pen sample draws on the event that delivers it. `pen()` does constant-time bookkeeping and gates nothing, so the added pen latency is 0.
2. A palm never leaves ink. Touch ink is provisional until its contact resolves as a finger and its hold has passed. Provisional ink sends no progress record.
3. Ambiguous means draw now and retract invisibly. A tap, a long-press menu, or an undo gesture cannot be taken back, so it waits for finger evidence. A scroll or a zoom can, so it runs against a camera snapshot and reverts.
4. Stand alone. The gates in `palm.accuracy.test.ts` hold with no `pointercancel`, no contact size, and no native hint.
5. Position beats timing. Where a contact lands relative to the pen tip and the writing hand is the strongest signal.
6. Revise. Every contact is scored again as it ages, and when a pen arrives. A palm verdict is final.
7. Deterministic. No timers, clocks, or randomness inside. Every call carries the event time, and each verdict carries a bitmask of its evidence (`explain`).
8. Fingers come back. Nothing latches for the session. Every state that blocks touch has a timed exit.

## Pen presence

`presence.ts` tracks up to 4 pens by pointer ID. Each is away, hovering, down, or in grace. Presence is the strongest of these:

| Presence | True when                                                                                                                   | Exit                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `down`   | Any pen is down                                                                                                             | Up or cancel; a leave while down plus 300 ms of silence; 10 s of silence        |
| `near`   | Any pen hovers or is in grace (`graceMs`, 500); or a palm latched near the pen is still down, or lifted under `graceMs` ago | Hover watchdog: 2 s with no pen event, 5 s on WebKit; not while a palm holds it |
| `recent` | Real pen evidence under 20 s ago                                                                                            | Time                                                                            |
| `away`   | A pen has been seen, or the device may have one                                                                             | Any pen event                                                                   |
| `absent` | No pen ever seen and the profile reports no pen digitizer                                                                   | The first pen event                                                             |

Real pen evidence is `hover`, `down`, `move`, `up`, and `cancel`. A `leave` from away does nothing. `system()` signals never count as pen evidence and never retract touch ink. A pen that reports no hover falls through grace into `recent` after each lift, so there is no sticky mode.

## The hand region

`handRegion.ts` models the writing hand as a circle plus a forearm strip, anchored to the pen tip (Vogel et al.). In finger drawing the anchor is the drawing contact.

- Shape: center at the tip plus an offset, radius `r`. Membership is 1 inside the circle, inside the forearm strip beyond it, and within 15 mm of the tip. It falls to 0 over 25 mm outside. The far side is more than 15 mm behind the tip, away from the hand.
- Seed: learned device state, then the pen's lean (a pen that leans 15 degrees or more points at the hand), then the handedness setting, then the system setting, then right-handed. The system's handedness is only a prior for which side to try first: Windows always reports one, right unless changed, so it never counts as knowing the side. Only the setting or learned state does.
- Learning: a palm that ends after hard evidence, or after 300 ms down with the pen down, moves the offset 20% toward where it sat when it sits on the region's side. Each stroke's lean blends in at 30%. An explicit setting holds the side of the hand until 5 strokes in a row lean the other way.
- Side: without a lean, a setting, or learning the side is unknown. Contacts that rest 300 ms while the pen is down vote for the side they sit on (again at 600 ms), and a palm latched by size or by the OS casts two votes. Two votes set the side, or flip a guessed one at once. Until then no contact gets E6, and once the pen has left, a contact in the hand on either side gets E5. The drawing hand of finger drawing tries both sides the same way until a palm on one side confirms it; two palms on the side not assumed flip it.
- Anchors: the last pen position and, once the pen has left, the start of the line being written and that start one line down, where the hand comes back for the next line. A contact that has traveled 25 mm is no palm re-planting there, so the line anchors no longer count it.

## Evidence

`score.ts` adds the terms that hold now. It recomputes them from the contact's features, never accumulating, at its own events, at ages 25 to 500 ms, and for all contacts when a pen arrives, a pen goes down, or a touch lands or lifts.

| Id  | Evidence                                                                                                            | Points                           |
| --- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| E1  | Palm size: 20 mm long or 15 mm across; 24 mm where the digitizer reports one radius in 4 mm steps                   | +4                               |
| E2  | Large: 14 to 20 mm, a thumb or flat finger                                                                          | +1                               |
| E3  | Fingertip: 11 mm or less                                                                                            | -1                               |
| E4  | Grew 4 mm, or 40% past a fingertip                                                                                  | +2                               |
| E5  | In the hand region of any anchor, where it is now                                                                   | +3 near or down; +2 or +1 recent |
| E6  | Far side of the tip, or 80 mm outside the region, once the side is known                                            | -2                               |
| E7  | The pen was down when it landed, or it rested 300 ms in the hand region while the pen was down                      | +2                               |
| E8  | Landed within 400 ms of a pen lift or leave; within 1 s. Once the side is known, only in, or near the hand          | +2; +1                           |
| E9  | Landed first: young and still when a pen arrived                                                                    | +2                               |
| E10 | Still at 150 ms; at 500 ms. In finger drawing, the drawing contact past 500 ms that never moved on                  | +1; +2                           |
| E11 | Swipe, once it has moved on: 3 mm straight in 200 ms; 8 mm and not large; never inside the hand region near the pen | -2; -3                           |
| E12 | A palm within 70 mm                                                                                                 | +2                               |
| E13 | Another contact landed within 12 mm (a split palm), or drifts with a latched palm beside it                         | +2                               |
| E14 | Three landings within 300 ms and 90 mm                                                                              | +2                               |
| E15 | Grip: landed within 5 mm of an edge and stays there, still for 500 ms, or elongated and still                       | +3                               |
| E16 | The OS says palm: a touch `pointercancel` under managed touch, or a native hint                                     | Latch                            |
| E17 | The size of a learned passive stylus tip                                                                            | -2                               |
| E18 | Its own palm: a resting contact in the region anchored at it                                                        | -2                               |
| E19 | Lifted as a tap                                                                                                     | -1                               |
| E20 | Sensitivity low, standard, high                                                                                     | -1, 0, +1                        |

Sizes count only when the digitizer reports real sizes (the profile's `touchSize`, or learned in the session), and then E1 and E4 count in every presence. A score of 4 or more latches palm, and a score of 0 or less is a finger.

- Moving on: a contact has moved on once it has traveled 10 mm, or 1.5 mm from where it was 250 ms after it landed. A palm drifts up to about 8 mm while it grows and settles, so less is no evidence of a stroke, a swipe, or a scroll.
- Against the pen: motion counts against the pen, so a palm that moves with the writing hand stays still, and a palm that slides between words in the hand region is no swipe.
- Confirmed: an action that has run 500 ms is confirmed, and only E1, E4, or E16 can stop it.
- Reopened: a palm latched only on where and when it landed (E5, E8, E12) that then swipes out of the hand region, or on the far side, is reopened. The other hand's scroll landed where the hand might have been. Any other palm evidence first settles the verdict for good.

## Roles and gates

Roles are `pass` (native, unmanaged pages only), `ignore`, `draw`, `shadow`, `scroll`, and `nav`. Every role change is an effect: `Retract` removes provisional ink, `Revert` restores the camera, `SuppressTap` swallows the click, `Commit` and `Uncommit` store or take back held ink, `Start` begins a scroll or pan, `Promote` shows a shadow stroke, and `Hold` parks a stroke that ended without a lift.

| Presence         | Page tap and long press | One-finger scroll | Two-finger pan and pinch                     | Controls         |
| ---------------- | ----------------------- | ----------------- | -------------------------------------------- | ---------------- |
| `down`           | Never                   | Never             | Never starts; a running or pending one stops | Score -1 or less |
| `near`           | Score -2 or less        | Score -1 or less  | Both 0 or less, motion confirmed, setting on | Score 1 or less  |
| `recent`         | 0 or less, -1 in a hand | 0 or less         | Both 0 or less, motion confirmed             | Not palm         |
| `away`, `absent` | Always                  | Always            | Pair rules                                   | Always           |

A pan pairs two contacts that are not palms, landed within 150 ms (300 ms when the first has barely moved), and sit 15 to 120 mm apart. It starts once both pass 1.5 mm of slop and move together, or their spacing changes 2 mm. For the gate, a pair that spreads or squeezes with neither contact moving against the pinch gets 3 points off both scores, since the parts of a palm drift together. With the pen near or recent, a contact outside every hand region gets 1 more off. A third finger inside the window voids the pair. A palm or a later contact is ignored and leaves the pair alone.

On a device that has seen a pen:

- A one-finger scroll starts once its contact has moved on and is not still growing as a palm does when it lands (2 mm within 250 ms). Where the hand last rested, without real sizes, it waits until the contact moves on after it settled, since a palm may slide 10 mm as it lands.
- A pan likewise waits until both contacts move on, unless they spread or squeeze.
- With the pen away, a contact with palm evidence of 2 or more (growth, a palm beside it, a split blob) moves no camera unless a swipe outweighs it. A long press is refused where the hand last rested or beside another contact.

The camera then catches up from where the contact crossed slop, so no motion is lost and a palm that settles never moves the page. A scroll or pan that has not started when the pen goes down is dropped. A running one stops, and reverts when it began under 500 ms ago, lies in the pen's hand, or was never judged a finger. The pen's verdicts run first. The pipeline drains them before it hands the pen's first sample to the tool, so a reverted camera is in place before the stroke maps its first point.

Multi-tap hears every page landing once the pen has been still for a second and is not near, so undo works a second after the pen is put down. Without contact sizes on a device that has seen a pen, a landing in the hand region of the last pen position or of the line being written is no tap (a palm that settles twice looks the same). A palm verdict voids its group. A gesture is taken back when a pen arrives within a second near its taps only when a tap finger was itself in the hand region and scored 1 or more, not counting the burst its own fingers make.

Touch is managed (`touchPolicy()`) once a pen has been seen, when the profile reports a pen digitizer, or while finger drawing is on with an ink tool. The page then keeps `touch-action: none` and drives scroll, pan, and pinch from script. That way, the first palm of an approach never starts a native pan.

## Finger drawing

### One draw slot

With an ink tool, presence away or absent, and finger drawing on, one contact draws. With "Draw with finger" set to on, the same holds with the pen recent: a finger draws provisionally, and a palm verdict or pen evidence takes it back. With the pen near it is ignored. One finger never scrolls while an ink tool and finger drawing are on.

A newcomer that is not a palm draws at once, whatever ignored contacts are down. Its ink stays hidden until the filter shows it with its whole path (`Promote`):

- A fingertip that keeps its size on a digitizer with real sizes shows at 1 mm (past sensor jitter) once it is 50 ms old.
- Any other contact shows once it has moved on, or at its lift.
- A contact that grows as it lands never shows, and one that grew and never moved on is latched palm.

### Pairs

With a drawing contact already down, any newcomer that is not a palm and lands inside the pair window pends with it. Both strokes build hidden until motion decides. When one rests inside the other's hand region, the other is the writer, and only a spread or squeeze (both moving now) is a pinch. The pair resolves in one of four ways:

- A pan or pinch retracts both strokes.
- A writer keeps its stroke with its whole path: the writer of a hand pair once it writes 3 mm, or else a contact that writes 3 mm and has moved on while the other rests. A contact that grows never writes.
- When one contact lifts or is latched palm, the other keeps its stroke.
- A pair whose later contact landed 550 ms ago, with neither moved on, is a resting hand: both are latched palm. A later newcomer whose hand holds a resting member of the pair takes the slot.

### Later contacts and edges

A stroke in progress (it shows, moved on, and never grew) keeps the slot through a pause: a later contact is ignored, never drawn. Otherwise a newcomer after the window takes the draw slot when the holder rests inside the newcomer's hand region, or when the holder is weak (no move for 150 ms, growing, or scoring 2) and the newcomer scores lower. A holder that never moved on is latched palm, and its hidden ink goes.

Otherwise a finger-like newcomer becomes a shadow. The shadow is promoted with its whole path if it writes while the holder rests or the holder proves to be a palm. Everything else is ignored.

A contact that lands within 5 mm of an edge is a shadow until it travels 2 mm away, then draws with its whole path. It is a grip only once it stays there. One that lifts within 500 ms having moved under 2 mm, and is neither large nor long, commits as a dot.

### Lift and commit

At the lift, a score of 2 or more retracts the stroke. So does ink that never showed from a contact that never moved like a stroke: it stayed down past a long press (500 ms), or drifted 2 mm and stopped by the time a palm settles (250 ms). Only a dot or a quick short mark commits without showing.

- With presence absent, or no pen ever seen on the device, a stroke commits at once, so phones and tablets without a pen neither wait nor lose ink.
- Elsewhere it is held for `graceMs`, and real pen evidence in that time drops it.
- A dot (under 2 mm of travel) shows at its lift on a digitizer with real sizes. Without them, or with pen evidence in the last 20 s, it stays hidden until it commits, since a palm bounce looks the same.
- Ink committed under a second before a pen arrives, inside its hand region, is taken back.

### Pens as mice, and known limits

A pen that reports as a mouse (`windows-pen-as-mouse`) is pen evidence: the pipeline feeds its events to the filter, and fingers draw only when finger drawing is on.

Known limits (`tests/fixtures/palm/known-limits.json`): a lone, small, moving contact that never grows and has no neighbor is a finger by every signal a page can see. So is a palm that bounces and lifts before any pen evidence on a digitizer without sizes: only the late retract takes its dot back. The generators label such contacts (`slides-like-a-stroke`, `bounce`, `fingertip-sized`), and a few more: a tap in the first second after the pen (`held-after-pen`), and a pen with neither lean nor size, where the hand may lie on either side or above the line (`side-unknown`). Two-finger taps near where the next line starts are refused on such digitizers. The report counts them apart from the gates, with the scenarios that some profiles cannot pass.

## Device profiles and settings

`settings.ts` holds the profile rows (`classifyDevice`), the settings, and the learned state. Every reader is lenient.

| Setting               | Values                                                                                          | Default    |
| --------------------- | ----------------------------------------------------------------------------------------------- | ---------- |
| `handedness`          | `auto`, `right`, `left`                                                                         | `auto`     |
| `fingerDraw`          | `auto` (fingers draw until a pen is seen), `on`, `off`; the stored boolean reads false as auto  | `auto`     |
| `sensitivity`         | `low`, `standard`, `high`; low raises palm sizes 15%, high draws only with a learned stylus tip | `standard` |
| `penOnly`             | Every single touch on the page is ignored                                                       | false      |
| `graceMs`             | 300 to 2,000                                                                                    | 500        |
| `twoFingerNavNearPen` | Hidden where the OS blocks touch near the pen                                                   | true       |

The learned state holds `penSeen`, the hand regions, the stylus tip size, and the calibrated pixel scale. Save `learned()` to device state on page hide.

## API

`createPalmFilter(settings, profile, learned)` makes one filter per page view. Positions are client CSS px, and the filter converts them to millimeters with the profile's `pxPerMm`. Read `effects` after every call, because the next call clears them. `input/pipeline.ts` wires the filter, the multi-tap detector, `touchNav`, and the touch stroke builders, and both the page view and the replayer use it.

| Call                                               | When                                                                                                                                      |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `pen(signal, pointerId, time, x, y, tiltX, tiltY)` | Every pen event from window-level listeners. A `hover` is a `pointermove` with no buttons; `leave` is `pointerleave` on the document root |
| `touchDown`, `touchMove`, `touchEnd`               | Every touch event on the page or on controls                                                                                              |
| `system(signal, time)`                             | Window blur, page hidden, page switch, or a pen capture lost while the pen is down. Never the capture release after a `pointerup`         |
| `tick(time)`                                       | Every 100 ms while `needsTick()`, and at `nextDue()`                                                                                      |
| `hint(kind, time, x, y)`                           | A native palm hint                                                                                                                        |

Budgets, checked in `benchmark.test.ts`: a pen event at most 1 µs, a touch event with 10 contacts down at most 5 µs, a tick at most 10 µs, 100,000 mixed events at most 60 ms, and no allocation per event. Contacts, pens, holds, and effects live in typed arrays, and hot modules copy their thresholds into plain local objects. `docs/perf/phase-5-core.md` records the numbers.

## Sources

- [S6] Android palm rejection and `FLAG_CANCELED`.
- [S16] The ChromeOS palm filter: it cancels touches within 0.4 s of stylus use and holds those within 1 s.
- [S28] Schwarz et al., "Probabilistic palm rejection using spatiotemporal touch features", CHI 2014.
- [S29] Annett et al., "Is the pen mightier than the finger?", 2014.
- [S30] Vogel et al., "Hand occlusion with tablet-sized direct pen input", CHI 2009.
- [S32] Windows `UISettings.HandPreference`.
