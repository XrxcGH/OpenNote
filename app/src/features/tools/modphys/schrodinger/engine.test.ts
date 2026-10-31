import { describe, expect, it } from 'vitest';
import { C } from '../shared/constants';
import { PhysicsError } from '../shared/errors';
import { barrier, finiteWell, gamow, quantumDot, step, transfer } from './analytic';
import { packet, scattering, wellStates } from './engine';
import type { WellInput } from './engine';
import { HBAR_EV_FS, runPacket } from './packet';
import { HB2M, typedPotential } from './solver';

const rel = (got: number, want: number) => Math.abs(got / want - 1);
const item = (calc: { items: readonly { key: string; value: number }[] }, key: string) =>
  calc.items.find((one) => one.key === key)!.value;
const levels = (calc: { items: readonly { key: string; value: number }[] }) =>
  calc.items.filter((one) => one.key === 'level').map((one) => one.value);
const base: WellInput = {
  preset: 'infinite',
  width: 1,
  depth: 10,
  hw: 1,
  alpha: 10,
  force: 1,
  strength: 1,
  typed: '',
  lo: -2,
  hi: 2,
  massRatio: 1,
  points: 2000,
  levels: 3,
  a: NaN,
  b: NaN,
};

describe('bound states', () => {
  it('gives E1 = 0.37603 eV for an electron in a 1 nm infinite well', () => {
    const e1 = levels(wellStates(base))[0]!;
    expect(rel(e1, 0.37603)).toBeLessThan(1e-4);
    // The exact level π²ħ²/(2mL²) from CODATA constants.
    expect(rel(e1, (Math.PI ** 2 * C.hbar ** 2) / (2 * C.me * 1e-18) / C.e)).toBeLessThan(1e-5);
  });

  it('gives 6 bound states and E1 = 0.297602 eV for a 10 eV, 1 nm finite well', () => {
    const exact = finiteWell(10, 1, 1);
    expect(exact.energies).toHaveLength(6);
    expect(Math.abs(exact.energies[0]! - 0.297602)).toBeLessThan(1e-5);
    const calc = wellStates({ ...base, preset: 'finite', levels: 8 });
    expect(levels(calc)).toHaveLength(6);
    expect(rel(levels(calc)[0]!, 0.297602)).toBeLessThan(1e-3);
  });

  it('gives 0.5, 1.5, 2.5 eV for ħω = 1 eV, with the minimum uncertainty in the ground state', () => {
    const calc = wellStates({ ...base, preset: 'harmonic' });
    [0.5, 1.5, 2.5].forEach((want, k) => expect(rel(levels(calc)[k]!, want)).toBeLessThan(1e-4));
    expect(item(calc, 'product')).toBeCloseTo(0.5, 3);
    expect(item(calc, 'meanX')).toBeCloseTo(0, 6);
  });

  it('matches the Morse and Airy levels and the delta well', () => {
    const morse = wellStates({ ...base, preset: 'morse', depth: 4, alpha: 2, levels: 2 });
    const hw0 = 2 * 2 * Math.sqrt(HB2M * 4);
    expect(rel(levels(morse)[0]!, hw0 / 2 - (hw0 / 2) ** 2 / 16)).toBeLessThan(1e-3);
    const linear = wellStates({ ...base, preset: 'linear', force: 1, levels: 2 });
    expect(rel(levels(linear)[0]!, 2.338107410459767 * Math.cbrt(HB2M))).toBeLessThan(1e-4);
    const delta = wellStates({ ...base, preset: 'delta', strength: 1, levels: 1, points: 4000 });
    expect(rel(levels(delta)[0]!, -1 / (4 * HB2M))).toBeLessThan(0.02);
  });

  it('reads a typed potential and gives probabilities in a region', () => {
    const calc = wellStates({
      ...base,
      preset: 'typed',
      typed: '0.25*x^2/(4*0.0380998)',
      lo: -3,
      hi: 3,
      a: -10,
      b: 10,
    });
    expect(item(calc, 'region')).toBeCloseTo(1, 6);
    expect(() => typedPotential('x +')).toThrow(PhysicsError);
    expect(() => typedPotential('y^2')).toThrow(PhysicsError);
    expect(() => wellStates({ ...base, points: 10 })).toThrow(PhysicsError);
  });
});

