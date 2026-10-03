// Timing helpers for the ink benchmarks (DEVELOPMENT.md phase 5: a 10,000-stroke page). Each operation runs many
// times, so one garbage-collection pause cannot decide the result. A run reports its best and median time. The best
// run must meet the budget, so other processes on a shared machine cannot fail a test. The median must stay within a
// few times the budget, so a slowdown that hits every run still fails it.
//
// A full test run starts many test files at once, and a developer's machine often runs other work too. So each
// timing also records how busy the machine was, as the time of a fixed reference job divided by its time on a quiet
// machine. A budget grows by that factor, which is 1 on a quiet machine, so a real slowdown still fails there.
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
  /** How many times slower than a quiet machine the reference job ran around this measurement. At least 1. */
  readonly load: number;
}

export const RUNS = 31;
/** Runs before timing starts, so the engine has compiled the code, as it has after a few pen strokes. */
export const WARMUP = 8;
export const BUDGET_MS = 10;
/** How many times the budget the median run may take, to allow for a busy machine. */
export const LOAD_ALLOWANCE = 3;
/** The most a budget grows for a busy machine. A slowdown beyond this fails even on a machine that is very busy. */
export const MAX_LOAD = 6;
/** The reference job's best time in milliseconds on a quiet machine. */
export const QUIET_REFERENCE_MS = 16;

/** A fixed job: sorts 60,000 numbers from a seeded sequence. It touches memory and compares, like the geometry does. */
function referenceJob(): number {
  const values = new Float64Array(60_000);
  let state = 12345;
  for (let i = 0; i < values.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    values[i] = state;
  }
  values.sort();
  return values[values.length >> 1];
}

/** How many times slower than a quiet machine the machine is right now. */
export function machineLoad(): number {
  let best = Infinity;
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    referenceJob();
    best = Math.min(best, performance.now() - started);
  }
  return Math.min(MAX_LOAD, Math.max(1, best / QUIET_REFERENCE_MS));
}

export function measure(run: (i: number) => void, runs = RUNS, warmup = WARMUP): Timing {
  const before = machineLoad();
  for (let i = 0; i < warmup; i++) run(i);
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    run(warmup + i);
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  return { best: times[0], median: times[Math.floor(runs / 2)], runs, load: Math.max(before, machineLoad()) };
}

/** The best run must be under the budget, and the median under three times it, with both scaled for a busy machine. */
export function expectWithinBudget({ best, median, load }: Timing, budget = BUDGET_MS): void {
  expect(best).toBeLessThan(budget * load);
  expect(median).toBeLessThan(budget * load * LOAD_ALLOWANCE);
}

/** A ceiling for work that runs once at page open: the best run must be under it, scaled for a busy machine. */
export function expectBelow({ best, load }: Timing, ceilingMs: number): void {
  expect(best).toBeLessThan(ceilingMs * load);
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
