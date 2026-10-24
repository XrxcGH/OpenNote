import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { capsulesAlong, eraseStrokes } from './erase';
import { lineStroke, makeStroke } from './fixtures';
import { partialErase, splitStroke } from './partialErase';
import { pointSegmentDistanceSq, segmentCapsuleInterval } from './primitives';
import { createStrokeIndex, pagePoints } from './strokeIndex';
import { moveStrokes } from './transform';
import type { Capsule, Vec } from './types';

const circle = (x: number, y: number, radius: number): Capsule => ({ from: { x, y }, to: { x, y }, radius });
let counter = 0;
const newId = () => `new${++counter}`;

describe('the stroke eraser', () => {
  const index = createStrokeIndex([
    lineStroke('top', { x: 0, y: 0 }, { x: 100, y: 0 }),
    lineStroke('middle', { x: 0, y: 30 }, { x: 100, y: 30 }),
    lineStroke('locked', { x: 0, y: 60 }, { x: 100, y: 60 }),
  ]);

  it('removes each stroke the swept circle touches, and only those', () => {
    const path = capsulesAlong(
      [
        { x: 50, y: -10 },
        { x: 50, y: 35 },
      ],
      3,
    );
    expect(eraseStrokes(index, path).sort()).toEqual(['middle', 'top']);
    expect(eraseStrokes(index, [circle(50, 45, 3)])).toEqual([]);
  });

  it('touches ink by its width, so the edge of a thick stroke counts', () => {
    const fat = createStrokeIndex([lineStroke('fat', { x: 0, y: 0 }, { x: 100, y: 0 }, 10, { width: 12 })]);
    expect(eraseStrokes(fat, [circle(50, 7, 2)])).toEqual(['fat']);
    expect(eraseStrokes(fat, [circle(50, 9, 2)])).toEqual([]);
  });

  it('skips strokes the caller excludes', () => {
    const erased = eraseStrokes(index, [circle(50, 60, 5)], { skip: (s) => s.id === 'locked' });
    expect(erased).toEqual([]);
  });

  it('turns a lone sample into one circle', () => {
    expect(capsulesAlong([{ x: 1, y: 2 }], 4)).toEqual([circle(1, 2, 4)]);
  });
});

describe('where a segment meets a capsule', () => {
  it('finds one interval for a segment crossing the body, and none for a miss', () => {
    const cap: Capsule = { from: { x: 0, y: 0 }, to: { x: 20, y: 0 }, radius: 2 };
    expect(segmentCapsuleInterval({ x: 10, y: -10 }, { x: 10, y: 10 }, cap)).toEqual([0.4, 0.6]);
    expect(segmentCapsuleInterval({ x: 10, y: 5 }, { x: 30, y: 5 }, cap)).toBeNull();
  });

  it('runs through the rounded ends', () => {
    const cap: Capsule = { from: { x: 0, y: 0 }, to: { x: 20, y: 0 }, radius: 2 };
    const [start, end] = segmentCapsuleInterval({ x: -10, y: 0 }, { x: 30, y: 0 }, cap)!;
    expect(-10 + start * 40).toBeCloseTo(-2, 9);
    expect(-10 + end * 40).toBeCloseTo(22, 9);
  });
});

const straight = lineStroke('a', { x: 0, y: 0 }, { x: 100, y: 0 }, 10, { startTime: 5_000 });

