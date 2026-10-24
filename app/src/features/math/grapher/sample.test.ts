import { describe, expect, it } from 'vitest';
import { compileExpression } from './evaluate';
import { sampleFunction } from './sample';
import type { Segment, Size, Viewport } from './types';

const size: Size = { width: 800, height: 400 };
const view: Viewport = { xMin: -10, xMax: 10, yMin: -5, yMax: 5 };

function sample(source: string, v: Viewport = view, s: Size = size): Segment[] {
  const result = compileExpression(source);
  if (!result.ok) throw new Error(result.error.message);
  return sampleFunction((x) => result.expression.evaluate(x), v, s);
}

function pointCount(segments: readonly Segment[]): number {
  return segments.reduce((total, segment) => total + segment.length, 0);
}

/** The height of the drawn line at x, or NaN when the line has a gap there. */
function lineAt(segments: readonly Segment[], x: number): number {
  for (const segment of segments) {
    for (let i = 1; i < segment.length; i += 1) {
      const a = segment[i - 1];
      const b = segment[i];
      if (x >= a.x && x <= b.x) return a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
    }
  }
  return NaN;
}

function worstError(source: string, segments: readonly Segment[], from: number, to: number): number {
  const result = compileExpression(source);
  if (!result.ok) throw new Error(result.error.message);
  let worst = 0;
  for (let i = 0; i <= 2000; i += 1) {
    const x = from + ((to - from) * i) / 2000;
    worst = Math.max(worst, Math.abs(lineAt(segments, x) - result.expression.evaluate(x)));
  }
  return worst;
}

describe('smooth curves', () => {
  it('stay within a fraction of a pixel of the function, with few points', () => {
    const segments = sample('sin(x)');
    expect(segments).toHaveLength(1);
    // One pixel is 0.025 units tall here, so a quarter pixel is about 0.006.
    expect(worstError('sin(x)', segments, -9.9, 9.9)).toBeLessThan(0.006);
    expect(pointCount(segments)).toBeLessThan(400);
  });

  it('add points where the curve bends sharply', () => {
    const tight: Viewport = { xMin: -0.5, xMax: 0.5, yMin: -1.5, yMax: 1.5 };
    const segments = sample('sin(40x)', tight);
    // A quarter pixel is 0.0019 units in this view.
    expect(worstError('sin(40x)', segments, -0.45, 0.45)).toBeLessThan(0.0025);
  });

  it('reach both edges of the view', () => {
    const [segment] = sample('x^2');
    expect(segment[0].x).toBeLessThan(view.xMin);
    expect(segment[segment.length - 1].x).toBeGreaterThan(view.xMax);
  });

  it('keep a corner sharp', () => {
    const segments = sample('abs(x)');
    expect(segments).toHaveLength(1);
    expect(lineAt(segments, 0)).toBeLessThan(0.01);
  });

  it('draw a steep line and a steep smooth curve unbroken', () => {
    expect(sample('1000x')).toHaveLength(1);
    expect(sample('atan(50x)')).toHaveLength(1);
  });
});

describe('asymptotes and jumps', () => {
  it('breaks 1/x at the pole', () => {
    const segments = sample('1/x');
    expect(segments).toHaveLength(2);
    const [left, right] = segments;
    expect(left.every((p) => p.x < 0)).toBe(true);
    expect(right.every((p) => p.x > 0)).toBe(true);
    // Each side runs close to the pole, so the drawn line reaches the top and bottom of the view.
    expect(Math.max(...left.map((p) => p.x))).toBeGreaterThan(-1e-3);
    expect(Math.min(...right.map((p) => p.x))).toBeLessThan(1e-3);
  });

  it('breaks tan(x) at every pole in view and draws between them', () => {
    const v: Viewport = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };
    const segments = sample('tan(x)', v);
    // Poles at -3pi/2, -pi/2, pi/2, and 3pi/2 split the view into five branches.
    expect(segments).toHaveLength(5);
    for (const pole of [-1.5 * Math.PI, -0.5 * Math.PI, 0.5 * Math.PI, 1.5 * Math.PI]) {
      const crosses = segments.some((s) => s[0].x < pole && s[s.length - 1].x > pole);
      expect(crosses).toBe(false);
    }
    expect(worstError('tan(x)', [segments[2]], -1.2, 1.2)).toBeLessThan(0.02);
  });

  it('breaks floor(x) at each whole number', () => {
    const v: Viewport = { xMin: -5, xMax: 5, yMin: -6, yMax: 6 };
    const segments = sample('floor(x)', v);
    // Ten whole-number steps in view, plus a short piece past each edge from the overscan.
    expect(segments).toHaveLength(12);
    for (const segment of segments) {
      const heights = new Set(segment.map((p) => p.y));
      expect(heights.size).toBe(1);
    }
  });

  it('breaks at a tall step inside the view but keeps a short ramp whole', () => {
    expect(sample('x/abs(x)')).toHaveLength(2);
    expect(sample('abs(x)/(abs(x)+1)')).toHaveLength(1);
  });
});

