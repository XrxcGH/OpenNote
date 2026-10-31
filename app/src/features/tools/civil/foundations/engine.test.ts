import { describe, expect, it } from 'vitest';
import { CivilError } from '../core/types';
import {
  GAMMA_W,
  bearing,
  bearingFactors,
  coulombK,
  culmann,
  groupEfficiency,
  infiniteSlope,
  pile,
  rankineK,
  rankineProfile,
  retainingWall,
  searchCircles,
  slipCircle,
} from './engine';
import type { BearingInput, SlopeSoil } from './engine';

const within = (actual: number, expected: number, tol: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
const rel = (actual: number, expected: number, tol: number) =>
  expect(Math.abs(actual / expected - 1)).toBeLessThanOrEqual(tol);
const key = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof CivilError) return error.key;
    throw error;
  }
  throw new Error('expected a CivilError');
};
const rad = (d: number) => (d * Math.PI) / 180;

describe('lateral earth pressure', () => {
  it('gives the Rankine wall of the plan', () => {
    within(rankineK(30, 'active'), 1 / 3, 1e-12);
    within(rankineK(30, 'passive'), 3, 1e-12);
    within(rankineK(30, 'rest'), 0.5, 1e-12);
    const p = rankineProfile([{ h: 5, gamma: 18, gammaSat: 20, c: 0, phi: 30 }], 0, Infinity, 'active');
    within(p.P, 75, 1e-6);
    within(p.zBar, 5 / 3, 1e-6);
  });

  it('matches a numerical sum for layers with water, cohesion, and a surcharge', () => {
    const layers = [
      { h: 2, gamma: 17, gammaSat: 19, c: 10, phi: 25 },
      { h: 4, gamma: 18, gammaSat: 20, c: 0, phi: 32 },
    ];
    const q = 10;
    const zw = 3;
    const p = rankineProfile(layers, q, zw, 'active');
    // Riemann sum of the same diagram written from scratch.
    const N = 200000;
    let P = 0;
    let M = 0;
    for (let k = 0; k < N; k++) {
      const z = ((k + 0.5) * 6) / N;
      const sv = q + (z <= 2 ? 17 * z : 34 + (z <= 3 ? 18 * (z - 2) : 18 + (20 - GAMMA_W) * (z - 3)));
      const [phi, c] = z <= 2 ? [25, 10] : [32, 0];
      const Ka = Math.tan(rad(45 - phi / 2)) ** 2;
      const sigma = Math.max(0, Ka * sv - 2 * c * Math.sqrt(Ka)) + (z > zw ? GAMMA_W * (z - zw) : 0);
      P += (sigma * 6) / N;
      M += ((sigma * 6) / N) * (6 - z);
    }
    rel(p.P, P, 1e-6);
    rel(p.zBar, M / P, 1e-5);
    within(p.Pw, 0.5 * GAMMA_W * 9, 1e-9);
  });

  it('finds the tension crack of a cohesive soil', () => {
    const p = rankineProfile([{ h: 6, gamma: 18, gammaSat: 20, c: 20, phi: 0 }], 0, Infinity, 'active');
    within(p.zc, (2 * 20) / 18, 1e-9);
    within(p.P, 0.5 * (18 * 6 - 40) * (6 - 40 / 18), 1e-9);
  });

  it('agrees with a trial-wedge search for Coulomb with wall friction', () => {
    const phi = 30;
    const delta = 20;
    let best = 0;
    for (let k = 1; k < 200000; k++) {
      const rho = phi + (k / 200000) * (90 - phi);
      const W = 0.5 / Math.tan(rad(rho));
      best = Math.max(best, (W * Math.sin(rad(rho - phi))) / Math.cos(rad(rho - phi - delta)));
    }
    // Pa = ½ K γ H² with γ H² = 1, and the force is inclined at δ, so its normal part is P cos δ.
    rel(coulombK(phi, delta, 0, 0, 'active'), (2 * best) / 1, 1e-6);
    within(coulombK(30, 0, 0, 0, 'active'), 1 / 3, 1e-12);
    within(coulombK(30, 0, 0, 0, 'passive'), 3, 1e-12);
  });

  it('refuses impossible pressure inputs', () => {
    expect(key(() => rankineProfile([], 0, Infinity, 'active'))).toBe('errors.noRows');
    expect(key(() => rankineK(60, 'active'))).toBe('foundations.errors.phi');
    expect(key(() => coulombK(30, 35, 0, 0, 'active'))).toBe('foundations.errors.delta');
    expect(key(() => coulombK(30, 10, 0, 35, 'active'))).toBe('foundations.errors.beta');
    expect(key(() => rankineProfile([{ h: -1, gamma: 18, gammaSat: 20, c: 0, phi: 30 }], 0, Infinity, 'active'))).toBe(
      'errors.positive',
    );
  });
});

