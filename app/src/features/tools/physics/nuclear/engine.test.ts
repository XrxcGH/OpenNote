// The nuclear science tool against its validation cases (first principles and AME2020 masses) and independent
// working: a numerically integrated decay chain, conservation of nuclei, known decay energies, and a critical core
// that comes back with k_eff = 1.
import { describe, expect, it } from 'vitest';
import { N_A, U_MEV } from '../kit/constants';
import { specProblems } from '../kit/checkSpec';
import { problem, runMode, value } from '../kit/run';
import type { Outcome } from '../kit/types';
import { findParticle, nuclideById } from './data';
import {
  attenuate,
  bateman,
  binding,
  criticalSize,
  daughterPeak,
  geometricBuckling,
  kEffective,
  multiplication,
  qValue,
  remaining,
  timeToFraction,
} from './engine';
import { NUCLEAR } from './spec';

const R = 'kitPhysics.nuclear.r.';
const YEAR = 365.25 * 86_400;
const rel = (got: number, want: number) => Math.abs(got - want) / Math.abs(want);
const mass = (id: string) => nuclideById(id)?.mass ?? NaN;
const word = (out: Outcome) => (out.ok ? out.rows.find((row) => row.word)?.word : null);

describe('nuclear science: decay', () => {
  it('has every message and solves every calculation from its starting numbers', () => {
    expect(specProblems(NUCLEAR)).toEqual([]);
  });

  it('C-14 with a 5730 y half-life: 25% remains after 11460 y', () => {
    expect(rel(timeToFraction(5730 * YEAR, 0.25), 11460 * YEAR)).toBeLessThan(1e-9);
    expect(rel(value(runMode(NUCLEAR, 'decay', {}), `${R}time`), 11460 * YEAR)).toBeLessThan(1e-9);
    expect(remaining(5730, 5730)).toBe(0.5);
    const out = runMode(NUCLEAR, 'decay', { find: 'amount', t: '5730' });
    expect(value(out, `${R}fraction`)).toBeCloseTo(0.5, 14);
  });

  it('one gram of Co-60 has an activity near 1130 Ci (41.8 TBq)', () => {
    const N0 = N_A / mass('Co-60');
    const out = runMode(NUCLEAR, 'decay', { nuclide: 'Co-60', find: 'amount', t: '0', N0: String(N0) });
    const activity = value(out, `${R}activity0`);
    expect(activity / 3.7e10).toBeGreaterThan(1125);
    expect(activity / 3.7e10).toBeLessThan(1135);
    expect(activity).toBeCloseTo((Math.LN2 / (1925.28 * 86_400)) * N0, -3);
  });

  it('says what is wrong with an impossible percent or half-life', () => {
    expect(problem(runMode(NUCLEAR, 'decay', { percent: '0' }))).toBe('kitPhysics.errors.range');
    expect(problem(runMode(NUCLEAR, 'decay', { percent: '150' }))).toBe('kitPhysics.errors.range');
    expect(problem(runMode(NUCLEAR, 'decay', { halfLife: '-3' }))).toBe('kitPhysics.errors.positive');
    expect(problem(runMode(NUCLEAR, 'decay', { find: 'amount', t: '-1' }))).toBe('kitPhysics.errors.nonNegative');
  });
});

