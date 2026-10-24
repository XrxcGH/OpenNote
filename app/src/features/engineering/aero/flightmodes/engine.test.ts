import { describe, expect, it } from 'vitest';
import { AeroError } from '../common';
import { characteristic, flightModes, longitudinalA } from './engine';

const close = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThan(tol);
const A = [
  [-0.02, 0.05, 0, -9.81],
  [-0.1, -1.2, 60, 0],
  [0.001, -0.05, -1.5, 0],
  [0, 0, 1, 0],
];

describe('aircraft dynamic modes', () => {
  it('finds the short period and phugoid', () => {
    const r = flightModes({ axis: 'longitudinal', A });
    const sp = r.modes.find((m) => m.id === 'shortPeriod')!;
    const ph = r.modes.find((m) => m.id === 'phugoid')!;
    close(sp.root.re, -1.3521, 1e-4);
    close(sp.root.im, 1.7249, 1e-4);
    close(sp.wn, 2.1917, 1e-4);
    close(sp.zeta, 0.6169, 1e-4);
    close(ph.root.re, -0.007918, 1e-4);
    close(ph.root.im, 0.112247, 1e-4);
    close(ph.wn, 0.11253, 1e-4);
    close(ph.zeta, 0.07037, 1e-4);
  });

  it('builds a characteristic polynomial whose roots are the eigenvalues (independent check)', () => {
    const c = characteristic(A);
    // Trace and determinant identities: c1 = -trace(A), c4 = det(A).
    close(c[1]!, -(-0.02 - 1.2 - 1.5 + 0), 1e-12);
    const r = flightModes({ axis: 'longitudinal', A });
    // Each eigenvector satisfies A v = s v.
    for (const m of r.modes) {
      const v = m.shape.map((s) => ({
        re: s.magnitude * Math.cos((s.phase * Math.PI) / 180),
        im: s.magnitude * Math.sin((s.phase * Math.PI) / 180),
      }));
      for (let i = 0; i < 4; i += 1) {
        let re = 0;
        let im = 0;
        for (let j = 0; j < 4; j += 1) {
          re += A[i]![j]! * v[j]!.re;
          im += A[i]![j]! * v[j]!.im;
        }
        const sre = m.root.re * v[i]!.re - m.root.im * v[i]!.im;
        const sim = m.root.re * v[i]!.im + m.root.im * v[i]!.re;
        close(re, sre, 1e-6 * (1 + Math.abs(sre)));
        close(im, sim, 1e-6 * (1 + Math.abs(sim)));
      }
    }
  });

});

describe('aircraft dynamic modes: approximations, derivatives, and edge cases', () => {
  it('gives the two-state approximations', () => {
    const r = flightModes({ axis: 'longitudinal', A });
    const sp = r.approximations.find((a) => a.id === 'shortPeriod')!;
    // Independent: eig of [[-1.2, 60], [-0.05, -1.5]].
    close(sp.wn, Math.sqrt(1.8 + 3), 1e-12);
    const ph = r.approximations.find((a) => a.id === 'phugoid')!;
    close(ph.wn, Math.sqrt((0.1 * 9.81) / 60), 1e-12);
  });

  it('assembles A from dimensional derivatives', () => {
    const a = longitudinalA({
      Xu: -0.02,
      Xw: 0.05,
      Zu: -0.1,
      Zw: -1.2,
      Mu: 0.001,
      Mw: -0.05,
      Mq: -1.5,
      Mwdot: 0,
      U0: 60,
      theta0: 0,
    });
    close(a[0]![3]!, -9.80665, 1e-12);
    close(a[1]![2]!, 60, 1e-12);
    expect(() =>
      longitudinalA({ Xu: 0, Xw: 0, Zu: 0, Zw: 0, Mu: 0, Mw: 0, Mq: 0, Mwdot: 0, U0: 0, theta0: 0 }),
    ).toThrow(AeroError);
  });

  it('classifies lateral modes', () => {
    const lat = [
      [-0.1, 0, -60, 9.81],
      [-0.02, -2, 0.5, 0],
      [0.01, -0.05, -0.2, 0],
      [0, 1, 0, 0],
    ];
    const r = flightModes({ axis: 'lateral', A: lat });
    expect(r.modes.map((m) => m.id).sort()).toEqual(['dutchRoll', 'roll', 'spiral']);
    const roll = r.modes.find((m) => m.id === 'roll')!;
    close(roll.root.re, -2, 0.2);
  });

  it('rejects a matrix that is not 4 by 4', () => {
    expect(() =>
      flightModes({
        axis: 'longitudinal',
        A: [
          [1, 2],
          [3, 4],
        ],
      }),
    ).toThrow(AeroError);
    expect(() => flightModes({ axis: 'longitudinal', A: A.map((r) => r.map(() => Number.NaN)) })).toThrow(AeroError);
  });

  it('handles a zero matrix, a huge one and a bad trim speed', () => {
    const zero = flightModes({ axis: 'longitudinal', A: A.map((r) => r.map(() => 0)) });
    zero.modes.forEach((m) => {
      expect(Math.abs(m.root.re)).toBeLessThan(1e-3);
      expect(m.stable).toBe(m.root.re < 0);
    });
    // Scaling A by k scales every eigenvalue by k.
    const k = 1e4;
    const big = flightModes({ axis: 'longitudinal', A: A.map((r) => r.map((x) => x * k)) });
    const sp = big.modes.find((m) => m.id === 'shortPeriod')!;
    close(sp.root.re / k, -1.3521, 1e-4);
    close(sp.root.im / k, 1.7249, 1e-4);
    const d = { Xu: 0, Xw: 0, Zu: 0, Zw: 0, Mu: 0, Mw: 0, Mq: 0, Mwdot: 0, theta0: 0 };
    expect(() => longitudinalA({ ...d, U0: 0 })).toThrow(AeroError);
    expect(() => longitudinalA({ ...d, U0: -50 })).toThrow(AeroError);
  });
});
