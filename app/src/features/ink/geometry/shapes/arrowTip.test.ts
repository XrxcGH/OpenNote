import { describe, expect, it } from 'vitest';
import { exactOutline } from '../../../../core/ink/path';
import { shapePoints } from './generate';
import type { Shape } from './types';

const width = 4;
const reach = (shape: Shape) =>
  Math.max(...exactOutline(shapePoints(shape), width).flatMap((poly) => poly.map((p) => p.x)));

describe('arrow tips in the outline', () => {
  const tip = { x: 100, y: 0 };
  const barbs: [{ x: number; y: number }, { x: number; y: number }] = [
    { x: 100 - 20 * Math.cos(Math.PI / 6), y: -10 },
    { x: 100 - 20 * Math.cos(Math.PI / 6), y: 10 },
  ];

  it('ends at the V of the barbs, with no spike past it', () => {
    const arrow = { kind: 'arrow', from: { x: 0, y: 0 }, tip, barbs } as unknown as Shape;
    expect(reach(arrow)).toBeCloseTo(tip.x + width / 2 / Math.sin(Math.PI / 6), 6);
  });

  it('leaves a triangle and a rectangle mitered at every corner', () => {
    const tri = {
      kind: 'triangle',
      corners: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 50, y: 70 },
      ],
    } as unknown as Shape;
    const rect = {
      kind: 'rectangle',
      corners: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 30 },
        { x: 0, y: 30 },
      ],
    } as unknown as Shape;
    expect(reach(rect)).toBeCloseTo(52, 6);
    expect(reach(tri)).toBeGreaterThan(102);
  });
});
