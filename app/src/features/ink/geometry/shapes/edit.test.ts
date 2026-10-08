import { describe, expect, it } from 'vitest';
import { endsOf, isConnector, moveEnd, nearestOnOutline } from './connect';
import { dragHandle, handlesOf } from './edit';
import { shapePoints } from './generate';
import { LIBRARY, libraryShape } from './library';
import { recognizeShape } from './recognize';
import type { Shape } from './types';

const rectangle: Shape = {
  kind: 'rectangle',
  corners: [
    { x: 100, y: 100 },
    { x: 300, y: 100 },
    { x: 300, y: 200 },
    { x: 100, y: 200 },
  ],
  square: false,
};

describe('shape handles', () => {
  it('gives a rectangle a handle at each corner, and drags one while its opposite corner stays', () => {
    expect(handlesOf(rectangle).map((h) => h.id)).toEqual(['c0', 'c1', 'c2', 'c3']);
    const dragged = dragHandle(rectangle, 'c2', { x: 360, y: 260 });
    if (dragged.kind !== 'rectangle') throw new Error('expected a rectangle');
    expect(dragged.corners[0]).toEqual({ x: 100, y: 100 });
    expect(dragged.corners[2].x).toBeCloseTo(360);
    expect(dragged.corners[2].y).toBeCloseTo(260);
  });

  it('resizes circles and ellipses, and moves the ends of lines and arrows', () => {
    const circle = dragHandle({ kind: 'circle', center: { x: 0, y: 0 }, radius: 10 }, 'radius', { x: 0, y: 30 });
    expect(circle).toMatchObject({ kind: 'circle', radius: 30 });
    const ellipse = dragHandle({ kind: 'ellipse', center: { x: 0, y: 0 }, rx: 50, ry: 20, rotation: 0 }, 'ry', {
      x: 5,
      y: 40,
    });
    expect(ellipse).toMatchObject({ kind: 'ellipse', rx: 50, ry: 40 });
    const arrow = recognizeShape(
      shapePoints({
        kind: 'arrow',
        from: { x: 0, y: 0 },
        tip: { x: 200, y: 0 },
        barbs: [
          { x: 175, y: -14 },
          { x: 175, y: 14 },
        ],
      }),
      { extra: true },
    );
    expect(arrow?.shape.kind).toBe('arrow');
    const longer = dragHandle(arrow!.shape, 'to', { x: 260, y: 0 });
    if (longer.kind !== 'arrow') throw new Error('expected an arrow');
    expect(longer.tip.x).toBe(260);
    expect(longer.barbs[0].x).toBeLessThan(260);
  });

  it('reads a shape back from its points, so a stored shape has handles', () => {
    for (const item of LIBRARY.filter(
      (one) => one.group === 'basic' && !['line', 'arrow', 'doubleArrow', 'curvedArrow'].includes(one.id),
    )) {
      const [points] = libraryShape(item.id, { x: 300, y: 300 }, 160);
      const match = recognizeShape(points, { extra: true, minSize: 1 });
      expect(match, item.id).not.toBeNull();
    }
  });
});

describe('connectors', () => {
  it('knows its ends and moves one of them', () => {
    const line: Shape = { kind: 'line', from: { x: 0, y: 0 }, to: { x: 100, y: 0 } };
    expect(isConnector(line)).toBe(true);
    expect(isConnector(rectangle)).toBe(false);
    expect(endsOf(line)).toEqual({ start: { x: 0, y: 0 }, end: { x: 100, y: 0 } });
    expect(moveEnd(line, 'end', { x: 100, y: 50 })).toMatchObject({ to: { x: 100, y: 50 } });
  });

  it('finds the nearest point of an outline within reach', () => {
    const outline = shapePoints(rectangle);
    expect(nearestOnOutline(outline, { x: 303, y: 150 }, 8)).toEqual({ x: 300, y: 150 });
    expect(nearestOnOutline(outline, { x: 500, y: 500 }, 8)).toBeNull();
  });
});

describe('the shape libraries', () => {
  it('draw something for every item', () => {
    for (const item of LIBRARY) {
      const strokes = libraryShape(item.id, { x: 200, y: 200 }, 140);
      expect(strokes.length, item.id).toBeGreaterThan(0);
      for (const stroke of strokes) expect(stroke.length, item.id).toBeGreaterThanOrEqual(2);
    }
  });
});
