import { describe, expect, it } from 'vitest';
import { CalcError, SIGMA } from '../numeric';
import {
  bandFractionTo,
  blackbody,
  concentric,
  disks,
  enclosure,
  parallelPlates,
  parallelRectangles,
  perpendicularRectangles,
  planck,
  planckCurve,
  shields,
  twoSurfaces,
} from './engine';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

/** Composite Simpson integral of the Planck function, independent of the series used by the engine. */
function integrate(t: number, l1: number, l2: number, n = 20000): number {
  const h = (l2 - l1) / n;
  let s = planck(l1, t) + planck(l2, t);
  for (let i = 1; i < n; i++) s += planck(l1 + i * h, t) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

describe('blackbody radiation', () => {
  it('5800 K: peak 0.49962 um, Eb 6.4169e7 W/m2, fraction 0.4 to 0.7 um 0.36766', () => {
    const r = blackbody(5800, 0.4e-6, 0.7e-6);
    expect(rel(r.peak * 1e6, 0.49962)).toBeLessThan(1e-4);
    expect(rel(r.emissive, 6.4169e7)).toBeLessThan(1e-4);
    expect(rel(r.fraction!, 0.36766)).toBeLessThan(1e-4);
  });
  it('band fractions agree with direct integration of the Planck law (both series branches)', () => {
    for (const [t, l1, l2] of [
      [5800, 0.4e-6, 0.7e-6],
      [300, 8e-6, 14e-6],
      [1500, 1e-6, 4e-6],
      [10000, 0.1e-6, 100e-6],
    ] as const) {
      const direct = integrate(t, l1, l2) / (SIGMA * t ** 4);
      expect(Math.abs(bandFractionTo(l2, t) - bandFractionTo(l1, t) - direct)).toBeLessThan(2e-5);
    }
  });
  it('fraction from 0 to infinity is 1 and F(0 to lambda T = 2898 um K) is about 0.2501', () => {
    expect(bandFractionTo(1e-2, 5800)).toBeCloseTo(1, 8);
    expect(bandFractionTo(2897.77e-6 / 1000, 1000)).toBeCloseTo(0.25009, 4);
  });
  it("gives the spectral power at one wavelength and the Planck curve peaks at Wien's wavelength", () => {
    const r = blackbody(1000, 3e-6);
    expect(rel(r.spectral!, planck(3e-6, 1000))).toBeLessThan(1e-14);
    const curve = planckCurve(1000);
    const best = curve.reduce((a, b) => (b[1] > a[1] ? b : a));
    expect(rel(best[0], 2.897771955e-6)).toBeLessThan(0.05);
  });
  it('rejects non-physical input', () => {
    expect(() => blackbody(0)).toThrow(CalcError);
    expect(() => blackbody(-5)).toThrow(CalcError);
    expect(() => blackbody(300, 2e-6, 1e-6)).toThrow(/longer/);
    expect(() => blackbody(300, 0, 1e-6)).toThrow(CalcError);
  });
});

describe('view factors', () => {
  it('coaxial disks r1 = r2 = 0.5, separation 1: F12 = 0.17157', () => {
    const r = disks(0.5, 0.5, 1);
    expect(Math.abs(r.f12 - 0.17157)).toBeLessThan(1e-5);
    expect(r.f21).toBeCloseTo(r.f12, 14);
  });
  it('disks reciprocity for unequal sizes and the far-field limit', () => {
    const r = disks(1, 0.2, 5);
    expect(r.f12 * Math.PI * 1 ** 2).toBeCloseTo(r.f21 * Math.PI * 0.2 ** 2, 12);
    const far = disks(0.1, 0.1, 100);
    expect(rel(far.f12, (0.1 * 0.1) / (100 * 100))).toBeLessThan(2e-3);
  });
  it('aligned parallel squares one side apart: 0.1998, and a very close pair tends to 1', () => {
    expect(Math.abs(parallelRectangles(1, 1, 1).f12 - 0.19982)).toBeLessThan(1e-4);
    expect(parallelRectangles(10, 10, 0.001).f12).toBeGreaterThan(0.99);
  });
  it('perpendicular equal squares: 0.20004, with reciprocity for unequal rectangles', () => {
    expect(Math.abs(perpendicularRectangles(1, 1, 1).f12 - 0.20004)).toBeLessThan(1e-4);
    const r = perpendicularRectangles(2, 1, 3);
    expect(r.f12 * 1).toBeCloseTo(r.f21 * 3, 12);
  });
  it('concentric cylinders and spheres', () => {
    expect(concentric('cylinder', 1, 2).f21).toBe(0.5);
    expect(concentric('sphere', 1, 2).f21).toBe(0.25);
    expect(() => concentric('sphere', 2, 1)).toThrow(/larger/);
    expect(() => disks(0, 1, 1)).toThrow(CalcError);
  });
});

describe('exchange between surfaces', () => {
  it('large parallel plates 800 K (eps 0.8) and 500 K (eps 0.6): 10269 W/m2', () => {
    expect(rel(parallelPlates(800, 500, 0.8, 0.6), 10269)).toBeLessThan(1e-4);
    const r = twoSurfaces({ t1: 800, t2: 500, e1: 0.8, e2: 0.6, a1: 1, a2: 1, f12: 1 });
    expect(rel(r.q12, 10269)).toBeLessThan(1e-4);
    expect(r.flux1).toBe(r.q12);
  });
  it('a small convex body in a large enclosure sees only its own emissivity', () => {
    const r = twoSurfaces({ t1: 600, t2: 300, e1: 0.5, e2: 0.9, a1: 0.1, a2: 1e6, f12: 1 });
    expect(rel(r.q12, 0.5 * 0.1 * SIGMA * (600 ** 4 - 300 ** 4))).toBeLessThan(1e-6);
  });
  it('rejects emissivity outside (0, 1] and a bad view factor', () => {
    expect(() => twoSurfaces({ t1: 5, t2: 3, e1: 0, e2: 1, a1: 1, a2: 1, f12: 1 })).toThrow(/emissivity/);
    expect(() => twoSurfaces({ t1: 5, t2: 3, e1: 1, e2: 1.2, a1: 1, a2: 1, f12: 1 })).toThrow(/emissivity/);
    expect(() => twoSurfaces({ t1: 5, t2: 3, e1: 1, e2: 1, a1: 1, a2: 1, f12: 0 })).toThrow(/view factor/);
  });
  it('one shield with equal emissivities halves the flux; N shields give 1/(N+1)', () => {
    const base = { t1: 800, t2: 400, e1: 0.7, e2: 0.7, eShield: 0.7 };
    const none = shields({ ...base, count: 0 });
    expect(none.flux).toBeCloseTo(parallelPlates(800, 400, 0.7, 0.7), 8);
    const one = shields({ ...base, count: 1 });
    expect(one.flux).toBeCloseTo(none.flux / 2, 8);
    expect(one.reduction).toBeCloseTo(0.5, 12);
    expect(one.shieldTemperatures[0] ** 4).toBeCloseTo((800 ** 4 + 400 ** 4) / 2, 3);
    const three = shields({ ...base, count: 3 });
    expect(three.flux).toBeCloseTo(none.flux / 4, 8);
    expect(three.shieldTemperatures).toHaveLength(3);
    expect(() => shields({ ...base, count: 1.5 })).toThrow(CalcError);
    expect(() => shields({ ...base, eShield: 0, count: 1 })).toThrow(CalcError);
  });
  it('a low-emissivity shield lowers the flux more', () => {
    const lowE = shields({ t1: 800, t2: 400, e1: 0.7, e2: 0.7, eShield: 0.05, count: 1 });
    const same = shields({ t1: 800, t2: 400, e1: 0.7, e2: 0.7, eShield: 0.7, count: 1 });
    expect(lowE.flux).toBeLessThan(same.flux / 5);
  });
});

describe('N-surface gray enclosure', () => {
  it('two surfaces reproduce the resistance-network result', () => {
    const a1 = 0.5;
    const a2 = 2;
    const f = [
      [0, 1],
      [a1 / a2, 1 - a1 / a2],
    ];
    const r = enclosure(
      [
        { area: a1, emissivity: 0.8, t: 700 },
        { area: a2, emissivity: 0.5, t: 400 },
      ],
      f,
    );
    const two = twoSurfaces({ t1: 700, t2: 400, e1: 0.8, e2: 0.5, a1, a2, f12: 1 });
    expect(rel(r.q[0], two.q12)).toBeLessThan(1e-9);
    expect(r.q[0] + r.q[1]).toBeCloseTo(0, 6);
  });
  it('a three-surface cavity conserves energy and gives a black surface J = Eb', () => {
    // Long triangular duct with equal sides: each F_ij = 1/2.
    const f = [
      [0, 0.5, 0.5],
      [0.5, 0, 0.5],
      [0.5, 0.5, 0],
    ];
    const r = enclosure(
      [
        { area: 1, emissivity: 1, t: 1000 },
        { area: 1, emissivity: 0.5, t: 500 },
        { area: 1, emissivity: 0.8, t: 300 },
      ],
      f,
    );
    expect(r.q.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 5);
    expect(r.radiosity[0]).toBeCloseTo(SIGMA * 1000 ** 4, 3);
    expect(r.summationError).toBe(0);
    expect(r.reciprocityError).toBe(0);
  });
  it('rejects rows that do not close and wrong sizes', () => {
    const s = [
      { area: 1, emissivity: 0.5, t: 500 },
      { area: 1, emissivity: 0.5, t: 300 },
    ];
    expect(() =>
      enclosure(s, [
        [0, 0.5],
        [1, 0],
      ]),
    ).toThrow(/add to 1/);
    expect(() => enclosure(s, [[0, 1]])).toThrow(/by/);
    expect(() => enclosure([s[0]], [[1]])).toThrow(/at least two/);
    expect(() =>
      enclosure(
        [{ ...s[0], t: 0 }, s[1]],
        [
          [0, 1],
          [1, 0],
        ],
      ),
    ).toThrow(CalcError);
  });
});
