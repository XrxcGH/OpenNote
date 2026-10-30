import { describe, expect, it } from 'vitest';
import { firstTexts, runTool } from '../kit/read';
import { SolidsError } from '../kit/types';
import { axialMember, bendingPoint, combinedPoint, torsionMember } from './engine';
import { membersSpec } from './spec';

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

describe('torsion', () => {
  it('gives the solid shaft validation case', () => {
    const r = torsionMember({ section: 'solid', T: 1000, L: 1, G: 80e9, d: 0.05 });
    rel(r.tauMax, 40.744e6, 1e-5);
    rel(r.phi, 0.020372, 1e-5);
    // Independent: τ = 16T/(πd³) and φ = 32TL/(πd⁴G).
    rel(r.tauMax, (16 * 1000) / (Math.PI * 0.05 ** 3), 1e-12);
    rel(r.phi, (32 * 1000) / (Math.PI * 0.05 ** 4 * 80e9), 1e-12);
    rel(r.gammaMax, r.tauMax / 80e9, 1e-12);
  });

  it('gives the closed box validation case by Bredt’s formulas', () => {
    const r = torsionMember({ section: 'thinClosed', T: 500, L: 1, G: 80e9, bm: 0.1, hm: 0.05, t: 0.002 });
    rel(r.tauMax, 25e6, 1e-6);
    rel(r.phi, 0.009375, 1e-6);
    rel(r.Am, 0.005, 1e-12);
  });

  it('turns 10 kW at 1500 rpm into a torque', () => {
    const r = torsionMember({ section: 'solid', power: 10e3, speed: 1500 / 60, L: 1, G: 80e9, d: 0.05 });
    rel(r.T, 63.662, 1e-5);
    rel(r.T, 10e3 / (1500 * ((2 * Math.PI) / 60)), 1e-12);
  });

  it('gives a hollow shaft its inner and outer stresses', () => {
    const r = torsionMember({ section: 'hollow', T: 2000, L: 2, G: 79e9, d: 0.06, di: 0.04 });
    const J = (Math.PI * (0.06 ** 4 - 0.04 ** 4)) / 32;
    rel(r.J, J, 1e-12);
    rel(r.tauMax, (2000 * 0.03) / J, 1e-12);
    rel(r.tauMin, (2000 * 0.02) / J, 1e-12);
    rel(r.phi, (2000 * 2) / (79e9 * J), 1e-12);
  });

  it('treats an open section as a thin strip', () => {
    const r = torsionMember({ section: 'thinOpen', T: 10, L: 1, G: 80e9, s: 0.15, t: 0.002 });
    rel(r.J, (0.15 * 0.002 ** 3) / 3, 1e-12);
    rel(r.tauMax, (3 * 10) / (0.15 * 0.002 ** 2), 1e-12);
  });

  it('keeps the sign of the torque, gives zero for none, and scales', () => {
    const base = { section: 'solid' as const, L: 1, G: 80e9, d: 0.05 };
    expect(torsionMember({ ...base, T: 0 }).tauMax).toBe(0);
    rel(-torsionMember({ ...base, T: -1000 }).phi, 0.020372, 1e-5);
    rel(torsionMember({ ...base, T: 1e12, d: 50 }).tauMax, (16 * 1e12) / (Math.PI * 50 ** 3), 1e-12);
  });

  it('names what is wrong', () => {
    expect(code(() => torsionMember({ section: 'hollow', T: 1, L: 1, G: 1, d: 0.05, di: 0.05 }))).toBe('innerTooBig');
    expect(code(() => torsionMember({ section: 'solid', T: 1, L: 0, G: 1, d: 0.05 }))).toBe('positive');
    expect(code(() => torsionMember({ section: 'solid', T: 1, L: 1, G: -1, d: 0.05 }))).toBe('positive');
    expect(code(() => torsionMember({ section: 'solid', T: NaN, L: 1, G: 1, d: 0.05 }))).toBe('notFinite');
    expect(code(() => torsionMember({ section: 'solid', power: 1, speed: 0, L: 1, G: 1, d: 1 }))).toBe('positive');
    const box = { section: 'thinClosed' as const, T: 1, L: 1, G: 1, bm: 0.1, hm: 0.05 };
    expect(code(() => torsionMember({ ...box, t: 0.06 }))).toBe('tooThick');
  });
});

