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
- Seed: learned device state, then the pen's lean (a pen that leans 15 degrees or more points at the hand), then the handedness setting, then the system setting, then right-handed.
- Learning: a palm that ends after hard evidence, or after 300 ms down with the pen down, moves the offset 20% toward where it sat. Each stroke's lean blends in at 30%. An explicit setting holds the side of the hand until 5 strokes in a row lean the other way.

## Evidence

`score.ts` adds the terms that hold now. It recomputes them from the contact's features, never accumulating, at its own events, at ages 25 to 500 ms, and for all contacts when a pen arrives, a pen goes down, or a touch lands or lifts.

| Id  | Evidence                                                                                       | Points                           |
| --- | ---------------------------------------------------------------------------------------------- | -------------------------------- |
| E1  | Palm size: 20 mm long or 15 mm across                                                          | +4                               |
| E2  | Large: 14 to 20 mm, a thumb or flat finger                                                     | +1                               |
| E3  | Fingertip: 11 mm or less                                                                       | -1                               |
| E4  | Grew 4 mm, or 40% past a fingertip                                                             | +2                               |
| E5  | In the hand region, where it is now                                                            | +3 near or down; +2 or +1 recent |
| E6  | Far side of the tip, or 80 mm outside the region                                               | -2                               |
| E7  | The pen was down when it landed, or it rested 300 ms in the hand region while the pen was down | +2                               |
| E8  | Landed within 400 ms of a pen lift or leave; within 1 s                                        | +2; +1                           |
| E9  | Landed first: young and still when a pen arrived                                               | +2                               |
| E10 | Still at 150 ms; at 500 ms                                                                     | +1; +2                           |
| E11 | Swipe: 3 mm straight in 200 ms; 8 mm and not large; never inside the hand region near the pen  | -2; -3                           |
| E12 | A palm within 70 mm                                                                            | +2                               |
| E13 | Another contact landed within 12 mm (a split palm)                                             | +2                               |
| E14 | Three landings within 300 ms and 90 mm                                                         | +2                               |
| E15 | Grip at a screen edge                                                                          | +3, never draws                  |
| E16 | The OS says palm: a touch `pointercancel` under managed touch, or a native hint                | Latch                            |
| E17 | The size of a learned passive stylus tip                                                       | -2                               |
| E18 | Its own palm: a resting contact in the region anchored at it                                   | -2                               |
| E19 | Lifted as a tap                                                                                | -1                               |
| E20 | Sensitivity low, standard, high                                                                | -1, 0, +1                        |

Sizes count only when the digitizer reports real sizes. Motion counts against the pen, so a palm that moves with the writing hand stays still, and a palm that slides between words in the hand region is no swipe. A score of 4 or more latches palm. A score of 0 or less is a finger. An action that has run 500 ms is confirmed, and only E1, E4, or E16 can stop it.

## Roles and gates

Roles are `pass` (native, unmanaged pages only), `ignore`, `draw`, `shadow`, `scroll`, and `nav`. Every role change is an effect: `Retract` removes provisional ink, `Revert` restores the camera, `SuppressTap` swallows the click, `Commit` and `Uncommit` store or take back held ink, `Start` begins a scroll or pan, `Promote` shows a shadow stroke, and `Hold` parks a stroke that ended without a lift.

| Presence         | Page tap and long press | One-finger scroll | Two-finger pan and pinch                     | Controls         |
| ---------------- | ----------------------- | ----------------- | -------------------------------------------- | ---------------- |
| `down`           | Never                   | Never             | Never starts; a running one stops            | Score -1 or less |
| `near`           | Score -2 or less        | Score -1 or less  | Both 0 or less, motion confirmed, setting on | Score 1 or less  |
| `recent`         | 0 or less               | 0 or less         | Both 0 or less, motion confirmed             | Not palm         |
| `away`, `absent` | Always                  | Always            | Pair rules                                   | Always           |

A pan pairs two contacts that are not palms, landed within 150 ms (300 ms when the first has barely moved), and sit 15 to 120 mm apart. It starts once both pass 1.5 mm of slop and move together, or their spacing changes 2 mm. A third finger inside the window voids the pair. A palm or a later contact is ignored and leaves the pair alone.

Touch is managed (`touchPolicy()`) once a pen has been seen, when the profile reports a pen digitizer, or while finger drawing is on with an ink tool. The page then keeps `touch-action: none` and drives scroll, pan, and pinch from script. That way, the first palm of an approach never starts a native pan.

## Finger drawing

With an ink tool, presence away or absent, and finger drawing on, one contact draws. A newcomer that is not a palm draws at once, whatever ignored contacts are down. The pipeline keeps its ink hidden until it moves 0.5 mm or lifts, so a hand edge that lands first never flashes a dot. With a drawing contact already down, a newcomer pairs into a pan inside the pair window (in the first contact's hand region only when it is fingertip-sized), or takes the draw slot when the first is weak (still, growing, or scoring 2). Otherwise a finger-like newcomer becomes a shadow, built but not shown, and is promoted with its whole path if the first proves to be a palm. Everything else is ignored.

At the lift, a score of 2 or more retracts the stroke. With presence absent, it commits at once, so phones neither wait nor lose ink. Elsewhere it is held for `graceMs`, and real pen evidence in that time drops it. Ink committed under a second before a pen arrives, inside its hand region, is taken back.

Known limit: a lone, small, moving contact that never grows and has no neighbor is a finger by every signal a page can see.

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
| `tick(time)`                                       | Every 100 ms while `needsTick()`, and at `nextDue()`                                                                                                        |
| `hint(kind, time, x, y)`                           | A native palm hint                                                                                                                        |

Budgets, checked in `benchmark.test.ts`: a pen event at most 1 µs, a touch event with 10 contacts down at most 5 µs, a tick at most 10 µs, 100,000 mixed events at most 60 ms, and no allocation per event. Contacts, pens, holds, and effects live in typed arrays, and hot modules copy their thresholds into plain local objects. `docs/perf/phase-5-core.md` records the numbers.

## Sources

- [S6] Android palm rejection and `FLAG_CANCELED`.
- [S16] The ChromeOS palm filter: it cancels touches within 0.4 s of stylus use and holds those within 1 s.
- [S28] Schwarz et al., "Probabilistic palm rejection using spatiotemporal touch features", CHI 2014.
- [S29] Annett et al., "Is the pen mightier than the finger?", 2014.
- [S30] Vogel et al., "Hand occlusion with tablet-sized direct pen input", CHI 2009.
- [S32] Windows `UISettings.HandPreference`.
