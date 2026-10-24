import { describe, expect, it } from 'vitest';
import { exactOutline } from './path';

type P = { x: number; y: number };
const width = 4;
const half = width / 2;

/** The farthest any outline point reaches along the unit direction `d`. */
function reach(polys: P[][], d: P): number {
  return Math.max(...polys.flat().map((p) => p.x * d.x + p.y * d.y));
}
const at = (deg: number, r: number, o: P = { x: 0, y: 0 }): P => ({
  x: o.x + r * Math.cos((deg * Math.PI) / 180),
  y: o.y + r * Math.sin((deg * Math.PI) / 180),
});

describe('exactOutline at an arrow tip', () => {
  it('reaches no farther than the V the barbs make', () => {
    const tip = { x: 100, y: 0 };
    const barbs: [P, P] = [at(180 - 30, 20, tip), at(180 + 30, 20, tip)];
    const polys = exactOutline([{ x: 0, y: 0 }, tip, barbs[0], tip, barbs[1]], width);
    // The barbs meet at 60 degrees: the V's miter ends half / sin(30 degrees) past the tip.
    expect(reach(polys, { x: 1, y: 0 })).toBeCloseTo(tip.x + half / Math.sin((30 * Math.PI) / 180), 6);
  });

  it('keeps the same tip for a double arrow, at both ends', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 0 };
    const pts = [at(30, 20, from), from, at(-30, 20, from), from, to, at(180 - 30, 20, to), to, at(180 + 30, 20, to)];
    const polys = exactOutline(pts, width);
    const apex = half / Math.sin((30 * Math.PI) / 180);
    expect(reach(polys, { x: 1, y: 0 })).toBeCloseTo(to.x + apex, 6);
    expect(reach(polys, { x: -1, y: 0 })).toBeCloseTo(apex, 6);
  });
});

describe('exactOutline corners that are not revisited', () => {
  it('keeps the rectangle corners mitered', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 30 },
      { x: 0, y: 30 },
      { x: 0, y: 0 },
    ];
    const polys = exactOutline(pts, width);
    expect(reach(polys, { x: 1, y: 0 })).toBeCloseTo(50 + half, 6);
    expect(reach(polys, { x: Math.SQRT1_2, y: Math.SQRT1_2 })).toBeCloseTo((80 + 2 * half) * Math.SQRT1_2, 6);
  });

  it('keeps a 40 degree triangle corner mitered', () => {
    const a = 40;
    const tipPt = { x: 100, y: 0 };
    const pts = [at(180 - a / 2, 80, tipPt), tipPt, at(180 + a / 2, 80, tipPt)];
    const closed = [...pts, pts[0]];
    const polys = exactOutline(closed, width);
    expect(reach(polys, { x: 1, y: 0 })).toBeCloseTo(100 + half / Math.sin(((a / 2) * Math.PI) / 180), 6);
  });
});
