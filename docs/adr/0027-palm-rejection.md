# ADR 0027: Palm rejection by evidence, with managed touch and retractable ink

- Status: Accepted
- Date: 2026-10-03

## Context

The owner's bar for Phase 5 is palm rejection more accurate than any major competitor, with near-flawless writing on Microsoft, Apple, Amazon, and other styluses, and fingers on phones and tablets. The first filter in `app/src/features/ink/input/palm.ts` was a hover gate: while a pen was near, touch was ignored. Three reviews found that it failed in the common cases. A palm that lands before the pen enters hover range kept scrolling and tapping. Two contacts of the writing hand paired into a pan. A pen without hover latched the filter for the session. A window blur deleted finger ink on a phone. The filter had no positions, so it could not use where the hand is.

Every competitor leans on the OS or the pen hardware. Those signals are missing on several targets: Fire OS 8 (Android 11) has no system palm rejector, OEM Windows digitizers may omit the Confidence and size usages, and a passive stylus is a finger to the OS.

## Decision

We will classify each touch contact by evidence: size, growth, position relative to the pen tip and a learned hand region, timing, motion, neighbors, and OS hints. The score is recomputed as the contact ages and when a pen arrives. A palm verdict is final. Touch ink is provisional and retractable; a scroll or zoom runs against a camera snapshot and reverts; a tap waits for finger evidence. Once a pen has been seen, page surfaces keep `touch-action: none` and drive scroll, pan, and pinch from script ("managed touch"), so every touch can be classified and reverted. A pen sample is never gated or delayed.

Accuracy is enforced in CI by replaying labeled synthetic sessions for every device profile through the same wiring the page view uses, with gates that may only tighten. Recorded sessions join the corpus as the owner captures them.

## Options considered

| Option | For | Against |
|---|---|---|
| Evidence score with provisional ink and managed touch (chosen) | Works with no OS help; handles palm-first, no-hover pens, finger drawing; explainable; measurable | More code; one-finger scroll is scripted while a pen device is in use |
| Hover gate with OS cancels (the first filter) | Small | Fails palm-first, no-hover pens, devices without OS help, and finger drawing |
| A learned model (neural or boosted trees) | Can reach high accuracy with data | Needs a large labeled corpus that does not exist yet; harder to explain and to keep deterministic |

## Consequences

The page view must call the pipeline for every pen and touch event, honor the effects, and keep the camera snapshot per contact. One-finger scroll with glide is reimplemented in `touchNav.ts` for managed pages. Thresholds marked [V] in `thresholds.ts` are start values; the Palm lab recordings must confirm them before release, and the accuracy gates keep any change from making things worse. Revisit if recordings show a signal the score cannot express, or if a labeled corpus large enough for a learned model exists.
