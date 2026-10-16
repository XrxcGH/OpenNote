// Property tests for the geometric operations: each states what must hold for any input, so a counterexample is a
// bug in the operation and not in a chosen example. Example tests sit beside each module.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { boundsOf, containsBounds, containsPoint, grow, intersects, transformBounds, union } from './bounds';
import { lineStroke, seededRandom } from './fixtures';
import { lassoSelect, rectanglePath } from './lasso';
import {
  applyToPoint,
  compose,
  determinant,
  IDENTITY,
  invert,
  rotation,
  scaling,
  translation,
  widthScale,
} from './matrix';
import { applyPressureTable, buildPressureTable, mapPressure, TABLE_SIZE } from './pressure';
import type { PressureCurveKind } from './pressure';
import { distance, pointInPolygon, polylineLength, pointSegmentDistanceSq } from './primitives';
import { snapAngle, snapSegment } from './shapes';
import { densify, resample, simplify } from './simplify';
import { createStabilizer, stabilize } from './stabilizer';
import { createStrokeIndex, pagePoints } from './strokeIndex';
import { bakeTransform, boxToBox, moveStrokes, scaleStrokes, selectionBounds } from './transform';
import type { Bounds, InkPoint, Matrix, Stroke, Vec } from './types';

const num = (range = 500) => fc.double({ min: -range, max: range, noNaN: true });
const vec = (range = 500) => fc.record({ x: num(range), y: num(range) });
const vecs = (min = 1, max = 40) => fc.array(vec(), { minLength: min, maxLength: max });
const matrix = fc
  .tuple(num(3), num(3), num(3), num(3), num(300), num(300))
  .filter(([a, b, c, d]) => Math.abs(a * d - b * c) > 0.05) as fc.Arbitrary<Matrix>;
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * (1 + Math.abs(a) + Math.abs(b));

describe('matrices', () => {
  it('compose applies the inner matrix first', () => {
    fc.assert(
      fc.property(matrix, matrix, vec(), (a, b, p) => {
        const direct = applyToPoint(a, applyToPoint(b, p));
        const joined = applyToPoint(compose(a, b), p);
        expect(near(direct.x, joined.x)).toBe(true);
        expect(near(direct.y, joined.y)).toBe(true);
      }),
    );
  });

  it('an inverse undoes the matrix', () => {
    fc.assert(
      fc.property(matrix, vec(), (m, p) => {
        const back = applyToPoint(invert(m)!, applyToPoint(m, p));
        expect(near(back.x, p.x, 1e-5)).toBe(true);
        expect(near(back.y, p.y, 1e-5)).toBe(true);
      }),
    );
  });

  it('multiplies determinants, and scales width by the root of the determinant', () => {
    fc.assert(
      fc.property(matrix, matrix, (a, b) => {
        expect(near(determinant(compose(a, b)), determinant(a) * determinant(b), 1e-6)).toBe(true);
        expect(near(widthScale(a), Math.sqrt(Math.abs(determinant(a))))).toBe(true);
      }),
    );
  });

  it('keeps distances under a rotation and a move, and scales them under scaling', () => {
    fc.assert(
      fc.property(vec(), vec(), num(7), vec(), num(4), (p, q, angle, shift, factor) => {
        const rigid = compose(translation(shift.x, shift.y), rotation(angle));
        expect(near(distance(applyToPoint(rigid, p), applyToPoint(rigid, q)), distance(p, q), 1e-6)).toBe(true);
        const grown = scaling(factor || 1, factor || 1);
        expect(
          near(distance(applyToPoint(grown, p), applyToPoint(grown, q)), Math.abs(factor || 1) * distance(p, q)),
        ).toBe(true);
      }),
    );
  });

  it('has an identity', () => {
    fc.assert(
      fc.property(vec(), (p) => {
        const q = applyToPoint(IDENTITY, p);
        expect(near(q.x, p.x) && near(q.y, p.y)).toBe(true);
      }),
    );
  });
});

describe('boxes', () => {
  it('a box of points holds every point, and a union holds both boxes', () => {
    fc.assert(
      fc.property(vecs(), vecs(), (a, b) => {
        const [boxA, boxB] = [boundsOf(a), boundsOf(b)];
        for (const p of a) expect(containsPoint(boxA, p)).toBe(true);
        const both = union(boxA, boxB);
        expect(containsBounds(both, boxA) && containsBounds(both, boxB)).toBe(true);
        expect(intersects(boxA, boxB)).toBe(intersects(boxB, boxA));
      }),
    );
  });

  it('a transformed box holds the transformed points, and growing only adds room', () => {
    fc.assert(
      fc.property(vecs(), matrix, fc.double({ min: 0, max: 50, noNaN: true }), (points, m, by) => {
        const placed = transformBounds(boundsOf(points), m);
        for (const p of points) {
          const q = applyToPoint(m, p);
          expect(q.x).toBeGreaterThanOrEqual(placed.minX - 1e-6);
          expect(q.y).toBeLessThanOrEqual(placed.maxY + 1e-6);
        }
        expect(containsBounds(grow(placed, by), placed)).toBe(true);
      }),
    );
  });
});

