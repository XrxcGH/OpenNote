import { describe, expect, it } from 'vitest';
import { END_K, plateBuckling, secantStress, solveColumn } from './engine';

const rel = (a: number | undefined, b: number, tol: number) =>
  expect(Math.abs((a ?? NaN) - b) / Math.abs(b), `${a} vs ${b}`).toBeLessThanOrEqual(tol);

// The column of the validation cases: E 200 GPa, I 8e-6 m^4, L 3 m.
const base = { E: 200e9, I: 8e-6, L: 3 };

describe('Euler buckling', () => {
  it('gives the critical load for each end condition', () => {
    // An independent check: pi^2 EI / (KL)^2 written out.
    const expected = (K: number) => (9.869604401089358 * 200e9 * 8e-6) / (K * 3) ** 2;
    rel(solveColumn({ ...base, K: END_K.pinned }).Pcr, 1754.6e3, 1e-5);
    rel(solveColumn({ ...base, K: END_K.fixedFixed }).Pcr, 7018.39e3, 1e-5);
    rel(solveColumn({ ...base, K: END_K.fixedPinned }).Pcr, 3580.81e3, 1e-5);
    rel(solveColumn({ ...base, K: END_K.fixedFree }).Pcr, 438.65e3, 1e-5);
    for (const K of [0.5, 0.7, 1, 2]) rel(solveColumn({ ...base, K }).Pcr, expected(K), 1e-12);
  });
});

describe('Johnson parabola', () => {
  it('finds the slenderness, the transition, and the critical stress', () => {
    const r = solveColumn({ ...base, K: 1, A: 4e-3, Sy: 250e6 });
    rel(r.slenderness, 67.082, 1e-4);
    rel(r.Cc, 125.66, 1e-4);
    rel(r.sigmaCr, 214.38e6, 1e-4);
    expect(r.regime).toBe('johnson');
    // At the transition the two curves meet at half the yield strength.
    const Cc = r.Cc ?? NaN;
    rel((Math.PI ** 2 * 200e9) / Cc ** 2, 125e6, 1e-12);
  });

  it('uses Euler for a long column', () => {
    const r = solveColumn({ ...base, L: 9, K: 1, A: 4e-3, Sy: 250e6 });
    expect(r.regime).toBe('euler');
    rel(r.sigmaCr, r.sigmaEuler ?? NaN, 1e-12);
  });
});

describe('secant formula', () => {
  it('gives the largest stress of an eccentric load', () => {
    const r = solveColumn({ ...base, K: 1, A: 4e-3, c: 0.1, e: 0.01, P: 500e3 });
    rel(r.sigmaMax, 218.48e6, 1e-4);
    // Written out: P/A (1 + ec/r^2 sec(L/(2r) sqrt(P/(EA)))).
    const rr = Math.sqrt(8e-6 / 4e-3);
    const direct =
      (500e3 / 4e-3) * (1 + 0.001 / rr ** 2 / Math.cos((3 / (2 * rr)) * Math.sqrt(500e3 / (200e9 * 4e-3))));
    rel(r.sigmaMax, direct, 1e-12);
  });

  it('finds the load that first yields the column', () => {
    const r = solveColumn({ ...base, K: 1, A: 4e-3, c: 0.1, e: 0.01, P: 500e3, Sy: 250e6 });
    const P = r.Pyield ?? NaN;
    rel(secantStress(P, 4e-3, 0.01, 0.1, Math.sqrt(2e-3), 3, 200e9), 250e6, 1e-9);
    expect(P).toBeGreaterThan(500e3);
  });

  it('stops at or above the critical load', () => {
    expect(() => solveColumn({ ...base, K: 1, A: 4e-3, c: 0.1, e: 0.01, P: 2000e3 })).toThrow('aboveCritical');
  });
});

describe('impossible inputs', () => {
  it('names the value that must be positive', () => {
    expect(() => solveColumn({ ...base, E: 0, K: 1 })).toThrow('positive');
    expect(() => solveColumn({ ...base, L: -3, K: 1 })).toThrow('positive');
    expect(() => solveColumn({ ...base, K: 0 })).toThrow('positive');
    expect(() => solveColumn({ ...base, K: 1, A: -1 })).toThrow('positive');
    expect(() => solveColumn({ ...base, K: 1, A: 4e-3, e: -0.01, c: 0.1, P: 1e3 })).toThrow('notNegative');
  });

  it('stays finite for huge and tiny values', () => {
    const r = solveColumn({ E: 1e15, I: 1e3, L: 1e-3, K: 1 });
    expect(Number.isFinite(r.Pcr)).toBe(true);
    const tiny = solveColumn({ E: 1, I: 1e-20, L: 1e3, K: 2 });
    expect(tiny.Pcr).toBeGreaterThan(0);
  });
});

describe('plate buckling', () => {
  const steel = { E: 200e9, nu: 0.3, b: 0.5, t: 0.01, a: NaN, Sy: NaN };

  it('gives the buckling stress of a long simply supported plate', () => {
    // Worked by hand: 4 x 9.8696044 x 200 000 MPa / (12 x 0.91) x (10/500)^2 = 289.219 MPa.
    const r = plateBuckling({ ...steel, edges: 'ss' });
    rel(r.sigmaCr / 1e6, 289.219, 1e-5);
    rel(r.Ncr, 289.219e6 * 0.01, 1e-5);
    // One unloaded edge free: k = 0.425, so 0.425/4 of that.
    rel(plateBuckling({ ...steel, edges: 'ssFree' }).sigmaCr / 1e6, (289.219 * 0.425) / 4, 1e-5);
  });

  it('finds k and the half waves for a shorter plate', () => {
    // a/b = 1.5: m = 1 gives (1/1.5 + 1.5)^2 = 4.694, m = 2 gives (2/1.5 + 0.75)^2 = (25/12)^2 = 4.3403.
    const r = plateBuckling({ ...steel, edges: 'ss', a: 0.75 });
    expect(r.m).toBe(2);
    rel(r.k, 625 / 144, 1e-12);
    // A square plate buckles in one half wave with k = 4.
    rel(plateBuckling({ ...steel, edges: 'ss', a: 0.5 }).k, 4, 1e-12);
  });

  it('says when the plate yields first, and stops on a bad Poisson ratio', () => {
    expect(plateBuckling({ ...steel, edges: 'ss', Sy: 250e6 }).yields).toBe(true);
    expect(() => plateBuckling({ ...steel, edges: 'ss', nu: 0.6 })).toThrow();
  });
});
