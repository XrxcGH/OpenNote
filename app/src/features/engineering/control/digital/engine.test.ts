import '../text';
import { describe, expect, it } from 'vitest';

import { ControlError } from '../lib/errors';
import { evalTF, makeTF, readTF, cabs, cx } from '../lib/tf';
import { alias, analyzeDiscrete, digitalPid, discretize, jury, longDivision, zLocus } from './engine';

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ControlError) return e.code;
    throw e;
  }
  return 'none';
};

describe('validation cases', () => {
  it('1/(s + 1), T = 0.1 s, ZOH: 0.095163/(z − 0.904837)', () => {
    const { hz } = discretize(readTF('1/(s+1)'), 0.1, 'zoh');
    expect(hz.den[1]).toBeCloseTo(1, 12);
    expect(Math.abs(hz.den[0] - -0.904837)).toBeLessThan(1e-6);
    expect(Math.abs(hz.num[0] - 0.095163)).toBeLessThan(1e-6);
    expect(hz.num.length).toBe(1);
    expect(hz.den[0]).toBeCloseTo(-Math.exp(-0.1), 14);
  });

  it('1/(s + 1), T = 0.1 s, Tustin: 0.047619 (z + 1)/(z − 0.904762)', () => {
    const { hz } = discretize(readTF('1/(s+1)'), 0.1, 'tustin');
    expect(Math.abs(hz.num[1] - 0.047619)).toBeLessThan(1e-6);
    expect(Math.abs(hz.num[0] - 0.047619)).toBeLessThan(1e-6);
    expect(Math.abs(hz.den[0] - -0.904762)).toBeLessThan(1e-6);
    expect(hz.den[0]).toBeCloseTo(-19 / 21, 14);
    expect(hz.num[0]).toBeCloseTo(1 / 21, 14);
  });

  it('z² − 1.2z + 0.5 is stable with |poles| = 0.70711', () => {
    const r = analyzeDiscrete(makeTF([1], [0.5, -1.2, 1]));
    expect(r.stable).toBe(true);
    expect(r.jury.stable).toBe(true);
    r.magnitudes.forEach((m) => expect(Math.abs(m - 0.70711)).toBeLessThan(1e-5));
    r.magnitudes.forEach((m) => expect(m).toBeCloseTo(Math.SQRT1_2, 12));
  });
});

describe('discretization against closed forms', () => {
  it('ZOH of 1/s² is T²(z + 1)/(2(z − 1)²)', () => {
    const T = 0.2;
    const { hz } = discretize(readTF('1/s^2'), T, 'zoh');
    const z = cx(0.3, 0.8);
    const expected = evalTF(makeTF([(T * T) / 2, (T * T) / 2], [1, -2, 1]), z);
    const got = evalTF(hz, z);
    expect(got.re).toBeCloseTo(expected.re, 12);
    expect(got.im).toBeCloseTo(expected.im, 12);
  });

  it('ZOH step response equals the continuous one at the samples', () => {
    const { hz } = discretize(readTF('4/(s^2 + 2s + 4)'), 0.05, 'zoh');
    const r = analyzeDiscrete(hz, 60);
    const wd = Math.sqrt(3);
    const cont = (t: number) => 1 - Math.exp(-t) * (Math.cos(wd * t) + Math.sin(wd * t) / wd);
    r.step.forEach((y, k) => expect(y).toBeCloseTo(cont(0.05 * k), 10));
  });

  it('Tustin of 1/s is (T/2)(z + 1)/(z − 1)', () => {
    const { hz } = discretize(readTF('1/s'), 0.5, 'tustin');
    expect(hz.num).toEqual([0.25, 0.25]);
    expect(hz.den).toEqual([-1, 1]);
  });

  it('prewarping makes the response exact at ω₀', () => {
    const g = readTF('10/(s^2 + 2s + 10)');
    const T = 0.2;
    const w0 = Math.sqrt(10);
    const { hz } = discretize(g, T, 'prewarp', w0);
    const a = evalTF(g, cx(0, w0));
    const b = evalTF(hz, cx(Math.cos(w0 * T), Math.sin(w0 * T)));
    expect(b.re).toBeCloseTo(a.re, 10);
    expect(b.im).toBeCloseTo(a.im, 10);
    expect(code(() => discretize(g, T, 'prewarp', 100))).toBe('prewarpRange');
  });

  it('matched pole-zero keeps DC gain and maps poles by e^{sT}', () => {
    const { hz } = discretize(readTF('(s + 2)/((s + 1)(s + 5))'), 0.1, 'matched');
    expect(evalTF(hz, cx(1)).re).toBeCloseTo(2 / 5, 12);
    const r = analyzeDiscrete(hz);
    const mags = [...r.magnitudes].sort();
    expect(mags[0]).toBeCloseTo(Math.exp(-0.5), 10);
    expect(mags[1]).toBeCloseTo(Math.exp(-0.1), 10);
    // Integrator: gain matched at low frequency.
    const integ = discretize(readTF('1/(s(s+1))'), 0.1, 'matched').hz;
    const w = 0.01;
    const ratio =
      cabs(evalTF(integ, cx(Math.cos(w * 0.1), Math.sin(w * 0.1)))) / cabs(evalTF(readTF('1/(s(s+1))'), cx(0, w)));
    expect(ratio).toBeCloseTo(1, 4);
  });

  it('rejects improper plants and bad periods', () => {
    expect(code(() => discretize(readTF('s^2/(s+1)'), 0.1, 'zoh'))).toBe('improper');
    expect(code(() => discretize(readTF('1/(s+1)'), 0, 'zoh'))).toBe('periodPositive');
    expect(code(() => discretize(readTF('1/(s+1)'), -1, 'tustin'))).toBe('periodPositive');
  });
});