describe('where the function is undefined', () => {
  it('starts sqrt(x) at zero and draws nothing to the left', () => {
    const segments = sample('sqrt(x)');
    expect(segments).toHaveLength(1);
    const [segment] = segments;
    expect(segment[0].x).toBeGreaterThanOrEqual(0);
    expect(segment[0].x).toBeLessThan(1e-4);
    expect(worstError('sqrt(x)', segments, 0.05, 9.9)).toBeLessThan(0.0075);
  });

  it('draws ln(x) from just above zero', () => {
    const [segment] = sample('ln(x)');
    expect(segment[0].x).toBeGreaterThan(0);
    expect(segment[0].x).toBeLessThan(1e-3);
  });

  it('gives no segments when the function is undefined everywhere', () => {
    expect(sample('sqrt(-1-x^2)')).toEqual([]);
  });

  it('splits a function that is defined in separate intervals', () => {
    // ln(sin(x)) exists where sin(x) > 0: (0, pi) and (2pi, 3pi) inside [-1, 10].
    const v: Viewport = { xMin: -1, xMax: 10, yMin: -5, yMax: 1 };
    expect(sample('ln(sin(x))', v)).toHaveLength(2);
  });

  it('returns nothing for an empty view', () => {
    const flat: Viewport = { xMin: 1, xMax: 1, yMin: 0, yMax: 1 };
    expect(sample('x', flat)).toEqual([]);
  });
});

describe('known values', () => {
  /** Where the drawn line crosses y = 0 between `from` and `to`, found by interpolation. */
  function zeroBetween(segments: readonly Segment[], from: number, to: number): number {
    for (const segment of segments) {
      for (let i = 1; i < segment.length; i += 1) {
        const a = segment[i - 1];
        const b = segment[i];
        if (a.x < from || b.x > to || a.y * b.y > 0) continue;
        return a.x + (a.y / (a.y - b.y)) * (b.x - a.x);
      }
    }
    return NaN;
  }

  it('crosses zero at the square root of two', () => {
    expect(zeroBetween(sample('x^2 - 2'), 0, 3)).toBeCloseTo(Math.SQRT2, 2);
  });

  it('crosses zero at pi, and peaks at 1 near pi/2', () => {
    const segments = sample('sin(x)');
    expect(zeroBetween(segments, 3, 3.3)).toBeCloseTo(Math.PI, 2);
    const peak = segments[0].reduce((best, p) => (p.y > best.y && p.x > 0 && p.x < 3 ? p : best), { x: 0, y: -2 });
    expect(peak.x).toBeCloseTo(Math.PI / 2, 1);
    expect(peak.y).toBeCloseTo(1, 3);
  });

  it('puts the vertex of a parabola at the right place', () => {
    const lowest = sample('(x - 3)^2 - 4')[0].reduce((best, p) => (p.y < best.y ? p : best));
    expect(lowest.x).toBeCloseTo(3, 1);
    expect(lowest.y).toBeCloseTo(-4, 2);
  });

  it('follows a parameter: a larger amplitude makes a taller wave', () => {
    const tall = compileExpression('a sin(x)', { parameters: ['a'] });
    if (!tall.ok) throw new Error('should compile');
    const top = (a: number) =>
      Math.max(...sampleFunction((x) => tall.expression.evaluate(x, { a }), view, size)[0].map((p) => p.y));
    expect(top(1)).toBeCloseTo(1, 2);
    expect(top(3)).toBeCloseTo(3, 2);
  });
});

describe('limits', () => {
  it('stays inside its evaluation budget on a curve that oscillates forever', () => {
    let calls = 0;
    const segments = sampleFunction(
      (x) => {
        calls += 1;
        return Math.sin(1 / x);
      },
      { xMin: -1, xMax: 1, yMin: -2, yMax: 2 },
      size,
      { maxEvaluations: 5000 },
    );
    expect(calls).toBeLessThanOrEqual(5000 + 257);
    expect(pointCount(segments)).toBeGreaterThan(100);
    for (const segment of segments) for (const p of segment) expect(Number.isFinite(p.y)).toBe(true);
  });
});
