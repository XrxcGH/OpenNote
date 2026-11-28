// How the long-table perf spec (sheet-tables.perf.spec.ts) turns its samples into one result per budget. Plain
// functions, so a Node test checks them: npm run test:ui-perf.
//
// A fixed benchmark tells how fast the machine is. One sample taken at the start of a test told the speed of one
// moment, and the runner's load changes from second to second. So the benchmark runs again before each measured
// open and after each scroll pass, and the test uses the median of those samples. The open is timed five times and
// the scroll three times, and the medians hold the budgets.

/** The fixed benchmark's time on the reference laptop (a Surface Laptop Studio 2), in ms (tree.perf.spec.ts). */
export const REFERENCE_BENCHMARK_MS = 60;
/** A 10,000-row table paints within this many ms of opening its page, on the laptop. */
export const FIRST_PAINT_MS = 250;
/**
 * The first paint is not all script: loading the table's code, layout, and the compositor do not slow in step with the
 * calibration benchmark. On a runner several times slower than the laptop, the budget gets this much extra room.
 */
export const SLOW_RUNNER_PAINT_ALLOWANCE = 1.25;
/** The scroll frames' budget, in ms, at the 99th percentile. */
export const FRAME_MS = 8;
/** No scroll frame may take more than this, in ms, in the median pass. */
export const WORST_FRAME_MS = 2 * FRAME_MS;
/** How many times the test scrolls 240 frames down the table. */
export const SCROLL_PASSES = 3;

/** The middle value, or the mean of the middle two. */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median of no values');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The CPU throttling that makes a machine as slow as the laptop, from one benchmark time in ms. Never below 1. */
export function throttleRate(benchmarkMs: number): number {
  return Math.max(1, REFERENCE_BENCHMARK_MS / Math.max(1, benchmarkMs));
}

/** How many times slower than the laptop this machine ran, from the benchmark samples of one test. Never below 1. */
export function scaleOf(benchmarks: readonly number[]): number {
  return Math.max(1, median(benchmarks) / REFERENCE_BENCHMARK_MS);
}

/** The first paint's budget at `scale`, in ms. */
export function paintBudget(scale: number): number {
  return FIRST_PAINT_MS * scale * (scale > 1.5 ? SLOW_RUNNER_PAINT_ALLOWANCE : 1);
}

/** The rank-based percentile `p` of `values`, as the typing benchmark reads it. */
function percentileOf(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

/**
 * The scroll frames' result from several passes of frame times, in ms: the median of the passes' 99th percentiles,
 * and the median of their worst frames. One stray frame in one pass, such as a garbage collection, does not decide it.
 */
export function frameResult(passes: readonly (readonly number[])[]): { p99: number; worst: number } {
  return {
    p99: median(passes.map((frames) => percentileOf(frames, 99))),
    worst: median(passes.map((frames) => Math.max(...frames))),
  };
}
