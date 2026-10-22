// Least-squares fits of a table's x and y columns (Regression tool). Pure: numbers in, numbers out.
import { solveLinear } from './linalg';

export type FitKind = 'polynomial' | 'exponential';

export interface Fit {
  kind: FitKind;
  /** Polynomial: c0 + c1 x + c2 x^2 and so on. Exponential: a times e to the (b x), so [a, b]. */
  coefficients: number[];
  /** The degree of a polynomial fit; 0 for exponential. */
  degree: number;
  /** The share of the variation in y the fit explains, against the data as given. */
  r2: number;
  n: number;
  predict(x: number): number;
}

export const MAX_DEGREE = 6;

function r2Of(ys: readonly number[], predicted: readonly number[]): number {
  const mean = ys.reduce((total, y) => total + y, 0) / ys.length;
  const total = ys.reduce((sum, y) => sum + (y - mean) ** 2, 0);
  const rest = ys.reduce((sum, y, i) => sum + (y - predicted[i]) ** 2, 0);
  if (total === 0) return rest < 1e-12 ? 1 : NaN;
  return 1 - rest / total;
}

/** Fits a polynomial of the degree by the normal equations, on x shifted to its mean and scaled for stability. */
export function polynomialFit(xs: readonly number[], ys: readonly number[], degree: number): Fit | null {
  const n = xs.length;
  if (n !== ys.length || degree < 1 || degree > MAX_DEGREE || n < degree + 1) return null;
  const shift = xs.reduce((total, x) => total + x, 0) / n;
  const scale = Math.max(...xs.map((x) => Math.abs(x - shift))) || 1;
  const size = degree + 1;
  const normal: number[][] = Array.from({ length: size }, () => new Array<number>(size + 1).fill(0));
  for (let i = 0; i < n; i++) {
    const u = (xs[i] - shift) / scale;
    const powers = Array.from({ length: 2 * degree + 1 }, (_, p) => u ** p);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) normal[r][c] += powers[r + c];
      normal[r][size] += powers[r] * ys[i];
    }
  }
  const scaled = solveLinear(normal);
  if (!scaled) return null;
  // Expand the sum of a_k ((x - shift) / scale)^k into plain powers of x.
  const coefficients = new Array<number>(size).fill(0);
  for (let k = 0; k < size; k++) {
    let binomial = 1;
    for (let j = 0; j <= k; j++) {
      coefficients[j] += (scaled[k] / scale ** k) * binomial * (-shift) ** (k - j);
      binomial = (binomial * (k - j)) / (j + 1);
    }
  }
  const predict = (x: number) => coefficients.reduceRight((total, c) => total * x + c, 0);
  return { kind: 'polynomial', coefficients, degree, r2: r2Of(ys, xs.map(predict)), n, predict };
}

/** Fits the exponential y = a times e to the (b x) by a straight line through ln y. Every y must be above zero. */
export function exponentialFit(xs: readonly number[], ys: readonly number[]): Fit | null {
  if (xs.length !== ys.length || xs.length < 2 || ys.some((y) => !(y > 0))) return null;
  const line = polynomialFit(xs, ys.map(Math.log), 1);
  if (!line) return null;
  const [a, b] = [Math.exp(line.coefficients[0]), line.coefficients[1]];
  const predict = (x: number) => a * Math.exp(b * x);
  return { kind: 'exponential', coefficients: [a, b], degree: 0, r2: r2Of(ys, xs.map(predict)), n: xs.length, predict };
}

const SUPERSCRIPTS = ['', '', '²', '³', '⁴', '⁵', '⁶'];

/** The fitted equation as text, with each coefficient written by `format`. */
export function equationOf(fit: Fit, format: (value: number) => string): string {
  if (fit.kind === 'exponential') {
    const [a, b] = fit.coefficients;
    return `y = ${format(a)}e^(${format(b)}x)`;
  }
  const terms: string[] = [];
  for (let power = fit.degree; power >= 0; power--) {
    const c = fit.coefficients[power];
    if (c === 0 && fit.degree > 0) continue;
    const size = format(Math.abs(c));
    const body = power === 0 ? size : `${size === '1' ? '' : size}x${power === 1 ? '' : SUPERSCRIPTS[power]}`;
    terms.push(terms.length === 0 ? `${c < 0 ? '−' : ''}${body}` : `${c < 0 ? '−' : '+'} ${body}`);
  }
  return `y = ${terms.join(' ') || '0'}`;
}
