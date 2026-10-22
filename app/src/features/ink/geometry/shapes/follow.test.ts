import { describe, expect, it } from 'vitest';
import { recognizeShape } from './recognize';
import { farEnd, followEnd, followsEnd } from './follow';
import { shapePoints } from './generate';
import type { Shape } from './types';

const line: Shape = { kind: 'line', from: { x: 0, y: 0 }, to: { x: 100, y: 0 } };

describe('keep holding a line, then move its end', () => {
  it('follows lines and straight arrows only', () => {
    expect(followsEnd(line)).toBe(true);
    expect(followsEnd({ kind: 'circle', center: { x: 0, y: 0 }, radius: 4 })).toBe(false);
  });

  it('lays the far end where the pen is, keeping the start', () => {
    const moved = followEnd(line, { x: 40, y: 70 }, false);
    expect(moved).toEqual({ kind: 'line', from: { x: 0, y: 0 }, to: { x: 40, y: 70 } });
  });

  it('keeps to 15 degree steps near level when the paper has no lines', () => {
    const end = farEnd(followEnd(line, { x: 100, y: 4 }))!;
    expect(end.y).toBeCloseTo(0, 9);
    expect(end.x).toBeCloseTo(Math.hypot(100, 4), 9);
  });

  it('moves an arrow tip and redraws its head at the new tip', () => {
    const drawn = [
      ...Array.from({ length: 21 }, (_, i) => ({ x: i * 10, y: 100 })),
      { x: 185, y: 90 },
      { x: 200, y: 100 },
      { x: 185, y: 110 },
    ];
    const arrow = recognizeShape(drawn, { minSize: 16, width: 2 })!;
    expect(arrow.shape.kind).toBe('arrow');
    const moved = followEnd(arrow.shape, { x: 0, y: 300 }, false);
    if (moved.kind !== 'arrow') throw new Error('not an arrow');
    expect(moved.tip).toEqual({ x: 0, y: 300 });
    expect(moved.from).toEqual(arrow.shape.kind === 'arrow' ? arrow.shape.from : null);
    // Both barbs sit behind the new tip, back toward the start.
    for (const barb of moved.barbs) expect(barb.y).toBeLessThan(300);
    expect(shapePoints(moved)).toHaveLength(5);
  });

  it('leaves other shapes alone', () => {
    const circle: Shape = { kind: 'circle', center: { x: 0, y: 0 }, radius: 4 };
    expect(followEnd(circle, { x: 9, y: 9 })).toBe(circle);
  });
});
