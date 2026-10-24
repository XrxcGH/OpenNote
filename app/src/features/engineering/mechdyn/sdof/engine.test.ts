import { describe, expect, it } from 'vitest';
import { solveSdof, SDOF_DEFAULTS, type SdofInput } from './engine';

const run = (patch: Partial<SdofInput>) => {
  const out = solveSdof({ ...SDOF_DEFAULTS, ...patch });
  if (!out.ok) throw new Error(out.error);
  return out.value;
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('single-degree-of-freedom vibration', () => {
  it('m 10 kg, k 4000 N/m, c 40 N s/m: natural frequency, damping, decrement', () => {
    const r = run({ m: 10, k: 4000, damping: 'c', c: 40 });
    expect(Math.abs(r.omegaN - 20)).toBeLessThan(1e-5);
    expect(Math.abs(r.zeta - 0.1)).toBeLessThan(1e-5);
    expect(Math.abs(r.omegaD! - 19.8997)).toBeLessThan(1e-4);
    expect(Math.abs(r.logDec! - 0.63148)).toBeLessThan(1e-5);
    expect(r.regime).toBe('under');
    // Independent check: the simulated free response's first two peaks give the same decrement.
    expect(Math.abs(r.logDecMeasured! - r.logDec!)).toBeLessThan(1e-6);
  });

  it('same, F0 100 N at 15 rad/s: amplitude and phase', () => {
    const r = run({ forcing: 'harmonic', F0: 100, omega: 15 });
    expect(rel(r.forced!.X * 1000, 54.054)).toBeLessThan(1e-4);
    expect(rel((r.forced!.phase * 180) / Math.PI, 18.925)).toBeLessThan(1e-4);
    // Independent: (F0/k) / |1 - r^2 + 2 i zeta r| with r = 0.75 is 0.025 / 0.4625.
    expect(r.forced!.X).toBeCloseTo(0.025 / 0.4625, 12);
  });

  it('the simulated steady state settles to the closed-form amplitude', () => {
    const r = run({ forcing: 'harmonic', F0: 100, omega: 15, x0: 0, duration: 6 });
    const tail = r.response.series[0].points.filter(([t]) => t > 4.5).map(([, x]) => Math.abs(x));
    expect(rel(Math.max(...tail), r.forced!.X)).toBeLessThan(2e-3);
  });

  it('transmissibility at r = 2, zeta 0.1', () => {
    const r = run({ damping: 'zeta', zeta: 0.1, forcing: 'base', Y: 0.01, omega: 40 });
    expect(Math.abs(r.forced!.transmissibility - 0.35586)).toBeLessThan(1e-5);
    expect(r.forced!.isolation).toBeCloseTo(1 - r.forced!.transmissibility, 12);
    // Relative motion Z = Y r^2 M = 0.01 * 4 / sqrt(9 + 0.16).
    expect(r.forced!.relative!).toBeCloseTo(0.04 / Math.sqrt(9.16), 12);
  });

  it('rotating unbalance and transmitted force', () => {
    const r = run({ forcing: 'unbalance', me: 0.02, omega: 40, damping: 'zeta', zeta: 0.1 });
    expect(r.forced!.X).toBeCloseTo(((0.02 / 10) * 4) / Math.sqrt(9.16), 12);
    expect(r.forced!.transmitted!).toBeCloseTo(0.02 * 1600 * Math.sqrt(1.16 / 9.16), 9);
  });

  it('free underdamped response matches the closed form', () => {
    const r = run({ x0: 0.01, v0: 0.2 });
    const wn = 20,
      z = 0.1,
      wd = wn * Math.sqrt(1 - z * z);
    const exact = (t: number) =>
      Math.exp(-z * wn * t) * (0.01 * Math.cos(wd * t) + ((0.2 + z * wn * 0.01) / wd) * Math.sin(wd * t));
    for (const [t, x] of r.response.series[0].points.filter((_, i) => i % 97 === 0)) expect(x).toBeCloseTo(exact(t), 8);
  });

  it('impulse response peaks where the closed form says', () => {
    const r = run({ x0: 0, v0: 0, forcing: 'impulse', impulse: 2, damping: 'c', c: 0 });
    expect(r.regime).toBe('undamped');
    expect(rel(r.peak, 2 / (10 * 20))).toBeLessThan(1e-4);
  });

  it('classifies critical and overdamped systems', () => {
    expect(run({ damping: 'zeta', zeta: 1 }).regime).toBe('critical');
    const over = run({ damping: 'zeta', zeta: 2 });
    expect(over.regime).toBe('over');
    expect(over.omegaD).toBeNull();
    expect(over.logDec).toBeNull();
  });

  it('custom forcing equal to the harmonic case gives the same response', () => {
    const a = run({ forcing: 'custom', custom: '100*sin(15*t)', duration: 2 });
    const b = run({ forcing: 'harmonic', F0: 100, omega: 15, duration: 2 });
    expect(a.response.series[0].points.at(-1)![1]).toBeCloseTo(b.response.series[0].points.at(-1)![1], 7);
  });

  it('rejects impossible input with a reason', () => {
    expect(solveSdof({ ...SDOF_DEFAULTS, m: 0 })).toEqual({ ok: false, error: 'positiveMass' });
    expect(solveSdof({ ...SDOF_DEFAULTS, k: -5 })).toEqual({ ok: false, error: 'positiveStiffness' });
    expect(solveSdof({ ...SDOF_DEFAULTS, c: -1 })).toEqual({ ok: false, error: 'negativeDamping' });
    expect(solveSdof({ ...SDOF_DEFAULTS, m: Number.NaN })).toEqual({ ok: false, error: 'notNumber' });
    expect(solveSdof({ ...SDOF_DEFAULTS, forcing: 'harmonic', omega: 0 })).toEqual({
      ok: false,
      error: 'positiveFrequency',
    });
    expect(solveSdof({ ...SDOF_DEFAULTS, forcing: 'custom', custom: 'sin(t' })).toMatchObject({
      ok: false,
      error: 'exprSyntax',
    });
    expect(solveSdof({ ...SDOF_DEFAULTS, forcing: 'custom', custom: 'q*t' })).toMatchObject({
      ok: false,
      error: 'exprUnknown',
    });
    expect(solveSdof({ ...SDOF_DEFAULTS, duration: 1e9 })).toEqual({ ok: false, error: 'tooLong' });
  });

  it('handles huge and tiny scales', () => {
    const big = run({ m: 1e6, k: 4e14, c: 4e9 });
    expect(big.omegaN).toBeCloseTo(2e4, 6);
    expect(big.zeta).toBeCloseTo(0.1, 12);
    const tiny = run({ m: 1e-6, k: 4e-4, c: 4e-6, x0: 1e-6 });
    expect(tiny.omegaN).toBeCloseTo(20, 9);
  });
});