describe('scattering', () => {
  it('gives T = 0.00285015 for an electron at 0.5 eV through a 1 eV, 1 nm barrier', () => {
    expect(Math.abs(barrier(0.5, 1, 1, 1).t - 0.00285015)).toBeLessThan(1e-6);
    // Transfer matrices reach the same number by another route.
    expect(rel(transfer([{ width: 1, v: 1 }], 0.5, 1), barrier(0.5, 1, 1, 1).t)).toBeLessThan(1e-9);
    expect(rel(transfer([{ width: 1, v: 0.2 }], 0.5, 1), barrier(0.5, 0.2, 1, 1).t)).toBeLessThan(1e-9);
  });

  it('gives R = 0.0294373 and T = 0.970563 for 2 eV onto a 1 eV step', () => {
    const r = step(2, 1, 1);
    expect(Math.abs(r.r - 0.0294373)).toBeLessThan(1e-6);
    expect(Math.abs(r.t - 0.970563)).toBeLessThan(1e-6);
    expect(item(scattering('step', 0.5, 1, 1, 1), 'transmission')).toBe(0);
  });

  it('transmits fully at a double-barrier resonance and over a well', () => {
    const structure = [
      { width: 1, v: 0.3 },
      { width: 3, v: 0 },
      { width: 1, v: 0.3 },
    ];
    let best = 0;
    for (let e = 0.005; e < 0.3; e += 0.0005) best = Math.max(best, transfer(structure, e, 1));
    expect(best).toBeGreaterThan(0.95);
    expect(item(scattering('well', 1, 1, 1, 1), 'transmission')).toBeLessThanOrEqual(1);
    expect(() => scattering('barrier', 0, 1, 1, 1)).toThrow(PhysicsError);
  });
});

describe('wave packets, dots, and Gamow', () => {
  it('keeps the norm and moves a free packet at the group velocity', () => {
    const setup = {
      lo: -40,
      hi: 40,
      n: 1200,
      x0: -10,
      sigma: 2,
      energy: 0.5,
      massRatio: 1,
      v0: 0,
      width: 0,
      time: 20,
      steps: 400,
    };
    const run = runPacket(setup);
    expect(run.norm).toBeCloseTo(1, 6);
    const speed = (2 * HB2M * run.k0) / HBAR_EV_FS;
    expect(Math.abs(run.meanX - (-10 + speed * 20))).toBeLessThan(0.1);
    const calc = packet({ ...setup, v0: 0.6, width: 0.5, time: 40 });
    expect(item(calc, 'transmitted') + item(calc, 'reflected')).toBeCloseTo(1, 2);
    // What has flowed through the right edge is what sits beyond it at the end.
    expect(Math.abs(item(calc, 'crossed') - item(calc, 'transmitted'))).toBeLessThan(0.01);
  });

  it('gives the probability current of a free packet as v |ψ|² at its peak', () => {
    const setup = {
      lo: -40,
      hi: 40,
      n: 1600,
      x0: -10,
      sigma: 2,
      energy: 0.5,
      massRatio: 1,
      v0: 0,
      width: 0,
      time: 40,
      steps: 800,
    };
    const run = runPacket(setup);
    // The packet's center reaches x = 0 after t = 10/v; by then σ has spread to σ√(1 + (ħt/2mσ²)²), and the current
    // there is v times the Gaussian peak 1/(√(2π) σ(t)).
    const v = (2 * HB2M * run.k0) / HBAR_EV_FS;
    const t = 10 / v;
    const spread = 2 * Math.sqrt(1 + (((HB2M / HBAR_EV_FS) * t) / 4) ** 2);
    const want = v / (Math.sqrt(2 * Math.PI) * spread);
    expect(Math.abs(run.peakCurrent / want - 1)).toBeLessThan(0.03);
    expect(Math.abs(run.crossed - run.transmitted)).toBeLessThan(0.01);
  });

  it('gives π²ħ²/(2m*R²) for an infinite spherical dot and less for a finite one', () => {
    const inf = quantumDot(3, 0, 0.067);
    expect(rel(inf.energy, (Math.PI ** 2 * HB2M) / (0.067 * 9))).toBeLessThan(1e-12);
    expect(quantumDot(3, 0.5, 0.067).energy).toBeLessThan(inf.energy);
    expect(quantumDot(0.1, 0.01, 1).bound).toBe(false);
  });

  it('gives η = Z₁Z₂ α c / v for the Gamow factor', () => {
    const g = gamow(2, 90, 4.27, 3.94);
    const v = Math.sqrt((2 * 4.27e6 * C.e) / (3.94 * C.u));
    expect(rel(g.eta, (2 * 90 * C.alpha * C.c) / v)).toBeLessThan(1e-9);
    expect(g.factor).toBeCloseTo(Math.exp(-2 * Math.PI * g.eta), 300);
  });
});
