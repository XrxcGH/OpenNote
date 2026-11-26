import '../text';
import { describe, expect, it } from 'vitest';
import { CalcError, besselJ } from '../numeric';
import {
  annulus,
  besselJc,
  bingham,
  casson,
  couette,
  murrayAsymmetric,
  murraySymmetric,
  poiseuille,
  powerLaw,
  womersley,
} from './engine';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const pipe = { radius: 1e-3, length: 0.1, dp: 100, viscosity: 3.5e-3 };

describe('Newtonian flow', () => {
  it('Poiseuille R 1 mm, L 0.1 m, dp 100 Pa, mu 3.5e-3', () => {
    const r = poiseuille(pipe);
    expect(rel(r.q, 1.122e-7)).toBeLessThan(1e-4);
    // the profile integrates to the flow rate (independent of the closed form)
    let q = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n) * 1e-3;
      q += (100 / (4 * 3.5e-3 * 0.1)) * (1e-6 - x * x) * 2 * Math.PI * x * (1e-3 / n);
    }
    expect(rel(r.q, q)).toBeLessThan(1e-7);
    expect(r.maxSpeed).toBeCloseTo(2 * r.meanSpeed, 12);
    expect(r.wallShear).toBeCloseTo((0.5 * 100 * 1e-3) / 0.1, 12);
    expect(r.u[0]).toBeCloseTo(r.maxSpeed, 12);
    expect(r.u.at(-1)).toBeCloseTo(0, 12);
  });
  it('plane flows: pure Couette, pure Poiseuille, and their flow rate', () => {
    const c = couette({ gap: 0.01, wallSpeed: 2, dpdx: 0, viscosity: 0.1 });
    expect(c.u[20]).toBeCloseTo(1, 12);
    expect(c.lowerWallShear).toBeCloseTo((0.1 * 2) / 0.01, 12);
    const p = couette({ gap: 0.01, wallSpeed: 0, dpdx: -1000, viscosity: 0.1 });
    expect(p.flowPerWidth).toBeCloseTo((1000 * 0.01 ** 3) / (12 * 0.1), 12);
    expect(p.u[20]).toBeCloseTo((1000 / (8 * 0.1)) * 0.01 * 0.01, 12);
    expect(p.lowerWallShear).toBeCloseTo(-p.upperWallShear, 12);
  });
  it('annulus tends to the pipe as the inner radius vanishes and matches the thin-gap slot', () => {
    // integrate the velocity profile u(r) = dp/(4 mu L) (b^2 - r^2 + (b^2 - a^2) ln(r/b)/ln(b/a)) over the gap
    const a = annulus({ inner: 2e-4, outer: 1e-3, length: 0.1, dp: 100, viscosity: 3.5e-3 });
    let qi = 0;
    const n = 200000;
    for (let i = 0; i < n; i++) {
      const r = 2e-4 + ((i + 0.5) / n) * 8e-4;
      const u = (100 / (4 * 3.5e-3 * 0.1)) * (1e-6 - r * r + ((1e-6 - 4e-8) * Math.log(r / 1e-3)) / Math.log(5));
      qi += u * 2 * Math.PI * r * (8e-4 / n);
    }
    expect(rel(a.q, qi)).toBeLessThan(1e-6);
    const thin = annulus({ inner: 0.0099, outer: 0.01, length: 1, dp: 100, viscosity: 1e-3 });
    const slot = (100 / (12 * 1e-3 * 1)) * 1e-4 ** 3 * 2 * Math.PI * 0.00995;
    expect(rel(thin.q, slot)).toBeLessThan(2e-3);
    expect(() => annulus({ inner: 2, outer: 1, length: 1, dp: 1, viscosity: 1 })).toThrow(CalcError);
  });
  it('rejects bad input', () => {
    expect(() => poiseuille({ ...pipe, radius: 0 })).toThrow(CalcError);
    expect(() => poiseuille({ ...pipe, dp: -1 })).toThrow(CalcError);
    expect(() => couette({ gap: 0, wallSpeed: 1, dpdx: 0, viscosity: 1 })).toThrow(CalcError);
  });
});

