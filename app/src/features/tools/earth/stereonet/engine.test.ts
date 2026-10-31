// Stereonets and structural geology: each planning case is checked against an independent value (a hand
// calculation with the formula stated in the case, or a second construction), then the edge cases.
import { describe, expect, it } from 'vitest';
import { Problem } from '../core/problem';
import {
  angle,
  apparentDip,
  intersection,
  lineOf,
  planeThrough,
  pole,
  rakeLine,
  rotate,
  threePoint,
  trueThickness,
  untilt,
  vector,
} from './geometry';
import { place } from './net';
import { density, eigenSymmetric, fisher, orientationTensor, roseBins } from './stats';

const problem = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof Problem ? error.code : 'other';
  }
  return null;
};

describe('planes and lines', () => {
  it('gives the pole 300/50 for strike 030, dip 40', () => {
    const p = pole({ strike: 30, dip: 40 });
    expect(Math.abs(p.trend - 300)).toBeLessThan(1e-9);
    expect(Math.abs(p.plunge - 50)).toBeLessThan(1e-9);
  });

  it('meets planes 30 toward 090 and 60 toward 180 along trend 108.435, at 64.3411 degrees between poles', () => {
    const a = { strike: 0, dip: 30 };
    const b = { strike: 90, dip: 60 };
    const line = intersection(a, b);
    expect(Math.abs(line.trend - 108.435)).toBeLessThan(5e-4);
    expect(Math.abs(angle(pole(a), pole(b)) - 64.3411)).toBeLessThan(5e-5);
    // The plan lists the plunge as 25.6589, which is 90 − 64.3411, not a plunge. Both planes' apparent dips along
    // trend 108.435 are atan(√0.3) = 28.7106 degrees, so that is the plunge of the line they share.
    expect(Math.abs(line.plunge - (Math.atan(Math.sqrt(0.3)) * 180) / Math.PI)).toBeLessThan(1e-9);
    expect(Math.abs(apparentDip(a, line.trend) - line.plunge)).toBeLessThan(1e-9);
    expect(Math.abs(apparentDip(b, line.trend) - line.plunge)).toBeLessThan(1e-9);
  });

  it('gives an apparent dip of 36.0052 toward 060 on a plane dipping 40 toward 090', () => {
    expect(Math.abs(apparentDip({ strike: 0, dip: 40 }, 60) - 36.0052)).toBeLessThan(5e-5);
    expect(Math.abs(apparentDip({ strike: 0, dip: 40 }, 0))).toBeLessThan(1e-12);
  });

  it('finds the plane through two lines and a rake back along it', () => {
    const plane = { strike: 30, dip: 40 };
    const back = planeThrough(rakeLine(plane, 20), rakeLine(plane, 110));
    expect(Math.abs(back.strike - 30)).toBeLessThan(1e-9);
    expect(Math.abs(back.dip - 40)).toBeLessThan(1e-9);
    expect(rakeLine(plane, 90)).toMatchObject({ plunge: expect.closeTo(40, 9) });
  });

  it('names parallel planes, a dip over 90, and a rake over 180', () => {
    expect(problem(() => intersection({ strike: 10, dip: 30 }, { strike: 10, dip: 30 }))).toBe('parallel');
    expect(problem(() => pole({ strike: 10, dip: 95 }))).toBe('dip');
    expect(problem(() => rakeLine({ strike: 10, dip: 30 }, 200))).toBe('rake');
  });
});

describe('maps and rotations', () => {
  it('solves the three-point problem: dip 6.37937 toward 063.4349', () => {
    const p = threePoint({ x: 0, y: 0, z: 100 }, { x: 100, y: 0, z: 90 }, { x: 0, y: 100, z: 95 });
    expect(Math.abs(p.dip - 6.37937)).toBeLessThan(5e-6);
    expect(Math.abs(p.direction - 63.4349)).toBeLessThan(5e-5);
    expect(problem(() => threePoint({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, { x: 2, y: 2, z: 2 }))).toBe(
      'collinear',
    );
  });

  it('gives true thickness as w sin δ on flat ground', () => {
    expect(Math.abs(trueThickness(100, 30, 0) - 50)).toBeLessThan(1e-9);
    expect(Math.abs(trueThickness(100, 30, 30))).toBeLessThan(1e-9);
    expect(problem(() => trueThickness(0, 30, 0))).toBe('width');
  });

  it('turns bedding back to horizontal and a quarter turn about the vertical clockwise', () => {
    const bedding = { strike: 0, dip: 30 };
    expect(untilt({ trend: 90, plunge: 30 }, bedding).plunge).toBeCloseTo(0, 9);
    const turned = lineOf(rotate(vector({ trend: 0, plunge: 0 }), { trend: 0, plunge: 90 }, 90));
    expect(turned.trend).toBeCloseTo(90, 9);
  });

  it('puts a vertical line at the center and a horizontal line on the primitive of either net', () => {
    expect(place({ trend: 0, plunge: 90 }, { net: 'area', hemisphere: 'lower' })).toMatchObject({ x: 165, y: 165 });
    const edge = place({ trend: 90, plunge: 0 }, { net: 'angle', hemisphere: 'lower' });
    expect(edge.x).toBeCloseTo(305, 9);
  });
});

describe('statistics', () => {
  it('gives the Fisher mean 14.9384/25.057 with R 2.986026, k 143.121, and α95 10.3429', () => {
    const f = fisher([
      { trend: 10, plunge: 20 },
      { trend: 20, plunge: 25 },
      { trend: 15, plunge: 30 },
    ]);
    expect(Math.abs(f.mean.trend - 14.9384)).toBeLessThan(5e-5);
    expect(Math.abs(f.mean.plunge - 25.057)).toBeLessThan(5e-4);
    expect(Math.abs(f.r - 2.986026)).toBeLessThan(5e-7);
    expect(Math.abs(f.kappa - 143.121) / 143.121).toBeLessThan(1e-5);
    expect(Math.abs(f.alpha95 - 10.3429)).toBeLessThan(5e-5);
  });

  it('finds a fold axis as the least eigenvector of poles to planes around it', () => {
    // Planes whose poles lie in the vertical east-west plane share a horizontal north-south axis.
    const poles = [10, 30, 50, 70, 90].map((dip) => pole({ strike: 0, dip })).concat(pole({ strike: 180, dip: 40 }));
    const t = orientationTensor(poles);
    expect(Math.abs(t.axes[2].plunge)).toBeLessThan(1e-9);
    expect(Math.min(t.axes[2].trend, 360 - t.axes[2].trend, Math.abs(180 - t.axes[2].trend))).toBeLessThan(1e-7);
    expect(t.shape).toBeLessThan(1);
  });

  it('diagonalizes a symmetric matrix with known eigenvalues 4, 2, 1', () => {
    const { values } = eigenSymmetric([
      [3, 1, 0],
      [1, 3, 0],
      [0, 0, 1],
    ]);
    expect(values.map((v) => Number(v.toFixed(12)))).toEqual([4, 2, 1]);
  });

  it('counts rose bins both ways for strikes and densities within 1% circles', () => {
    expect(roseBins([5, 95], 30, true)).toEqual([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]);
    expect(density([vector({ trend: 0, plunge: 90 })], [0, 0, -1])).toBe(100);
    expect(problem(() => fisher([{ trend: 1, plunge: 1 }]))).toBe('lines');
  });
});
