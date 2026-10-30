import { describe, expect, it } from 'vitest';
import { CalcError } from '../numeric';
import { characteristicLength, eigenvalues, lumped, profile, semiInfinite, series, solid } from './engine';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('lumped capacitance', () => {
  const sphere = { characteristicLength: 0.01 / 6, k: 400, rho: 8933, cp: 385, h: 100, tInitial: 100, tFluid: 25 };
  it('copper sphere D 10 mm in 25 C fluid: Bi = 4.17e-4, tau = 57.320 s, 100 to 50 C in 62.97 s', () => {
    const r = lumped({ ...sphere, target: 50, time: 100 });
    expect(rel(r.biot, 4.17e-4)).toBeLessThan(2e-3);
    expect(rel(r.tau, 57.32)).toBeLessThan(1e-4);
    expect(rel(r.timeToTarget!, 62.97)).toBeLessThan(1e-4);
    expect(r.valid).toBe(true);
    expect(r.temperature).toBeCloseTo(25 + 75 * Math.exp(-100 / r.tau), 9);
  });
  it('characteristic lengths', () => {
    expect(characteristicLength('sphere', 0.01)).toBeCloseTo(0.01 / 3, 15);
    expect(characteristicLength('cylinder', 0.01)).toBeCloseTo(0.005, 15);
    expect(characteristicLength('wall', 0.01)).toBe(0.01);
  });
  it('warns above Bi = 0.1 and rejects impossible targets', () => {
    expect(lumped({ ...sphere, h: 1e5, k: 1 }).warnings).toContain('fhTransWarnBiot');
    expect(() => lumped({ ...sphere, target: 10 })).toThrow(CalcError);
    expect(() => lumped({ ...sphere, target: 25 })).toThrow(CalcError);
    expect(() => lumped({ ...sphere, tInitial: 25 })).toThrow(CalcError);
    expect(() => lumped({ ...sphere, h: 0 })).toThrow(CalcError);
    expect(() => lumped({ ...sphere, time: -1 })).toThrow(CalcError);
  });
});

describe('exact series solutions', () => {
  it('plane wall Bi 1, Fo 0.5, center', () => {
    const r = series('wall', 1, 0.5);
    expect(Math.abs(r.zeta1 - 0.86033)).toBeLessThan(1e-5);
    expect(Math.abs(r.c1 - 1.11913)).toBeLessThan(1e-5);
    expect(Math.abs(r.center - 0.77253)).toBeLessThan(1e-5);
    expect(Math.abs(r.oneTermCenter - 0.77296)).toBeLessThan(1e-5);
  });
  it('sphere Bi 1, Fo 0.5, center', () => {
    const r = series('sphere', 1, 0.5);
    expect(r.zeta1).toBeCloseTo(Math.PI / 2, 9);
    expect(Math.abs(r.c1 - 1.27324)).toBeLessThan(1e-5);
    expect(Math.abs(r.center - 0.37078)).toBeLessThan(1e-5);
  });
  it('cylinder Bi 1 (SciPy reference)', () => {
    const r = series('cylinder', 1, 0.5);
    expect(r.zeta1).toBeCloseTo(1.2557837117945936, 9);
    expect(r.c1).toBeCloseTo(1.20709205839186, 9);
    expect(r.center).toBeCloseTo(0.54858620389229, 9);
  });
  it('surface values and heat fraction at Bi 0.3, Fo 0.2 (SciPy reference)', () => {
    const w = series('wall', 0.3, 0.2);
    expect(w.center).toBeCloseTo(0.9828106053531557, 8);
    expect(w.surface).toBeCloseTo(0.8647983299939649, 8);
    expect(w.heatFraction).toBeCloseTo(0.0544427972864574, 8);
    const c = series('cylinder', 0.3, 0.2);
    expect(c.center).toBeCloseTo(0.9536278969645938, 8);
    expect(c.surface).toBeCloseTo(0.8311378956819109, 8);
    expect(c.heatFraction).toBeCloseTo(0.1069340728383702, 8);
    const s = series('sphere', 0.3, 0.2);
    expect(s.center).toBeCloseTo(0.9162192480082932, 8);
    expect(s.surface).toBeCloseTo(0.7944008877046368, 8);
    expect(s.heatFraction).toBeCloseTo(0.15719889878288362, 8);
  });
  it('limits: theta -> 1 at Fo 0, -> 0 late, and large Biot gives a surface at the fluid temperature', () => {
    expect(series('wall', 2, 0).center).toBeGreaterThan(0.99);
    expect(series('wall', 2, 30).center).toBeLessThan(1e-8);
    expect(series('wall', 1000, 0.3).surface).toBeLessThan(2e-3);
    expect(series('sphere', 0.001, 100).theta).toBeGreaterThanOrEqual(0);
  });
  it('lumped limit: small Bi matches exp(-Bi Fo * shape factor)', () => {
    const bi = 0.001;
    const fo = 5;
    expect(Math.abs(series('wall', bi, fo).center - Math.exp(-bi * fo))).toBeLessThan(5e-4);
    expect(Math.abs(series('cylinder', bi, fo).center - Math.exp(-2 * bi * fo))).toBeLessThan(5e-4);
    expect(Math.abs(series('sphere', bi, fo).center - Math.exp(-3 * bi * fo))).toBeLessThan(5e-4);
  });
  it('eigenvalues satisfy the characteristic equation and are ordered', () => {
    const z = eigenvalues('wall', 2.5, 30);
    expect(z.length).toBeGreaterThan(8);
    z.forEach((v) => expect(Math.abs(v * Math.tan(v) - 2.5)).toBeLessThan(1e-6));
    expect([...z].sort((a, b) => a - b)).toEqual(z);
  });
  it('rejects bad input', () => {
    expect(() => series('wall', 0, 1)).toThrow(CalcError);
    expect(() => series('wall', 1, -1)).toThrow(CalcError);
    expect(() => series('wall', 1, 1, 2)).toThrow(CalcError);
    expect(() => series('wall', 1e9, 1)).toThrow(CalcError);
  });
});

