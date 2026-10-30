import { describe, expect, it } from 'vitest';
import { initialValues, runTool } from '../spec';
import { firstOrder, firstPeak, secondOrder } from './engine';
import { spec } from './tool';

const close = (a: number, b: number, rel = 1e-4) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.abs(b));

describe('second-order response', () => {
  it('matches the series RLC step: α 500, ω₀ 1000, ω_d 866.03, peak 11.6303 V at 3.6276 ms', () => {
    const r = secondOrder(100 / (2 * 0.1), 1 / Math.sqrt(0.1 * 10e-6), 0, 0, 10);
    expect(r.damping).toBe('underdamped');
    close(r.alpha, 500, 1e-12);
    close(r.omega0, 1000, 1e-12);
    close(r.omegaD, 866.0254, 1e-6);
    const peak = firstPeak(r)!;
    close(peak.value, 11.6303, 1e-4);
    close(peak.time, 3.6276e-3, 1e-4);
    // independent: the first peak of a zero-state step is at π/ω_d with 1 + e^(−απ/ω_d) of the final value
    close(peak.time, Math.PI / r.omegaD, 1e-6);
    close(peak.value, 10 * (1 + Math.exp((-500 * Math.PI) / r.omegaD)), 1e-8);
  });

  it('starts and ends where the initial conditions and the source say', () => {
    const r = secondOrder(500, 1000, 2, 30, 10);
    close(r.at(0), 2, 1e-12);
    close(r.slope(0), 30, 1e-9);
    close(r.at(1), 10, 1e-9);
  });

  it('solves overdamped and critically damped circuits and has no overshoot', () => {
    const over = secondOrder(2000, 1000, 0, 0, 5);
    expect(over.damping).toBe('overdamped');
    close(over.s1 * over.s2, 1e6, 1e-9);
    close(over.s1 + over.s2, -4000, 1e-9);
    close(over.at(0), 0, 1e-9);
    expect(firstPeak(over)).toBeNull();
    const crit = secondOrder(1000, 1000, 0, 0, 5);
    expect(crit.damping).toBe('critical');
    close(crit.at(1e-3), 5 - 5 * Math.exp(-1) * 2, 1e-9);
    expect(firstPeak(crit)).toBeNull();
  });

  it('keeps both roots accurate when the damping is huge', () => {
    const r = secondOrder(1e8, 1, 0, 0, 1);
    close(r.s1, -5e-9, 1e-9);
  });

  it('refuses impossible circuits', () => {
    expect(() => secondOrder(-1, 1, 0, 0, 0)).toThrow();
    expect(() => secondOrder(1, 0, 0, 0, 0)).toThrow();
    expect(() => firstOrder(0, 0, 1)).toThrow();
  });
});

describe('first-order response', () => {
  it('RL: R 10 Ω, L 50 mH gives τ = 5 ms', () => {
    const out = runTool(spec, { ...initialValues(spec), circuit: 'rl', r: '10', l: '50m', vs: '5', i0: '0' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.rows.find((row) => row.key === 'tau')!.value).toBe('5 ms');
  });

  it('RC step reaches 63.2% after one time constant', () => {
    const r = firstOrder(1e-3, 0, 1);
    close(r.at(1e-3), 1 - Math.exp(-1), 1e-12);
    close(r.at(0), 0, 1e-12);
  });
});

describe('the tool', () => {
  it('describes the underdamped example in words, steps, and a plot', () => {
    const out = runTool(spec, { ...initialValues(spec), r: '100', l: '0.1', c: '10u', vs: '10' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.answer).toContain('11.63');
    expect(out.rows.map((row) => row.key)).toContain('peakTime');
    expect(out.steps.length).toBeGreaterThan(4);
    expect(out.plot!.series[0]!.y[0]).toBeCloseTo(0, 9);
  });

  it('solves the parallel circuit with a current source', () => {
    const out = runTool(spec, {
      ...initialValues(spec),
      circuit: 'parallelRlc',
      r: '200',
      l: '0.1',
      c: '10u',
      is: '1',
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.rows.find((row) => row.key === 'alpha')!.value).toBe('250 s⁻¹');
  });

  it('says which input is wrong', () => {
    const bad = runTool(spec, { ...initialValues(spec), r: 'abc' });
    expect(bad).toMatchObject({ ok: false, error: 'number', vars: { field: 'resistance' } });
    expect(runTool(spec, { ...initialValues(spec), r: '-5' })).toMatchObject({ ok: false, error: 'positive' });
    expect(runTool(spec, { ...initialValues(spec), c: '0' })).toMatchObject({ ok: false, error: 'positive' });
  });
});
