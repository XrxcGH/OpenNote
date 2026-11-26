import '../text';
import { describe, expect, it } from 'vitest';
import { firstTexts, runTool } from '../kit/read';
import { SolidsError } from '../kit/types';
import { failure, laminate, readLayup, reducedStiffness, transformedStiffness } from './engine';
import { compositesSpec } from './spec';

const rel = (a: number | undefined, b: number, tol: number) =>
  expect(Math.abs((a ?? NaN) - b) / Math.abs(b), `${a} vs ${b}`).toBeLessThanOrEqual(tol);
const near = (a: number | undefined, b: number, tol: number) =>
  expect(Math.abs((a ?? NaN) - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol);
const code = (work: () => unknown) => {
  try {
    work();
  } catch (error) {
    return error instanceof SolidsError ? error.code : 'other';
  }
  return 'none';
};

const GPa = 1e9;
const MPa = 1e6;
const lamina = { E1: 181 * GPa, E2: 10.3 * GPa, nu12: 0.28, G12: 7.17 * GPa };
const strengths = { Xt: 1500 * MPa, Xc: 1500 * MPa, Yt: 40 * MPa, Yc: 246 * MPa, S: 68 * MPa };
const deg = (d: number) => (d * Math.PI) / 180;
type M3 = number[][];
const mul = (a: M3, b: M3): M3 => a.map((row) => b[0].map((_, j) => row.reduce((s, v, k) => s + v * b[k][j], 0)));
const inv3 = (m: M3): M3 => {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
};

describe('lamina stiffness', () => {
  it('gives the validation Q', () => {
    const Q = reducedStiffness(lamina);
    rel(Q.Q11, 181811 * MPa, 1e-5);
    rel(Q.Q12, 2896.9 * MPa, 1e-5);
    rel(Q.Q22, 10346.2 * MPa, 1e-5);
    rel(Q.Q66, 7170 * MPa, 1e-12);
  });

  it('gives the validation Q̄ at +30°, and agrees with T⁻¹ Q R T R⁻¹', () => {
    const Q = reducedStiffness(lamina);
    const Qb = transformedStiffness(Q, deg(30));
    rel(Qb[0][0], 109379 * MPa, 1e-5);
    rel(Qb[0][1], 32462.6 * MPa, 1e-5);
    rel(Qb[0][2], 54193.0 * MPa, 1e-5);
    rel(Qb[1][1], 23646.8 * MPa, 1e-5);
    rel(Qb[1][2], 20053.5 * MPa, 1e-5);
    rel(Qb[2][2], 36735.6 * MPa, 1e-5);
    // Independent: the stress transformation T and Reuter's matrix R.
    for (const d of [-60, 15, 45, 110]) {
      const [c, s] = [Math.cos(deg(d)), Math.sin(deg(d))];
      const T = [
        [c * c, s * s, 2 * s * c],
        [s * s, c * c, -2 * s * c],
        [-s * c, s * c, c * c - s * s],
      ];
      const R = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 2],
      ];
      const Qm = [
        [Q.Q11, Q.Q12, 0],
        [Q.Q12, Q.Q22, 0],
        [0, 0, Q.Q66],
      ];
      const expected = mul(mul(mul(mul(inv3(T), Qm), R), T), inv3(R));
      const got = transformedStiffness(Q, deg(d));
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) near(got[i][j], expected[i][j], 1e-6 * Q.Q11);
    }
  });
});

