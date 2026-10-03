import { describe, expect, it } from 'vitest';
import { strokeBounds } from './bounds';
import { lineStroke } from './fixtures';
import { applyToPoint, compose, IDENTITY, invert, rotation, scaling, translation, widthScale } from './matrix';
import { moveStrokes, rotateStrokes, scaleStrokes, selectionBounds, bakeTransform, boxToBox } from './transform';
import { pagePoints } from './strokeIndex';

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

describe('matrices', () => {
  it('compose applies the inner matrix first', () => {
    const m = compose(translation(10, 0), scaling(2, 2));
    expect(applyToPoint(m, { x: 1, y: 1 })).toEqual({ x: 12, y: 2 });
  });

  it('keeps the fixed point of a rotation and a scale in place', () => {
    const about = { x: 5, y: 7 };
    const r = applyToPoint(rotation(Math.PI / 3, about), about);
    const s = applyToPoint(scaling(3, 0.5, about), about);
    near(r.x, 5);
    near(r.y, 7);
    near(s.x, 5);
    near(s.y, 7);
  });

  it('rotates a quarter turn clockwise on screen', () => {
    const p = applyToPoint(rotation(Math.PI / 2), { x: 1, y: 0 });
    near(p.x, 0);
    near(p.y, 1);
  });

  it('inverts to the identity and refuses a flat matrix', () => {
    const m = compose(rotation(0.7, { x: 3, y: 4 }), scaling(2, 3));
    const product = compose(m, invert(m)!);
    product.forEach((v, i) => near(v, IDENTITY[i]));
    expect(invert([1, 2, 2, 4, 0, 0])).toBeNull();
  });

  it('scales width by the square root of the determinant, so moving never changes it', () => {
    near(widthScale(translation(50, 50)), 1);
    near(widthScale(scaling(2, 8)), 4);
    near(widthScale(rotation(1.1)), 1);
  });
});

describe('stroke transforms', () => {
  const stroke = lineStroke('a', { x: 0, y: 0 }, { x: 10, y: 0 });

  it('moves and scales a stroke without touching its raw points', () => {
    const [moved] = moveStrokes([stroke], 5, 6);
    const [scaled] = scaleStrokes([moved], 2, 2, { x: 5, y: 6 });
    expect(scaled.points).toBe(stroke.points);
    expect(pagePoints(scaled)[10]).toEqual({ x: 25, y: 6 });
    near(strokeBounds(scaled).maxX, 25 + 2);
  });

  it('rotates about a point', () => {
    const [turned] = rotateStrokes([stroke], Math.PI / 2, { x: 0, y: 0 });
    const end = pagePoints(turned)[10];
    near(end.x, 0);
    near(end.y, 10);
  });

  it('bakes the transform into the points and the width', () => {
    const [scaled] = scaleStrokes([stroke], 3, 3, { x: 0, y: 0 });
    const baked = bakeTransform(scaled);
    expect(baked.transform).toBeUndefined();
    expect(baked.width).toBeCloseTo(6);
    expect(baked.points[10].x).toBeCloseTo(30);
    expect(baked.points[10].pressure).toBe(0.5);
  });

  it('finds the selection box and the matrix between two boxes', () => {
    const other = lineStroke('b', { x: -4, y: 8 }, { x: 4, y: 12 });
    const box = selectionBounds([stroke, other])!;
    expect(box).toEqual({ minX: -4, minY: 0, maxX: 10, maxY: 12 });
    const m = boxToBox(box, { minX: 0, minY: 0, maxX: 28, maxY: 24 })!;
    expect(applyToPoint(m, { x: 10, y: 12 })).toEqual({ x: 28, y: 24 });
    expect(boxToBox({ minX: 0, minY: 0, maxX: 0, maxY: 5 }, box)).toBeNull();
  });
});
