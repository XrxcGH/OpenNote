// Random processes and the Kalman filter against closed forms worked by hand: the Ornstein-Uhlenbeck variance
// σ²/(2a), its transient σ²/(2a)(1 − e^(−2at)), Brownian variance σ²t, the second-order variance 1/(4ζω³), the scalar
// Riccati quadratic, and the plan's cases.
import { describe, expect, it } from 'vitest';
import { ControlError, readNumberMatrix } from '../lib/errors';
import { add, mul, normMax, transpose } from '../lib/linalg';
import { seeded } from '../lib/random';
import { readTF } from '../lib/tf';
import { makeKalman, makeSde, runKalman, simulatePaths, spectrum, stationary, steadyKalman, vanLoan } from './engine';

const m = (text: string) => readNumberMatrix(text);
const ou = (a: number, sigma: number) => makeSde([[-a]], [[sigma]], [[1]], [[1]]);

describe('validation cases', () => {
  it('dX = −2X dt + dW has stationary variance 0.25', () => {
    expect(stationary(ou(2, 1)).p[0][0]).toBeCloseTo(0.25, 12);
  });

  it('Monte Carlo agrees with 0.25 within sampling error', () => {
    const r = simulatePaths(ou(2, 1), [0], 5, 1000, 5000, 7);
    // The standard error of a variance from 5000 normal samples is 0.25·√(2/4999) ≈ 0.005.
    expect(Math.abs(r.endVariance - 0.25)).toBeLessThan(0.0125);
    expect(r.theoryEndVariance).toBeCloseTo(0.25 * (1 - Math.exp(-20)), 9);
  });

  it('a random walk with q = r = 1: prior P = 1.61803, K = 0.61803, posterior 0.61803', () => {
    const k = steadyKalman(makeKalman([[1]], [[1]], [[1]], [[1]]), [[1]]);
    const phi = (1 + Math.sqrt(5)) / 2;
    expect(k.prior[0][0]).toBeCloseTo(phi, 10);
    expect(k.gain[0][0]).toBeCloseTo(phi - 1, 10);
    expect(k.posterior[0][0]).toBeCloseTo(phi - 1, 10);
  });
});

describe('covariance against closed forms', () => {
  it('scalar OU: σ²/(2a) for several a and σ', () => {
    for (const [a, s] of [
      [0.5, 3],
      [10, 0.1],
      [1e3, 1],
    ]) {
      expect(stationary(ou(a, s)).p[0][0]).toBeCloseTo((s * s) / (2 * a), 10);
    }
  });

  it('Van Loan matches e^(−ah) and σ²/(2a)(1 − e^(−2ah))', () => {
    const { phi, qd } = vanLoan([[-3]], [[2]], 0.2);
    expect(phi[0][0]).toBeCloseTo(Math.exp(-0.6), 12);
    expect(qd[0][0]).toBeCloseTo((2 / 6) * (1 - Math.exp(-1.2)), 12);
  });

  it('Brownian motion has variance σ²t and no stationary state', () => {
    const bm = makeSde([[0]], [[2]], [[1]], [[1]]);
    expect(simulatePaths(bm, [0], 3, 100, 10, 1).theoryEndVariance).toBeCloseTo(12, 9);
    expect(() => stationary(bm)).toThrow(ControlError);
  });

  it('a two-state system satisfies the Lyapunov equation', () => {
    const s = makeSde(m('0 1; -4 -0.8'), m('0; 1'), m('1 0'), [[0.5]]);
    const p = stationary(s).p;
    const q = mul(mul(s.b, s.w), transpose(s.b));
    expect(normMax(add(add(mul(s.a, p), mul(p, transpose(s.a))), q))).toBeLessThan(1e-12);
    // x₁ variance of ẍ + 2ζωẋ + ω²x = noise: W/(4ζω³) with 2ζω = 0.8, ω = 2.
    expect(p[0][0]).toBeCloseTo(0.5 / (4 * 0.2 * 8), 10);
  });
});

