import { describe, expect, it } from 'vitest';
import { applyReshape, pivotOf, reshapeFor } from './reshape';

const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe('keep holding, then move', () => {
  it('grows with the pen and shrinks with it', () => {
    const pivot = pivotOf(square);
    expect(pivot).toEqual({ x: 50, y: 50 });
    const bigger = reshapeFor(pivot, { x: 100, y: 50 }, { x: 150, y: 50 });
    expect(bigger.scale).toBeCloseTo(2);
    expect(bigger.turn).toBeCloseTo(0);
    const grown = applyReshape(square, pivot, bigger);
    expect(grown[0].x).toBeCloseTo(-50);
    expect(grown[2].x).toBeCloseTo(150);
    expect(reshapeFor(pivot, { x: 100, y: 50 }, { x: 60, y: 50 }).scale).toBeCloseTo(0.2);
  });

  it('turns with the pen, in steps of 15 degrees when it is close to one', () => {
    const pivot = { x: 0, y: 0 };
    const rough = reshapeFor(pivot, { x: 100, y: 0 }, { x: 0, y: 100 }); // a quarter turn, clockwise on screen
    expect(rough.turn).toBeCloseTo(Math.PI / 2);
    const near = reshapeFor(
      pivot,
      { x: 100, y: 0 },
      {
        x: 100 * Math.cos(0.5),
        y: 100 * Math.sin(0.5),
      },
    );
    expect(near.turn).toBeCloseTo((30 * Math.PI) / 180); // 28.6 degrees snaps to 30
    const turned = applyReshape([{ x: 100, y: 0 }], pivot, rough);
    expect(turned[0].x).toBeCloseTo(0);
    expect(turned[0].y).toBeCloseTo(100);
  });

  it('does nothing when the shape snapped at its own center', () => {
    expect(reshapeFor({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 50, y: 50 })).toEqual({ scale: 1, turn: 0 });
  });
});