describe('axial members', () => {
  it('gives the stress and stretch of a bar with a free end', () => {
    const r = axialMember({ ends: 'free', P: 50e3, A: 500e-6, L: 1, E: 200e9 });
    rel(r.sigma1, 100e6, 1e-12);
    rel(r.delta, 0.5e-3, 1e-12);
    rel(r.strain, 500e-6, 1e-12);
    const hot = axialMember({ ends: 'free', P: 0, A: 500e-6, L: 2, E: 200e9, alpha: 12e-6, dT: 50 });
    rel(hot.delta, 12e-6 * 50 * 2, 1e-12);
    expect(hot.sigma1).toBe(0);
  });

  it('splits a load between two fixed ends as Pb/L and Pa/L', () => {
    const r = axialMember({ ends: 'fixed', P: 30e3, A: 500e-6, L: 1, E: 200e9, a: 0.4 });
    rel(r.N1, 18e3, 1e-12);
    rel(r.N2, -12e3, 1e-12);
    rel(r.delta, (18e3 * 0.4) / (200e9 * 500e-6), 1e-12);
  });

  it('gives −EαΔT for a heated bar between walls', () => {
    const r = axialMember({ ends: 'fixed', P: 0, A: 500e-6, L: 1, E: 200e9, a: 0.4, alpha: 12e-6, dT: 50 });
    rel(r.sigma1, -200e9 * 12e-6 * 50, 1e-12);
    rel(r.sigma2, -120e6, 1e-12);
    near(r.delta, 0, 1e-15);
  });

  it('names what is wrong', () => {
    const bar = { ends: 'fixed' as const, P: 1, A: 1e-4, L: 1, E: 1e9 };
    expect(code(() => axialMember({ ...bar, a: 1.5 }))).toBe('loadOffBar');
    expect(code(() => axialMember({ ...bar, a: NaN }))).toBe('notFinite');
    expect(code(() => axialMember({ ...bar, ends: 'free', A: 0 }))).toBe('positive');
  });
});

describe('bending at a point', () => {
  it('gives −Mz y/Iz and My z/Iy with no product of inertia', () => {
    const r = bendingPoint({ My: 2e3, Mz: 10e3, Iy: 2e-6, Iz: 8e-6, y: 0.025, z: 0.01 });
    rel(r.sigmaY, (-10e3 * 0.025) / 8e-6, 1e-12);
    rel(r.sigmaZ, (2e3 * 0.01) / 2e-6, 1e-12);
    rel(r.sigma, -31.25e6 + 10e6, 1e-12);
    // tan α = (Iz/Iy) tan θ, with tan θ = My/Mz (Hibbeler).
    rel(Math.tan(r.alpha), (8e-6 / 2e-6) * (2e3 / 10e3), 1e-12);
  });

  it('agrees with bending about the principal axes when Iyz is not zero', () => {
    const [Iy, Iz, Iyz, My, Mz, y, z] = [2e-6, 8e-6, 2e-6, 1.5e3, 10e3, 0.03, -0.02];
    const r = bendingPoint({ My, Mz, Iy, Iz, Iyz, y, z });
    // Turn the axes until the product of inertia vanishes, then use the symmetric formula.
    const th = Math.atan2(2 * Iyz, Iz - Iy) / 2;
    const [c, s] = [Math.cos(th), Math.sin(th)];
    const Izp = Iz * c * c + Iy * s * s + 2 * Iyz * s * c;
    const Iyp = Iz * s * s + Iy * c * c - 2 * Iyz * s * c;
    near((Iy - Iz) * s * c + Iyz * (c * c - s * s), 0, 1e-18);
    const [yp, zp] = [y * c + z * s, -y * s + z * c];
    const [Myp, Mzp] = [My * c + Mz * s, -My * s + Mz * c];
    rel(r.sigma, (-Mzp * yp) / Izp + (Myp * zp) / Iyp, 1e-10);
  });

  it('adds N/A and gives VQ/(It)', () => {
    const r = bendingPoint({
      My: 0,
      Mz: 0,
      Iy: 1e-6,
      Iz: 4e-6,
      y: 0,
      z: 0,
      N: 20e3,
      A: 2e-3,
      V: 10e3,
      Q: 5e-5,
      t: 0.01,
    });
    rel(r.sigma, 10e6, 1e-12);
    rel(r.tau, (10e3 * 5e-5) / (4e-6 * 0.01), 1e-12);
  });

  it('names what is wrong', () => {
    const base = { My: 1, Mz: 1, Iy: 1e-6, Iz: 1e-6, y: 0, z: 0 };
    expect(code(() => bendingPoint({ ...base, Iyz: 1e-6 }))).toBe('inertiaMatrix');
    expect(code(() => bendingPoint({ ...base, Iz: 0 }))).toBe('positive');
    expect(code(() => bendingPoint({ ...base, N: 5 }))).toBe('positive');
    expect(code(() => bendingPoint({ ...base, V: 5, Q: 1e-6, t: 0 }))).toBe('positive');
  });
});

