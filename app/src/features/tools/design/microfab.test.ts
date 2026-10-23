import { describe, expect, it } from 'vitest';
import {
  binding,
  dieYield,
  diesPerWafer,
  etch,
  evaporation,
  fractionBound,
  lithography,
  selectivity,
  stoney,
} from './microfab';

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(String((r as unknown as { problem: string }).problem));
  return r as Extract<T, { ok: true }>;
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('lithography', () => {
  it('193 nm, NA 1.35, k1 0.25, k2 1', () => {
    const r = ok(lithography(193, 1.35, 0.25, 1));
    expect(rel(r.resolution, 35.741)).toBeLessThan(1e-4);
    expect(rel(r.dof, 105.9)).toBeLessThan(1e-4);
  });
  it('rejects impossible optics', () => {
    expect(lithography(193, 0, 0.25, 1)).toEqual({ ok: false, problem: 'naRange' });
    expect(lithography(193, 2, 0.25, 1)).toEqual({ ok: false, problem: 'naRange' });
    expect(lithography(-1, 1, 0.25, 1)).toEqual({ ok: false, problem: 'wavelengthPositive' });
  });
});

describe('etching', () => {
  it('depth, undercut and anisotropy', () => {
    const r = ok(etch(100, 20, 3));
    expect(r.depth).toBe(300);
    expect(r.undercut).toBe(60);
    expect(r.anisotropy).toBeCloseTo(0.8, 12);
    expect(ok(etch(100, 100, 1)).anisotropy).toBe(0);
    expect(ok(etch(100, 0, 1)).anisotropy).toBe(1);
  });
  it('selectivity and bad input', () => {
    expect(ok(selectivity(300, 3)).selectivity).toBe(100);
    expect(selectivity(300, 0)).toEqual({ ok: false, problem: 'rateMaskPositive' });
    expect(etch(0, 0, 1)).toEqual({ ok: false, problem: 'rateVerticalPositive' });
  });
});

describe('Stoney and evaporation', () => {
  it('Si 130 GPa, nu 0.28, 500 um substrate, 1 um film, R 100 m gives 75.231 MPa', () => {
    const r = ok(stoney({ es: 130e9, nus: 0.28, hs: 500e-6, hf: 1e-6, radius: 100 }));
    expect(rel(r.stress, 75.231e6)).toBeLessThan(1e-4);
  });
  it('sign follows the curvature and a thick film is refused', () => {
    expect(ok(stoney({ es: 130e9, nus: 0.28, hs: 500e-6, hf: 1e-6, radius: -100 })).stress).toBeLessThan(0);
    expect(stoney({ es: 130e9, nus: 0.28, hs: 500e-6, hf: 1e-6, radius: 0 })).toEqual({
      ok: false,
      problem: 'radiusNonZero',
    });
    expect(stoney({ es: 130e9, nus: 0.28, hs: 500e-6, hf: 100e-6, radius: 10 })).toEqual({
      ok: false,
      problem: 'filmNotThin',
    });
  });
  it('cosine-law thickness falls as (1 + (x/h)^2)^-2', () => {
    const r = ok(evaporation(1e-3, 2700, 0.3, 0.3));
    expect(r.center).toBeCloseTo(1e-3 / (Math.PI * 2700 * 0.09), 15);
    expect(r.at / r.center).toBeCloseTo(0.25, 12);
    expect(evaporation(0, 2700, 0.3, 0)).toEqual({ ok: false, problem: 'massPositive' });
  });
});

describe('wafer', () => {
  it('300 mm wafer, 100 mm2 die gives 640.2 dies', () => {
    const r = ok(diesPerWafer(300, 100));
    expect(rel(r.dies, 640.2)).toBeLessThan(1e-3);
    expect(r.dies).toBeCloseTo((Math.PI * 150 ** 2) / 100 - (Math.PI * 300) / Math.sqrt(200), 9);
  });
  it('edge exclusion reduces the count; an absurd die is refused', () => {
    expect(ok(diesPerWafer(300, 100, 3)).dies).toBeLessThan(ok(diesPerWafer(300, 100)).dies);
    expect(diesPerWafer(300, 1e6)).toEqual({ ok: false, problem: 'dieTooLarge' });
    expect(diesPerWafer(300, 100, 150)).toEqual({ ok: false, problem: 'edgeRange' });
  });
  it('yield models', () => {
    const x = 1 * 0.5;
    expect(ok(dieYield('poisson', 1, 0.5)).yield).toBeCloseTo(Math.exp(-x), 12);
    expect(ok(dieYield('murphy', 1, 0.5)).yield).toBeCloseTo(((1 - Math.exp(-x)) / x) ** 2, 12);
    expect(ok(dieYield('seeds', 1, 0.5)).yield).toBeCloseTo(1 / 1.5, 12);
    expect(ok(dieYield('murphy', 1, 0)).yield).toBe(1);
    expect(dieYield('poisson', 1, -1)).toEqual({ ok: false, problem: 'defectsNegative' });
  });
});

describe('Langmuir binding', () => {
  it('KD 1 nM at 1 nM binds half', () => {
    expect(ok(fractionBound(1e-9, 1e-9)).theta).toBe(0.5);
    expect(ok(fractionBound(0, 1e-9)).theta).toBe(0);
    expect(fractionBound(1, 0)).toEqual({ ok: false, problem: 'kdPositive' });
  });
  it('kinetics approach equilibrium', () => {
    const r = ok(binding(1e5, 1e-4, 1e-9, 0));
    expect(r.kd).toBeCloseTo(1e-9, 20);
    expect(r.theta).toBeCloseTo(0.5, 9);
    expect(r.kobs).toBeCloseTo(2e-4, 15);
    expect(r.at).toBe(0);
    const late = ok(binding(1e5, 1e-4, 1e-9, 1e6));
    expect(late.at).toBeCloseTo(0.5, 9);
    const t95 = ok(binding(1e5, 1e-4, 1e-9, 0)).t95;
    const at95 = ok(binding(1e5, 1e-4, 1e-9, t95)).at;
    expect(at95 / 0.5).toBeCloseTo(0.95, 9);
  });
});
