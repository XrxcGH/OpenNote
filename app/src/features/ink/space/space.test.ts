import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { strokeBounds } from '../geometry/bounds';
import { generatePage, lineStroke } from '../geometry/fixtures';
import { createStrokeIndex } from '../geometry/strokeIndex';
import { transformStrokes } from '../geometry/transform';
import { planInsertSpace, spaceAmount } from './insertSpace';

const page = () =>
  createStrokeIndex([
    lineStroke('above', { x: 0, y: 10 }, { x: 100, y: 10 }),
    lineStroke('crossing', { x: 50, y: 80 }, { x: 50, y: 140 }),
    lineStroke('near', { x: 0, y: 150 }, { x: 100, y: 150 }),
    lineStroke('far', { x: 0, y: 400 }, { x: 100, y: 400 }),
    lineStroke('locked', { x: 0, y: 200 }, { x: 100, y: 200 }),
  ]);

describe('insert space', () => {
  it('pushes down what starts below the line, and leaves what crosses it', () => {
    const plan = planInsertSpace(page(), 100, 60);
    expect(plan.strokes.sort()).toEqual(['far', 'locked', 'near']);
    expect(plan.dy).toBe(60);
    expect(plan.matrix).toEqual([1, 0, 0, 1, 0, 60]);
  });

  it('leaves locked strokes and blocks in place and counts them', () => {
    const plan = planInsertSpace(page(), 100, 60, {
      locked: (s) => s.id === 'locked',
      blocks: [
        { id: 'box', top: 300 },
        { id: 'pinned', top: 320, locked: true },
        { id: 'high', top: 20 },
      ],
    });
    expect(plan.strokes.sort()).toEqual(['far', 'near']);
    expect(plan.blocks).toEqual(['box']);
    expect(plan.lockedStay).toBe(2);
  });

  it('closes a gap but never lifts content above the line', () => {
    const plan = planInsertSpace(page(), 100, -500);
    const top = Math.min(...plan.strokes.map((id) => strokeBounds(page().get(id)!).minY));
    expect(top + plan.dy).toBeCloseTo(100, 9);
    expect(plan.dy).toBeLessThan(0);
    expect(planInsertSpace(page(), 100, -10).dy).toBe(-10);
  });

  it('moves nothing when nothing is below the line', () => {
    const plan = planInsertSpace(page(), 1000, 50);
    expect(plan).toMatchObject({ strokes: [], blocks: [], dy: 0, lockedStay: 0 });
    expect(planInsertSpace(page(), 1000, -50).dy).toBe(0);
  });

  it('measures amounts in millimeters, inches, and lines of the ruling', () => {
    expect(spaceAmount(10, 'mm', 30)).toBeCloseTo(37.795, 3);
    expect(spaceAmount(1, 'in', 30)).toBe(96);
    expect(spaceAmount(2.5, 'lines', 30)).toBe(75);
    expect(spaceAmount(NaN, 'mm', 30)).toBe(0);
  });
});

describe('insert space under random pages', () => {
  const arbitrary = fc.record({
    seed: fc.integer({ min: 1, max: 5000 }),
    y: fc.integer({ min: 0, max: 12_000 }),
    dy: fc.integer({ min: -3000, max: 3000 }),
  });

  it('moves exactly the strokes below the line, keeps their order, and never crosses the line upward', () => {
    fc.assert(
      fc.property(arbitrary, ({ seed, y, dy }) => {
        const { strokes } = generatePage(120, seed);
        const index = createStrokeIndex(strokes);
        const plan = planInsertSpace(index, y, dy);
        const expected = strokes.filter((s) => strokeBounds(s).minY >= y).map((s) => s.id);
        expect(plan.strokes.sort()).toEqual(expected.sort());
        if (dy >= 0) expect(plan.dy).toBe(plan.strokes.length ? dy : 0);
        const moved = transformStrokes(
          plan.strokes.map((id) => index.get(id)!),
          plan.matrix,
        );
        for (const s of moved)
          expect(strokeBounds(s).minY).toBeGreaterThanOrEqual(Math.min(y, strokeBounds(index.get(s.id)!).minY) - 1e-6);
      }),
      { numRuns: 25 },
    );
  });

  it('is undone by the opposite drag when the first drag was downward', () => {
    fc.assert(
      fc.property(arbitrary, ({ seed, y, dy }) => {
        const { strokes } = generatePage(60, seed);
        const index = createStrokeIndex(strokes);
        const down = planInsertSpace(index, y, Math.abs(dy));
        const moved = transformStrokes(
          down.strokes.map((id) => index.get(id)!),
          down.matrix,
        );
        const after = createStrokeIndex([...strokes.filter((s) => !down.strokes.includes(s.id)), ...moved]);
        const up = planInsertSpace(after, y, -Math.abs(dy));
        expect(up.strokes.sort()).toEqual([...down.strokes].sort());
        expect(up.dy).toBeCloseTo(down.strokes.length ? -Math.abs(dy) : 0, 6);
      }),
      { numRuns: 20 },
    );
  });
});
