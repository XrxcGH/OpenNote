// The 10,000-stroke budget (DEVELOPMENT.md phase 5): hit testing and the lasso each finish in under 10 ms.
// The timing helpers in ../bench.ts run each operation many times and judge it by its best run.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectBelow, expectWithinBudget, flushResults, measure, record } from '../bench';
import { capsulesAlong, eraseStrokes } from './erase';
import { generatePage } from './fixtures';
import { hitCapsules, hitPoint } from './hitTest';
import { lassoSelect, rectanglePath } from './lasso';
import { partialErase } from './partialErase';
import { createStrokeIndex } from './strokeIndex';
import type { StrokeIndex } from './strokeIndex';

const STROKES = 10_000;
const NOTE = '10,000 strokes of 80 points';

afterAll(() => flushResults('geometry'));

describe(`a page of ${STROKES} strokes`, () => {
  const { width, height, strokes } = generatePage(STROKES, 42);
  let index: StrokeIndex;

  beforeAll(() => {
    index = createStrokeIndex(strokes);
  });

  it('holds every stroke', () => {
    expect(index.size).toBe(STROKES);
  });

  it('builds the index from the strokes', () => {
    const timing = record(
      'Build the stroke index',
      measure(() => createStrokeIndex(strokes), 5, 1),
      NOTE,
    );
    expectBelow(timing, 500);
  });

  it('answers a point hit under the budget', () => {
    const took = measure((i) => hitPoint(index, { x: (i * 157) % width, y: (i * 911) % height }, 4));
    expectWithinBudget(record('Point hit', took, NOTE));
  });

  it('answers an eraser sweep of capsules under the budget', () => {
    const took = measure((i) => {
      const from = { x: (i * 131) % width, y: (i * 719) % height };
      const samples = [
        from,
        { x: from.x + 12, y: from.y + 4 },
        { x: from.x + 20, y: from.y + 14 },
        { x: from.x + 26, y: from.y + 30 },
      ];
      const path = capsulesAlong(samples, 12);
      hitCapsules(index, path);
      eraseStrokes(index, path);
    });
    expectWithinBudget(record('Stroke eraser sweep', took, `${NOTE}, 12 unit radius`));
  });

  it('cuts strokes with the partial eraser under the budget', () => {
    let next = 0;
    const took = measure((i) => {
      const at = { x: (i * 131) % width, y: (i * 719) % height };
      partialErase(index, capsulesAlong([at, { x: at.x + 30, y: at.y + 10 }], 8), () => `cut${next++}`);
    });
    expectWithinBudget(record('Partial eraser sweep', took, `${NOTE}, 8 unit radius`));
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
    expectWithinBudget(record('Lasso over a wide area', took, `${NOTE}, 2,400 by 1,600 units`));
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
    expectWithinBudget(record('Lasso as a curved loop', took, `${NOTE}, ${selected.length} selected`));
    expect(selected.length).toBeGreaterThan(100);
  });
});