describe('non-Newtonian pipe flow', () => {
  it('power law n 0.5, K 0.02', () => {
    const r = powerLaw({ radius: 1e-3, length: 0.1, dp: 100, k: 0.02, n: 0.5 });
    expect(rel(r.q, 3.927e-7)).toBeLessThan(1e-4);
  });
  it('power law with n = 1 is Poiseuille and the profile integrates to Q', () => {
    const r = powerLaw({ radius: 1e-3, length: 0.1, dp: 100, k: 3.5e-3, n: 1 });
    expect(rel(r.q, poiseuille(pipe).q)).toBeLessThan(1e-12);
    const s = powerLaw({ radius: 1e-3, length: 0.1, dp: 100, k: 0.02, n: 0.5 });
    let q = 0;
    for (let i = 0; i < s.r.length - 1; i++)
      q += ((s.u[i]! * s.r[i]! + s.u[i + 1]! * s.r[i + 1]!) / 2) * (s.r[i + 1]! - s.r[i]!) * 2 * Math.PI;
    expect(rel(q, s.q)).toBeLessThan(2e-3);
  });
  it('Bingham: no flow below the yield stress, Newtonian as the yield stress goes to zero', () => {
    expect(bingham({ ...pipe, yieldStress: 10 }).flows).toBe(false);
    expect(bingham({ ...pipe, yieldStress: 10 }).q).toBe(0);
    expect(rel(bingham({ ...pipe, yieldStress: 0 }).q, poiseuille(pipe).q)).toBeLessThan(1e-12);
    const b = bingham({ ...pipe, yieldStress: 0.2 });
    // independent: Q = pi/(tw^3) int tau^2 gamma(tau) dtau * R^3, gamma = (tau - ty)/mu
    const tw = (100 * 1e-3) / (2 * 0.1);
    let q = 0;
    const n = 100000;
    for (let i = 0; i < n; i++) {
      const tau = ((i + 0.5) / n) * tw;
      q += tau > 0.2 ? tau * tau * ((tau - 0.2) / 3.5e-3) * (tw / n) : 0;
    }
    q *= (Math.PI * 1e-9) / tw ** 3;
    expect(rel(b.q, q)).toBeLessThan(1e-6);
    expect(b.plugRadius).toBeCloseTo((0.2 / tw) * 1e-3, 12);
  });
  it('Casson flow rate agrees with direct quadrature of the constitutive law', () => {
    const c = casson({ radius: 1.5e-3, length: 0.2, dp: 40, viscosity: 3.5e-3, yieldStress: 0.005 });
    const tw = (40 * 1.5e-3) / (2 * 0.2);
    let q = 0;
    const n = 200000;
    for (let i = 0; i < n; i++) {
      const tau = ((i + 0.5) / n) * tw;
      if (tau > 0.005) q += tau * tau * ((Math.sqrt(tau) - Math.sqrt(0.005)) ** 2 / 3.5e-3) * (tw / n);
    }
    q *= (Math.PI * 1.5e-3 ** 3) / tw ** 3;
    expect(rel(c.q, q)).toBeLessThan(1e-6);
    // the integrated velocity profile reproduces the flow rate too
    let qp = 0;
    for (let i = 0; i < c.r.length - 1; i++)
      qp += ((c.u[i]! * c.r[i]! + c.u[i + 1]! * c.r[i + 1]!) / 2) * (c.r[i + 1]! - c.r[i]!) * 2 * Math.PI;
    expect(rel(qp, c.q)).toBeLessThan(5e-3);
  });
  it('rejects bad parameters', () => {
    expect(() => powerLaw({ radius: 1e-3, length: 0.1, dp: 100, k: 0, n: 0.5 })).toThrow(CalcError);
    expect(() => bingham({ ...pipe, yieldStress: -1 })).toThrow(CalcError);
  });
});

