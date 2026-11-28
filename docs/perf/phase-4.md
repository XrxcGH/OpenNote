# Phase 4 performance record

Phase 4's exit gate is typing within 16 ms with a 20-page note ([DEVELOPMENT.md](../DEVELOPMENT.md#phase-4-typed-notes)). This page records how it was measured, the numbers, what the gate run fixed, and what is still over budget. The budgets and conditions come from sections 24 and 26 of the Phase 4 architecture.

Contents:

1. [Machine and method](#machine-and-method)
2. [Typing](#typing)
3. [Motion](#motion)
4. [Microbenchmarks](#microbenchmarks)
5. [What the gate run fixed](#what-the-gate-run-fixed)
6. [Still over budget](#still-over-budget)
7. [The nightly gate on a hosted runner](#the-nightly-gate-on-a-hosted-runner)
8. [Not yet measured](#not-yet-measured)
9. [Accessibility found in passing](#accessibility-found-in-passing)
10. [Bundle budgets left raised](#bundle-budgets-left-raised)

## Machine and method

- **Machine:** Surface Laptop Studio 2 (Intel Core i7-13800H, 20 logical processors, 32 GB, 2400 by 1600 at 120 Hz, 150% scaling), Windows 11 Pro, Microsoft Edge 154 headless. Phase 2's perf tests treat this laptop as the reference machine. The 4-core reference laptop of section 24.5 was not available, so its column is still empty.
- **Load:** other build and test jobs shared the machine. Processor load was 57% when run 1 started and 99% during run 2, so run 2 shows what contention does rather than what the app does.
- **Build:** the web test build (`npm run app:build:test`), served by `vite preview`. The web platform keeps pages in memory, so the real core's saving and journaling are not in these numbers.
- **Typing:** `npm run perf:typing` ([tests/perf/typing](../../tests/perf/typing)). Each condition opens its page fresh, places the caret, and sends 10 warm-up keys and then 100 measured keys through the DevTools Protocol, 120 ms apart (33 ms in the burst condition).
  - **Painted:** the in-page measure of architecture decision record (ADR) 0005, from the keydown's time stamp to a message posted from the next animation frame.
  - **Script:** from the keydown's first listener to the end of the key's synchronous work, Chromium's own text insertion included.
  - `OPENNOTE_TYPING_GATE=1` fails a condition over 16 ms painted p95.
- **Motion:** the same command's motion mode pans and zooms the freeform page with 8 text boxes and counts dropped frames against 60 Hz.
- **Microbenchmarks:** `app/src/editor/bench/typing.test.ts`, in the unit suite on every pull request.

## Typing

Painted latency in ms, and script per key at the 95th percentile. The gate is painted p95 at most 16 ms.

| Condition | Run 1 p50 | Run 1 p95 | Run 1 max | Run 1 script p95 | Run 2 p95 (99% load) | Run 1 against the gate |
|---|---|---|---|---|---|---|
| Short note (control) | 7.4 | 10.4 | 14.5 | 4.4 | 15.6 | Pass |
| **20-page note, caret at the start** | 10.6 | **14.3** | 22.5 | 5.6 | 20.1 | **Pass** |
| **20-page note, caret in the middle** | 11.3 | **14.4** | 25.7 | 6.2 | 14.0 | **Pass** |
| **20-page note, caret at the end** | 10.6 | **13.8** | 22.8 | 7.0 | 48.6 | **Pass** |
| 20-page outline, 1,200 items, middle | 24.2 | 36.1 | 65.1 | 13.2 | 64.2 | Fail |
| 20-page note in one callout | 12.5 | 14.4 | 16.5 | 6.3 | 65.2 | Pass |
| Freeform page, 8 boxes, in the 20-page box | 11.9 | 13.5 | 16.2 | 6.0 | 48.3 | Pass |
| Table cell after the 20-page note | 11.3 | 16.0 | 23.9 | 6.7 | 55.5 | Pass |
| Highlighted code block after the note | 10.7 | 15.3 | 17.5 | 8.2 | 44.3 | Pass |
| Spell check on, 200 squiggles in view | 14.0 | 18.4 | 28.0 | 7.2 | 81.6 | Fail |
| Bursts of 30 keys a second | 11.9 | 16.4 | 28.8 | 7.4 | 36.7 | Fail, by 0.4 ms |
| Screen reader flag, accessibility tree on | 13.9 | 20.6 | 36.1 | 7.8 | 28.2 | Fail |
| 50% page zoom | 12.9 | 15.8 | 23.8 | 6.3 | 39.7 | Pass |
| 200% page zoom | 11.6 | 20.8 | 26.8 | 7.2 | 25.5 | Fail |

The DEVELOPMENT.md gate is the 20-page note. It passes in run 1 at all three caret positions, at 13.8 to 14.4 ms. Earlier runs during the gate work put the screen reader condition at 14.7 to 16.7 ms and 200% zoom at 13.3 to 14.6 ms, so those two failures are partly load. The outline and the squiggles are over budget in every run.

No condition had a long animation frame (over 50 ms) in run 1. Script per key is over its 4.5 ms budget everywhere but the short note. The measure includes Chromium's own text insertion, which the budget's 3 ms for "browser input" was meant to cover. The plugins' share, measured alone, is well inside its 1.5 ms (see the microbenchmarks).

## Motion

On the freeform page with 8 text boxes, one of them the 20-page note. Headless Edge drew about 100 frames a second when idle.

| Gesture | Frames a second | Frame interval p95 (ms) | Dropped against 60 Hz | Most in a row | Budget: never two in a row |
|---|---|---|---|---|---|
| Mouse wheel scrolling | 101.5 | 12.1 | 3 | 3 | Fail, one hitch |
| Ctrl+wheel zooming | 93.0 | 20.0 | 1 | 1 | Pass |
| One-finger touch pan | 102.6 | 10.3 | 0 | 0 | Pass |
| Two-finger pinch | 51.9 | 39.4 | 12 | 1 | Pass, at 52 frames a second |

## Microbenchmarks

From one unit-suite run on the loaded machine. The machine scale stayed at its cap of 4, so budgets were 4 times their reference values.

| Measure | 20-page note | 20-page outline | Budget on the reference machine |
|---|---|---|---|
| Phase 4's plugins per key, p95 | 0.33 ms | 0.50 ms | 1.5 ms |
| Serializer, cold | 63 ms | 46 ms | Reported |
| Flush (serialize, splice, request JSON), p95 | 1.2 ms | 1.3 ms | 8 ms |
| Undo frame re-parse, p95 | 4.2 ms (range) | 38 ms (full) | 20 ms range, 50 ms full |

## What the gate run fixed

| Problem | Effect before | After |
|---|---|---|
| No `contain: paint` on textblocks, which section 5.7 requires | 20-page note 17.5 ms p95; layerize and paint over 9 ms a key | 12.8 to 14.4 ms |
| `:nth-child(1 of ...)` restyled every block when a widget changed | 3.5 ms of style recalculation a key at the top of the note | Gone |
| Fold buttons were redrawn on every key in a heading or list item | Caret at the start: 22.8 ms p95 | 14.3 ms |
| Squiggles were re-added on every key, and Chromium repainted the page for each change | 17 ms of paint a key with 200 squiggles in view | 8.5 ms of paint, 18.4 ms p95 |
| A touch pan ended after its first step (lost implicit capture) | Touch pan moved one tenth of the finger's path | Follows the finger, 0 dropped frames |

## Still over budget

- **The 20-page outline (36 ms p95).** A nested list of 1,200 items is about 3,600 boxes. Each key costs Chromium about 7 ms to insert the text and 4 ms of layout. The hover hit test that follows any layout change costs 5 to 7 ms more while the pointer rests over the list. The app's own script is 1.3 ms of it. Options: `content-visibility: auto` on far list items (section 28's measured fallback), or handling plain text input in `beforeinput` so Chromium's editing command never runs. Both are design changes for the page view's owner.
- **Squiggles in view (18.4 ms p95).** After any change to the page's elements, Chromium re-validates every custom highlight marker and repaints the text that holds one, about 8 ms with 200 in view. Options: report it to Chromium, or hide squiggles in the paragraph being typed in until the pause that checks it.
- **Undo in the outline.** A range re-parse covers whole top-level blocks, and an outline is one list. Its undo frames parse all 43 KB again: 38 ms on the loaded machine, most of undo's 50 ms.
- **Script per key, 5.6 to 7 ms p95 in the 20-page note,** against 4.5 ms. Most of it is Chromium's text insertion and ProseMirror reading the change back.

## The nightly gate on a hosted runner

The nightly `perf-typing-gate` job runs this benchmark with the gate on, on a hosted Windows runner. Its first run on main (2026-11-26) failed four conditions. The pull request job measures the same way without the gate, so its artifacts give a history on the same kind of machine.

| Condition | 2026-10-31 p95 | 2026-11-07 to 11-25 p95 | Nightly p95 | Cause |
|---|---|---|---|---|
| Table cell after the 20-page note | 8.0 | 10.2 to 19.2 | 18.0 | A regression in November. The table toolbar draws again on every caret move, and it rewrote the attributes of all its buttons each time. That part is fixed: it writes no attributes when nothing changed. Background work (the smart table's 120 ms recalculation and the 300 ms text sync) still lands just before some keys. |
| Bursts of 30 keys a second | 17.1 | 16.4 to 19.2 | 18.3 | Not a regression: over budget since it was first measured, on the reference laptop too (16.4). The runner's frame clock is 60 Hz. Any frame asked for after a key keeps the clock running, so the next key, 33 ms later, waits for its tick. One source is fixed: the page's caret asked for a frame on every key even when the browser draws the caret. |
| Code studio, 1,000-line file | none | 22.7 to 23.9 | 23.2 | CodeMirror blinks its caret with a CSS animation that never ends, so every key waited for the next tick (p50 16.7 ms). That part is fixed: the caret stays solid while keys come, as a native caret does, and blinks again after 1 s. The rest is the studio's own work per key (parse, completion, problem marks), tracked as B12-TYPING-1000 in [code-studio.md](code-studio.md). |
| Code studio, 5,000 console lines | none | 22.1 to 23.8 | 22.0 | As above. |

The budget stays at 16 ms. The fixes were measured on the development laptop under load. The studio's p50 went from 19 to 13 ms. The burst p95 went from 17.5 to 16.3 ms. The 20-page note's p95 went from 10.5 to 8.5 ms. The table, the burst, and the studio are still over budget on a hosted runner.

### Second round: frames between keys

The nightly run still had the table at 17.8 ms, the burst at 17.2 ms, and the studio at 21.7 and 20.8 ms. A Chromium trace showed why. Chromium keeps the frame clock running for two ticks after a frame, then stops it. A key that comes while it runs, or just after it stops, waits for the next tick. So a frame drawn in the 50 ms before a key can cost that key a whole tick.

Each slow key followed a frame drawn by work on a timer after the previous key. Most of those writes changed nothing. The browser takes a value written again as a change: it restyles the element and asks for a frame.

- **Table.** The smart table recalculates 120 ms after a key, just before the next key at a typist's pace. It sent its results to the editor even when they had not changed. That drew the table's toolbar and the pointer layer again, and the pointer layer wrote `hidden` on its three handles. Now a recalculation whose results did not change sends nothing, and the handles are written only when they change.
- **Code studio.** The syntax check publishes a file's problems 50 ms after a key. The editor drew them and its gutter again each time, though typing after a problem leaves it where it was. The studio's Problems panel drew again too. Now the same problems draw nothing. A key at the end of a long line also scrolled twice: the browser scrolled the caret into view, then CodeMirror scrolled again for its 5 px margin, in a second frame. The editor's scroller now has the same `scroll-padding`, so one scroll does.
- **The whole class.** A probe recorded every unchanged write while each condition typed. It found the same pattern in nine more places, from the symbol list to the command bar. They now skip a value the element has, through `app/src/ui/domWrites.ts`. `tests/ui/behavior/typing-writes.spec.ts` runs the probe in four conditions.

Painted p95, in ms. Hosted numbers come from the pull request job: main first, then this change twice.

| Condition | Laptop before | Laptop after | Hosted before | Hosted after |
|---|---|---|---|---|
| Table cell | 17.5 | 10.6 | 18.4 | 12.4, 11.1 |
| Code studio | 18.9 | 8.3 | 20.3 | 17.0, 17.4 |
| Code studio, 5,000 console lines | 20.3 | 7.9 | 21.6 | 17.8, 18.0 |
| Bursts of 30 keys a second | 17.2 | 16.0 to 17.5 | 16.2 | 17.4, 17.2 |

The table is under budget. The studio is not, on the slower hosted runner. Most of each key's work there is CodeMirror's own: the incremental parse and the view update. CodeMirror also measures its completion list again 50 ms after the list changes size, a frame before some keys. A 1.6 times CPU throttle on the laptop gives the hosted numbers.

A later look at the table found two more costs:

- **Toolbar on every key.** The table draws its toolbar again on each caret move, so on each key. The cell format bar and the formula bar's name box drew again with it, and their inputs wrote their attributes. Each bar now draws only when what it shows changes.
- **Features that load late.** Each of a table's features adds a plugin to its editor after the table shows. That rebuilds every plugin's view. The spreadsheet keys took their grid marks off and put them back. The toolbar's room below the table was cleared and written again. On a slow runner this landed between keys. A rebuilt view now keeps what it shows.
- **Every block type.** A second probe typed in each one: paragraph, lists, task list, quote, heading, callout, code, table, smart table, sheet, long sheet, and equation. It found the same pattern in the task item and the equation field. The app has no image caption to type in.

On the laptop the table's painted p50 went from 5.7 to 5.0 ms, and its script p50 from 3.0 to 2.5 ms.

The burst stays at the edge. At 30 keys a second, each key comes about two ticks after the last one's frame, just when Chromium stops the clock. About one key in ten waits most of a tick. The app's work after the tick is about 2 ms. That is Chromium's frame scheduling, not app work, and it needs the owner's decision.

## Not yet measured

- The 4-core reference laptop, and the screen measure (Desktop Duplication), both in section 24.5's nightly run.
- Typing with the real core saving and journaling, and with a UI Automation client attached. The screen reader condition here turns on Chromium's accessibility tree with `--force-renderer-accessibility`, which is what a client does.
- Page open (500 and 5,000 blocks), editor mounts, the 50 ms feedback budgets in the desktop app, and memory by the M4 method.
- Spike S5 on real hardware.

## Accessibility found in passing

The sampler's text reads the same static and mounted, apart from controls only an editor draws, after one fix: static math showed nothing until an editor mounted. Two gaps remain for the schema's owner, held in an expected-failure test in `tests/ui/a11y/page.aria.spec.ts`. Static task items show their state only as a drawn box, with no checkbox, and static callouts have no name.

## Bundle budgets left raised

The lazy limits for the engineering kits and the solvers window were lowered to what they measure plus about 2 KB. Those windows load after the tool-window host, so they are counted without it (the `after` rule on `features/tools/ui/host` in `app/bundle-budget.json`). These limits stay above their old values, and the cause is one fault, tracked here:

- `features/tools/index.ts` re-exports the host (`ui/host`), so every group that imports the tools index (the accounts commands, the kits' `open.ts` files, `tables/index`) loads the host's 176 KB and its libraries. That is why `accounts/lms/commands` (271 KB), `meetings/commands` (197 KB), `tasks/auto` and `tasks/commands` (196 KB), `tools/index` (359 KB) and `tables/index` (73 KB) cannot come down. The import-boundary rule stops the accounts from importing the `upcoming` and `upcomingMerge` modules directly. The fix is to move the open-window store and `openTools` into a small module the index re-exports, make `openTool`, `closeTool` and `resetToolWindows` load the host on call, and then lower all six limits. Do it as one change, with the callers in `auditHooks.ts` and `registrations/qolStudy.ts`.
