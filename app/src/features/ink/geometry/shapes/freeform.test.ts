import { describe, expect, it } from 'vitest';
import { dragHandle, handlesOf } from './edit';
import { shapePoints } from './generate';
import { recognizeShape } from './recognize';
import type { Shape } from './types';
import { densify } from '../simplify';

const trapezoid: Shape = {
  kind: 'freeform',
  corners: [
    { x: 140, y: 100 },
    { x: 260, y: 100 },
    { x: 320, y: 220 },
    { x: 80, y: 220 },
  ],
};

describe('irregular polygons', () => {
  it('reads a held trapezoid back as the same freeform polygon with a handle at each corner', () => {
    const points = densify(shapePoints(trapezoid), 4);
    const match = recognizeShape(points, { minSize: 1, extra: true });
    expect(match?.shape.kind).toBe('freeform');
    if (match?.shape.kind !== 'freeform') return;
    expect(handlesOf(match.shape)).toHaveLength(4);
    match.shape.corners.forEach((corner) => {
      const nearest = Math.min(...trapezoid.corners.map((c) => Math.hypot(c.x - corner.x, c.y - corner.y)));
      expect(nearest).toBeLessThan(6);
    });
  });

  it('is not tried on ordinary writing, only when the stroke is held', () => {
    const points = densify(shapePoints(trapezoid), 4);
    expect(recognizeShape(points, { minSize: 1 })?.shape.kind).not.toBe('freeform');
  });

  it('moves one corner when its handle is dragged and closes the outline', () => {
    const dragged = dragHandle(trapezoid, 'c3', { x: 40, y: 260 });
    if (dragged.kind !== 'freeform') throw new Error('expected a freeform polygon');
    expect(dragged.corners[3]).toEqual({ x: 40, y: 260 });
    expect(dragged.corners[0]).toEqual(trapezoid.kind === 'freeform' ? trapezoid.corners[0] : null);
    const outline = shapePoints(dragged);
    expect(outline[outline.length - 1]).toEqual(outline[0]);
    expect(dragHandle(trapezoid, 'c9', { x: 0, y: 0 })).toBe(trapezoid);
  });
});
