import { describe, expect, it } from 'vitest';
import { boundsOf } from './bounds';
import { outlinePath, pencilOpacity, pencilWidthFactor, strokeOutline } from './outline';
import type { InkPoint } from './types';

const horizontal = (pressure: number | undefined, tilt = 0): InkPoint[] =>
  Array.from({ length: 30 }, (_, i) => ({ x: i * 2, y: 50, pressure, tiltX: tilt, tiltY: 0, time: i * 8 }));

const thickness = (outline: { y: number }[]) => {
  const ys = outline.map((p) => p.y);
  return Math.max(...ys) - Math.min(...ys);
};

describe('stroke outlines', () => {
  it('draws a wider line for a harder press', () => {
    const light = strokeOutline(horizontal(0.2), { tool: 'pen', width: 4 });
    const hard = strokeOutline(horizontal(0.9), { tool: 'pen', width: 4 });
    expect(thickness(hard)).toBeGreaterThan(thickness(light) * 1.5);
  });

  it('gives strokes without pressure a uniform width of the nominal size', () => {
    const outline = strokeOutline(horizontal(undefined), { tool: 'pen', width: 4 });
    expect(thickness(outline)).toBeCloseTo(4, 0);
  });

  it('ignores pressure for the highlighter', () => {
    const light = strokeOutline(horizontal(0.1), { tool: 'highlighter', width: 6 });
    const hard = strokeOutline(horizontal(1), { tool: 'highlighter', width: 6 });
    expect(thickness(light)).toBeCloseTo(thickness(hard), 6);
  });

  it('scales the width with the stroke transform', () => {
    const one = strokeOutline(horizontal(undefined), { tool: 'pen', width: 4 });
    const two = strokeOutline(horizontal(undefined), { tool: 'pen', width: 4, scale: 2 });
    expect(thickness(two)).toBeCloseTo(thickness(one) * 2, 0);
  });

  it('widens the pencil as it tilts toward the page and lowers its opacity', () => {
    const upright = strokeOutline(horizontal(0.5, 0), { tool: 'pencil', width: 4 });
    const flat = strokeOutline(horizontal(0.5, 80), { tool: 'pencil', width: 4 });
    expect(thickness(flat)).toBeGreaterThan(thickness(upright) * 1.6);
    expect(pencilWidthFactor({ x: 0, y: 0, tiltX: 90 })).toBeCloseTo(2.2, 6);
    expect(pencilOpacity(horizontal(0.5, 0))).toBeCloseTo(0.9, 6);
    expect(pencilOpacity(horizontal(0.5, 90))).toBeCloseTo(0.55, 6);
  });

  it('keeps the outline around the points and writes a closed path', () => {
    const outline = strokeOutline(horizontal(0.5), { tool: 'pen', width: 4 });
    const box = boundsOf(outline);
    expect(box.minX).toBeLessThan(0);
    expect(box.maxX).toBeGreaterThan(58);
    expect(outlinePath(outline)).toMatch(/^M[\d.,-]+Q.*Z$/);
    expect(outlinePath([])).toBe('');
  });
});
