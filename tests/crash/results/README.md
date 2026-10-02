# Week-one results of WP2

These files hold the first runs of measurements M3, M5, and M6 and of the kill harness, from plan section 2. They ran on a Surface Laptop Studio 2, which is much faster than the reference laptop in BRAND.md. Every report says `"reference_laptop": false`, and none of these numbers counts as a pass on the reference laptop.

## The machine

- Surface Laptop Studio 2 with an Intel Core i7-13800H.
- A KXG80ZNV1T02 solid-state drive from Kioxia on NVMe (Non-Volatile Memory Express), formatted with NTFS (New Technology File System).
- Windows 11 build 26200, with Microsoft Defender real-time protection on.

Other work ran on the machine at the same time, so the numbers are noisy. Two runs of the same measurement differed by up to half. No USB stick, no volume with exFAT or the 32-bit file allocation table (FAT32), and no remote network share was available. The share results come from the loopback share `\\localhost\C$` on the same drive, through the Windows network redirector. They show the semantics of a network share, but not its speed.

## The files

| File | What it holds |
|---|---|
| `2026-09-30-surface-laptop-studio-2-nvme.json` | M3, M5, and M6 on the internal drive |
| `2026-09-30-surface-laptop-studio-2-share-loopback-m5.json` | M5 on the loopback share |
| `2026-09-30-surface-laptop-studio-2-share-loopback-m6.json` | M6 on the loopback share |
| `2026-09-30-kill-harness-fs-100.json` | 100 kills of the file system workload, with no failures |

Times are in milliseconds, at the 50th, 95th, and 99th percentiles. Run them again with `cargo crashtest measure all --dir <folder> --label <drive> --out <file>`, which builds the optimized `perf` profile.

## What they show

M5: a save of a budget page after one stroke took 16 to 23 ms at the 95th percentile over two runs on the internal drive. The gate is 25 ms on the reference drive, so the slower reference laptop will likely miss it. The fallback in plan section 2 is to merge the two page flushes where the file system allows it.

M3: reading and parsing the files of a budget page, with the cache emptied first, took 16 to 31 ms at the 95th percentile with 1 or 4 segments, over three runs. With 8 segments it took 25 to 63 ms. Decoding the ink comes on top, once the formats package (WP1) lands. The fallback, compacting to at most 4 segments per page, looks prudent.

M6 on NTFS:

- A rename by handle with POSIX (Portable Operating System Interface) semantics replaces a file that another process holds with delete sharing. That process keeps reading the old file.
- Without delete sharing, the replace fails with a sharing violation, which is Busy.
- A folder can't be renamed while a file inside it is open.

M6 on the loopback share:

- POSIX semantics aren't available, so the rename falls back to `FileRenameInfo`.
- Any held target then refuses the replace with access denied, and flushing a folder handle fails.
- Every save there is unconfirmed, as the table in spec 17.5 says.

## Phase 3 exit-gate runs

These ran on the same Surface Laptop Studio 2 after every Phase 3 work package merged, from optimized builds (the `spikes` profile). They don't count as passes on the reference laptop. Other programs kept the processor at 100% and left little memory free throughout, so the times are much noisier than the ones above.

| File | What it holds |
|---|---|
| `2026-09-30-kill-harness-core-1000.json` | 1,000 kills of the core workload with seed 20260930, with no failures |
| `2026-09-30-surface-laptop-studio-2-bench-1000-pages.json` | `opennote-perf bench all --pages 1000` |

Kill harness: 506 writers were killed at a random moment, 264 just after a save step, and 230 at an armed fail point, of which 72 were reached. The writers acknowledged 12,470 edits, and the hostile reader held files 14,211 times. The run took 2 hours 57 minutes, because each iteration gets slower as scratch pages pile up in the notebook.

Property tests: with `PROPTEST_CASES=10000`, all 591 tests of `opennote-core` with every feature passed in 26 minutes. The round trip on disk (P2) took 20 of them.

Benchmarks within their gates, in milliseconds at the 95th or 99th percentile:

- Typing batch 0.07 (gate 0.5), 500-point stroke 0.12 (2), journal append and flush 2.5 (30).
- Notebook open 38 warm (50) and 17 cold (250), page list of one section 7 (50), core share of a budget page open 1.9 (25).
- Start-up path 38 (150), scan after an unclean exit 260 (500).
- Core memory 10.5 MB with ten budget pages (96 MB), and no growth on reopening.

