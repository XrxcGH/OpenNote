// Frequency response against the plan's cases and closed forms: crossovers solved by bisection on the polynomial
// |L(jω)|² = 1, phase margins from arctangents, the second-order bandwidth and peak formulas, and Nyquist counts
// checked against the closed loop's own roots.
import { describe, expect, it } from 'vitest';
import { ControlError } from '../lib/errors';
import { readTF, rootsOf } from '../lib/tf';
import {
  asymptote,
  asymptoteDb,
  closedLoop,
  grid,
  magDb,
  makeLoop,
  margins,
  nyquist,
  phaseDeg,
  type Loop,
} from './engine';

const loop = (text: string, delay = 0) => makeLoop(readTF(text), delay);
const all = (l: Loop) => margins(l, grid(l));
const atan = (x: number) => (Math.atan(x) * 180) / Math.PI;

/** The root of f on [a, b] by plain bisection. */
function bisect(f: (x: number) => number, a: number, b: number): number {
  let lo = a;
  let hi = b;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (Math.sign(f(mid)) === Math.sign(f(lo))) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

describe('validation cases', () => {
  it('10/(s(s + 1)(s + 5)): ω_gc = 1.2270, PM = 25.39°, ω_pc = √5, GM = 9.5424 dB', () => {
    const m = all(loop('10/(s (s + 1) (s + 5))'));
    const wgc = bisect((w) => w * w * (w * w + 1) * (w * w + 25) - 100, 0.5, 2);
    expect(m.wgc).toBeCloseTo(wgc, 9);
    expect(m.wgc).toBeCloseTo(1.227, 3);
    expect(m.pm).toBeCloseTo(90 - atan(wgc) - atan(wgc / 5), 8);
    expect(m.pm).toBeCloseTo(25.39, 2);
    expect(m.wpc).toBeCloseTo(Math.sqrt(5), 9);
    expect(m.gm).toBeCloseTo(20 * Math.log10(3), 8);
  });

  it('2(s + 1)/(s(s − 1)): P = 1, one counter-clockwise encirclement, closed loop stable', () => {
    const r = nyquist(loop('2 (s + 1)/(s (s - 1))'));
    expect([r.p, r.ccw, r.z]).toEqual([1, 1, 0]);
    // Independent: s² + s + 2 has both roots in the left half-plane.
    expect(rootsOf([2, 1, 1]).every((z) => z.re < 0)).toBe(true);
  });

  it('1/(s + 1) at ω = 1 is −3.0103 dB and −45°', () => {
    const l = loop('1/(s + 1)');
    expect(magDb(l, 1)).toBeCloseTo(-10 * Math.log10(2), 10);
    expect(phaseDeg(l, 1)).toBeCloseTo(-45, 12);
  });
});

describe('margins and delay', () => {
  it('2e^(−0.2s)/(s + 1): ω_gc = √3 and PM = 120° − 0.2√3 rad', () => {
    const m = all(loop('2/(s + 1)', 0.2));
    expect(m.wgc).toBeCloseTo(Math.sqrt(3), 9);
    expect(m.pm).toBeCloseTo(120 - (0.2 * Math.sqrt(3) * 180) / Math.PI, 8);
    expect(m.delayMargin).toBeCloseTo((m.pm * Math.PI) / 180 / Math.sqrt(3), 12);
  });

  it('a loop without a gain crossover has infinite PM', () => {
    const m = all(loop('0.5/(s + 1)'));
    expect(m.gainCrossovers).toEqual([]);
    expect(m.pm).toBe(Infinity);
  });

  it('draws the straight-line asymptote 20 log K_B − 20N log ω with breaks at the corners', () => {
    const a = asymptote(loop('10/(s (s + 1) (s + 5))'));
    expect(a.bodeGain).toBeCloseTo(2, 12);
    expect(a.type).toBe(1);
    expect(a.breaks).toEqual([
      { w: 1, change: -20 },
      { w: 5, change: -20 },
    ]);
    expect(asymptoteDb(a, 0.1)).toBeCloseTo(20 * Math.log10(2) + 20, 10);
    expect(asymptoteDb(a, 50)).toBeCloseTo(
      20 * Math.log10(2) - 20 * Math.log10(50) - 40 * Math.log10(50 / 5) - 20 * Math.log10(5),
      10,
    );
  });
});

describe('closed loop', () => {
  it('1/s closes to 1/(s + 1): bandwidth 1 rad/s and no peak', () => {
    const l = loop('1/s');
    const c = closedLoop(l, grid(l, 1e-3, 1e3));
    expect(c.dc).toBeCloseTo(1, 6);
    expect(c.bandwidth).toBeCloseTo(1, 8);
    expect(c.peakDb).toBeCloseTo(0, 5);
  });

  it('a second-order loop matches the bandwidth and resonance formulas', () => {
    const [z, wn] = [0.3, 2];
    const l = loop(`${wn * wn}/(s (s + ${2 * z * wn}))`);
    const c = closedLoop(l, grid(l, 1e-3, 1e3, 20001));
    expect(c.bandwidth).toBeCloseTo(wn * Math.sqrt(1 - 2 * z * z + Math.sqrt(4 * z ** 4 - 4 * z * z + 2)), 8);
    expect(c.peakDb).toBeCloseTo(20 * Math.log10(1 / (2 * z * Math.sqrt(1 - z * z))), 4);
    expect(c.wPeak).toBeCloseTo(wn * Math.sqrt(1 - 2 * z * z), 2);
  });

  it('refines the resonant peak off the default grid', () => {
    const [z, wn] = [0.3, 2];
    const l = loop(`${wn * wn}/(s (s + ${2 * z * wn}))`);
    const c = closedLoop(l, grid(l));
    expect(Math.abs(c.wPeak - wn * Math.sqrt(1 - 2 * z * z))).toBeLessThan(1e-6);
    expect(c.peakDb).toBeCloseTo(20 * Math.log10(1 / (2 * z * Math.sqrt(1 - z * z))), 8);
    // 2/(s(s + 1)(s + 2)): |D(jω)|² = u³ + 5u² − 8u + 4 with u = ω², least at u = 2/3, where it is 32/27.
    const k = loop('2/(s (s + 1) (s + 2))');
    const ck = closedLoop(k, grid(k));
    expect(Math.abs(ck.wPeak - Math.sqrt(2 / 3))).toBeLessThan(1e-6);
    expect(ck.peakDb).toBeCloseTo(20 * Math.log10(2 / Math.sqrt(32 / 27)), 8);
  });
});

describe('the Nyquist criterion against closed-loop roots', () => {
  const cases: [string, number, number][] = [
    ['10/(s (s + 1) (s + 5))', 0, 0],
    ['40/(s (s + 1) (s + 5))', 0, 2],
    ['0.5/(s - 1)', 0, 1],
    ['3/(s - 1)', 0, 0],
    ['2/(s + 1)', 1, 0],
    ['2/(s + 1)', 1.5, 2],
  ];
  it.each(cases)('counts %s with delay %s: Z = %s', (text, delay, z) => {
    const r = nyquist(loop(text, delay));
    expect(r.z).toBe(z);
    if (r.closedPoles) expect(r.closedPoles.filter((q) => q.re > 0).length).toBe(z);
    expect(r.marginal).toBe(false);
  });

  it('flags closed-loop poles on the imaginary axis', () => {
    expect(nyquist(loop('1/(s^2 + 1)')).marginal).toBe(true);
    expect(nyquist(loop('48/(s (s + 2) (s + 4))')).marginal).toBe(true);
  });
});

const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    if (e instanceof ControlError) return e.code;
    throw e;
  }
  return 'none';
};

describe('impossible input', () => {
  const cases: [string, () => unknown][] = [
    ['improper', () => loop('s^2/(s + 1)')],
    ['delayRange', () => loop('1/(s + 1)', -1)],
    ['rangeOrder', () => grid(loop('1/(s + 1)'), 10, 1)],
    ['delayProper', () => nyquist(loop('(s + 2)/(s + 1)', 0.1))],
  ];
  it.each(cases)('names %s', (want, f) => expect(code(f)).toBe(want));
});
