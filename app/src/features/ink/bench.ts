// Timing helpers for the ink benchmarks (DEVELOPMENT.md phase 5: a 10,000-stroke page). Each operation runs many
// times, so one garbage-collection pause cannot decide the result. A run reports its best and median time. The best
// run must meet the budget, so other processes on a shared machine cannot fail a test. The median must stay within a
// few times the budget, so a slowdown that hits every run still fails it.
//
// Set OPENNOTE_BENCH_OUT to a folder to write each benchmark file's numbers there as JSON. docs/perf/phase-5-core.md
// records them.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';

export interface Timing {
  /** Milliseconds for the fastest run. */
  readonly best: number;
  /** Milliseconds for the middle run. */
  readonly median: number;
  readonly runs: number;
}

export const RUNS = 31;
/** Runs before timing starts, so the engine has compiled the code, as it has after a few pen strokes. */
export const WARMUP = 8;
export const BUDGET_MS = 10;
/** How many times the budget the median run may take, to allow for a busy machine. */
export const LOAD_ALLOWANCE = 3;

export function measure(run: (i: number) => void, runs = RUNS, warmup = WARMUP): Timing {
  for (let i = 0; i < warmup; i++) run(i);
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    run(warmup + i);
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  return { best: times[0], median: times[Math.floor(runs / 2)], runs };
}

export function expectWithinBudget({ best, median }: Timing, budget = BUDGET_MS): void {
  expect(best).toBeLessThan(budget);
  expect(median).toBeLessThan(budget * LOAD_ALLOWANCE);
}

export interface Result extends Timing {
  readonly name: string;
  /** What one run did, such as "10,000 strokes", for the table in the perf doc. */
  readonly note: string;
}

const results: Result[] = [];

/** Notes a result for the report, and returns the timing so a test can assert on it. */
export function record(name: string, timing: Timing, note = ''): Timing {
  results.push({ name, note, ...timing });
  return timing;
}

/** Writes the results of one benchmark file when OPENNOTE_BENCH_OUT names a folder. */
export function flushResults(file: string): void {
  const folder = process.env.OPENNOTE_BENCH_OUT;
  if (!folder || results.length === 0) return;
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${file}.json`), JSON.stringify(results, null, 2));
}