/** The chain's equations integrated by fourth-order Runge-Kutta, as an independent check. */
function integrate(lambdas: number[], initial: number[], t: number, steps = 4000): number[] {
  const rate = (n: number[]) => n.map((value, i) => (i > 0 ? lambdas[i - 1] * n[i - 1] : 0) - lambdas[i] * value);
  let n = [...initial];
  const h = t / steps;
  const add = (a: number[], b: number[], k: number) => a.map((value, i) => value + k * b[i]);
  for (let s = 0; s < steps; s++) {
    const k1 = rate(n);
    const k2 = rate(add(n, k1, h / 2));
    const k3 = rate(add(n, k2, h / 2));
    const k4 = rate(add(n, k3, h));
    n = n.map((value, i) => value + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  }
  return n;
}

describe('nuclear science: decay chains', () => {
  it('A -> B with lambda 0.1 and 0.05, 1000 of A, t 10: N_B = 477.30', () => {
    const [nA, nB] = bateman([0.1, 0.05], [1000, 0], 10);
    expect(rel(nB, 477.3)).toBeLessThan(1e-5);
    expect(nA).toBeCloseTo(1000 * Math.exp(-1), 10);
    expect(value(runMode(NUCLEAR, 'chain', {}), `${R}member`, 'N_B')).toBeCloseTo(nB, 10);
    // The same chain typed as half-lives.
    const byHalf = runMode(NUCLEAR, 'chain', {
      given: 'halfLife',
      byHalfLife: `${Math.LN2 / 0.1} 1000\n${Math.LN2 / 0.05} 0`,
    });
    expect(value(byHalf, `${R}member`, 'N_B')).toBeCloseTo(nB, 9);
  });

  it('a 3-member chain with daughters present and a stable end agrees with integration and keeps every nucleus', () => {
    const lambdas = [0.3, 0.07, 0.02, 0];
    const initial = [500, 200, 50, 10];
    const exact = bateman(lambdas, initial, 25);
    const numeric = integrate(lambdas, initial, 25);
    exact.forEach((one, i) => expect(rel(one, numeric[i])).toBeLessThan(1e-9));
    expect(exact.reduce((a, b) => a + b, 0)).toBeCloseTo(760, 9);
  });

  it('the daughter peaks where its activity equals the parent’s', () => {
    const peak = daughterPeak(0.1, 0.05) ?? NaN;
    const [nA, nB] = bateman([0.1, 0.05], [1, 0], peak);
    expect(0.1 * nA).toBeCloseTo(0.05 * nB, 12);
  });

  it('says what is wrong with equal constants, a long chain, or a zero constant', () => {
    expect(problem(runMode(NUCLEAR, 'chain', { byConstant: '0.1 1000\n0.1 0' }))).toBe(
      'kitPhysics.nuclear.errors.sameConstant',
    );
    expect(problem(runMode(NUCLEAR, 'chain', { byConstant: '1 1\n2 0\n3 0\n4 0', stable: 'yes' }))).toBe(
      'kitPhysics.nuclear.errors.chainLength',
    );
    expect(problem(runMode(NUCLEAR, 'chain', { byConstant: '0 1000\n0.1 0' }))).toBe(
      'kitPhysics.nuclear.errors.chainConstant',
    );
    expect(problem(runMode(NUCLEAR, 'chain', { byConstant: '0.1' }))).toBe('kitPhysics.errors.rowCount');
  });
});

describe('nuclear science: masses', () => {
  it('He-4 from atomic masses: B = 28.2957 MeV, 7.0739 MeV per nucleon', () => {
    const out = binding(2, 4, 4.00260325413, 1.00782503223, 1.00866491595, U_MEV);
    expect(rel(out.energy, 28.2957)).toBeLessThan(1e-5);
    expect(rel(out.perNucleon, 7.0739)).toBeLessThan(1e-5);
    expect(value(runMode(NUCLEAR, 'binding', {}), `${R}binding`)).toBeCloseTo(out.energy, 10);
  });

  it('binding energies per nucleon match the known curve: Fe-56 8.790, Ni-62 8.795, U-235 7.591 MeV', () => {
    const per = (id: string) => value(runMode(NUCLEAR, 'binding', { nuclide: id }), `${R}perNucleon`);
    expect(per('Fe-56')).toBeCloseTo(8.7903, 3);
    expect(per('Ni-62')).toBeCloseTo(8.7945, 3);
    expect(per('U-235')).toBeCloseTo(7.5909, 3);
    expect(per('Ni-62')).toBeGreaterThan(per('Fe-56'));
    expect(problem(runMode(NUCLEAR, 'binding', { nuclide: 'custom', Z: '2.5' }))).toBe(
      'kitPhysics.nuclear.errors.nucleus',
    );
    expect(problem(runMode(NUCLEAR, 'binding', { nuclide: 'custom', Z: '2', A: '4', mass: '5' }))).toBe(
      'kitPhysics.nuclear.errors.unbound',
    );
  });

  it('D + T -> He-4 + n: Q = 17.5893 MeV', () => {
    const Q = value(runMode(NUCLEAR, 'qvalue', {}), `${R}q`);
    expect(rel(Q, 17.5893)).toBeLessThan(1e-5);
    const direct = (mass('H-2') + mass('H-3') - mass('He-4') - mass('n')) * U_MEV;
    expect(Q).toBeCloseTo(direct, 12);
  });

  it('decay energies by the atomic-mass rules: C-14 beta 156.5 keV, the free neutron 782 keV, Ra-226 alpha 4.871 MeV', () => {
    const q = (reactants: string, products: string) =>
      value(runMode(NUCLEAR, 'qvalue', { reactants, products }), `${R}q`);
    expect(q('C-14', 'N-14 e- nu')).toBeCloseTo(0.156476, 4);
    expect(q('n', 'p + e-')).toBeCloseTo(0.78235, 4);
    expect(q('226Ra', 'Rn-222 + alpha')).toBeCloseTo(4.8707, 3);
    expect(word(runMode(NUCLEAR, 'qvalue', { reactants: 'He-4 + N-14', products: 'O-17 p' }))).toBe(
      'kitPhysics.nuclear.kind.endoergic',
    );
  });

  it('a positron counts as 2 electron masses', () => {
    const me = 5.48579909065e-4;
    const plus = findParticle('e+', me);
    expect(plus?.mass).toBeCloseTo(2 * me, 15);
    const out = qValue(
      [{ Z: 6, A: 11, mass: 11.0114336 }],
      [{ Z: 5, A: 11, mass: mass('B-11') }, plus ?? { Z: 0, A: 0, mass: 0 }],
      U_MEV,
    );
    expect(out.q).toBeCloseTo((11.0114336 - mass('B-11') - 2 * me) * U_MEV, 12);
  });

  it('says what is wrong with an unbalanced or unknown reaction', () => {
    expect(problem(runMode(NUCLEAR, 'qvalue', { products: 'He-4' }))).toBe('kitPhysics.nuclear.errors.nucleons');
    expect(problem(runMode(NUCLEAR, 'qvalue', { products: 'He-4 p' }))).toBe('kitPhysics.nuclear.errors.charge');
    expect(problem(runMode(NUCLEAR, 'qvalue', { products: 'Xx-9' }))).toBe('kitPhysics.nuclear.errors.particle');
    expect(problem(runMode(NUCLEAR, 'qvalue', { reactants: '' }))).toBe('kitPhysics.errors.missing');
  });
});

describe('nuclear science: shielding and reactors', () => {
  it('attenuation: one half-value layer passes half, and the three ways to give mu agree', () => {
    const out = attenuate(50, Math.LN2 / 50);
    expect(out.transmitted).toBeCloseTo(0.5, 15);
    expect(out.tvl / out.hvl).toBeCloseTo(Math.log2(10), 14);
    const linear = value(runMode(NUCLEAR, 'attenuation', { mu: '0.4728' }), `${R}transmitted`);
    const byMass = value(
      runMode(NUCLEAR, 'attenuation', { given: 'mass', muRho: '0.06', rho: '7.88' }),
      `${R}transmitted`,
    );
    expect(byMass).toBeCloseTo(linear, 12);
    expect(linear).toBeCloseTo(Math.exp(-0.4728 * 2), 14);
    const cross = runMode(NUCLEAR, 'attenuation', { given: 'cross' });
    // Iron's thermal absorption: N = 7.874 N_A / 55.845 per cm³, Sigma = N x 2.56 b.
    expect(value(cross, `${R}macro`)).toBeCloseTo(((7.874 * N_A) / 55.845) * 2.56e-24 * 100, 10);
  });

  it('dose rate falls with the square of distance and through the shield', () => {
    const out = runMode(NUCLEAR, 'dose', { mu: '0.5', x: '2', hours: '3' });
    const want = (2 / 9) * Math.exp(-1);
    expect(value(out, `${R}rate2`)).toBeCloseTo(want / 3.6e6, 16); // mSv/h to Sv/s
    expect(value(out, `${R}dose`)).toBeCloseTo(want * 3, 12);
  });

  it('k_inf = 1.10792 and a bare sphere with M² = 300 cm² goes critical at R = 165.64 cm', () => {
    const { kInf } = multiplication({ eta: 2.02, epsilon: 1.03, p: 0.75, f: 0.71 });
    expect(rel(kInf, 1.10792)).toBeLessThan(1e-5);
    const crit = criticalSize('sphere', kInf, 300, 1);
    // The plan rounds to 5 figures: 165.638 cm.
    expect(Number(crit.size.toPrecision(5))).toBe(165.64);
    expect(crit.size).toBeCloseTo(Math.PI / Math.sqrt((kInf - 1) / 300), 12);
    const out = runMode(NUCLEAR, 'reactor', {});
    expect(value(out, 'kitPhysics.nuclear.size.sphere')).toBeCloseTo(crit.size / 100, 12);
    // At its critical size each shape has k_eff = 1.
    for (const shape of ['sphere', 'cube', 'slab', 'cylinder'] as const) {
      const size = criticalSize(shape, kInf, 300, 0.924).size;
      expect(kEffective(kInf, 300, geometricBuckling(shape, size, 0.924)).kEff).toBeCloseTo(1, 12);
    }
  });

  it('the cylinder needs the least volume near H/D = 0.924, and small cores are subcritical', () => {
    const v = (ratio: number) => criticalSize('cylinder', 1.1, 300, ratio).volume ?? NaN;
    expect(v(0.924)).toBeLessThan(v(0.8));
    expect(v(0.924)).toBeLessThan(v(1.05));
    expect(word(runMode(NUCLEAR, 'reactor', { size: '100' }))).toBe('kitPhysics.nuclear.kind.sub');
    expect(word(runMode(NUCLEAR, 'reactor', { size: '300' }))).toBe('kitPhysics.nuclear.kind.super');
    expect(problem(runMode(NUCLEAR, 'reactor', { eta: '1.2' }))).toBe('kitPhysics.nuclear.errors.subcritical');
    expect(problem(runMode(NUCLEAR, 'reactor', { p: '1.2' }))).toBe('kitPhysics.errors.range');
  });
});