describe('laminates', () => {
  it('gives the [0/90]s validation case', () => {
    const r = laminate({ lamina, t: 0.125e-3, angles: readLayup('[0/90]s').map(deg), N: [100e3, 0, 0], M: [0, 0, 0] });
    rel(r.A[0][0], 48039.3e3, 1e-5);
    rel(r.A[1][1], 48039.3e3, 1e-5);
    rel(r.A[0][1], 1448.46e3, 1e-5);
    rel(r.A[2][2], 3585e3, 1e-9);
    rel(r.D[0][0], 1.6706, 1e-5);
    rel(r.D[1][1], 0.33103, 1e-4);
    rel(r.engineering.Ex, 95991 * MPa, 1e-5);
    rel(r.engineering.Ey, 95991 * MPa, 1e-5);
    for (const row of r.B) for (const value of row) near(value, 0, 1e-6);
    // Independent: with B = 0 the mid-plane strains are A⁻¹ N.
    const strain = inv3(r.A).map((row) => row[0] * 100e3);
    for (let i = 0; i < 3; i++) near(r.e0[i], strain[i], 1e-12);
    const zeroPly = r.faces[0];
    rel(zeroPly.local[0], r.Qbar[0][0][0] * strain[0] + r.Qbar[0][0][1] * strain[1], 1e-9);
  });

  it('couples bending and stretching in an unsymmetric laminate', () => {
    const r = laminate({ lamina, t: 0.125e-3, angles: [0, deg(90)], N: [0, 0, 0], M: [10, 0, 0] });
    expect(Math.abs(r.B[0][0])).toBeGreaterThan(0);
    expect(Math.abs(r.e0[0])).toBeGreaterThan(0);
    // Equilibrium: the faces' stresses integrate back to the moment.
    let moment = 0;
    for (let k = 0; k < 2; k++) {
      const [bottom, top] = [r.faces[2 * k], r.faces[2 * k + 1]];
      const [z0, z1] = [bottom.z, top.z];
      const [s0, s1] = [bottom.global[0], top.global[0]];
      // σx is linear through the ply: ∫σ z dz exactly.
      const slope = (s1 - s0) / (z1 - z0);
      const a = s0 - slope * z0;
      moment += (a * (z1 * z1 - z0 * z0)) / 2 + (slope * (z1 ** 3 - z0 ** 3)) / 3;
    }
    rel(moment, 10, 1e-9);
  });

  it('reads layups in the usual notation', () => {
    expect(readLayup('[0/90]s')).toEqual([0, 90, 90, 0]);
    expect(readLayup('0 90, 45')).toEqual([0, 90, 45]);
    expect(readLayup('[±45/0]2s')).toEqual([45, -45, 0, 45, -45, 0, 0, -45, 45, 0, -45, 45]);
    expect(readLayup('[0/45/-45/90]s')).toHaveLength(8);
  });
});

describe('failure', () => {
  it('gives the validation Tsai–Wu and Tsai–Hill indices', () => {
    const f = failure([500 * MPa, 20 * MPa, 30 * MPa], strengths);
    rel(f.tsaiWu, 0.69789, 1e-4);
    rel(f.ratioWu, 1.2858, 1e-4);
    rel(f.tsaiHill, 0.5513, 1e-4);
    // Scaling the stresses by R puts Tsai–Wu exactly at 1.
    const R = f.ratioWu;
    rel(failure([500 * MPa * R, 20 * MPa * R, 30 * MPa * R], strengths).tsaiWu, 1, 1e-12);
    rel(f.maxStress, 0.5, 1e-12);
  });

  it('uses the compressive strengths for compressive stresses', () => {
    const f = failure([-750 * MPa, -123 * MPa, 0], strengths);
    rel(f.maxStress, 0.5, 1e-12);
    expect(failure([0, 0, 0], strengths).ratioWu).toBe(Infinity);
  });

  it('names what is wrong', () => {
    expect(code(() => reducedStiffness({ ...lamina, nu12: 5 }))).toBe('laminaPoisson');
    expect(code(() => reducedStiffness({ ...lamina, E2: 0 }))).toBe('positive');
    expect(code(() => readLayup('[0/ninety]s'))).toBe('layup');
    expect(code(() => readLayup(''))).toBe('layup');
    expect(code(() => laminate({ lamina, t: 0, angles: [0], N: [0, 0, 0], M: [0, 0, 0] }))).toBe('positive');
    expect(code(() => failure([1, 1, 1], { ...strengths, S: 0 }))).toBe('positive');
  });

  it('runs the form, with first-ply failure when the strengths are given', () => {
    const r = runTool(
      compositesSpec,
      { ...firstTexts(compositesSpec), layup: '[0/45/-45/90]s', Xt: '1500', Xc: '1500', Yt: '40', Yc: '246', S: '68' },
      'si',
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.outcome.rows.find((row) => row.id === 'firstPly')?.value).toBeTypeOf('number');
    // Loaded by its first-ply failure load, the laminate is just at failure: the strength ratio is 1.
    const fpf = r.ok ? r.outcome.rows.find((row) => row.id === 'NxFpf')?.value : undefined;
    expect(fpf).toBeTypeOf('object');
    const atFailure = runTool(
      compositesSpec,
      {
        ...firstTexts(compositesSpec),
        layup: '[0/45/-45/90]s',
        Xt: '1500',
        Xc: '1500',
        Yt: '40',
        Yc: '246',
        S: '68',
        Nx: `${(fpf as { v: number }).v / 1000} N/mm`,
      },
      'si',
    );
    const R = atFailure.ok ? atFailure.outcome.rows.find((row) => row.id === 'ratio')?.value : NaN;
    rel(R as number, 1, 1e-9);
    const bad = runTool(compositesSpec, { ...firstTexts(compositesSpec), Nx: '100 MPa' }, 'si');
    expect(bad.ok ? 'none' : bad.fields.map((one) => one.error.code).join()).toBe('unitMismatch');
  });
});