const stroke = (id: string, points: Vec[]): Stroke => ({ id, tool: 'pen', width: 2, startTime: 0, points });

describe('moving, scaling, and baking strokes', () => {
  it('a move shifts the page points and the selection box by the same amount', () => {
    fc.assert(
      fc.property(vecs(2), num(300), num(300), (points, dx, dy) => {
        const original = stroke('a', points);
        const [moved] = moveStrokes([original], dx, dy);
        const [before, after] = [pagePoints(original), pagePoints(moved)];
        before.forEach((p, i) => expect(near(after[i].x, p.x + dx) && near(after[i].y, p.y + dy)).toBe(true));
        const [boxA, boxB] = [selectionBounds([original])!, selectionBounds([moved])!];
        expect(near(boxB.minX, boxA.minX + dx) && near(boxB.maxY, boxA.maxY + dy)).toBe(true);
      }),
    );
  });

  it('scaling about a point leaves that point where it is', () => {
    fc.assert(
      fc.property(vecs(2), vec(), fc.double({ min: 0.2, max: 4, noNaN: true }), (points, about, factor) => {
        const [scaled] = scaleStrokes([stroke('a', points)], factor, factor, about);
        const fixed = applyToPoint(scaled.transform!, about);
        expect(near(fixed.x, about.x) && near(fixed.y, about.y)).toBe(true);
      }),
    );
  });

  it('baking a transform changes no page point and drops the transform', () => {
    fc.assert(
      fc.property(vecs(2), matrix, (points, m) => {
        const moved = { ...stroke('a', points), transform: m };
        const baked = bakeTransform(moved);
        expect(baked.transform).toBeUndefined();
        pagePoints(moved).forEach((p, i) =>
          expect(near(baked.points[i].x, p.x) && near(baked.points[i].y, p.y)).toBe(true),
        );
      }),
    );
  });

  it('a box-to-box matrix carries the corners of one box to the corners of the other', () => {
    const box = fc
      .record({
        x: num(200),
        y: num(200),
        w: fc.double({ min: 1, max: 300, noNaN: true }),
        h: fc.double({ min: 1, max: 300, noNaN: true }),
      })
      .map((r): Bounds => ({ minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h }));
    fc.assert(
      fc.property(box, box, (from, to) => {
        const m = boxToBox(from, to)!;
        const [a, b] = [
          applyToPoint(m, { x: from.minX, y: from.minY }),
          applyToPoint(m, { x: from.maxX, y: from.maxY }),
        ];
        expect(near(a.x, to.minX) && near(a.y, to.minY) && near(b.x, to.maxX) && near(b.y, to.maxY)).toBe(true);
      }),
    );
  });
});

/** The distance from a point to the nearest part of a polyline. */
function distanceToPath(p: Vec, line: readonly Vec[]): number {
  if (line.length === 1) return distance(p, line[0]);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, pointSegmentDistanceSq(p, line[i - 1], line[i]));
  return Math.sqrt(best);
}

describe('simplifying and resampling paths', () => {
  it('simplify keeps the ends and every dropped point within the tolerance', () => {
    fc.assert(
      fc.property(vecs(), fc.double({ min: 0.1, max: 20, noNaN: true }), (points, tolerance) => {
        const thin = simplify(points, tolerance);
        expect(thin[0]).toBe(points[0]);
        expect(thin[thin.length - 1]).toBe(points[points.length - 1]);
        for (const p of points) expect(distanceToPath(p, thin)).toBeLessThanOrEqual(tolerance + 1e-6);
      }),
    );
  });

  it('densify keeps every original point and leaves no gap above the step', () => {
    fc.assert(
      fc.property(vecs(1, 15), fc.double({ min: 1, max: 100, noNaN: true }), (points, step) => {
        const dense = densify(points, step);
        for (const p of points) expect(dense).toContain(p);
        dense.slice(1).forEach((p, i) => expect(distance(dense[i], p)).toBeLessThanOrEqual(step + 1e-6));
        expect(near(polylineLength(dense), polylineLength(points), 1e-6)).toBe(true);
      }),
    );
  });

  it('resample returns the asked count with the ends of a path that has length', () => {
    fc.assert(
      fc.property(vecs(2, 20), fc.integer({ min: 2, max: 50 }), (points, count) => {
        fc.pre(polylineLength(points) > 1e-6);
        const out = resample(points, count);
        expect(out).toHaveLength(count);
        expect(near(out[0].x, points[0].x) && near(out[0].y, points[0].y)).toBe(true);
        const last = points[points.length - 1];
        expect(distance(out[count - 1], last)).toBeLessThan(1e-6 * (1 + polylineLength(points)));
      }),
    );
  });
});

