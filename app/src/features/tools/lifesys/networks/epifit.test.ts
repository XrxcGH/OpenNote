// Fitting β and γ to case counts, against data and fits made independently in Python (SciPy solve_ivp at 1e-11
// tolerance for the data, curve_fit for the noisy case): N 1000, I₀ 1, β 0.5, γ 0.2, every 4 days to day 60.
import { describe, expect, it } from 'vitest';
import { LsError } from '../num/errors';
import { epiFitResult, sirCurve } from './engine';

const T = Array.from({ length: 16 }, (_, i) => 4 * i);
const PREV = [
  1, 3.303, 10.752, 33.4, 90.687, 181.621, 233.521, 204.873, 143.65, 89.997, 53.315, 30.691, 17.402, 9.787, 5.479, 3.06,
];
const CUM = [
  1, 4.846, 17.354, 56.088, 160.053, 359.295, 582.719, 733.648, 812.199, 850.929, 870.479, 880.684, 886.149, 889.124,
  890.759, 891.663,
];
const NOISY = [1, 3, 11, 33, 93, 171, 234, 199, 152, 90, 55, 29, 17, 9, 6, 3];
const data = (ys: number[]) => T.map((t, i) => [t, ys[i]]);
const value = (r: ReturnType<typeof epiFitResult>, label: string) =>
  r.rows.find((x) => x.label === label)?.value as number;
const base = { n: 1000, i0: 1, beta0: 0.3, gamma0: 0.1 };

describe('SIR fit to case counts', () => {
  it('the forward model reproduces the independent prevalence and cumulative counts', () => {
    const prev = sirCurve(1000, 1, 0.5, 0.2, T, 'prevalence');
    const cum = sirCurve(1000, 1, 0.5, 0.2, T, 'cumulative');
    prev.forEach((v, i) => expect(Math.abs(v - PREV[i])).toBeLessThan(2e-3));
    cum.forEach((v, i) => expect(Math.abs(v - CUM[i])).toBeLessThan(2e-3));
  });

  it('recovers β 0.5 and γ 0.2 from exact prevalence', () => {
    const r = epiFitResult({ ...base, kind: 'prevalence', data: data(PREV) });
    expect(value(r, 'networks.r.beta')).toBeCloseTo(0.5, 4);
    expect(value(r, 'networks.r.gamma')).toBeCloseTo(0.2, 4);
    expect(value(r, 'networks.r.r0')).toBeCloseTo(2.5, 3);
  });

  it('recovers β and γ from cumulative cases', () => {
    const r = epiFitResult({ ...base, kind: 'cumulative', data: data(CUM) });
    expect(value(r, 'networks.r.beta')).toBeCloseTo(0.5, 4);
    expect(value(r, 'networks.r.gamma')).toBeCloseTo(0.2, 4);
    // The final size for R0 2.5, the root of z = 1 − e^(−2.5 z), is 89.2645% (the plan's planning-pass value).
    expect(value(r, 'networks.r.finalSize')).toBeCloseTo(89.2645, 2);
  });

  it('matches SciPy curve_fit on noisy, rounded counts', () => {
    const r = epiFitResult({ ...base, kind: 'prevalence', data: data(NOISY) });
    expect(value(r, 'networks.r.beta')).toBeCloseTo(0.49773664, 3);
    expect(value(r, 'networks.r.gamma')).toBeCloseTo(0.2007278, 3);
    const se = r.steps[1].vars?.sb as number;
    expect(se).toBeGreaterThan(0.0012);
    expect(se).toBeLessThan(0.0025);
  });

  it('rejects too few points, unsorted times, counts above N, and an I₀ of N or more', () => {
    const run =
      (rows: number[][], extra: Partial<typeof base> = {}) =>
      () =>
        epiFitResult({ ...base, ...extra, kind: 'prevalence', data: rows });
    expect(run(data(PREV).slice(0, 2))).toThrow(LsError);
    expect(
      run([
        [0, 1],
        [8, 5],
        [4, 3],
      ]),
    ).toThrow(LsError);
    expect(
      run([
        [0, 1],
        [4, 5],
        [8, 2000],
      ]),
    ).toThrow(LsError);
    expect(run(data(PREV), { i0: 1000 })).toThrow(LsError);
    expect(run(data(PREV), { beta0: 0 })).toThrow(LsError);
  });
});
