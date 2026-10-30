import { describe, expect, it } from 'vitest';
import { CalcError } from '../numeric';
import { annularFin, fin, finArray, finProfile } from './engine';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const pin = { shape: 'pin' as const, size: 0.005, length: 0.05, k: 200, h: 50, thetaBase: 75 };

describe('straight and pin fins', () => {
  it('pin fin D 5 mm, L 50 mm, k 200, h 50, theta_b 75 K', () => {
    const r = fin(pin);
    expect(rel(r.m, 14.1421)).toBeLessThan(1e-4);
    expect(rel(r.q.adiabatic!, 2.536)).toBeLessThan(1e-4);
    expect(rel(r.q.convective!, 2.5819)).toBeLessThan(1e-4);
    expect(rel(r.q.corrected!, 2.5819)).toBeLessThan(1e-4);
    expect(rel(r.efficiency, 0.86106)).toBeLessThan(1e-4);
    expect(rel(r.q.infinite!, 4.1652)).toBeLessThan(1e-4);
  });
  it('the convective tip equals the corrected-length result within a fraction of a percent', () => {
    const r = fin(pin);
    expect(rel(r.q.convective!, r.q.corrected!)).toBeLessThan(2e-3);
  });
  it('the convective-tip profile satisfies the tip boundary condition', () => {
    const m = Math.sqrt(200);
    const hmk = 50 / (m * 200);
    const p = finProfile(pin, 'convective', 11);
    expect(p.ratio[0]).toBeCloseTo(1, 12);
    // tip condition: -k theta' = h theta at the tip, via a numerical derivative of the profile
    const tip = finProfile({ ...pin, length: 0.05 }, 'convective', 2001);
    const t1 = tip.ratio.at(-1)!;
    const t0 = tip.ratio.at(-2)!;
    const t2 = tip.ratio.at(-3)!;
    const dtheta = (3 * t1 - 4 * t0 + t2) / (2 * (tip.x[2000]! - tip.x[1999]!));
    expect(Math.abs(-dtheta / (hmk * m) - t1) / t1).toBeLessThan(5e-3);
  });
  it('rectangular fin geometry and the tip temperature condition', () => {
    const r = fin({
      shape: 'rectangular',
      size: 0.002,
      width: 0.05,
      length: 0.03,
      k: 180,
      h: 40,
      thetaBase: 60,
      thetaTip: 20,
    });
    expect(r.m).toBeCloseTo(Math.sqrt((40 * 0.104) / (180 * 1e-4)), 9);
    expect(r.q.temperature).toBeDefined();
    // a tip held at the adiabatic-tip temperature carries the adiabatic-tip heat
    const adiabaticTip = (1 / Math.cosh(r.m * 0.03)) * 60;
    const same = fin({
      shape: 'rectangular',
      size: 0.002,
      width: 0.05,
      length: 0.03,
      k: 180,
      h: 40,
      thetaBase: 60,
      thetaTip: adiabaticTip,
    });
    expect(rel(same.q.temperature!, same.q.adiabatic!)).toBeLessThan(1e-9);
    expect(fin(pin).q.temperature).toBeUndefined();
  });
  it('effectiveness is above 1 for a useful fin and warns when the fin is too short or too thick', () => {
    const r = fin(pin);
    expect(r.effectiveness.adiabatic!).toBeGreaterThan(1);
    expect(fin({ ...pin, length: 0.0001 }).warnings).toContain('fhFinsWarnShort');
    expect(fin({ ...pin, size: 0.1, k: 1 }).warnings).toContain('fhFinsWarnBiot');
  });
  it('rejects bad input', () => {
    expect(() => fin({ ...pin, k: 0 })).toThrow(CalcError);
    expect(() => fin({ ...pin, thetaBase: 0 })).toThrow(CalcError);
    expect(() => fin({ ...pin, size: -1 })).toThrow(CalcError);
    expect(() => fin({ shape: 'rectangular', size: 0.002, length: 0.03, k: 180, h: 40, thetaBase: 60 })).toThrow(
      CalcError,
    );
  });
});

