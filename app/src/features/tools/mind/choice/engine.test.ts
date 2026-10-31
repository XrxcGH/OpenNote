// The decision-model engine against the planned cases. The diffusion numbers check against the symmetric closed
// form P = 1/(1 + e^{-2vA/s^2}), E[DT] = (A/v) tanh(Av/s^2); the density against its own integrals.
import { describe, expect, it } from 'vitest';
import { integrate } from '../kit/num';
import { makeRng } from '../kit/rng';
import { MindError } from '../kit/types';
import {
  diffusionChoice,
  ez,
  ezForward,
  gamble,
  inverseValue,
  passageDensity,
  simulate,
  value,
  weight,
} from './engine';

const code = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof MindError ? error.code : 'other';
  }
  return 'none';
};

const BASE = { v: 0.2, a: 0.1, w: 0.5, s: 0.1 };

describe('drift diffusion', () => {
  it('gives P(correct) 0.880797 and mean decision time 0.190399 s', () => {
    const r = diffusionChoice(BASE);
    // A = 0.05: 2vA/s^2 = 2, so P = 1/(1 + e^-2); Av/s^2 = 1, so E[DT] = 0.25 tanh(1).
    expect(r.pUpper).toBeCloseTo(1 / (1 + Math.exp(-2)), 12);
    expect(r.pUpper).toBeCloseTo(0.880797, 6);
    expect(r.meanDt).toBeCloseTo(0.25 * Math.tanh(1), 12);
    expect(r.meanDt).toBeCloseTo(0.190399, 6);
  });

  it('handles zero drift and a biased start', () => {
    expect(diffusionChoice({ ...BASE, v: 0 }).pUpper).toBe(0.5);
    // With no drift, E[T] = z(a - z)/s^2 = 0.05 * 0.05 / 0.01.
    expect(diffusionChoice({ ...BASE, v: 0 }).meanDt).toBeCloseTo(0.25, 12);
    expect(diffusionChoice({ ...BASE, w: 0.7 }).pUpper).toBeGreaterThan(diffusionChoice(BASE).pUpper);
  });

  it('has a density whose integrals are the choice probabilities', () => {
    for (const d of [BASE, { ...BASE, w: 0.3, v: -0.1 }]) {
      const up = integrate((t) => passageDensity(t, d, 'upper'), 1e-6, 5, 1e-10);
      const low = integrate((t) => passageDensity(t, d, 'lower'), 1e-6, 5, 1e-10);
      expect(up).toBeCloseTo(diffusionChoice(d).pUpper, 6);
      expect(up + low).toBeCloseTo(1, 6);
    }
    // The small- and large-time series agree where they meet (t/a^2 = 1 in unit-noise terms).
    const t = 1; // a/s = 1, so t/a^2 = 1 here.
    expect(passageDensity(t * (1 - 1e-9), BASE, 'upper')).toBeCloseTo(passageDensity(t * (1 + 1e-9), BASE, 'upper'), 5);
  });

  it('simulates close to the closed form with a seed, and the same seed gives the same run', () => {
    const run = simulate(BASE, 0.3, 4000, 0.0005, makeRng(7));
    const p = run.upper.length / run.trials;
    expect(Math.abs(p - 0.880797)).toBeLessThan(0.02);
    expect(simulate(BASE, 0.3, 50, 0.001, makeRng(3)).upper).toEqual(simulate(BASE, 0.3, 50, 0.001, makeRng(3)).upper);
    expect(Math.min(...run.upper)).toBeGreaterThan(0.3);
  });
});

describe('EZ-diffusion', () => {
  it('round-trips v 0.2, a 0.12, Ter 0.3', () => {
    const f = ezForward(0.2, 0.12, 0.3, 0.1);
    // va/s^2 = 2.4, so Pc = 1/(1 + e^-2.4); MRT = 0.3 + 0.3 tanh(1.2).
    expect(f.pc).toBeCloseTo(0.916827, 6);
    expect(f.mrt).toBeCloseTo(0.3 + 0.3 * Math.tanh(1.2), 12);
    expect(f.mrt).toBeCloseTo(0.550096, 6);
    expect(f.vrt).toBeCloseTo(0.0350723, 7);
    const back = ez(f.pc, f.vrt, f.mrt, 0.1);
    expect(back.v).toBeCloseTo(0.2, 9);
    expect(back.a).toBeCloseTo(0.12, 9);
    expect(back.ter).toBeCloseTo(0.3, 9);
  });

  it('stops at chance, at perfect accuracy, and when the decision time exceeds the mean RT', () => {
    expect(code(() => ez(0.5, 0.03, 0.5, 0.1))).toBe('ezChance');
    expect(code(() => ez(1, 0.03, 0.5, 0.1))).toBe('ezEdge');
    expect(code(() => ez(0.9, 0.035, 0.1, 0.1))).toBe('ezTer');
    expect(code(() => ez(0.9, 0, 0.5, 0.1))).toBe('positive');
  });
});

describe('prospect theory', () => {
  const shape = { alpha: 0.88, beta: 0.88, lambda: 2.25 };

  it('values +100 at 57.544 and -100 at -129.474', () => {
    expect(value(100, shape)).toBeCloseTo(Math.pow(100, 0.88), 12);
    expect(value(100, shape)).toBeCloseTo(57.544, 3);
    expect(value(-100, shape)).toBeCloseTo(-129.474, 3);
    expect(inverseValue(value(-100, shape), shape)).toBeCloseTo(-100, 9);
  });

  it('weights 0.1 at 0.186303 with gamma 0.61', () => {
    const g = 0.61;
    const byHand = Math.pow(0.1, g) / Math.pow(Math.pow(0.1, g) + Math.pow(0.9, g), 1 / g);
    expect(weight(0.1, 'tk', g)).toBeCloseTo(byHand, 12);
    expect(weight(0.1, 'tk', g)).toBeCloseTo(0.186303, 6);
    expect(weight(1 / Math.E, 'prelec', 0.65)).toBeCloseTo(1 / Math.E, 12);
    expect(weight(0, 'tk', g)).toBe(0);
  });

  it('gives a sure thing its own value and ranks a mixed gamble from the extremes', () => {
    expect(gamble([{ x: 50, p: 1 }], shape, 'tk', 0.61, 0.69).certainty).toBeCloseTo(50, 9);
    const g = gamble(
      [
        { x: 100, p: 0.5 },
        { x: -100, p: 0.5 },
      ],
      shape,
      'tk',
      0.61,
      0.69,
    );
    const byHand = weight(0.5, 'tk', 0.61) * value(100, shape) + weight(0.5, 'tk', 0.69) * value(-100, shape);
    expect(g.worth).toBeCloseTo(byHand, 12);
    expect(g.expected).toBe(0);
    expect(g.certainty).toBeLessThan(0);
  });

  it('stops when the probabilities do not add to 1', () => {
    expect(code(() => gamble([{ x: 1, p: 0.4 }], shape, 'tk', 0.61, 0.69))).toBe('probabilities');
    expect(code(() => gamble([], shape, 'tk', 0.61, 0.69))).toBe('empty');
  });
});
