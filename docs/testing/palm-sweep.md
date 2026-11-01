# Palm rejection: the label-oracle sweep

The label oracle (`app/src/features/ink/input/testing/oracle.ts`) replays a generated session and checks it by its labels. A contact labeled with no intent leaves no ink, moves no camera, and taps nothing. Every intended stroke, scroll, pinch, tap, and gesture happens. The property tests in `testing.test.ts` drew a random scenario, profile, and seed, so a rare failing seed showed up as a CI flake (seeds 13 and -869232014).

The sweep (`oracleSweep.test.ts`) runs 200,000 cases instead: every generator seed from 1 to 100,000, twice, each time with another of the 745 scenario and profile pairs. Every failing case is classified, and `tests/fixtures/palm/oracle-sweep.json` records each one by its index. The property tests now draw only from the swept cases and leave the open ones out, so a draw can no longer meet an unclassified failure.

## How to run it

```sh
PALM_SWEEP_FROM=0 PALM_SWEEP_TO=50000 PALM_SWEEP_OUT=sweep-0.json npx vitest run --config app/vitest.config.ts --project unit app/src/features/ink/input/testing/oracleSweep.test.ts -t "full sweep"
```

Run four shards of 50,000 in parallel; each takes about four minutes. A shard is compared with the record. It fails on a failing case the record does not list as open: a new failure, or a fixed one back. It also fails on an open case in its range that now passes, so the record is updated when it should be. The failure message lists both. The nightly workflow's `palm-sweep` job runs the four shards every night and keeps each shard's `PALM_SWEEP_OUT` file as an artifact.

A new scenario or profile changes every case's pair, and a test then asks for the sweep to be run and recorded again.

## How a failure is classified

- **Generator gap:** the generators broke their own model of the hand. They placed a contact where their own model puts the writing hand, labeled a contact by a size the digitizer never reports, or fell back to a fixed place without checking it. These are fixed in the generators, but one (G7).
- **Classifier miss:** the session keeps to the model, and the filter still gets it wrong. These are left as they are and listed below for review. No classifier code changed.

## What the first sweep found

The first sweep found 206 failing cases (0.1 percent). The generator fixes below cleared 112 of them. The sweep after the fixes found 102: 94 left from the first sweep and 8 that the fixes moved elsewhere. Of those, 98 are classifier misses and 4 a generator gap left open (G7).

The fixes changed the corpus `palm.accuracy.test.ts` replays. Every gate still holds. One recorded baseline rose: the 95th-percentile scroll delay on `pencil-usb-c`, from 84 to 96 ms (the gate is 600 ms), since the pinches and scrolls now land elsewhere.

### Generator gaps

| Id  | Cases   | What was wrong                                                                                                                                        | Fix                                                                                                                                                       |
| --- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | 60      | Other-hand taps were kept clear of a tripod hand only. An overwriter's palm rests above the line, and a small screen can leave no clear place at all. | A tap keeps clear of the drawn heel at the tip and both line starts, and is not made when no clear place is left.                                         |
| G2  | 7       | The writer leaned an overwriter's pen down, away from its hand above the line.                                                                        | An overwriter's pen leans up, as a hooked grip's does.                                                                                                    |
| G3  | 14      | A pinch was kept clear where its fingers landed, not where the upper finger ended.                                                                    | Both ends of each finger's path are checked.                                                                                                              |
| G4  | 6       | A scroll was kept clear where it landed, not along its path.                                                                                          | The whole path is checked.                                                                                                                                |
| G5  | 8       | A palm part's size was judged at the lift, which no digitizer reports, or exactly on the palm bound, which reads either side of it in pixels.         | The label uses the last reported size and needs a size past the bound.                                                                                    |
| G6  | 17      | With no clear room, a double tap fell back to a fixed place inside the hand, and the room it found ignored an overwriter's forearm.                   | Every place on the screen is tried, the forearm runs through the drawn heel, and with no room the other hand does not tap.                                |
| G7  | 4, open | A tap keeps clear of an overwriter's drawn heel but models its forearm as a tripod's, so it can land in the forearm the pen now leans toward.         | Open: modeling every grip's forearm in `handCovers` cleared these but moved 56 other-hand contacts into C1, which broke two corpus gates. It waits on C1. |

### Classifier misses, open for review

These are proposals. Each needs a decision before the classifier changes, and the gates in `palm.accuracy.test.ts` must hold after it.

| Id  | Cases | Miss                                                                                                                                                                                                                                                                                                                | Proposed direction                                                                                   |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| C1  | 75    | Without pen lean, side votes flip the hand region across at once, but its height moves only 20 percent toward each resting palm. After two palms above the line, a hooked or overwriting hand's region still points below the tip, and its forearm strip covers the other hand's pinch, scroll, tap, or long press. | When side votes come from palms above the tip, flip the region's height too, as the side is flipped. |
| C2  | 12    | A two- or three-finger double tap of the other hand, far from the writing hand, loses fingers: its own fingers make the burst (E14, +2), which cancels the far side (E6, -2), and a palm that just lifted counts as beside it (E12).                                                                                | Leave a gesture's own fingers out of E14 for the tap gate, as the gesture take-back already does.    |
| C3  | 6     | In finger drawing, a three-finger double tap with fingers 40 mm apart reads as a drawing hand with its own palm (E18), and the group is not heard.                                                                                                                                                                  | Hear a multi-tap before the draw slot takes its fingers, as it is heard with the pen away.           |
| C4  | 3     | A stroke that starts 300 ms after a grip thumb lands at the screen edge pairs with the thumb and is ignored.                                                                                                                                                                                                        | Never pair a newcomer with a contact that rests within 5 mm of an edge.                              |
| C5  | 1     | A palm without sizes that slides 8 to 10 mm as it settles reads as a swipe (E11), though the README says a palm drifts up to 10 mm.                                                                                                                                                                                 | Count E11's 8 mm only after the contact has settled (250 ms).                                        |
| C6  | 1     | On a digitizer without sizes, split palms grow the hand region toward its 80 mm cap, and its line-start anchor then covers a pinch left of the line.                                                                                                                                                                | Learn the radius more slowly from palms with no size, or cap it lower than 80 mm.                    |