describe('pressure curves', () => {
  const kinds: PressureCurveKind[] = ['soft', 'normal', 'firm'];

  it('never go down, start at the minimum, and end at full pressure', () => {
    fc.assert(
      fc.property(fc.constantFrom(...kinds), fc.double({ min: 0, max: 0.6, noNaN: true }), (curve, minimum) => {
        const table = buildPressureTable({ curve, minimum });
        expect(table).toHaveLength(TABLE_SIZE);
        expect(near(table[0], minimum, 1e-6)).toBe(true);
        expect(table[TABLE_SIZE - 1]).toBeCloseTo(1, 6);
        for (let i = 1; i < TABLE_SIZE; i++) expect(table[i]).toBeGreaterThanOrEqual(table[i - 1] - 1e-6);
      }),
      { numRuns: 30 },
    );
  });

  it('map any pressure into the range from the minimum to 1, in order', () => {
    const table = buildPressureTable({ curve: 'soft', minimum: 0.2 });
    fc.assert(
      fc.property(num(2), num(2), (a, b) => {
        const [low, high] = a < b ? [a, b] : [b, a];
        expect(mapPressure(table, low)).toBeLessThanOrEqual(mapPressure(table, high) + 1e-9);
        expect(mapPressure(table, a)).toBeGreaterThanOrEqual(0.2 - 1e-6);
        expect(mapPressure(table, a)).toBeLessThanOrEqual(1 + 1e-6);
      }),
    );
  });

  it('leave points without pressure as they are', () => {
    const table = buildPressureTable({ curve: 'firm' });
    const points: InkPoint[] = [
      { x: 1, y: 2 },
      { x: 3, y: 4, pressure: 0.5 },
    ];
    const out = applyPressureTable(points, table);
    expect(out[0]).toBe(points[0]);
    expect(out[1].pressure).not.toBe(0.5);
  });
});

describe('snapping angles', () => {
  const deg = Math.PI / 180;

  it('either leaves an angle alone or moves it at most 6 degrees onto a multiple of 15', () => {
    fc.assert(
      fc.property(num(7), (radians) => {
        const snapped = snapAngle(radians);
        if (snapped === radians) return;
        expect(Math.abs(snapped - radians)).toBeLessThanOrEqual(6 * deg + 1e-9);
        expect(near(snapped / deg / 15, Math.round(snapped / deg / 15), 1e-9)).toBe(true);
      }),
    );
  });

  it('is steady: snapping a snapped angle changes nothing', () => {
    fc.assert(
      fc.property(num(7), (radians) => {
        expect(near(snapAngle(snapAngle(radians)), snapAngle(radians), 1e-9)).toBe(true);
      }),
    );
  });

  it('turns a segment about its midpoint and keeps its length', () => {
    fc.assert(
      fc.property(vec(), vec(), (from, to) => {
        fc.pre(distance(from, to) > 1e-3);
        const [a, b] = snapSegment(from, to);
        expect(near(distance(a, b), distance(from, to), 1e-6)).toBe(true);
        expect(near((a.x + b.x) / 2, (from.x + to.x) / 2, 1e-6)).toBe(true);
      }),
    );
  });
});