describe('the partial eraser', () => {
  it('cuts a stroke in two with an interpolated point at each cut', () => {
    const [left, right] = splitStroke(straight, [circle(52, 0, 6)], newId)!;
    expect(left.points.at(-1)).toMatchObject({ x: 46, y: 0, pressure: 0.5 });
    expect(left.points.at(-1)!.time).toBeCloseTo(46, 6);
    expect(right.points[0]).toMatchObject({ x: 58, y: 0 });
    expect(left.origin).toBe('a');
    expect(right.origin).toBe('a');
    expect(left.id).not.toBe(right.id);
  });

  it('rebases the later slice so its first point starts at time zero', () => {
    const [left, right] = splitStroke(straight, [circle(52, 0, 6)], newId)!;
    expect(left.startTime).toBe(5_000);
    expect(right.startTime).toBeCloseTo(5_000 + 58, 6);
    expect(right.points[0].time).toBeCloseTo(0, 9);
    expect(right.points.at(-1)!.time).toBeCloseTo(100 - 58, 6);
  });

  it('keeps one slice when the eraser takes an end, and none when it takes everything', () => {
    expect(splitStroke(straight, [circle(0, 0, 10)], newId)).toHaveLength(1);
    expect(splitStroke(straight, [circle(50, 0, 80)], newId)).toEqual([]);
    expect(splitStroke(straight, [circle(50, 30, 5)], newId)).toBeNull();
  });

  it('cuts a stroke in several places along a sweeping path', () => {
    const sweep = capsulesAlong(
      [
        { x: 20, y: 0 },
        { x: 20, y: 3 },
        { x: 60, y: 3 },
        { x: 60, y: 0 },
      ],
      2,
    );
    expect(splitStroke(straight, sweep, newId)).toHaveLength(3);
  });
});

describe('the partial eraser on special cases', () => {
  it('drops slices too short to see', () => {
    const parts = splitStroke(straight, [circle(50, 0, 49.7)], newId)!;
    expect(parts).toEqual([]);
  });

  it('cuts a moved stroke where it is on the page and keeps its transform', () => {
    const [moved] = moveStrokes([straight], 10, 20);
    const parts = splitStroke(moved, [circle(60, 20, 5)], newId)!;
    expect(parts).toHaveLength(2);
    expect(parts[0].transform).toEqual(moved.transform);
    expect(pagePoints(parts[0]).at(-1)!.x).toBeCloseTo(55, 9);
    expect(parts[0].points.at(-1)!.x).toBeCloseTo(45, 9);
  });

  it('wipes out a dot that the eraser covers, and leaves it otherwise', () => {
    const dot = makeStroke('dot', [{ x: 5, y: 5 }]);
    expect(splitStroke(dot, [circle(6, 5, 3)], newId)).toEqual([]);
    expect(splitStroke(dot, [circle(20, 5, 3)], newId)).toBeNull();
  });

  it('reports what to remove and what to add across a page', () => {
    const index = createStrokeIndex([straight, lineStroke('far', { x: 0, y: 200 }, { x: 100, y: 200 })]);
    const result = partialErase(index, [circle(50, 0, 4)], newId);
    expect(result.removed).toEqual(['a']);
    expect(result.added).toHaveLength(2);
  });
});

describe('the partial eraser guarantee', () => {
  const coordinate = fc.double({ min: 0, max: 200, noNaN: true });
  const point = fc.record({ x: coordinate, y: coordinate });
  const capsule = fc.record({ from: point, to: point, radius: fc.double({ min: 1, max: 30, noNaN: true }) });

  it('leaves no vertex or segment midpoint of a slice inside the eraser', () => {
    fc.assert(
      fc.property(
        fc.array(point, { minLength: 2, maxLength: 30 }),
        fc.array(capsule, { minLength: 1, maxLength: 4 }),
        (points, capsules) => {
          const parts = splitStroke(makeStroke('p', points), capsules, newId) ?? [];
          for (const probe of parts.flatMap((part) => probesOf(part.points))) expectClearOf(capsules, probe);
        },
      ),
      { numRuns: 300 },
    );
  });
});

/** Every vertex of a polyline and the midpoint of each segment. */
function probesOf(points: readonly Vec[]): Vec[] {
  const mids = points.slice(1).map((p, i) => ({ x: (p.x + points[i].x) / 2, y: (p.y + points[i].y) / 2 }));
  return [...points, ...mids];
}

function expectClearOf(capsules: readonly Capsule[], probe: Vec): void {
  for (const c of capsules) {
    const d = Math.sqrt(pointSegmentDistanceSq(probe, c.from, c.to));
    expect(d).toBeGreaterThanOrEqual(c.radius - 1e-6);
  }
}