describe('spectra', () => {
  it('1/(s + 2) with S₀ = 1: variance 0.25 both ways, R(τ) = e^(−2τ)/4', () => {
    const r = spectrum(readTF('1/(s + 2)'), 1);
    expect(r.variance).toBeCloseTo(0.25, 12);
    expect(r.integrated).toBeCloseTo(0.25, 8);
    r.tau.forEach((t, i) => expect(r.autocorrelation[i]).toBeCloseTo(Math.exp(-2 * t) / 4, 10));
    expect(r.psd[0]).toBeCloseTo(1 / (4 + r.w[0] ** 2), 12);
  });

  it('a second-order system has variance S₀/(4ζω³)', () => {
    const r = spectrum(readTF('1/(s^2 + 1.2s + 4)'), 3);
    expect(r.variance).toBeCloseTo(3 / (4 * 0.3 * 8), 10);
    expect(r.integrated).toBeCloseTo(r.variance, 7);
  });
});

describe('the Kalman filter', () => {
  it('matches the scalar Riccati quadratic P² + (r − a²r − q)P − qr = 0', () => {
    const [a, q, r] = [0.9, 0.5, 2];
    const k = steadyKalman(makeKalman([[a]], [[1]], [[q]], [[r]]), [[1]]);
    const bq = r - a * a * r - q;
    expect(k.prior[0][0]).toBeCloseTo((-bq + Math.sqrt(bq * bq + 4 * q * r)) / 2, 10);
  });

  it('a constant-velocity model reaches a fixed point of the Riccati recursion', () => {
    const md = makeKalman(m('1 0.1; 0 1'), m('1 0'), m('0.001 0; 0 0.01'), [[0.5]]);
    const k = steadyKalman(md, m('1 0; 0 1'));
    const next = add(mul(mul(md.f, k.posterior), transpose(md.f)), md.q);
    expect(normMax(add(next, k.prior, -1))).toBeLessThan(1e-10);
  });

  it('filters better than the raw measurements, and repeats with the same seed', () => {
    const md = makeKalman([[1]], [[1]], [[0.01]], [[1]]);
    const a = runKalman(md, [[1]], [0], 400, 3);
    expect(a.rmsEstimate).toBeLessThan(a.rmsMeasured / 2);
    expect(runKalman(md, [[1]], [0], 400, 3).estimate).toEqual(a.estimate);
  });
});

describe('the generator', () => {
  it('repeats for a seed and gives standard normals', () => {
    const a = seeded(42);
    const b = seeded(42);
    const xs = Array.from({ length: 100000 }, () => a.normal());
    expect(b.normal()).toBe(xs[0]);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const v = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1);
    expect(Math.abs(mean)).toBeLessThan(0.01);
    expect(Math.abs(v - 1)).toBeLessThan(0.02);
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
    ['notStationary', () => stationary(makeSde([[1]], [[1]], [[1]], [[1]]))],
    ['notSquare', () => makeSde([[1, 2]], [[1]], [[1]], [[1]])],
    ['wShape', () => makeSde([[-1]], [[1]], [[1]], m('1 0; 0 1'))],
    ['notCovariance', () => makeSde([[-1]], [[1]], [[1]], [[-1]])],
    ['psdProper', () => spectrum(readTF('(s + 1)/(s + 2)'), 1)],
    ['notStationary', () => spectrum(readTF('1/(s - 1)'), 1)],
    ['intensityPositive', () => spectrum(readTF('1/(s + 1)'), 0)],
    ['x0Length', () => simulatePaths(ou(1, 1), [0, 0], 1, 100, 10, 1)],
    ['pathsRange', () => simulatePaths(ou(1, 1), [0], 1, 100, 1e6, 1)],
    ['spanPositive', () => simulatePaths(ou(1, 1), [0], -1, 100, 10, 1)],
    ['rCovariance', () => makeKalman([[1]], [[1]], [[1]], [[0]])],
    ['qCovariance', () => makeKalman([[1]], [[1]], [[-1]], [[1]])],
    ['hCols', () => makeKalman([[1]], m('1 0'), [[1]], [[1]])],
    ['kalmanNoConverge', () => steadyKalman(makeKalman([[2]], [[0]], [[1]], [[1]]), [[1]])],
  ];
  it.each(cases)('names %s', (want, f) => expect(code(f)).toBe(want));
});
