# Phase 5 ink core: 10,000-stroke benchmark

This page records how fast the pure ink core runs on a page of 10,000 strokes. The phase's test list asks for this benchmark. Its budget says that hit testing and the lasso each finish in under 10 ms. The benchmark covers the geometry, the stroke model, the erase sessions, insert space, the lasso over blocks, the tile planner, and the pen path. It does not cover drawing, so it says nothing about the pen-to-screen budget. That needs the page view and a real pen.

## How it is measured

- The page has 10,000 strokes of 80 points each, drawn by a seeded generator (`generatePage` with seed 42) over a 4,000 by 12,000 unit page. A stroke is about 100 units long, like a word of handwriting.
- Every operation runs 8 times to warm up, and then 31 times. The tables show the best run and the median run, in milliseconds. Operations that run once at page open run 3 to 7 times.
- A test passes when the best run meets its budget and the median stays within three times the budget. The best run is the fair figure on a shared machine, because other processes only slow a run down.
- The tests are `app/src/features/ink/geometry/benchmark.test.ts` and `app/src/features/ink/benchmark.test.ts`. Set `OPENNOTE_BENCH_OUT` to a folder to write each file's numbers as JSON, and run `npx vitest run --config app/vitest.config.ts --project unit app/src/features/ink/benchmark app/src/features/ink/geometry/benchmark --no-file-parallelism`.
- The figures below are the lowest best and median of three runs on the development laptop while several other builds and test runs used the same machine. Treat each one as an upper bound. A quiet machine is faster, and the first run of the lasso on the wide area took 10.3 ms while the machine was busiest.

## Results the pen waits on

These run while the person writes, erases, or selects. Each must finish in under 10 ms.

| Operation | Best (ms) | Median (ms) |
|---|---|---|
| Point hit | 0.011 | 0.043 |
| Stroke eraser sweep, 12 unit radius | 0.040 | 0.401 |
| Partial eraser sweep, 8 unit radius | 0.021 | 0.707 |
| Stroke eraser session, move | 0.028 | 0.142 |
| Partial eraser session, one move then commit | 0.051 | 0.739 |
| Lasso over a wide area, 2,400 by 1,600 units | 6.519 | 12.008 |
| Lasso as a curved loop, 387 strokes selected | 3.940 | 5.804 |
| Lasso over ink and 200 blocks | 5.430 | 9.351 |
| Plan insert space, line at mid page | 5.486 | 8.228 |
| Plan a cold viewport, ring included | 0.738 | 4.797 |
| Plan one scroll step | 0.307 | 0.522 |
| Invalidate 30 changes in 16 tiles | 0.415 | 0.618 |
| Build a 400-sample stroke with the steady pen | 0.674 | 0.940 |
| Filter 2,000 palm events | 0.527 | 0.733 |

The lasso over a wide area is the closest to its budget, because a lasso that covers a quarter of the page has to resolve thousands of strokes. Its median is above 10 ms on this machine, and the architecture's own target for the engine is 20 ms. The mask answers most strokes without testing a point, and a stroke that crosses the edge counts its points. The planner runs on every camera message, so its cost matters most when scrolling, and it stays under 1 ms.

## Results at page open

These run once when a page opens, or when a person starts a big job.

| Operation | Best (ms) | Median (ms) |
|---|---|---|
| Build the stroke index from decoded strokes | 32.3 | 41.4 |
| Index every record from its header, without decoding points | 52.7 | 71.5 |
| Decode 1,500 strokes (one viewport) | 116.8 | 138.6 |
| Decode and fold every record | 1,425.7 | 2,156.1 |
| Frame every record as bytes | 369.1 | 526.4 |
| Encode every stroke | 2,467.5 | 2,745.8 |
| Check 10,000 strokes for a scribble | 50.4 | 60.2 |

- The architecture's page-open plan indexes every record from its header, and decodes only the strokes that meet the viewport. That costs about 53 ms plus the viewport decode. Decoding all 10,000 strokes at once takes about 1.4 s here, so a page view must not do that.
- A quieter measurement of the viewport decode on the same laptop gave 27 ms for 1,500 strokes, of which 14 ms is the varint decoding itself. The architecture's estimate of 3 to 5 ms assumes the work is split over three raster workers and decoded straight into typed arrays. A single thread that builds point objects takes about five times as long. The engine should decode into typed arrays for drawing, and build point objects only for hit tests and edits.
- Encoding takes about 250 microseconds for a stroke of 80 points, so a stroke of 400 points encodes in about 1 ms at pen-up. Nothing encodes thousands of strokes at once except an import.

## What is not measured here

- Latency from pen to screen, and the frame rate while scrolling a tiled page. Both need the page view, a real pen, and the Surface Pro. The phase's done test covers them.
- Memory. The tile budget code uses the split of 40 MB from the architecture, with a fixed part of 19 MB that is a placeholder until week-one check I10 measures it.
- Drawing a tile. The planner says which tiles to draw. The engine's raster cost per tile is part of the page view round.
