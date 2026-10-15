// Corners placed by hand on a scan (A3-20): moves stay inside the photo, arrow keys step, and fractions become pixels.
import { describe, expect, it } from 'vitest';
import { cornersOf } from './apply';
import type { Frame } from './apply';
import { keyMove, moveCorner } from './CornerEditor';

const whole: Frame = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

describe('corners placed by hand', () => {
  it('moves one corner and keeps it inside the photo', () => {
    const moved = moveCorner(whole, 1, 1.4, -0.2);
    expect(moved[1]).toEqual([1, 0]);
    expect(moveCorner(whole, 0, 0.25, 0.1)[0]).toEqual([0.25, 0.1]);
    expect(moved[0]).toBe(whole[0]);
  });

  it('steps with the arrow keys, farther with Shift, and ignores other keys', () => {
    expect(keyMove('ArrowRight', false)).toEqual([0.005, 0]);
    expect(keyMove('ArrowUp', true)).toEqual([0, -0.05]);
    expect(keyMove('Enter', false)).toBeNull();
  });

  it('turns a frame into pixel corners, clamping bad numbers', () => {
    const frame: Frame = [
      [0.1, 0.2],
      [Number.NaN, 0],
      [2, 1],
      [0, -1],
    ];
    expect(cornersOf(frame, 101, 51)).toEqual([
      [10, 10],
      [0, 0],
      [100, 50],
      [0, 0],
    ]);
  });
});
