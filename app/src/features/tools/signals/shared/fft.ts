// The discrete Fourier transform of any length: radix-2 for powers of two, Bluestein's chirp-z method otherwise,
// and the 2D transform the image tools use. Also the analysis windows with their corrections.
import { SignalError } from './errors';

export interface Spectrum {
  readonly re: Float64Array;
  readonly im: Float64Array;
}

const isPowerOfTwo = (n: number) => n > 0 && (n & (n - 1)) === 0;

/** The radix-2 transform in place; `inverse` uses e^(+i...) and leaves the 1/N to the caller. */
function radix2(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / size;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < size / 2; k += 1) {
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

/** Bluestein: a length-N transform as a convolution of chirps, done with power-of-two transforms. */
function bluestein(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  let m = 1;
  while (m < 2 * n - 1) m <<= 1;
  const sign = inverse ? 1 : -1;
  const cr = new Float64Array(n);
  const ci = new Float64Array(n);
  for (let k = 0; k < n; k += 1) {
    const angle = (sign * Math.PI * ((k * k) % (2 * n))) / n;
    cr[k] = Math.cos(angle);
    ci[k] = Math.sin(angle);
  }
  const ar = new Float64Array(m);
  const ai = new Float64Array(m);
  for (let k = 0; k < n; k += 1) {
    ar[k] = re[k]! * cr[k]! - im[k]! * ci[k]!;
    ai[k] = re[k]! * ci[k]! + im[k]! * cr[k]!;
  }
  const br = new Float64Array(m);
  const bi = new Float64Array(m);
  br[0] = cr[0]!;
  bi[0] = -ci[0]!;
  for (let k = 1; k < n; k += 1) {
    br[k] = br[m - k] = cr[k]!;
    bi[k] = bi[m - k] = -ci[k]!;
  }
  radix2(ar, ai, false);
  radix2(br, bi, false);
  for (let k = 0; k < m; k += 1) {
    const r = ar[k]! * br[k]! - ai[k]! * bi[k]!;
    ai[k] = ar[k]! * bi[k]! + ai[k]! * br[k]!;
    ar[k] = r;
  }
  radix2(ar, ai, true);
  for (let k = 0; k < n; k += 1) {
    const r = ar[k]! / m;
    const i = ai[k]! / m;
    re[k] = r * cr[k]! - i * ci[k]!;
    im[k] = r * ci[k]! + i * cr[k]!;
  }
}

/** The DFT X_k = sum x_n e^(-2 pi i k n / N) of real or complex samples, of any length. */
export function fft(real: ArrayLike<number>, imag?: ArrayLike<number>): Spectrum {
  const n = real.length;
  if (n === 0) throw new SignalError('empty');
  const re = Float64Array.from(real);
  const im = imag ? Float64Array.from(imag) : new Float64Array(n);
  if (isPowerOfTwo(n)) radix2(re, im, false);
  else bluestein(re, im, false);
  return { re, im };
}

/** The inverse DFT, with the 1/N, so ifft(fft(x)) is x. */
export function ifft(real: ArrayLike<number>, imag: ArrayLike<number>): Spectrum {
  const n = real.length;
  if (n === 0) throw new SignalError('empty');
  const re = Float64Array.from(real);
  const im = Float64Array.from(imag);
  if (isPowerOfTwo(n)) radix2(re, im, true);
  else bluestein(re, im, true);
  for (let k = 0; k < n; k += 1) {
    re[k] = re[k]! / n;
    im[k] = im[k]! / n;
  }
  return { re, im };
}

/** The 2D DFT of a width x height grid stored row by row (or its inverse, with the 1/(W H)). */
export function fft2(re: Float64Array, im: Float64Array, width: number, height: number, inverse = false): Spectrum {
  const outRe = Float64Array.from(re);
  const outIm = Float64Array.from(im);
  const pass = (getRe: Float64Array, getIm: Float64Array) => (inverse ? ifft(getRe, getIm) : fft(getRe, getIm));
  for (let y = 0; y < height; y += 1) {
    const row = pass(outRe.subarray(y * width, (y + 1) * width), outIm.subarray(y * width, (y + 1) * width));
    outRe.set(row.re, y * width);
    outIm.set(row.im, y * width);
  }
  const colRe = new Float64Array(height);
  const colIm = new Float64Array(height);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      colRe[y] = outRe[y * width + x]!;
      colIm[y] = outIm[y * width + x]!;
    }
    const col = pass(colRe, colIm);
    for (let y = 0; y < height; y += 1) {
      outRe[y * width + x] = col.re[y]!;
      outIm[y * width + x] = col.im[y]!;
    }
  }
  return { re: outRe, im: outIm };
}

export type WindowName = 'rectangular' | 'hann' | 'hamming' | 'blackman' | 'flattop' | 'kaiser';
export const WINDOWS: readonly WindowName[] = ['rectangular', 'hann', 'hamming', 'blackman', 'flattop', 'kaiser'];

/** The modified Bessel function of the first kind, order 0, by its power series. */
export function besselI0(x: number): number {
  let term = 1;
  let total = 1;
  const quarter = (x * x) / 4;
  for (let k = 1; k < 500 && term > 1e-17 * total; k += 1) {
    term *= quarter / (k * k);
    total += term;
  }
  return total;
}

const COSINE_SUMS: Record<Exclude<WindowName, 'kaiser' | 'rectangular'>, readonly number[]> = {
  hann: [0.5, 0.5],
  hamming: [0.54, 0.46],
  blackman: [0.42, 0.5, 0.08],
  flattop: [0.21557895, 0.41663158, 0.277263158, 0.083578947, 0.006947368],
};

/**
 * An analysis window of n points. Periodic windows (the default, for spectra) repeat with period n; symmetric
 * ones (for filter design) are even about their middle. Kaiser takes its beta.
 */
export function makeWindow(name: WindowName, n: number, symmetric = false, beta = 8.6): Float64Array {
  if (!Number.isInteger(n) || n < 1) throw new SignalError('windowLength');
  const w = new Float64Array(n);
  const span = symmetric ? n - 1 : n;
  if (n === 1 || name === 'rectangular') return w.fill(1);
  if (name === 'kaiser') {
    const scale = besselI0(beta);
    for (let i = 0; i < n; i += 1) {
      const r = (2 * i) / span - 1;
      w[i] = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / scale;
    }
    return w;
  }
  const a = COSINE_SUMS[name];
  for (let i = 0; i < n; i += 1) {
    let value = 0;
    a.forEach((coefficient, k) => {
      value += (k % 2 ? -1 : 1) * coefficient * Math.cos((2 * Math.PI * k * i) / span);
    });
    w[i] = value;
  }
  return w;
}

/** The coherent gain (mean of the window) and the equivalent noise bandwidth in bins, N sum w^2 / (sum w)^2. */
export function windowFigures(w: ArrayLike<number>): { coherentGain: number; enbw: number; sumSquares: number } {
  let total = 0;
  let squares = 0;
  for (let i = 0; i < w.length; i += 1) {
    total += w[i]!;
    squares += w[i]! * w[i]!;
  }
  return { coherentGain: total / w.length, enbw: (w.length * squares) / (total * total), sumSquares: squares };
}
