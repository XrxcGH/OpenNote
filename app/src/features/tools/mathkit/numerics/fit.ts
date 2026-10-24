// Fitting data: least-squares polynomials, nonlinear least squares for a model with named parameters
// (Levenberg-Marquardt), and the discrete Fourier transform by the radix-2 fast algorithm with zero padding.
import { solveDense, type Mat } from '../dense';
import { compile, namesIn, read } from '../expr';
import { fmt } from '../numeric';
import { KitError, step, type KitStep } from '../types';
import { line, numbers, polyLatex, type NumLine, type NumOut } from './common';
import { readPoints } from './interp';

/** Least-squares coefficients (ascending) by modified Gram-Schmidt QR on the Vandermonde matrix, which is stable. */
export function polyfit(x: readonly number[], y: readonly number[], degree: number): number[] {
  const m = x.length;
  const n = degree + 1;
  if (m < n) throw new KitError('needPoints', String(n));
  // Center and scale x for conditioning, fit, then expand back.
  const mean = x.reduce((s, v) => s + v, 0) / m;
  const half = (Math.max(...x) - Math.min(...x)) / 2 || 1;
  const u = x.map((v) => (v - mean) / half);
  const Q: number[][] = [];
  const R: Mat = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let j = 0; j < n; j++) {
    const v = u.map((t) => t ** j);
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < j; k++) {
        const dot = v.reduce((s, a, i) => s + a * Q[k][i], 0);
        R[k][j] += dot;
        for (let i = 0; i < m; i++) v[i] -= dot * Q[k][i];
      }
    }
    const norm = Math.sqrt(v.reduce((s, a) => s + a * a, 0));
    if (norm < 1e-12) throw new KitError('singular');
    R[j][j] = norm;
    Q.push(v.map((a) => a / norm));
  }
  const qty = Q.map((col) => col.reduce((s, a, i) => s + a * y[i], 0));
  const c = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = qty[i];
    for (let k = i + 1; k < n; k++) s -= R[i][k] * c[k];
    c[i] = s / R[i][i];
  }
  // p(u) with u = (x - mean) / half: expand each u^j.
  const out = new Array<number>(n).fill(0);
  let powers: number[] = [1];
  for (let j = 0; j < n; j++) {
    powers.forEach((a, i) => (out[i] += (c[j] * a) / half ** j));
    // powers *= (x - mean)
    const next = new Array<number>(powers.length + 1).fill(0);
    powers.forEach((a, i) => {
      next[i + 1] += a;
      next[i] -= a * mean;
    });
    powers = next;
  }
  return out;
}

const rSquared = (y: readonly number[], fit: readonly number[]): number => {
  const mean = y.reduce((s, v) => s + v, 0) / y.length;
  const total = y.reduce((s, v) => s + (v - mean) ** 2, 0);
  const resid = y.reduce((s, v, i) => s + (v - fit[i]) ** 2, 0);
  return total === 0 ? (resid === 0 ? 1 : 0) : 1 - resid / total;
};

export interface FitResult extends NumOut {
  parameters: number[];
  r2: number;
  evaluate: (x: number) => number;
}

/** The answer every fit gives: the headline, the quality, the data against the fit, the plot, and the steps. */
function fitOutput(
  p: { x: number[]; y: number[] },
  evaluate: (x: number) => number,
  parameters: number[],
  headline: NumLine,
  steps: KitStep[],
  latex: string,
): FitResult {
  const fitted = p.x.map(evaluate);
  const r2 = rSquared(p.y, fitted);
  const rms = Math.sqrt(p.y.reduce((s, v, i) => s + (v - fitted[i]) ** 2, 0) / p.y.length);
  const lo = p.x[0];
  const hi = p.x[p.x.length - 1];
  const curve = Array.from({ length: 121 }, (_, k): [number, number] => {
    const x = lo + ((hi - lo) * k) / 120;
    return [x, evaluate(x)];
  });
  return {
    lines: [headline, line('fitQuality', { r2: fmt(r2, 8), rms: fmt(rms, 5) })],
    tables: [
      {
        title: 'fitPoints',
        columns: ['xi', 'yi', 'fit', 'residual'],
        rows: p.x.map((x, i) => [fmt(x), fmt(p.y[i]), fmt(fitted[i], 8), fmt(p.y[i] - fitted[i], 4)]),
      },
    ],
    plots: [
      {
        label: 'fit',
        series: [{ points: curve }, { points: p.x.map((x, i): [number, number] => [x, p.y[i]]), dots: true, tone: 1 }],
      },
    ],
    fields: [],
    steps,
    latex,
    parameters,
    r2,
    evaluate,
  };
}