describe('combined loads at a point', () => {
  it('adds torsion and transverse shear at the side of a round shaft', () => {
    const r = combinedPoint({ shape: 'circle', d: 0.05, Vy: 5e3, T: 1e3, Mz: 500, y: 0, z: 0.025 });
    const A = (Math.PI * 0.05 ** 2) / 4;
    // At the neutral axis: no bending stress, 4V/(3A) from the shear, and −16T/(πd³) along y from the torque.
    near(r.sigma, 0, 1e-6);
    rel(r.tauXy, (4 * 5e3) / (3 * A) - (16 * 1e3) / (Math.PI * 0.05 ** 3), 1e-12);
    near(r.tauXz, 0, 1e-6);
    rel(r.principal[0], Math.abs(r.tauXy), 1e-12);
    rel(r.principal[2], -Math.abs(r.tauXy), 1e-12);
  });

  it('gives the bending stress at the top of a round shaft', () => {
    const r = combinedPoint({ shape: 'circle', d: 0.05, Mz: 1e3, N: 10e3, y: 0.025, z: 0 });
    rel(r.sigma, 10e3 / ((Math.PI * 0.05 ** 2) / 4) - (32 * 1e3) / (Math.PI * 0.05 ** 3), 1e-12);
    const [s1, s2, s3] = r.principal;
    expect(s2).toBe(0);
    rel(s1 + s3, r.sigma, 1e-12);
  });

  it('gives 1.5 V/A at the middle of a rectangle and zero at its edge', () => {
    const mid = combinedPoint({ shape: 'rect', b: 0.05, h: 0.1, Vy: 10e3, y: 0, z: 0 });
    rel(mid.tauXy, 1.5 * (10e3 / 0.005), 1e-12);
    const edge = combinedPoint({ shape: 'rect', b: 0.05, h: 0.1, Vy: 10e3, Mz: 2e3, y: 0.05, z: 0 });
    near(edge.tauXy, 0, 1e-9);
    rel(edge.sigma, -(6 * 2e3) / (0.05 * 0.1 ** 2), 1e-12);
    const side = combinedPoint({ shape: 'rect', b: 0.05, h: 0.1, Vz: 10e3, y: 0, z: 0 });
    rel(side.tauXz, 1.5 * (10e3 / 0.005), 1e-12);
  });

  it('gives a round tube its shear at the neutral axis', () => {
    const [R, Ri, V] = [0.03, 0.02, 8e3];
    const r = combinedPoint({ shape: 'tube', d: 2 * R, di: 2 * Ri, Vy: V, y: 0, z: 0.025 });
    const A = Math.PI * (R * R - Ri * Ri);
    rel(r.tauXy, ((4 * V) / (3 * A)) * ((R * R + R * Ri + Ri * Ri) / (R * R + Ri * Ri)), 1e-12);
  });

  it('names what is wrong', () => {
    expect(code(() => combinedPoint({ shape: 'circle', d: 0.05, y: 0.03, z: 0 }))).toBe('outside');
    expect(code(() => combinedPoint({ shape: 'tube', d: 0.05, di: 0.04, y: 0, z: 0 }))).toBe('outside');
    expect(code(() => combinedPoint({ shape: 'rect', b: 0.05, h: 0.1, T: 1, y: 0, z: 0 }))).toBe('rectTorsion');
    expect(code(() => combinedPoint({ shape: 'rect', b: 0.05, h: -0.1, y: 0, z: 0 }))).toBe('positive');
  });
});

describe('the members form', () => {
  it('reads the torsion case in SI and US units alike', () => {
    const si = runTool(membersSpec, { ...firstTexts(membersSpec) }, 'si');
    const us = runTool(membersSpec, { ...firstTexts(membersSpec) }, 'us');
    expect(si.ok && us.ok).toBe(true);
    if (si.ok && us.ok) {
      const tau = (run: typeof si) => (run.ok ? run.outcome.rows.find((row) => row.id === 'tauMax')?.value : 0);
      expect(tau(si)).toEqual(tau(us));
    }
  });

  it('marks a torque typed in a force unit', () => {
    const run = runTool(membersSpec, { ...firstTexts(membersSpec), T: '3 kN' }, 'si');
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.fields.map((one) => [one.field, one.error.code])).toEqual([['T', 'unitMismatch']]);
  });
});
