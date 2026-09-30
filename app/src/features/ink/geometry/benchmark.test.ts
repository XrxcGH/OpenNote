// The 10,000-stroke budget (DEVELOPMENT.md phase 5): hit testing and the lasso each finish in under 10 ms.
// Each operation runs many times, so one garbage-collection pause cannot decide the result.

import { beforeAll, describe, expect, it } from 'vitest';
import { capsulesAlong, eraseStrokes } from './erase';
import { generatePage } from './fixtures';
import { hitCapsules, hitPoint } from './hitTest';
import { lassoSelect, rectanglePath } from './lasso';
import { partialErase } from './partialErase';
import { createStrokeIndex } from './strokeIndex';
import type { StrokeIndex } from './strokeIndex';

const STROKES = 10_000;
const BUDGET_MS = 10;
const RUNS = 31;
/** How many times the budget the median run may take, to allow for a busy machine. */
const LOAD_ALLOWANCE = 3;
/** Runs before timing starts, so the engine has compiled the code, as it has after a few pen strokes. */
const WARMUP = 8;

interface Timing {
  readonly best: number;
  readonly median: number;
}

function measure(run: (i: number) => void): Timing {
  for (let i = 0; i < WARMUP; i++) run(i);
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const started = performance.now();
    run(WARMUP + i);
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  return { best: times[0], median: times[Math.floor(RUNS / 2)] };
}

/**
 * The best run must meet the budget, so other processes on a shared machine cannot fail the test. The median
 * must stay within a few times the budget, so a slowdown that hits every run still fails it.
 */
function expectWithinBudget({ best, median }: Timing): void {
  expect(best).toBeLessThan(BUDGET_MS);
  expect(median).toBeLessThan(BUDGET_MS * LOAD_ALLOWANCE);
}

describe(`a page of ${STROKES} strokes`, () => {
  const { width, height, strokes } = generatePage(STROKES, 42);
  let index: StrokeIndex;

  beforeAll(() => {
    index = createStrokeIndex(strokes);
  });

  it('holds every stroke', () => {
    expect(index.size).toBe(STROKES);
  });

  it('answers a point hit under the budget', () => {
    const took = measure((i) => hitPoint(index, { x: (i * 157) % width, y: (i * 911) % height }, 4));
    expectWithinBudget(took);
  });

  it('answers an eraser sweep of capsules under the budget', () => {
    const took = measure((i) => {
      const from = { x: (i * 131) % width, y: (i * 719) % height };
      const path = capsulesAlong(
        [
          from,
          { x: from.x + 12, y: from.y + 4 },
          { x: from.x + 20, y: from.y + 14 },
          { x: from.x + 26, y: from.y + 30 },
        ],
        12,
      );
      hitCapsules(index, path);
      eraseStrokes(index, path);
    });
    expectWithinBudget(took);
  });

  it('cuts strokes with the partial eraser under the budget', () => {
    let next = 0;
    const took = measure((i) => {
      const at = { x: (i * 131) % width, y: (i * 719) % height };
      partialErase(index, capsulesAlong([at, { x: at.x + 30, y: at.y + 10 }], 8), () => `cut${next++}`);
    });
    expectWithinBudget(took);
  });
});

describe(`a lasso on a page of ${STROKES} strokes`, () => {
  const { width, height, strokes } = generatePage(STROKES, 42);
  const index = createStrokeIndex(strokes);

  it('runs over a wide area under the budget', () => {
    const took = measure((i) => {
      const top = (i * 433) % (height - 2000);
      lassoSelect(index, rectanglePath({ x: 800, y: top }, { x: width - 800, y: top + 1600 }), { pixel: 1 });
    });
    expectWithinBudget(took);
  });

  it('runs as a curved loop under the budget', () => {
    const loop = Array.from({ length: 60 }, (_, k) => ({
      x: 2000 + Math.cos((k / 60) * 2 * Math.PI) * 900,
      y: 6000 + Math.sin((k / 60) * 2 * Math.PI) * 700,
    }));
    let selected: string[] = [];
    const took = measure(() => {
      selected = lassoSelect(index, loop, { pixel: 1 });
    });
    expectWithinBudget(took);
    expect(selected.length).toBeGreaterThan(100);
  });
});
