// Routh-Hurwitz and the root locus against the plan's cases and independent checks: root counts from a numerical
// root finder, and departure and arrival angles tested by the angle condition a short step away.
import { describe, expect, it } from 'vitest';
import { ControlError } from '../lib/errors';
import { cabs, cdiv, cx, pevalC, readTF, rootsOf, type Complex, type TF } from '../lib/tf';
import { gainForDamping, gainForPoint, locusRules, routh } from './engine';

const deg = (z: Complex) => (Math.atan2(z.im, z.re) * 180) / Math.PI;
const angleOfG = (g: TF, s: Complex) => deg(cdiv(pevalC(g.num, s), pevalC(g.den, s)));
/** Coefficients highest power first, as written. */
const poly = (...hi: number[]) => [...hi].reverse();

describe('validation cases', () => {
  it('K/(s(s + 2)(s + 4)): centroid −2, asymptotes ±60° and 180°, breakaway −0.8453, crossing at K = 48', () => {
    const r = locusRules(readTF('1/(s (s + 2) (s + 4))'));
    expect(r.centroid).toBeCloseTo(-2, 12);
    expect([...r.asymptotes].sort((a, b) => a - b)).toEqual([-60, 60, 180]);
    expect(r.breaks).toHaveLength(1);
    expect(r.breaks[0].point.re).toBeCloseTo(-2 + 2 / Math.sqrt(3), 9);
    expect(r.crossings).toHaveLength(1);
    expect(r.crossings[0].at).toBeCloseTo(Math.sqrt(8), 9);
    expect(r.crossings[0].k).toBeCloseTo(48, 8);
    expect(r.ranges).toHaveLength(1);
    expect(r.ranges[0][0]).toBe(0);
    expect(r.ranges[0][1]).toBeCloseTo(48, 8);
  });

  it('s⁴ + 2s³ + 3s² + 6s + 5: a zero in the first column, two right-half-plane roots', () => {
    const r = routh(poly(1, 2, 3, 6, 5));
    expect(r.rows.map((row) => row.cells[0])).toEqual(['1', '2', 'ε', '−10/ε', '5']);
    expect(r.signChanges).toBe(2);
    const rhp = r.roots.filter((z) => z.re > 0);
    expect(rhp).toHaveLength(2);
    expect(rhp[0].re).toBeCloseTo(0.3002, 4);
    expect(Math.abs(rhp[0].im)).toBeCloseTo(1.6248, 4);
  });

  it('s³ + 2s² + 4s + 8: a row of zeros, auxiliary 2s² + 8, roots ±2i', () => {
    const r = routh(poly(1, 2, 4, 8));
    expect(r.auxiliary).toEqual([[8, 0, 2]]);
    expect(r.rows[2].special).toBe('auxiliary');
    expect(r.rows[2].cells).toEqual(['4']);
    expect([r.rhp, r.axis, r.lhp]).toEqual([0, 2, 1]);
  });
});

describe('Routh against a root finder', () => {
  const cases = [
    poly(1, 6, 11, 6),
    poly(1, 1, 2, 24),
    poly(1, -3, 2),
    poly(2, 3, 1, 5, 4),
    poly(1, 2, 3, 4, 5, 6),
    poly(-1, -2, -3),
    poly(1, 0.5, 30, 2, 100),
  ];
  it.each(cases.map((c) => [c.join(', '), c]))('counts the right-half-plane roots of [%s]', (_, c) => {
    const r = routh(c as number[]);
    const rhp = rootsOf(c as number[]).filter((z) => z.re > 1e-9).length;
    expect(r.rhp).toBe(rhp);
    expect(r.axis).toBe(0);
  });

  it('finds a root at the origin through a row of zeros', () => {
    const r = routh(poly(1, 1, 1, 0));
    expect([r.rhp, r.axis, r.lhp]).toEqual([0, 1, 2]);
  });

  it('shows the plain entries of a regular array', () => {
    // s³ + 6s² + 11s + 6: rows 1 11 | 6 6 | 10 | 6.
    expect(routh(poly(1, 6, 11, 6)).rows.map((row) => row.cells)).toEqual([['1', '11'], ['6', '6'], ['10'], ['6']]);
  });
});

describe('root locus rules against the angle condition', () => {
  it('departs (s + 2)/(s² + 2s + 2) at 135°, along the locus', () => {
    const g = readTF('(s + 2)/(s^2 + 2s + 2)');
    const r = locusRules(g);
    const d = r.departures.find((x) => x.at.im > 0);
    expect(d?.angleDeg).toBeCloseTo(135, 9);
    const t = ((d?.angleDeg ?? 0) * Math.PI) / 180;
    const s = cx(-1 + 1e-5 * Math.cos(t), 1 + 1e-5 * Math.sin(t));
    expect(Math.abs(angleOfG(g, s))).toBeCloseTo(180, 2);
  });

  it('arrives at a complex zero along the locus', () => {
    const g = readTF('(s^2 + 2s + 2)/(s (s + 3))');
    const a = locusRules(g).arrivals.find((x) => x.at.im > 0);
    expect(a?.angleDeg).toBeCloseTo(180 + 135 + (Math.atan2(1, 2) * 180) / Math.PI - 90 - 360, 9);
    const t = ((a?.angleDeg ?? 0) * Math.PI) / 180;
    const s = cx(-1 + 1e-5 * Math.cos(t), 1 + 1e-5 * Math.sin(t));
    expect(Math.abs(angleOfG(g, s))).toBeCloseTo(180, 2);
  });

  it('finds K for a point on the locus and for a damping ratio', () => {
    const g = readTF('1/(s (s + 2) (s + 4))');
    const onAxis = gainForPoint(g, cx(0, Math.sqrt(8)));
    expect(onAxis.k).toBeCloseTo(48, 8);
    const z = gainForDamping(g, 0.5);
    expect(z).toHaveLength(1);
    // The pole sits on the 120° line and is a root of the closed loop at that K.
    expect(deg(z[0].point)).toBeCloseTo(120, 9);
    const p = pevalC([z[0].k, 8, 6, 1], z[0].point);
    expect(cabs(p)).toBeLessThan(1e-8 * z[0].k);
  });
});

const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    if (e instanceof ControlError) return e.code;
    throw e;
  }
  return 'none';
};

describe('impossible input', () => {
  const g = readTF('1/(s (s + 2))');
  const cases: [string, () => unknown][] = [
    ['routhOrder', () => routh([5])],
    ['orderTooHigh', () => routh(new Array<number>(14).fill(1))],
    ['locusNoPoles', () => locusRules(readTF('s + 1'))],
    ['notOnLocus', () => gainForPoint(g, cx(1, 1))],
    ['zetaRange', () => gainForDamping(g, 1.2)],
    ['zetaRange', () => gainForDamping(g, 0)],
  ];
  it.each(cases)('names %s', (want, f) => expect(code(f)).toBe(want));
});