describe('dimensional solid problems', () => {
  const brick = { shape: 'wall' as const, size: 0.1, alpha: 5e-7, k: 1, h: 20, tInitial: 20, tFluid: 500 };
  it('finds the time to reach a center temperature and reproduces it', () => {
    const r = solid({ ...brick, target: 300 });
    expect(r.timeToTarget).toBeGreaterThan(0);
    expect(r.center).toBeCloseTo(300, 6);
    const again = solid({ ...brick, time: r.timeToTarget });
    expect(again.temperature).toBeCloseTo(300, 6);
  });
  it('profile runs from the center to the surface and is monotonic for heating', () => {
    const p = profile(brick, 3600, 11);
    expect(p.temperature[0]).toBeLessThan(p.temperature[10]!);
    for (let i = 1; i < p.temperature.length; i++)
      expect(p.temperature[i]!).toBeGreaterThanOrEqual(p.temperature[i - 1]! - 1e-9);
  });
  it('mass diffusion is the same maths with concentration in place of temperature', () => {
    const r = solid({
      shape: 'wall',
      size: 0.002,
      alpha: 1e-10,
      k: 1e-10,
      h: 2e-8,
      tInitial: 0,
      tFluid: 1,
      time: 3600,
    });
    expect(r.biot).toBeCloseTo(0.4, 9);
    expect(r.center).toBeGreaterThan(0);
    expect(r.center).toBeLessThan(r.surface);
  });
  it('rejects impossible targets', () => {
    expect(() => solid({ ...brick, target: 600 })).toThrow(CalcError);
    expect(() => solid({ ...brick })).toThrow(CalcError);
  });
});

describe('semi-infinite solid', () => {
  it('soil at 20 C, surface -15 C, 0.8 m deep after 60 days: eta 0.47292, T = 2.373 C', () => {
    const r = semiInfinite({
      surface: 'temperature',
      alpha: 0.138e-6,
      k: 1,
      tInitial: 20,
      depth: 0.8,
      time: 60 * 86400,
      value: -15,
    });
    expect(Math.abs(r.eta - 0.47292)).toBeLessThan(1e-4);
    expect(Math.abs(r.temperature - 2.373)).toBeLessThan(1e-3);
    expect(r.temperature).toBeCloseTo(2.373422544073133, 9);
  });
  it('constant flux and convection (SciPy reference)', () => {
    const flux = semiInfinite({
      surface: 'flux',
      alpha: 1e-6,
      k: 1,
      tInitial: 0,
      depth: 0.01,
      time: 3600,
      value: 1000,
    });
    expect(flux.temperature).toBeCloseTo(58.17236460253214, 8);
    const conv = semiInfinite({
      surface: 'convection',
      alpha: 1e-6,
      k: 1,
      tInitial: 0,
      depth: 0.01,
      time: 3600,
      value: 1,
      h: 50,
    });
    expect(conv.temperature).toBeCloseTo(0.7328158594048245, 9);
  });
  it('convection tends to the fixed-temperature solution as h grows', () => {
    const a = semiInfinite({
      surface: 'convection',
      alpha: 1e-6,
      k: 1,
      tInitial: 0,
      depth: 0.01,
      time: 3600,
      value: 1,
      h: 1e9,
    });
    const b = semiInfinite({
      surface: 'temperature',
      alpha: 1e-6,
      k: 1,
      tInitial: 0,
      depth: 0.01,
      time: 3600,
      value: 1,
    });
    expect(Math.abs(a.temperature - b.temperature)).toBeLessThan(1e-6);
  });
  it('at the surface the fixed temperature is reached immediately; bad input is rejected', () => {
    expect(
      semiInfinite({ surface: 'temperature', alpha: 1e-6, k: 1, tInitial: 20, depth: 0, time: 10, value: -5 })
        .temperature,
    ).toBeCloseTo(-5, 12);
    expect(() =>
      semiInfinite({ surface: 'temperature', alpha: 1e-6, k: 1, tInitial: 20, depth: -1, time: 10, value: 0 }),
    ).toThrow(CalcError);
    expect(() =>
      semiInfinite({ surface: 'convection', alpha: 1e-6, k: 1, tInitial: 20, depth: 1, time: 10, value: 0 }),
    ).toThrow(CalcError);
    expect(() =>
      semiInfinite({ surface: 'temperature', alpha: 1e-6, k: 1, tInitial: 20, depth: 1, time: 0, value: 0 }),
    ).toThrow(CalcError);
  });
});
