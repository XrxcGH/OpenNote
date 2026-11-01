import './text';
import { describe, expect, it } from 'vitest';
import { fit, monteCarlo, position, rng, stack } from './tolerances';
import type { StackItem } from './tolerances';

const sym = (name: string, nominal: number, t: number, sign: 1 | -1 = 1): StackItem => ({
  name,
  nominal,
  plus: t,
  minus: t,
  sign,
});
const three = [sym('a', 10, 0.1), sym('b', 20, 0.2), sym('c', 30, 0.1)];

describe('stack', () => {
  it('matches the worked 10, 20, 30 stack', () => {
    const r = stack(three);
    if (!r.ok) throw new Error(r.problem);
    expect(r.nominal).toBe(60);
    expect(r.worstPlus).toBeCloseTo(0.4, 12);
    expect(r.worstMinus).toBeCloseTo(0.4, 12);
    expect(r.rss).toBeCloseTo(Math.sqrt(0.01 + 0.04 + 0.01), 12);
    expect(r.rss).toBeCloseTo(0.24495, 5);
    expect(r.worstMax).toBeCloseTo(60.4, 12);
  });

  it('handles subtracting items and unequal tolerances', () => {
    // gap = 50 - 30 - 19.9; hole +0.2/-0, shaft +0/-0.1 pushed through the sign
    const r = stack([
      { name: 'housing', nominal: 50, plus: 0.2, minus: 0, sign: 1 },
      { name: 'shaft', nominal: 30, plus: 0, minus: 0.1, sign: -1 },
    ]);
    if (!r.ok) throw new Error(r.problem);
    expect(r.nominal).toBe(20);
    // largest gap: housing 50.2, shaft 29.9 -> 20.3; smallest: housing 50, shaft 30 -> 20
    expect(r.worstMax).toBeCloseTo(20.3, 12);
    expect(r.worstMin).toBeCloseTo(20, 12);
    expect(r.rssMean).toBeCloseTo(20.15, 12);
  });

  it('shares sum to one', () => {
    const r = stack(three);
    if (!r.ok) throw new Error(r.problem);
    expect(r.share.reduce((a, s) => a + s.worst, 0)).toBeCloseTo(1, 12);
    expect(r.share.reduce((a, s) => a + s.rss, 0)).toBeCloseTo(1, 12);
  });

  it('copes with zero tolerances and rejects bad input', () => {
    const z = stack([sym('a', 5, 0)]);
    if (!z.ok) throw new Error(z.problem);
    expect(z.rss).toBe(0);
    expect(z.share[0]?.worst).toBe(0);
    expect(stack([])).toEqual({ ok: false, problem: 'stackEmpty' });
    expect(stack([sym('a', 5, -0.1)])).toEqual({ ok: false, problem: 'negativeTolerance' });
    expect(stack([sym('a', NaN, 0.1)])).toEqual({ ok: false, problem: 'notNumber' });
    const huge = stack([sym('a', 1e12, 1e6)]);
    if (!huge.ok) throw new Error(huge.problem);
    expect(huge.worstMax).toBe(1e12 + 1e6);
  });
});

describe('monteCarlo', () => {
  it('repeats for the same seed', () => {
    const a = monteCarlo(three, 'uniform', 2000, 7);
    const b = monteCarlo(three, 'uniform', 2000, 7);
    expect(a).toEqual(b);
    expect(rng(1)()).not.toBe(rng(2)());
  });

  it('uniform sd matches sqrt(sum a^2 / 3)', () => {
    const r = monteCarlo(three, 'uniform', 200000, 11);
    if (!r.ok) throw new Error(r.problem);
    expect(r.mean).toBeCloseTo(60, 2);
    expect(r.sd).toBeCloseTo(Math.sqrt((0.01 + 0.04 + 0.01) / 3), 2);
    expect(r.min).toBeGreaterThanOrEqual(59.6);
    expect(r.max).toBeLessThanOrEqual(60.4);
  });

  it('normal draws with band = 3 sigma give sd near RSS / 3 and stay inside worst case', () => {
    const r = monteCarlo(three, 'normal', 200000, 5, { lo: 59.6, hi: 60.4 });
    if (!r.ok) throw new Error(r.problem);
    expect(r.sd).toBeGreaterThan(0.078);
    expect(r.sd).toBeLessThan(0.0816497);
    expect(r.inside).toBe(1);
    expect(r.bins.reduce((a, b) => a + b.count, 0)).toBe(200000);
  });

  it('rejects a silly run count', () => {
    expect(monteCarlo(three, 'normal', 3, 1)).toEqual({ ok: false, problem: 'runsRange' });
  });
});

describe('fit', () => {
  it('hole 20.000/20.021 and shaft 19.967/19.980 is a clearance fit', () => {
    const r = fit({ min: 20, max: 20.021 }, { min: 19.967, max: 19.98 });
    if (!r.ok) throw new Error(r.problem);
    expect(r.kind).toBe('clearance');
    expect(r.minClearance).toBeCloseTo(0.02, 9);
    expect(r.maxClearance).toBeCloseTo(0.054, 9);
  });

  it('classifies interference and transition fits', () => {
    const i = fit({ min: 20, max: 20.021 }, { min: 20.022, max: 20.035 });
    if (!i.ok) throw new Error(i.problem);
    expect(i.kind).toBe('interference');
    expect(i.maxClearance).toBeCloseTo(-0.001, 9);
    const t = fit({ min: 20, max: 20.021 }, { min: 20.002, max: 20.015 });
    if (!t.ok) throw new Error(t.problem);
    expect(t.kind).toBe('transition');
    expect(t.minClearance).toBeCloseTo(-0.015, 9);
    expect(t.maxClearance).toBeCloseTo(0.019, 9);
  });

  it('rejects impossible limits', () => {
    expect(fit({ min: 21, max: 20 }, { min: 19, max: 19.5 })).toEqual({ ok: false, problem: 'limitsOrder' });
    expect(fit({ min: 0, max: 20 }, { min: 19, max: 19.5 })).toEqual({ ok: false, problem: 'sizePositive' });
    expect(fit({ min: NaN, max: 20 }, { min: 19, max: 19.5 })).toEqual({ ok: false, problem: 'notNumber' });
  });
});

describe('position', () => {
  it('dx 0.03, dy 0.04, tolerance 0.10 at MMC with 0.05 bonus passes at 0.150', () => {
    const r = position(0.03, 0.04, 0.1, 'MMC', 0.05);
    if (!r.ok) throw new Error(r.problem);
    expect(r.position).toBeCloseTo(0.1, 12);
    expect(r.allowed).toBeCloseTo(0.15, 12);
    expect(r.pass).toBe(true);
  });

  it('RFS gives no bonus and can fail', () => {
    const r = position(0.03, 0.04, 0.08, 'RFS', 0.05);
    if (!r.ok) throw new Error(r.problem);
    expect(r.bonus).toBe(0);
    expect(r.pass).toBe(false);
  });

  it('passes exactly at the limit and rejects bad values', () => {
    const r = position(0.03, 0.04, 0.1, 'RFS', 0);
    if (!r.ok) throw new Error(r.problem);
    expect(r.pass).toBe(true);
    expect(position(0, 0, 0, 'RFS', 0)).toEqual({ ok: false, problem: 'tolerancePositive' });
    expect(position(0, 0, 0.1, 'MMC', -1)).toEqual({ ok: false, problem: 'departureNegative' });
    expect(position(Infinity, 0, 0.1, 'MMC', 0)).toEqual({ ok: false, problem: 'notNumber' });
  });
});
