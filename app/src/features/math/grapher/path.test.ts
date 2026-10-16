import { describe, expect, it } from 'vitest';
import { compileExpression } from './evaluate';
import { clipLine, clipPolyline, segmentsToPath } from './path';
import { sampleFunction } from './sample';
import type { Segment, Size, Viewport } from './types';

const size: Size = { width: 800, height: 400 };
const view: Viewport = { xMin: -10, xMax: 10, yMin: -5, yMax: 5 };

function sample(source: string, v: Viewport = view, s: Size = size): Segment[] {
  const result = compileExpression(source);
  if (!result.ok) throw new Error(result.error.message);
  return sampleFunction((x) => result.expression.evaluate(x), v, s);
}

const box = { left: 0, top: 0, right: 100, bottom: 100 };

describe('clipping', () => {
  it('keeps the part of a line inside the box, exact at the cut', () => {
    expect(clipLine({ x: -50, y: 50 }, { x: 150, y: 50 }, box)).toEqual([
      { x: 0, y: 50 },
      { x: 100, y: 50 },
    ]);
    const [start, end] = clipLine({ x: 50, y: 50 }, { x: 150, y: 250 }, box) ?? [];
    expect(start).toEqual({ x: 50, y: 50 });
    expect(end?.x).toBeCloseTo(75, 9);
    expect(end?.y).toBeCloseTo(100, 9);
  });

  it('drops a line that misses the box, including a vertical one', () => {
    expect(clipLine({ x: -10, y: 0 }, { x: -10, y: 100 }, box)).toBeNull();
    expect(clipLine({ x: 0, y: 150 }, { x: 100, y: 200 }, box)).toBeNull();
  });

  it('splits a line that leaves the box and comes back', () => {
    const runs = clipPolyline(
      [
        { x: 10, y: 10 },
        { x: 50, y: -100 },
        { x: 90, y: 10 },
      ],
      box,
    );
    expect(runs).toHaveLength(2);
  });
});

describe('path output', () => {
  it('writes one M and L path per unbroken run, in pixels', () => {
    const small: Size = { width: 100, height: 100 };
    const v: Viewport = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };
    const d = segmentsToPath(sample('x', v, small), v, small);
    expect(d.startsWith('M')).toBe(true);
    expect(d.match(/M/g)).toHaveLength(1);
    expect(d).not.toMatch(/e[+-]?\d/);
  });

  it('cuts an asymptote at the edge of the drawing area', () => {
    const d = segmentsToPath(sample('1/x'), view, size);
    const numbers = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    // The margin lets the line run 4 px past the edges and no further.
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(-4);
    expect(Math.max(...numbers)).toBeLessThanOrEqual(804);
    expect(d.match(/M/g)?.length).toBe(2);
  });

  it('draws 1/x^2 as two branches, with no line across the pole', () => {
    const d = segmentsToPath(sample('1/x^2'), view, size);
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d).not.toMatch(/NaN|Infinity/);
  });

  it('returns an empty path when nothing is visible', () => {
    const above = segmentsToPath(sample('x^2+100'), view, size);
    expect(above).toBe('');
  });

  it('rounds coordinates and drops repeated points', () => {
    const d = segmentsToPath(
      [
        [
          { x: 0, y: 0 },
          { x: 0.0001, y: 0.0001 },
          { x: 1, y: 1 },
        ],
      ],
      view,
      size,
      { decimals: 1 },
    );
    expect(d).toBe('M400 200L440 160');
  });
});