describe('annular fins', () => {
  const a = { innerRadius: 0.01, outerRadius: 0.03, thickness: 0.002, k: 200, h: 50, thetaBase: 1 };
  it('r1 10 mm, r2 30 mm, t 2 mm, k 200, h 50: efficiency 0.93957', () => {
    const r = annularFin(a);
    expect(Math.abs(r.efficiency - 0.93957)).toBeLessThan(1e-4);
    expect(r.correctedOuterRadius).toBeCloseTo(0.031, 12);
  });
  it('agrees with a numerical solution of the annular fin equation', () => {
    const m = Math.sqrt((2 * 50) / (200 * 0.002));
    const r1 = 0.01;
    const r2 = 0.031;
    // integrate from the adiabatic tip inward: theta(r2)=1, theta'(r2)=0; theta'' = m^2 theta - theta'/r
    const n = 100000;
    const h = (r1 - r2) / n;
    let y = [1, 0];
    let r = r2;
    const f = (rr: number, v: number[]) => [v[1]!, m * m * v[0]! - v[1]! / rr];
    for (let i = 0; i < n; i++) {
      const k1 = f(r, y);
      const k2 = f(
        r + h / 2,
        y.map((v, j) => v + (h / 2) * k1[j]!),
      );
      const k3 = f(
        r + h / 2,
        y.map((v, j) => v + (h / 2) * k2[j]!),
      );
      const k4 = f(
        r + h,
        y.map((v, j) => v + h * k3[j]!),
      );
      y = y.map((v, j) => v + (h / 6) * (k1[j]! + 2 * k2[j]! + 2 * k3[j]! + k4[j]!));
      r += h;
    }
    // heat = -k 2 pi r1 t theta'(r1)/theta(r1) per unit base excess temperature
    const q = (-200 * 2 * Math.PI * r1 * 0.002 * y[1]!) / y[0]!;
    const eta = q / (50 * 2 * Math.PI * (r2 * r2 - r1 * r1));
    expect(Math.abs(annularFin(a).efficiency - eta)).toBeLessThan(1e-6);
  });
  it('the annular fin with a huge inner radius approaches the straight fin', () => {
    const big = annularFin({ ...a, innerRadius: 5, outerRadius: 5.03 });
    const straight = Math.tanh(big.m * (0.03 + 0.001)) / (big.m * (0.03 + 0.001));
    expect(Math.abs(big.efficiency - straight)).toBeLessThan(3e-3);
  });
  it('rejects bad input', () => {
    expect(() => annularFin({ ...a, outerRadius: 0.005 })).toThrow(CalcError);
    expect(() => annularFin({ ...a, thickness: 0 })).toThrow(CalcError);
    expect(() => annularFin({ ...a, k: 1e-9, h: 1e4, innerRadius: 1 })).toThrow(CalcError);
  });
});

describe('fin arrays', () => {
  it('ten pin fins on a 5 cm by 5 cm base', () => {
    const f = fin(pin);
    const r = finArray({
      count: 10,
      finHeat: f.q.corrected!,
      finEfficiency: f.efficiencyCorrected,
      finArea: Math.PI * 0.005 * 0.05125,
      finBaseArea: (Math.PI * 0.005 ** 2) / 4,
      baseArea: 0.0025,
      h: 50,
      thetaBase: 75,
    });
    expect(r.total).toBeCloseTo(10 * f.q.corrected! + 50 * (0.0025 - (10 * Math.PI * 0.005 ** 2) / 4) * 75, 9);
    expect(r.enhancement).toBeGreaterThan(1);
    expect(r.overallEfficiency).toBeGreaterThan(f.efficiencyCorrected - 1e-12);
    expect(r.overallEfficiency).toBeLessThan(1);
  });
  it('rejects a count that does not fit', () => {
    const base = {
      finHeat: 1,
      finEfficiency: 0.9,
      finArea: 1e-3,
      finBaseArea: 1e-3,
      baseArea: 1e-3,
      h: 10,
      thetaBase: 10,
    };
    expect(() => finArray({ ...base, count: 2 })).toThrow(/more than the whole base/);
    expect(() => finArray({ ...base, count: 0 })).toThrow(CalcError);
  });
});
