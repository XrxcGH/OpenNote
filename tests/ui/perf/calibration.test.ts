// Plain Node tests of the long-table perf spec's statistics. Run with: npm run test:ui-perf

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FIRST_PAINT_MS,
  FRAME_MS,
  REFERENCE_BENCHMARK_MS,
  SCROLL_PASSES,
  SLOW_RUNNER_PAINT_ALLOWANCE,
  WORST_FRAME_MS,
  frameResult,
  median,
  paintBudget,
  scaleOf,
  throttleRate,
} from './calibration.ts';

describe('the median', () => {
  it('is the middle value of an odd count, in any order', () => {
    assert.equal(median([5, 1, 3]), 3);
  });

  it('is the mean of the middle two of an even count', () => {
    assert.equal(median([4, 1, 3, 2]), 2.5);
  });

  it('is not moved by one wild value', () => {
    assert.equal(median([600, 610, 620, 630, 5000]), 620);
  });

  it('refuses no values', () => {
    assert.throws(() => median([]));
  });
});

describe('the scale', () => {
  it('is 1 on the laptop, and never below 1 on a faster machine', () => {
    assert.equal(scaleOf([REFERENCE_BENCHMARK_MS]), 1);
    assert.equal(scaleOf([20, 30, 40]), 1);
  });

  it('is the median of the samples, not the first one', () => {
    // A CI runner: the first sample came in a quiet second, the rest under the load the opens met. The old test
    // took only the first, a scale of 1.8, and held the opens to a budget for a faster machine than they ran on.
    const samples = [108, 186, 192, 180, 198, 189];
    assert.equal(scaleOf(samples.slice(0, 1)), 1.8);
    assert.equal(scaleOf(samples), 187.5 / REFERENCE_BENCHMARK_MS);
  });

  it('throttles a faster machine to the laptop, and never speeds up a slower one', () => {
    assert.equal(throttleRate(30), 2);
    assert.equal(throttleRate(120), 1);
    assert.equal(throttleRate(0), REFERENCE_BENCHMARK_MS);
  });
});

describe('the first paint budget', () => {
  it('is 250 ms on the laptop, scaled on a slower machine, with room on a much slower one', () => {
    assert.equal(paintBudget(1), FIRST_PAINT_MS);
    assert.equal(paintBudget(1.5), FIRST_PAINT_MS * 1.5);
    assert.equal(paintBudget(3), FIRST_PAINT_MS * 3 * SLOW_RUNNER_PAINT_ALLOWANCE);
  });

  it('still fails a table that opens twice as slowly, at any scale', () => {
    // The opens of a run that meets the budget with the least room the allowance gives: at the budget itself.
    for (const scale of [1, 1.5, 2, 3, 5]) {
      const opens = [0.9, 0.95, 1, 0.97, 0.93].map((share) => share * paintBudget(scale));
      assert.ok(median(opens) <= paintBudget(scale));
      assert.ok(median(opens.map((ms) => 2 * ms)) > paintBudget(scale));
    }
  });
});

describe('the scroll frames', () => {
  // 240 frames of a pass that meets the budgets on the laptop: 237 of 5 ms and three of 7.5 ms.
  const pass = (slowest = 7.5) => [...Array.from({ length: 237 }, () => 5), 7.5, 7.5, slowest];

  it('are the median of the passes, so one stray frame in one pass does not decide them', () => {
    const { p99, worst } = frameResult([pass(), pass(40), pass()]);
    assert.equal(p99, 7.5);
    assert.equal(worst, 7.5);
  });

  it('fail a long frame that comes in most passes', () => {
    const { worst } = frameResult([pass(40), pass(40), pass()]);
    assert.ok(worst > WORST_FRAME_MS);
  });

  it('fail a scroll that runs twice as slowly', () => {
    const slow = (frames: number[]) => frames.map((ms) => 2 * ms);
    const { p99, worst } = frameResult([slow(pass()), slow(pass()), slow(pass())]);
    assert.ok(p99 > FRAME_MS);
    assert.equal(worst, 15);
    assert.equal(SCROLL_PASSES, 3);
  });
});