describe('Womersley flow', () => {
  it('complex Bessel functions agree with the real ones on the real axis', () => {
    for (const x of [0.5, 3, 10, 15.9, 16.1, 25, 40]) {
      expect(besselJc(0, { re: x, im: 0 }).re).toBeCloseTo(besselJ(0, x), 7);
      expect(besselJc(1, { re: x, im: 0 }).re).toBeCloseTo(besselJ(1, x), 7);
    }
    // the series and the asymptotic form meet on the complex ray used by Womersley flow
    const e = Math.cos((3 * Math.PI) / 4);
    const s = Math.sin((3 * Math.PI) / 4);
    const a = besselJc(0, { re: 15.999 * e, im: 15.999 * s });
    const b = besselJc(0, { re: 16.001 * e, im: 16.001 * s });
    expect(Math.abs(Math.hypot(a.re, a.im) / Math.hypot(b.re, b.im) - 1)).toBeLessThan(2e-3);
  });
  it('R 0.01 m, f 1.2 Hz, nu 3.3e-6 gives alpha = 15.116', () => {
    const w = womersley({ radius: 0.01, frequency: 1.2, nu: 3.3e-6, density: 1060, amplitude: 100 });
    expect(rel(w.alpha, 15.116)).toBeLessThan(1e-4);
    expect(w.centerlineLag).toBeGreaterThan(0.5);
  });
  it('tends to quasi-steady Poiseuille flow when alpha is small', () => {
    // omega / nu = 1 gives alpha = R = 0.01
    const omega = 2 * Math.PI;
    const w = womersley({ radius: 0.01, frequency: 1, nu: omega, density: 1000, amplitude: 100, phases: [0] });
    expect(w.alpha).toBeCloseTo(0.01, 12);
    const prof = w.profiles[0]!.u;
    for (let i = 0; i < prof.length - 1; i++) {
      const quasi = (100 / (4 * 1000 * omega)) * (1e-4 - w.r[i]! ** 2);
      expect(rel(prof[i]!, quasi)).toBeLessThan(1e-4);
    }
    expect(rel(w.centerlineAmplitude, w.quasiSteadyCenterline)).toBeLessThan(1e-4);
  });
  it('the profile integrates to the flow amplitude with its phase (independent check)', () => {
    const w = womersley({
      radius: 0.01,
      frequency: 1.2,
      nu: 3.3e-6,
      density: 1060,
      amplitude: 100,
      points: 2001,
      phases: [0.3],
    });
    let q = 0;
    const u = w.profiles[0]!.u;
    for (let i = 0; i < w.r.length - 1; i++)
      q += ((u[i]! * w.r[i]! + u[i + 1]! * w.r[i + 1]!) / 2) * (w.r[i + 1]! - w.r[i]!) * 2 * Math.PI;
    expect(rel(q, w.flowAmplitude * Math.cos(0.3 + w.flowPhase))).toBeLessThan(1e-5);
  });
  it('rejects bad input', () => {
    expect(() => womersley({ radius: 0.01, frequency: 0, nu: 1e-6, density: 1000, amplitude: 1 })).toThrow(CalcError);
    expect(() => womersley({ radius: 1, frequency: 1000, nu: 1e-6, density: 1000, amplitude: 1 })).toThrow(/60/);
  });
});

describe("Murray's law", () => {
  it('symmetric bifurcation', () => {
    expect(rel(murraySymmetric(1, 2).ratio, 0.7937)).toBeLessThan(1e-4);
    expect(murraySymmetric(2e-3, 2).childRadius).toBeCloseTo(2e-3 * 2 ** (-1 / 3), 15);
    expect(murraySymmetric(1, 3).ratio ** 3 * 3).toBeCloseTo(1, 12);
  });
  it('asymmetric branches keep the cubes summing', () => {
    const b = murrayAsymmetric(1, 0.6);
    expect(b ** 3 + 0.6 ** 3).toBeCloseTo(1, 12);
    expect(() => murrayAsymmetric(1, 1.2)).toThrow(CalcError);
    expect(() => murraySymmetric(1, 1)).toThrow(CalcError);
  });
});