export function polynomialFit(source: string, degree: number): FitResult {
  const p = readPoints(source);
  if (!Number.isInteger(degree) || degree < 0 || degree > 10) throw new KitError('badWhole', 'degree: 0 to 10');
  const c = polyfit(p.x, p.y, degree);
  const evaluate = (x: number) => c.reduceRight((s, a) => s * x + a, 0);
  const latex = `y=${polyLatex(c)}`;
  const steps = [
    step('numMethod', 'S(c)=\\sum_i\\bigl(y_i-p(x_i)\\bigr)^2\\ \\text{is smallest}', {
      $method: 'kitMath.numerics.method.leastSquares',
    }),
    step('numValue', latex),
  ];
  return fitOutput(p, evaluate, c, line('fitModel', { model: latex.replace('y=', '') }), steps, latex);
}

/** Levenberg-Marquardt: damped Gauss-Newton steps that are kept only when they lower the sum of squares. */
function levenbergMarquardt(
  model: (theta: readonly number[], x: number) => number,
  p: { x: number[]; y: number[] },
  start: number[],
): number[] {
  const residuals = (theta: readonly number[]) => p.x.map((x, i) => p.y[i] - model(theta, x));
  const cost = (theta: readonly number[]) => residuals(theta).reduce((s, r) => s + r * r, 0);
  let theta = start.slice();
  if (!Number.isFinite(cost(theta))) throw new KitError('undefinedValue', 'model');
  let lambda = 1e-3;
  let current = cost(theta);
  for (let iteration = 1; iteration <= 200; iteration++) {
    const r = residuals(theta);
    // Jacobian of the model with respect to the parameters, by central differences.
    const J: Mat = p.x.map((x) =>
      theta.map((t, k) => {
        const h = 1e-6 * Math.max(1, Math.abs(t));
        const up = theta.slice();
        const down = theta.slice();
        up[k] += h;
        down[k] -= h;
        return (model(up, x) - model(down, x)) / (2 * h);
      }),
    );
    const JTJ = theta.map((_, a) => theta.map((_, b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
    const JTr = theta.map((_, a) => J.reduce((s, row, i) => s + row[a] * r[i], 0));
    let improved = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const A = JTJ.map((row, a) => row.map((v, b) => (a === b ? v + lambda * (v || 1) : v)));
      const delta = solveDense(A, JTr);
      if (delta) {
        const trial = theta.map((t, k) => t + delta[k]);
        const c = cost(trial);
        if (Number.isFinite(c) && c < current) {
          const gain = current - c;
          theta = trial;
          current = c;
          lambda = Math.max(lambda / 5, 1e-12);
          improved = true;
          if (gain < 1e-16 * Math.max(current, 1e-300) || gain < 1e-30) iteration = 1000;
          break;
        }
      }
      lambda *= 5;
    }
    if (!improved) break;
  }
  return theta;
}

/** Fits y = model(x; parameters) by Levenberg-Marquardt from a starting guess. */
export function nonlinearFit(options: { source: string; model: string; names: string; start: string }): FitResult {
  const p = readPoints(options.source);
  const names = options.names
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const start = numbers(options.start, 'start');
  if (names.length === 0 || names.length !== start.length)
    throw new KitError('badSystem', `${start.length}/${names.length}`);
  if (names.includes('x')) throw new KitError('badModel', 'x');
  if (p.x.length < names.length) throw new KitError('needPoints', String(names.length));
  const tree = read(options.model);
  const bad = [...namesIn(tree)].find((name) => name !== 'x' && !names.includes(name));
  if (bad) throw new KitError('unknown-name', bad);
  const fn = compile(tree, ['x', ...names]);
  const model = (theta: readonly number[], x: number) => fn([x, ...theta]);
  const theta = levenbergMarquardt(model, p, start);
  const values = names.map((n, i) => `${n} = ${fmt(theta[i], 8)}`).join(', ');
  const steps = [
    step('numMethod', '(J^{T}J+\\lambda I)\\,\\delta=J^{T}r,\\quad \\theta\\leftarrow\\theta+\\delta', {
      $method: 'kitMath.numerics.method.levenbergMarquardt',
    }),
    step('numValue', names.map((n, i) => `${n}=${fmt(theta[i], 8)}`).join(',\\ ')),
  ];
  const latex = names.map((n, i) => `${n}=${fmt(theta[i], 8)}`).join(',\\ ');
  return fitOutput(p, (x) => model(theta, x), theta, line('fitParameters', { values }), steps, latex);
}

/** The discrete Fourier transform of real or complex samples by the radix-2 algorithm (the length must be 2^k). */
export function fft(re: readonly number[], im: readonly number[]): { re: number[]; im: number[] } {
  const n = re.length;
  if (n & (n - 1)) throw new KitError('badWhole', 'n: power of 2');
  const r = re.slice();
  const i2 = im.slice();
  // Bit-reversal order.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [r[i], r[j]] = [r[j], r[i]];
      [i2[i], i2[j]] = [i2[j], i2[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    for (let start = 0; start < n; start += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(angle * k);
        const wi = Math.sin(angle * k);
        const a = start + k;
        const b = a + len / 2;
        const tr = r[b] * wr - i2[b] * wi;
        const ti = r[b] * wi + i2[b] * wr;
        r[b] = r[a] - tr;
        i2[b] = i2[a] - ti;
        r[a] += tr;
        i2[a] += ti;
      }
    }
  }
  return { re: r, im: i2 };
}

export interface SpectrumResult extends NumOut {
  size: number;
  magnitude: number[];
  frequencies: number[];
  peak: { frequency: number; amplitude: number };
}

/** The amplitude spectrum of samples taken at a sampling rate (zero-padded to a power of two). */
export function spectrum(samples: string, rate: number): SpectrumResult {
  const x = numbers(samples, 'samples');
  if (x.length < 2 || x.length > 65536) throw new KitError('badWhole', 'samples: 2 to 65536');
  if (!(rate > 0)) throw new KitError('badRate');
  let size = 1;
  while (size < x.length) size <<= 1;
  const padded = [...x, ...new Array<number>(size - x.length).fill(0)];
  const { re, im } = fft(padded, new Array<number>(size).fill(0));
  const half = size / 2;
  const magnitude = Array.from({ length: half + 1 }, (_, k) => {
    const m = Math.hypot(re[k], im[k]) / x.length;
    return k === 0 || k === half ? m : 2 * m;
  });
  const frequencies = Array.from({ length: half + 1 }, (_, k) => (k * rate) / size);
  let peakAt = 1;
  for (let k = 1; k <= half; k++) if (magnitude[k] > magnitude[peakAt]) peakAt = k;
  const rows = Array.from({ length: Math.min(half + 1, 40) }, (_, k) => [
    String(k),
    fmt(frequencies[k], 8),
    fmt(magnitude[k], 8),
    fmt((Math.atan2(im[k], re[k]) * 180) / Math.PI, 5),
  ]);
  const steps: KitStep[] = [
    step('numMethod', 'X_k=\\sum_{n=0}^{N-1}x_n e^{-2\\pi i k n/N}', { $method: 'kitMath.numerics.method.fft' }),
    step(
      'fftPad',
      `N=${size}\\ (${x.length}\\ \\text{samples}),\\quad \\Delta f=\\frac{f_s}{N}=${fmt(rate / size, 8)}`,
    ),
  ];
  return {
    lines: [
      line('fftPeak', { f: fmt(frequencies[peakAt], 8), a: fmt(magnitude[peakAt], 8) }),
      line('fftSize', { n: String(size), samples: String(x.length), df: fmt(rate / size, 8) }),
    ],
    tables: [{ title: 'spectrum', columns: ['k', 'frequency', 'amplitude', 'phase'], rows }],
    plots: [
      {
        label: 'spectrum',
        series: [{ points: frequencies.map((f, k): [number, number] => [f, magnitude[k]]) }],
      },
    ],
    fields: [],
    steps,
    size,
    magnitude,
    frequencies,
    peak: { frequency: frequencies[peakAt], amplitude: magnitude[peakAt] },
  };
}