describe('retaining walls', () => {
  it('checks a cantilever wall by hand', () => {
    const r = retainingWall({
      stem: 4,
      t1: 0.3,
      t2: 0.3,
      tb: 0.5,
      toe: 0.5,
      heel: 2,
      gammaC: 24,
      gamma: 18,
      phi: 30,
      q: 0,
      deltaB: 20,
      ca: 0,
      front: 0,
    });
    const Pa = (0.5 / 3) * 18 * 4.5 * 4.5;
    const V = 24 * 0.3 * 4 + 24 * 2.8 * 0.5 + 18 * 2 * 4;
    const MR = 28.8 * 0.65 + 33.6 * 1.4 + 144 * 1.8;
    within(r.Pa, Pa, 1e-9);
    within(r.V, V, 1e-9);
    within(r.FSo, MR / (Pa * 1.5), 1e-9);
    within(r.FSs, (V * Math.tan(rad(20))) / Pa, 1e-9);
    const e = 1.4 - (MR - Pa * 1.5) / V;
    within(r.e, e, 1e-9);
    within(r.qMax, (V / 2.8) * (1 + (6 * e) / 2.8), 1e-9);
    expect(r.inThird).toBe(true);
  });

  it('refuses a stem that narrows downward', () => {
    expect(
      key(() =>
        retainingWall({
          stem: 4,
          t1: 0.5,
          t2: 0.3,
          tb: 0.5,
          toe: 0.5,
          heel: 2,
          gammaC: 24,
          gamma: 18,
          phi: 30,
          q: 0,
          deltaB: 20,
          ca: 0,
          front: 0,
        }),
      ),
    ).toBe('foundations.errors.stem');
  });
});

describe('bearing capacity', () => {
  const strip: BearingInput = {
    method: 'vesic',
    shape: 'strip',
    B: 2,
    L: 2,
    Df: 1,
    gamma: 18,
    gammaSat: 20,
    c: 0,
    phi: 30,
    zw: Infinity,
    e: 0,
    incline: 0,
    depthFactors: false,
    FS: 3,
  };

  it('gives the plan factors and the strip footing', () => {
    const f = bearingFactors(30, 'vesic');
    within(f.Nq, 18.4011, 1e-4);
    within(f.Nc, 30.1396, 1e-4);
    within(f.Ng, 22.4025, 1e-4);
    within(bearing(strip).qult, 734.465, 1e-3);
  });

  it('matches published factor tables for the other authors', () => {
    const t = bearingFactors(30, 'terzaghi');
    within(t.Nc, 37.16, 0.01);
    within(t.Nq, 22.46, 0.01);
    within(bearingFactors(0, 'terzaghi').Nc, 5.7, 1e-12);
    // Kumbhojkar's (1993) Terzaghi N-gamma as tabulated in Das, Table 3.1.
    within(bearingFactors(20, 'terzaghi').Ng, 3.64, 0.005);
    within(bearingFactors(35, 'terzaghi').Ng, 45.41, 0.005);
    within(bearingFactors(40, 'terzaghi').Ng, 115.31, 0.005);
    within(bearingFactors(30.5, 'terzaghi').Ng, (19.13 + 22.65) / 2, 0.005);
    within(bearingFactors(0, 'vesic').Nc, 5.14, 0.002);
    within(bearingFactors(30, 'meyerhof').Ng, 15.67, 0.01);
    within(bearingFactors(30, 'hansen').Ng, 15.07, 0.01);
  });

  it('lowers the capacity for water at the base and for eccentric load', () => {
    const wet = bearing({ ...strip, zw: 1 });
    expect(wet.waterCase).toBe(2);
    within(wet.terms[2], 0.5 * (20 - GAMMA_W) * 2 * 22.4025, 1e-3);
    const ecc = bearing({ ...strip, e: 0.25 });
    within(ecc.Bp, 1.5, 1e-12);
    within(ecc.Qult, ecc.qult * 1.5, 1e-9);
  });

  it('refuses impossible footings', () => {
    expect(key(() => bearing({ ...strip, B: 0 }))).toBe('errors.positive');
    expect(key(() => bearing({ ...strip, e: 1 }))).toBe('foundations.errors.eccentric');
    expect(key(() => bearing({ ...strip, method: 'terzaghi', e: 0.1 }))).toBe('foundations.errors.terzaghi');
    expect(key(() => bearing({ ...strip, FS: 0.5 }))).toBe('foundations.errors.fs');
  });
});

