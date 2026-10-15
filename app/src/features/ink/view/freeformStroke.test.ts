// A freeform polygon through the stroke path it lives on: saved as an ordinary shape stroke, read back with a handle
// at each corner, and reshaped by dragging one. Also pins how a skewed four-sided outline is named.

import { describe, expect, it } from 'vitest';
import { dragHandle, handlesOf, recognizeShape } from '../geometry/shapes';
import type { Shape } from '../geometry/shapes';
import { densify } from '../geometry/simplify';
import { inkStroke } from '../model/fixtures';
import { recordFromStroke, strokeFromRecord } from '../model';
import { restroke, shapeOfStroke } from './shapeEdit';

const house: Shape = {
  kind: 'freeform',
  corners: [
    { x: 200, y: 100 },
    { x: 290, y: 170 },
    { x: 290, y: 280 },
    { x: 110, y: 280 },
    { x: 110, y: 170 },
  ],
};

const shapeStroke = (shape: Shape) => restroke(inkStroke(1, 4), shape, 'freeform-1');

describe('freeform polygon stroke', () => {
  it('is a shape stroke that reads back as the same polygon with a handle per corner', () => {
    const read = shapeOfStroke(shapeStroke(house));
    expect(read?.kind).toBe('freeform');
    if (read?.kind !== 'freeform') return;
    expect(read.corners).toHaveLength(5);
    expect(handlesOf(read)).toHaveLength(5);
  });

  it('survives saving and loading', () => {
    const saved = strokeFromRecord(recordFromStroke(shapeStroke(house)));
    const read = shapeOfStroke(saved);
    expect(read?.kind).toBe('freeform');
    if (read?.kind !== 'freeform') return;
    const corners = house.kind === 'freeform' ? house.corners : [];
    corners.forEach((c, i) => {
      expect(Math.hypot(read.corners[i].x - c.x, read.corners[i].y - c.y)).toBeLessThan(3);
    });
  });

  it('reshapes to a new stroke when a corner handle is dragged', () => {
    const read = shapeOfStroke(shapeStroke(house));
    if (!read) throw new Error('expected a shape');
    const moved = dragHandle(read, 'c1', { x: 360, y: 120 });
    const next = shapeOfStroke(shapeStroke(moved));
    expect(next?.kind).toBe('freeform');
    if (next?.kind !== 'freeform') return;
    expect(Math.max(...next.corners.map((c) => c.x))).toBeGreaterThan(340);
  });
});

describe('a skewed four-sided outline', () => {
  const kindAt = (degrees: number) => {
    const t = Math.tan((degrees * Math.PI) / 180) * 100;
    const outline = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200 + t, y: 100 },
      { x: t, y: 100 },
      { x: 0, y: 0 },
    ];
    return recognizeShape(densify(outline, 4), { extra: true, minSize: 1 })?.shape.kind ?? null;
  };

  it('is a rectangle up to 14 degrees off square, a freeform polygon from 22, and left alone between', () => {
    expect(kindAt(6)).toBe('rectangle');
    expect(kindAt(14)).toBe('rectangle');
    expect(kindAt(18)).toBeNull();
    expect(kindAt(22)).toBe('freeform');
    expect(kindAt(40)).toBe('freeform');
  });
});
