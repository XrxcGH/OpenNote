import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { boundsOf } from './bounds';
import { generatePage } from './fixtures';
import {
  detailLevel,
  lodTolerance,
  MIN_POLYLINE_PX,
  polylineWidth,
  pressureExtremes,
  simplifyStroke,
  smoothPath,
} from './lod';
import { pointSegmentDistanceSq, polylineLength } from './primitives';
import type { InkPoint, Vec } from './types';

const path = fc.array(
  fc.record({
    x: fc.double({ min: -200, max: 200, noNaN: true }),
    y: fc.double({ min: -200, max: 200, noNaN: true }),
    pressure: fc.double({ min: 0, max: 1, noNaN: true }),
  }),
  { minLength: 0, maxLength: 80 },
);

/** The distance from a point to the nearest part of a polyline. */
function distanceToPath(p: Vec, line: readonly Vec[]): number {
  if (line.length === 1) return Math.hypot(p.x - line[0].x, p.y - line[0].y);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, pointSegmentDistanceSq(p, line[i - 1], line[i]));
  return Math.sqrt(best);
}

describe('levels of detail', () => {
  it('draws exact outlines from a quarter device pixel per unit, and polylines below', () => {
    expect(detailLevel(0.25)).toBe('exact');
    expect(detailLevel(0.2499)).toBe('polyline');
    expect(detailLevel(8)).toBe('exact');
  });

  it('thins at a quarter of a device pixel, and keeps a hairline visible', () => {
    expect(lodTolerance(1)).toBe(0.25);
    expect(lodTolerance(0.25)).toBe(1);
    expect(polylineWidth(2, 0.1)).toBe(MIN_POLYLINE_PX);
    expect(polylineWidth(10, 0.1)).toBe(1);
  });
});

describe('thinning a stroke', () => {
  it('keeps the ends, never adds points, and keeps every dropped point near the result', () => {
    fc.assert(
      fc.property(path, fc.double({ min: 0.05, max: 5, noNaN: true }), (points, tolerance) => {
        const thin = simplifyStroke(points, tolerance);
        expect(thin.length).toBeLessThanOrEqual(points.length);
        if (points.length === 0) return;
        expect(thin[0]).toBe(points[0]);
        expect(thin[thin.length - 1]).toBe(points[points.length - 1]);
        for (const p of points) expect(distanceToPath(p, thin)).toBeLessThanOrEqual(tolerance + 1e-9);
      }),
      { numRuns: 100 },
    );
  });

  it('does not thin again what it already thinned', () => {
    fc.assert(
      fc.property(path, fc.double({ min: 0.05, max: 5, noNaN: true }), (points, tolerance) => {
        const once = simplifyStroke(points, tolerance);
        expect(simplifyStroke(once, tolerance)).toEqual(once);
      }),
      { numRuns: 60 },
    );
  });

  it('keeps the points where pressure peaks and dips', () => {
    const points: InkPoint[] = Array.from({ length: 41 }, (_, i) => ({
      x: i,
      y: 0,
      pressure: 0.5 + 0.4 * Math.sin((i / 40) * 4 * Math.PI),
    }));
    const extremes = pressureExtremes(points).map((i) => points[i]);
    expect(extremes.length).toBeGreaterThanOrEqual(3);
    const thin = simplifyStroke(points, 1);
    for (const e of extremes) expect(thin).toContain(e);
    expect(thin.length).toBeLessThan(points.length);
  });

  it('finds no pressure turns in a stroke without pressure or with a steady press', () => {
    expect(pressureExtremes(Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0 })))).toEqual([]);
    expect(
      pressureExtremes(Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0, pressure: 0.5 + (i % 2) * 0.01 }))),
    ).toEqual([]);
  });

  it('thins the handwriting of a page to a fraction of its points', () => {
    const { strokes } = generatePage(50, 4);
    const before = strokes.reduce((n, s) => n + s.points.length, 0);
    const after = strokes.reduce((n, s) => n + simplifyStroke(s.points, 0.25).length, 0);
    expect(after).toBeLessThan(before);
  });
});

describe('smoothing a path', () => {
  it('keeps the ends in place, the point count, and the other channels', () => {
    fc.assert(
      fc.property(path, fc.integer({ min: 0, max: 4 }), (points, passes) => {
        const smooth = smoothPath(points, passes);
        expect(smooth).toHaveLength(points.length);
        if (points.length === 0) return;
        expect(smooth[0]).toEqual(points[0]);
        expect(smooth[smooth.length - 1]).toEqual(points[points.length - 1]);
        smooth.forEach((p, i) => expect(p.pressure).toBe(points[i].pressure));
      }),
      { numRuns: 80 },
    );
  });

  it('never makes the path longer or leaves its box', () => {
    fc.assert(
      fc.property(path, fc.integer({ min: 1, max: 4 }), (points, passes) => {
        const smooth = smoothPath(points, passes);
        expect(polylineLength(smooth)).toBeLessThanOrEqual(polylineLength(points) + 1e-6);
        if (points.length === 0) return;
        const [outer, inner] = [boundsOf(points), boundsOf(smooth)];
        expect(inner.minX).toBeGreaterThanOrEqual(outer.minX - 1e-9);
        expect(inner.maxY).toBeLessThanOrEqual(outer.maxY + 1e-9);
      }),
      { numRuns: 80 },
    );
  });

  it('turns a zigzag into a gentler line', () => {
    const zigzag = Array.from({ length: 21 }, (_, i) => ({ x: i * 4, y: i % 2 ? 6 : -6 }));
    const smooth = smoothPath(zigzag, 3);
    expect(polylineLength(smooth)).toBeLessThan(polylineLength(zigzag) / 2);
  });
});
