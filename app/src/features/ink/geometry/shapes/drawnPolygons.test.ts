// Hand-drawn irregular polygons from the Beta 5 walk (W2-2): a narrow trapezoid, a slightly slanted parallelogram, and
// a house drawn with about 2 px of jitter each snap to a polygon with a handle on every corner.
import { describe, expect, it } from 'vitest';
import { recognizeShape } from './recognize';

type P = [number, number];
const line = (a: P, b: P, n: number): P[] =>
  Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
const poly = (vs: P[], n: number): P[] => vs.slice(0, -1).flatMap((v, i) => line(v, vs[i + 1], n));
const wob = (pts: P[], a = 2) =>
  pts.map(([x, y], i) => ({ x: x + Math.sin(i * 1.7) * a, y: y + Math.cos(i * 2.3) * a }));
const shapes: Record<string, [P[], number]> = {
  trapezoid: [
    poly(
      [
        [780, 520],
        [880, 520],
        [910, 610],
        [750, 610],
        [780, 520],
      ],
      12,
    ),
    4,
  ],
  parallelogram: [
    poly(
      [
        [960, 520],
        [1060, 520],
        [1030, 610],
        [930, 610],
        [960, 520],
      ],
      12,
    ),
    4,
  ],
  house: [
    poly(
      [
        [1100, 610],
        [1100, 550],
        [1150, 510],
        [1200, 550],
        [1200, 610],
        [1100, 610],
      ],
      10,
    ),
    5,
  ],
};
describe('drawn irregular polygons', () => {
  for (const [name, [pts, n]] of Object.entries(shapes))
    it(name, () => {
      const m = recognizeShape(wob(pts), { minSize: 16, width: 1.9, extra: true });
      expect([m?.shape.kind, m?.shape.kind === 'freeform' ? m.shape.corners.length : 0]).toEqual(['freeform', n]);
    });
});