describe('discrete analysis', () => {
  it('Jury agrees with the pole magnitudes', () => {
    const polys = [
      [0.24, -0.08, -1.3, 1],
      [-0.5, 0.2, 0.1, 1],
      [1, -2.5, 1],
      [0.9, 0, 0, 0, 1],
      [0.05, -0.3, 0.6, -1.1, 1],
      [-2, 0.5, 1],
    ];
    for (const p of polys) {
      const r = analyzeDiscrete(makeTF([1], p));
      expect(r.jury.stable).toBe(r.stable);
    }
    expect(code(() => jury([3]))).toBe('juryOrder');
  });

  it('long division equals the impulse response and the partial fractions', () => {
    const h = makeTF([0, 1], [0.08, -0.6, 1]); // z/((z − 0.2)(z − 0.4))
    const r = analyzeDiscrete(h, 12);
    const ld = longDivision(h, 12);
    ld.forEach((x, k) => expect(x).toBeCloseTo(r.impulse[k], 14));
    // z/((z − 0.2)(z − 0.4)) ⇒ h[k] = (0.4^k − 0.2^k)/0.2
    ld.forEach((x, k) => expect(x).toBeCloseTo((0.4 ** k - 0.2 ** k) / 0.2, 14));
    for (let k = 1; k < 12; k += 1) {
      const sum = (r.partialFractions ?? []).reduce((s, { r: res, p }) => s + res.re * p.re ** (k - 1), 0);
      expect(sum).toBeCloseTo(ld[k], 12);
    }
  });

  it('finds the gain range of a sampled loop', () => {
    const { hz } = discretize(readTF('1/(s+1)'), 0.1, 'zoh');
    const r = zLocus(hz);
    expect(r.ranges).toHaveLength(1);
    expect(r.ranges[0][0]).toBe(0);
    expect(r.ranges[0][1]).toBeCloseTo((1 + Math.exp(-0.1)) / (1 - Math.exp(-0.1)), 6);
  });

  it('aliasing: 60 Hz sampled at 50 Hz appears at 10 Hz', () => {
    const r = alias(60, 50);
    expect(r.apparent).toBeCloseTo(10, 12);
    expect(r.aliased).toBe(true);
    expect(alias(20, 50).aliased).toBe(false);
    expect(code(() => alias(10, 0))).toBe('frequencyPositive');
  });

  it('digital PID equals the sum of its parts', () => {
    const [kp, ki, kd, T] = [2, 0.5, 0.1, 0.05];
    const r = digitalPid(kp, ki, kd, T, 'backward');
    const z = cx(0.7, 0.4);
    const parts = (zz: typeof z) => {
      const i = evalTF(makeTF([0, ki * T], [-1, 1]), zz);
      const d = evalTF(makeTF([-kd / T, kd / T], [0, 1]), zz);
      return { re: kp + i.re + d.re, im: i.im + d.im };
    };
    const got = evalTF(r.cz, z);
    expect(got.re).toBeCloseTo(parts(z).re, 12);
    expect(got.im).toBeCloseTo(parts(z).im, 12);
    const tr = digitalPid(kp, ki, 0, T, 'trapezoid');
    const exp2 = evalTF(makeTF([-kp + (ki * T) / 2, kp + (ki * T) / 2], [-1, 1]), z);
    expect(evalTF(tr.cz, z).re).toBeCloseTo(exp2.re, 12);
  });
});
