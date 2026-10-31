// Seismology: each planning case checks the engine against a value worked out independently (the planning pass's
// own computation, or a synthetic survey built from known answers), then the documented problems for bad input.
import { describe, expect, it } from 'vitest';
import { Problem } from '../core/problem';
import { rel } from '../core/testing';
import {
  bValue,
  cumulative,
  dix,
  fromPicks,
  locate,
  magnitude,
  moment,
  momentOf,
  nmo,
  refraction,
  spDistance,
  wadati,
  waveSpeeds,
} from './engine';

const problem = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof Problem ? error.code : 'other';
  }
  return null;
};

describe('arrival times', () => {
  it('gives 84 km for an S-P time of 10 s with Vp 6 and Vs 3.5 km/s', () => {
    expect(rel(spDistance(10, 6000, 3500), 84000)).toBeLessThan(1e-6);
    expect(spDistance(0, 6000, 3500)).toBe(0);
  });

  it('recovers Vp/Vs and the origin time from a Wadati diagram built with 1.75 and 2 s', () => {
    const arrivals = [20, 50, 90, 140].map((d) => [2 + d / 6, 2 + (d * 1.75) / 6] as const);
    const w = wadati(arrivals);
    expect(rel(w.ratio, 1.75)).toBeLessThan(1e-12);
    expect(Math.abs(w.origin - 2)).toBeLessThan(1e-9);
  });

  it('locates a synthetic epicenter at (10, 20) km with origin time 5 s', () => {
    const v = 6000;
    const at = (x: number, y: number) => ({ x, y, t: 5 + Math.hypot(x - 10e3, y - 20e3) / v });
    const loc = locate([at(0, 0), at(50e3, 0), at(0, 50e3), at(40e3, 40e3)], v);
    expect(Math.abs(loc.x - 10e3)).toBeLessThan(1e-3);
    expect(Math.abs(loc.y - 20e3)).toBeLessThan(1e-3);
    expect(Math.abs(loc.origin - 5)).toBeLessThan(1e-6);
    expect(loc.rms).toBeLessThan(1e-6);
  });

  it('names too few stations, equal S and P speeds, and a negative time', () => {
    expect(problem(() => locate([{ x: 0, y: 0, t: 1 }], 6000))).toBe('stations');
    expect(problem(() => spDistance(10, 3500, 3500))).toBe('vpvs');
    expect(problem(() => spDistance(-1, 6000, 3500))).toBe('time');
    expect(problem(() => spDistance(1, 0, 3500))).toBe('speed');
  });
});

describe('size', () => {
  it('gives Mw 7.26667 and log E 15.7 for M0 1e20 N m', () => {
    const m = magnitude(1e20);
    expect(Math.abs(m.mw - 7.26667)).toBeLessThan(5e-6);
    expect(Math.abs(m.logEnergy - 15.7)).toBeLessThan(1e-9);
    expect(rel(momentOf(m.mw), 1e20)).toBeLessThan(1e-12);
  });

  it('multiplies rigidity, area, and slip, and refuses zero', () => {
    expect(moment(30e9, 1e6, 2)).toBe(6e16);
    expect(problem(() => moment(30e9, 0, 2))).toBe('positive');
    expect(problem(() => magnitude(0))).toBe('positive');
  });

  it('gives the Aki-Utsu b-value 0.987033 for ten magnitudes with Mc 2.0 and bins of 0.1', () => {
    const mags = [2.0, 2.1, 2.3, 2.5, 2.2, 3.0, 2.4, 2.8, 2.0, 2.6];
    const b = bValue(mags, 2.0, 0.1);
    // By hand: mean 2.39, b = log10(e) / (2.39 − 1.95).
    expect(Math.abs(b.b - 0.987033)).toBeLessThan(1e-6);
    expect(b.count).toBe(10);
    expect(rel(b.a, 1 + b.b * 2)).toBeLessThan(1e-12);
    expect(rel(b.seAki, b.b / Math.sqrt(10))).toBeLessThan(1e-12);
    expect(cumulative(mags, 2.0, 0.1)[0]).toEqual([2, 10]);
  });

  it('leaves out magnitudes below Mc and names a set too small', () => {
    expect(bValue([1.0, 2.0, 2.5], 2.0, 0.1).below).toBe(1);
    expect(problem(() => bValue([2.5], 2.0, 0.1))).toBe('magnitudes');
    expect(problem(() => bValue([], 2.0, 0.1))).toBe('magnitudes');
  });
});

describe('surveys', () => {
  it('gives crossover 59.3296 m, intercept 0.0247207 s, and critical distance 16.1808 m', () => {
    const r = refraction(1500, 4000, 20);
    expect(Math.abs(r.crossover - 59.3296)).toBeLessThan(1e-4);
    expect(Math.abs(r.intercept - 0.0247207)).toBeLessThan(1e-7);
    expect(Math.abs(r.critical - 16.1808)).toBeLessThan(1e-4);
  });

  it('recovers 1500 and 4000 m/s and a 20 m layer from picks built from them', () => {
    const ti = refraction(1500, 4000, 20).intercept;
    const picks = [
      [5, 5 / 1500, 1],
      [10, 10 / 1500, 1],
      [20, 20 / 1500, 1],
      [60, ti + 60 / 4000, 2],
      [80, ti + 80 / 4000, 2],
      [100, ti + 100 / 4000, 2],
    ] as const;
    const p = fromPicks(picks);
    expect(rel(p.v1, 1500)).toBeLessThan(1e-9);
    expect(rel(p.v2, 4000)).toBeLessThan(1e-9);
    expect(rel(p.depth, 20)).toBeLessThan(1e-9);
  });

  it('names a slower lower layer', () => {
    expect(problem(() => refraction(4000, 1500, 20))).toBe('faster');
    expect(problem(() => refraction(1500, 4000, 0))).toBe('thickness');
  });

  it('gives the NMO time 1.11803 s and the Dix speed 3278.72 m/s', () => {
    expect(Math.abs(nmo(1, 1000, 2000).t - 1.11803)).toBeLessThan(5e-6);
    expect(Math.abs(dix(1.0, 2000, 1.5, 2500).speed - 3278.72)).toBeLessThan(5e-3);
    expect(problem(() => dix(1.5, 2000, 1.0, 2500))).toBe('order');
    expect(problem(() => dix(1.0, 3000, 1.1, 1000))).toBe('dix');
  });

  it('gives wave speeds from moduli, with Vp/Vs √3 for a Poisson solid', () => {
    // K = 5/3 μ makes λ = μ, so Vp/Vs = √3 and Poisson's ratio 0.25.
    const w = waveSpeeds(50e9, 30e9, 2700);
    expect(rel(w.ratio, Math.sqrt(3))).toBeLessThan(1e-12);
    expect(rel(w.poisson, 0.25)).toBeLessThan(1e-12);
    expect(rel(w.vs, Math.sqrt(30e9 / 2700))).toBeLessThan(1e-12);
    expect(problem(() => waveSpeeds(50e9, 30e9, 0))).toBe('moduli');
  });
});