describe('slopes', () => {
  it('gives the infinite slope of the plan, dry and with seepage', () => {
    within(infiniteSlope(35, 25, 0, 0, 18, 20, 'dry').FS, 1.5016, 1e-4);
    within(infiniteSlope(35, 25, 0, 0, 18, 20, 'seepage').FS, 0.765065, 1e-6);
  });

  it('puts a slope at its critical height at a factor of safety of 1', () => {
    const first = culmann(10, 60, 20, 20, 18);
    const atCritical = culmann(first.Hcr, 60, 20, 20, 18);
    within(atCritical.FS, 1, 1e-9);
  });

  const soil: SlopeSoil = { H: 10, beta: 30, gamma: 18, c: 15, phi: 25, ru: 0 };

  it('has Bishop at or above the ordinary method on a c-φ circle', () => {
    const r = slipCircle(soil, 5, 18, Math.hypot(5 - 10 / Math.tan(rad(30)), 18), 30);
    expect(r.bishop).toBeGreaterThanOrEqual(r.ordinary);
    expect(r.slices).toHaveLength(30);
    expect(r.iterations.length).toBeGreaterThan(1);
  });

  it('gives the cohesion-only factor of safety from the arc and the moment', () => {
    const clay: SlopeSoil = { H: 10, beta: 30, gamma: 18, c: 40, phi: 0, ru: 0 };
    const xc = 6;
    const yc = 16;
    const R = Math.hypot(xc - 10 / Math.tan(rad(30)), yc);
    const r = slipCircle(clay, xc, yc, R, 400);
    within(r.bishop, r.ordinary, 1e-9);
    // Independent: c R θ over the weight's moment about the center, with a fine sum over the mass.
    const ground = (x: number) => (x <= 0 ? 10 : x >= 10 / Math.tan(rad(30)) ? 0 : 10 - x * Math.tan(rad(30)));
    const base = (x: number) => yc - Math.sqrt(Math.max(0, R * R - (x - xc) ** 2));
    const x1 = r.slices[0]!.x - r.slices[0]!.b / 2;
    const x2 = x1 + r.slices[0]!.b * 400;
    let moment = 0;
    const N = 400000;
    for (let k = 0; k < N; k++) {
      const x = x1 + ((k + 0.5) * (x2 - x1)) / N;
      moment += 18 * Math.max(0, ground(x) - base(x)) * ((x2 - x1) / N) * (xc - x);
    }
    const angle = Math.asin((xc - x1) / R) - Math.asin((xc - x2) / R);
    rel(r.bishop, (40 * R * R * angle) / moment, 1e-4);
  });

  it('searches a grid and keeps the lowest circle', () => {
    const s = searchCircles(soil, [0, 10], [12, 22], 5, 20);
    const fs = s.grid.map((g) => g.FS).filter(Number.isFinite);
    within(s.best.bishop, Math.min(...fs), 1e-12);
  });

  it('refuses a circle that misses the slope and a soil with no strength', () => {
    expect(key(() => slipCircle(soil, -50, 50, 1))).toBe('foundations.errors.miss');
    expect(key(() => slipCircle({ ...soil, c: 0, phi: 0 }, 5, 18, 20))).toBe('foundations.errors.strength');
  });
});

describe('piles', () => {
  it('gives the plan skin friction by the alpha method', () => {
    const r = pile('round', 0.5, [{ h: 20, gammaEff: 8, cu: 50, alpha: 0.5, beta: 0 }], 'clay', 0, 3);
    within(r.Qs, 785.398, 1e-3);
    within(r.Qb, 9 * 50 * Math.PI * 0.0625, 1e-9);
  });

  it('adds the beta method in sand at the mid-depth stress', () => {
    const r = pile('square', 0.4, [{ h: 10, gammaEff: 10, cu: 0, alpha: 0, beta: 0.3 }], 'sand', 40, 2.5);
    within(r.Qs, 0.3 * 50 * 1.6 * 10, 1e-9);
    within(r.Qb, 100 * 40 * 0.16, 1e-9);
  });

  it('gives the Converse-Labarre group efficiency', () => {
    const g = groupEfficiency(3, 4, 0.4, 1.2);
    // theta = atan(0.4 / 1.2) = 18.43 deg; E = 1 - 18.43 x (3 x 3 + 2 x 4) / (90 x 12) = 0.710.
    within(g.theta, 18.435, 0.001);
    within(g.E, 0.7098, 0.0005);
    expect(key(() => groupEfficiency(3, 4, 0.4, 0.3))).toBe('foundations.errors.spacing');
  });
});