describe('the steady pen', () => {
  const noisy = (seed: number, n: number): InkPoint[] => {
    const random = seededRandom(seed);
    return Array.from({ length: n }, (_, i) => ({ x: i * 3, y: (random() - 0.5) * 6, time: i * 8 }));
  };

  it('starts at the first sample, ends at the last, and gives the same ink for the same samples', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 1, max: 10 }), (seed, strength) => {
        const samples = noisy(seed, 60);
        const options = { strength, zoom: 1 };
        const a = stabilize(samples, options);
        expect(a[0].x).toBe(samples[0].x);
        expect(a[a.length - 1]).toMatchObject({ x: samples[59].x, y: samples[59].y });
        expect(stabilize(samples, options)).toEqual(a);
      }),
      { numRuns: 30 },
    );
  });

  it('smooths more as the strength grows', () => {
    const roughness = (points: readonly Vec[]) =>
      points.slice(1).reduce((s, p, i) => s + Math.abs(p.y - points[i].y), 0);
    const samples = noisy(7, 120);
    const [soft, firm] = [stabilize(samples, { strength: 2, zoom: 1 }), stabilize(samples, { strength: 9, zoom: 1 })];
    expect(roughness(firm)).toBeLessThan(roughness(soft));
    expect(roughness(soft)).toBeLessThan(roughness(samples));
  });

  it('feeds one sample at a time to the same result', () => {
    const samples = noisy(3, 40);
    const stabilizer = createStabilizer({ strength: 5, zoom: 2 });
    const live = samples.map((p) => stabilizer.push(p));
    expect(live).toEqual(stabilize(samples, { strength: 5, zoom: 2 }).slice(0, live.length));
  });
});

describe('the lasso', () => {
  const inside = (box: Bounds, p: Vec) => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;

  it('nests its modes: all within mostly within any', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9999 }), vecs(3, 8), (seed, path) => {
        const random = seededRandom(seed);
        const index = createStrokeIndex(
          Array.from({ length: 25 }, (_, i) =>
            lineStroke(
              `s${i}`,
              { x: random() * 600 - 300, y: random() * 600 - 300 },
              { x: random() * 600 - 300, y: random() * 600 - 300 },
              15,
            ),
          ),
        );
        const [all, mostly, any] = (['all', 'mostly', 'any'] as const).map(
          (mode) => new Set(lassoSelect(index, path, { mode })),
        );
        for (const id of all) expect(mostly.has(id)).toBe(true);
        for (const id of mostly) expect(any.has(id)).toBe(true);
      }),
      { numRuns: 40 },
    );
  });

  it('takes a stroke wholly inside a rectangle in every mode, and leaves a stroke wholly outside', () => {
    const box: Bounds = { minX: -100, minY: -100, maxX: 100, maxY: 100 };
    const path = rectanglePath({ x: box.minX, y: box.minY }, { x: box.maxX, y: box.maxY });
    fc.assert(
      fc.property(vec(400), vec(400), (a, b) => {
        const s = lineStroke('s', a, b, 12);
        const index = createStrokeIndex([s]);
        const points = pagePoints(s);
        const wholly = points.every((p) => inside({ ...box, minX: -99, minY: -99, maxX: 99, maxY: 99 }, p));
        const clear = points.every((p) => !inside(grow(box, 5), p)) && !crosses(a, b, grow(box, 5));
        for (const mode of ['all', 'mostly', 'any'] as const) {
          const picked = lassoSelect(index, path, { mode }).length === 1;
          if (wholly) expect(picked).toBe(true);
          if (clear) expect(picked).toBe(false);
        }
      }),
      { numRuns: 120 },
    );
  });

  it('agrees with a point test on a simple polygon for a single point', () => {
    const star = fc
      .array(
        fc.record({
          angle: fc.double({ min: 0, max: 6.28, noNaN: true }),
          radius: fc.double({ min: 20, max: 200, noNaN: true }),
        }),
        {
          minLength: 4,
          maxLength: 10,
        },
      )
      .map((list) =>
        [...list]
          .sort((p, q) => p.angle - q.angle)
          .map((s) => ({ x: Math.cos(s.angle) * s.radius, y: Math.sin(s.angle) * s.radius })),
      );
    fc.assert(
      fc.property(star, vec(250), (polygon, p) => {
        const index = createStrokeIndex([lineStroke('dot', p, p, 1)]);
        const picked = lassoSelect(index, polygon, { mode: 'any', pixel: 0.001 }).length === 1;
        fc.pre(distanceToPath(p, [...polygon, polygon[0]]) > 0.5);
        expect(picked).toBe(pointInPolygon(p, polygon));
      }),
      { numRuns: 100 },
    );
  });
});

/** True when the segment from a to b meets the box, by testing the segment against the four sides. */
function crosses(a: Vec, b: Vec, box: Bounds): boolean {
  const corners = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
  return corners.some((c, i) => {
    const d = corners[(i + 1) % 4];
    return segmentsMeet(a, b, c, d);
  });
}

function segmentsMeet(p1: Vec, p2: Vec, p3: Vec, p4: Vec): boolean {
  const orient = (a: Vec, b: Vec, c: Vec) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return orient(p1, p2, p3) !== orient(p1, p2, p4) && orient(p3, p4, p1) !== orient(p3, p4, p2);
}