Over their gates:

| Measure | Result | Gate | Second run |
|---|---|---|---|
| `store.open.budget_page.p95` | 278 ms (50th percentile 136) | 25 ms | 294 ms |
| `store.save.one_stroke.p95` | 1,123 ms (50th percentile 39) | 25 ms | 1,088 ms |
| `store.recovery.journal_4mib.max` | 987 ms | 100 ms | 746 ms |

The store open decodes all 5,000 strokes, and decoding them alone took 165 to 203 ms at the 50th percentile in the format suite. The save's 95th percentile includes the compactions the saver chooses. Runs of the format suite differed by up to 13 times, so the load on the machine explains part of the excess, but not all of it.

The session, start-up, and memory suites still run on the in-memory test core (`session::kit`), as their module comments say. Their numbers leave out the disk and the real codecs until those suites move to the real parts.

## Phase 3 performance follow-up

These ran on 2 October 2026 on the same Surface Laptop Studio 2, plugged in, with Defender real-time protection on. Other programs, including another agent's builds, kept the processor 15 to 40% busy, with about half the memory free.

The exit-gate runs above used the optimized `spikes` profile, so a debug build doesn't explain their excess. Still, nothing stopped a debug run: `cargo run -p opennote-perf` built the debug profile, where opening the budget page took 729 ms at the 50th percentile against 71 ms optimized. Now `cargo perf bench store <dir>` builds the `perf` profile, which inherits the release optimizations, and both benchmark tools refuse a debug build unless they get `--debug`. DEVELOPMENT.md says how to run them.

Before is `origin/phase-3` built with `spikes`, and after is branch `p3-perf` built with `perf`. The two ran in turn, three times each, 20 seconds apart. Times are in milliseconds, and none of them counts as a pass on the reference laptop.

| Measure | Gate | Exit-gate run | Before | After |
|---|---|---|---|---|
| `store.open.budget_page.p95` | 25 | 278 | 43 to 44 (50th percentile 42) | 17 to 20 (50th percentile 16 to 17) |
| `store.save.one_stroke.p95` | 25 | 1,123 | 237 to 253 (50th percentile 25 to 27) | 18 to 19 (50th percentile 15) |
| `store.recovery.journal_4mib.max` | 100 | 987 | 278 and 284, and once 15,891 | 112 to 131 |

Journal appends stayed at 1.1 to 1.6 ms at the 99th percentile. `2026-10-02-surface-laptop-studio-2-store-before.json` and `2026-10-02-surface-laptop-studio-2-store-after.json` hold the second run of each.

### What changed

- Stroke points are checked with a fast path first. For 5,000 strokes, the check fell from 38 to 10 ms.
- A minor compaction leaves the untouched strokes of the base segment unparsed, and takes the later segments that the store just wrote from memory. On this laptop a new segment file took about 24 ms to open the first time, most likely while Defender scanned it. So these saves took about 200 ms and set the 95th percentile.
- A save no longer copies the page's strokes. It builds and checks `page.json` on a second thread while the new segment is written and flushed. The file system still sees the same calls in the same order.
- Recovery replays journal records by reference, loads the page while the journal decodes, and frees the decoded journal on another thread.
- Applying a transaction that changes one thing makes no hash sets.
- The core builds with `opt-level = 3` in release, and so in `perf`. That made each step 12 to 24% faster.
- Segment records and journal payloads decode on up to 8 threads. Decoding the budget page's segment fell from 8.7 to 4.4 ms, and the 4 MiB journal from 39 to 14 ms.

### What is left

Recovery still misses its gate. A timed run took about 100 ms. Reading and decoding the journal while the page loads took 24, and replaying 7,206 transactions through the applier took 23. Saving the page took 25, and writing its history version 13. The save writes and flushes a 4 MiB segment. In the benchmark, the journal was also written a moment before, so its first read likely waits for the scan too. Replaying runs of `addStrokes` as one batch would save most of the replay.

### Crash safety

All 599 tests of `opennote-core` with every feature passed. They include the crash scenarios on the fault-injecting file system and the power cuts. `2026-10-02-kill-harness-core-100.json` holds 100 kills of the core workload with seed 20261002, after all of these changes, with no failures. 50 writers were killed at a random moment, 26 just after a save step, and 24 at an armed fail point, of which 13 were reached. The hostile reader held files 2,780 times.
