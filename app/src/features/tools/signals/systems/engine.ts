// Discrete systems and sampling: convolution as a flip-shift-multiply-sum table, correlation with its lag,
// difference equations with their poles, sampling and aliasing with reconstruction, quantization noise, and
// rate changes. Continuous convolution of piecewise signals is done on a fine grid.
import { SignalError } from '../shared/errors';
import { cabs, fmt, gaussian, polyRoots, seededRandom, type Complex } from '../shared/num';
import { step, type Step } from '../shared/steps';

export interface ConvolutionRow {
  readonly n: number;
  /** The products x[k] h[n − k] that are not both outside the sequences. */
  readonly terms: readonly { k: number; x: number; h: number }[];
  readonly sum: number;
}

export interface Convolution {
  readonly y: number[];
  /** The index of y[0]: the sum of the two starting indices. */
  readonly start: number;
  readonly rows: ConvolutionRow[];
  readonly steps: Step[];
}

/** y[n] = Σ x[k] h[n − k], for sequences that start at the given indices. */
export function convolve(x: readonly number[], h: readonly number[], xStart = 0, hStart = 0): Convolution {
  if (!x.length || !h.length) throw new SignalError('empty');
  const length = x.length + h.length - 1;
  const rows: ConvolutionRow[] = [];
  for (let i = 0; i < length; i += 1) {
    const terms: { k: number; x: number; h: number }[] = [];
    for (let k = Math.max(0, i - h.length + 1); k <= Math.min(i, x.length - 1); k += 1) {
      terms.push({ k: k + xStart, x: x[k]!, h: h[i - k]! });
    }
    rows.push({ n: i + xStart + hStart, terms, sum: terms.reduce((total, term) => total + term.x * term.h, 0) });
  }
  const y = rows.map((row) => row.sum);
  return {
    y,
    start: xStart + hStart,
    rows,
    steps: [
      step('convolutionDefinition', 'y[n] = Σₖ x[k] h[n − k]'),
      step('convolutionLength', `Lx + Lh − 1 = ${x.length} + ${h.length} − 1 = ${length}`),
      step('convolutionFlip', rows.slice(0, 3).map(rowText).join('; ')),
      step('convolutionResult', `y = [${y.map((v) => fmt(v)).join(', ')}]`),
    ],
  };
}

export const rowText = (row: ConvolutionRow): string =>
  `y[${row.n}] = ${row.terms.map((term) => `${fmt(term.x)}·${fmt(term.h)}`).join(' + ') || '0'} = ${fmt(row.sum)}`;

/** Cross-correlation r[l] = Σ y[n] x[n − l]: how far y lags x. Lags run from −(Lx − 1) to Ly − 1. */
export function crossCorrelate(x: readonly number[], y: readonly number[]): {
  lags: number[];
  r: number[];
  peakLag: number;
  steps: Step[];
} {
  if (!x.length || !y.length) throw new SignalError('empty');
  const lags: number[] = [];
  const r: number[] = [];
  for (let lag = -(x.length - 1); lag <= y.length - 1; lag += 1) {
    let total = 0;
    for (let n = 0; n < y.length; n += 1) {
      const k = n - lag;
      if (k >= 0 && k < x.length) total += y[n]! * x[k]!;
    }
    lags.push(lag);
    r.push(total);
  }
  let best = 0;
  r.forEach((value, i) => {
    if (value > r[best]!) best = i;
  });
  return {
    lags,
    r,
    peakLag: lags[best]!,
    steps: [
      step('correlationDefinition', 'r[l] = Σₙ y[n] x[n − l]'),
      step('correlationPeak', `r is largest at l = ${lags[best]} (r = ${fmt(r[best]!)})`),
    ],
  };
}

export interface DifferenceResult {
  readonly y: number[];
  readonly poles: Complex[];
  readonly zeros: Complex[];
  readonly stable: boolean;
  readonly steps: Step[];
}

/**
 * Runs a[0] y[n] + a[1] y[n−1] + ... = b[0] x[n] + b[1] x[n−1] + ..., starting at rest, for the given input. The
 * poles are the roots of the polynomial a(z), so the system is stable when every pole is inside the unit circle.
 */
export function runDifference(b: readonly number[], a: readonly number[], x: readonly number[]): DifferenceResult {
  if (!b.length || !a.length) throw new SignalError('empty');
  if (a[0] === 0) throw new SignalError('leadingZero');
  const a0 = a[0]!;
  const y: number[] = [];
  for (let n = 0; n < x.length; n += 1) {
    let total = 0;
    b.forEach((bk, k) => {
      if (n - k >= 0) total += bk * x[n - k]!;
    });
    a.forEach((ak, k) => {
      if (k > 0 && n - k >= 0) total -= ak * y[n - k]!;
    });
    y.push(total / a0);
  }
  const order = Math.max(a.length, b.length);
  const pad = (c: readonly number[]) => [...c, ...Array<number>(order - c.length).fill(0)];
  const poles = polyRoots(pad(a));
  const zeros = polyRoots(pad(b));
  const stable = poles.every((p) => cabs(p) < 1 - 1e-12);
  return {
    y,
    poles,
    zeros,
    stable,
    steps: [
      step('differenceRecursion', `y[n] = (${b.map((v, k) => `${fmt(v)}·x[n−${k}]`).join(' + ')} − Σₖ₌₁ aₖ y[n−k]) / ${fmt(a0)}`),
      step('differenceFirst', y.slice(0, 4).map((v, n) => `y[${n}] = ${fmt(v)}`).join(', ')),
      step('differencePoles', poles.map((p) => `|p| = ${fmt(cabs(p))}`).join(', ') || '—'),
      step(stable ? 'differenceStable' : 'differenceUnstable'),
    ],
  };
}

export const impulse = (length: number): number[] => Array.from({ length }, (_, n) => (n === 0 ? 1 : 0));
export const unitStep = (length: number): number[] => Array<number>(length).fill(1);

/** The frequency a sampled tone appears at: |f − fs round(f / fs)|, folded into 0 to fs/2. */
export function aliased(f: number, fs: number): { apparent: number; nyquist: number; aliases: boolean; steps: Step[] } {
  if (!(fs > 0)) throw new SignalError('sampleRate');
  if (!(f >= 0) || !Number.isFinite(f)) throw new SignalError('frequency');
  const apparent = Math.abs(f - fs * Math.round(f / fs));
  const nyquist = fs / 2;
  return {
    apparent,
    nyquist,
    aliases: f > nyquist,
    steps: [
      step('samplingNyquist', `fs / 2 = ${fmt(nyquist)} Hz`),
      step('samplingFold', `f_a = |f − fs · round(f / fs)| = |${fmt(f)} − ${fmt(fs)} · ${Math.round(f / fs)}| = ${fmt(apparent)} Hz`),
    ],
  };
}

/** Samples of a cosine and two reconstructions on a fine grid: zero-order hold and sinc interpolation. */
export function sampleAndRebuild(f: number, fs: number, duration: number, fine = 20) {
  if (!(fs > 0)) throw new SignalError('sampleRate');
  if (!(duration > 0) || duration * fs > 4000) throw new SignalError('duration');
  const count = Math.floor(duration * fs) + 1;
  const times = Array.from({ length: count }, (_, n) => n / fs);
  const samples = times.map((time) => Math.cos(2 * Math.PI * f * time));
  const gridCount = (count - 1) * fine + 1;
  const grid = Array.from({ length: gridCount }, (_, i) => (i / fine) / fs);
  const original = grid.map((time) => Math.cos(2 * Math.PI * f * time));
  const hold = grid.map((_, i) => samples[Math.floor(i / fine)]!);
  const sinc = grid.map((time) => {
    let total = 0;
    samples.forEach((value, n) => {
      const u = time * fs - n;
      total += value * (u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u));
    });
    return total;
  });
  return { times, samples, grid, original, hold, sinc };
}

export interface Quantized {
  readonly stepSize: number;
  readonly levels: number;
  readonly theory: number;
  readonly measured: number;
  readonly input: number[];
  readonly output: number[];
  readonly steps: Step[];
}

/** SQNR of a full-scale sine with N bits: 6.02 N + 1.76 dB. */
export const sqnrTheory = (bits: number): number => 6.02 * bits + 1.76;

/** A full-scale sine through an N-bit quantizer (mid-rise, clipped to the range), with optional uniform dither. */
export function quantize(bits: number, fullScale: number, cycles = 3, count = 4096, dither = false, seed = 1): Quantized {
  if (!Number.isInteger(bits) || bits < 1 || bits > 24) throw new SignalError('bits');
  if (!(fullScale > 0)) throw new SignalError('fullScale');
  const levels = 2 ** bits;
  const delta = (2 * fullScale) / levels;
  const noise = gaussian(seededRandom(seed));
  const input = Array.from({ length: count }, (_, n) => fullScale * Math.sin((2 * Math.PI * cycles * n) / count + 0.1));
  const output = input.map((v) => {
    const d = dither ? (noise() * delta) / 2 : 0;
    const level = Math.min(levels - 1, Math.max(0, Math.floor((v + d + fullScale) / delta)));
    return -fullScale + (level + 0.5) * delta;
  });
  let signal = 0;
  let error = 0;
  input.forEach((v, n) => {
    signal += v * v;
    error += (output[n]! - v) ** 2;
  });
  const measured = 10 * Math.log10(signal / error);
  const theory = sqnrTheory(bits);
  return {
    stepSize: delta,
    levels,
    theory,
    measured,
    input,
    output,
    steps: [
      step('quantStep', `Δ = 2 · FS / 2^N = 2 · ${fmt(fullScale)} / ${levels} = ${fmt(delta)}`),
      step('quantNoise', `σ² = Δ² / 12 = ${fmt((delta * delta) / 12)}`),
      step('quantSqnr', `SQNR = 6.02 · ${bits} + 1.76 = ${fmt(theory)} dB`),
      step('quantMeasured', `10 log₁₀(Σx² / Σe²) = ${fmt(measured)} dB`),
    ],
  };
}

/** Upsampling by L (L − 1 zeros between samples) and then downsampling by M (keeping every M-th). */
export function changeRate(x: readonly number[], up: number, down: number): { y: number[]; steps: Step[] } {
  if (!Number.isInteger(up) || !Number.isInteger(down) || up < 1 || down < 1 || up > 16 || down > 16) {
    throw new SignalError('rateFactor');
  }
  if (!x.length) throw new SignalError('empty');
  const upsampled: number[] = [];
  x.forEach((v) => {
    upsampled.push(v);
    for (let i = 1; i < up; i += 1) upsampled.push(0);
  });
  const y = upsampled.filter((_, i) => i % down === 0);
  return {
    y,
    steps: [
      step('rateUp', `L = ${up}: ${x.length} → ${upsampled.length} samples; images appear at multiples of fs`),
      step('rateDown', `M = ${down}: keep every ${down}th sample; content above fs/(2M) aliases`),
    ],
  };
}

export type PieceKind = 'rect' | 'triangle' | 'exponential' | 'step';
export interface Piece {
  readonly kind: PieceKind;
  /** Start time; for a triangle, its center. */
  readonly at: number;
  /** Width (rect, triangle), or the decay rate of e^(−rate t) (exponential). */
  readonly size: number;
  readonly height: number;
}

export function pieceAt(piece: Piece, time: number): number {
  const u = time - piece.at;
  if (piece.kind === 'rect') return u >= 0 && u < piece.size ? piece.height : 0;
  if (piece.kind === 'triangle') return Math.abs(u) < piece.size / 2 ? piece.height * (1 - Math.abs(u) / (piece.size / 2)) : 0;
  if (piece.kind === 'exponential') return u >= 0 ? piece.height * Math.exp(-piece.size * u) : 0;
  return u >= 0 ? piece.height : 0;
}

/** Where a piece is not zero, for the convolution's grid; exponentials and steps are cut at a long horizon. */
function support(piece: Piece, horizon: number): [number, number] {
  if (piece.kind === 'triangle') return [piece.at - piece.size / 2, piece.at + piece.size / 2];
  if (piece.kind === 'rect') return [piece.at, piece.at + piece.size];
  return [piece.at, piece.at + (piece.kind === 'exponential' ? Math.min(horizon, 12 / piece.size) : horizon)];
}

/** (f * g)(t) = ∫ f(τ) g(t − τ) dτ on a fine grid (the midpoint rule), over where both pieces are not zero. */
export function convolveContinuous(f: Piece, g: Piece, points = 400): { t: number[]; y: number[]; steps: Step[] } {
  for (const piece of [f, g]) {
    if (!(piece.size > 0) || !Number.isFinite(piece.at) || !Number.isFinite(piece.height)) throw new SignalError('pieceSize');
  }
  const [f0, f1] = support(f, 10);
  const [g0, g1] = support(g, 10);
  const dt = (f1 - f0) / 2000;
  const t: number[] = [];
  const y: number[] = [];
  for (let i = 0; i <= points; i += 1) {
    const time = f0 + g0 + ((f1 + g1 - f0 - g0) * i) / points;
    let total = 0;
    for (let tau = f0 + dt / 2; tau < f1; tau += dt) total += pieceAt(f, tau) * pieceAt(g, time - tau) * dt;
    t.push(time);
    y.push(total);
  }
  return {
    t,
    y,
    steps: [
      step('continuousDefinition', '(f ∗ g)(t) = ∫ f(τ) g(t − τ) dτ'),
      step('continuousSupport', `t from ${fmt(f0 + g0)} to ${fmt(f1 + g1)}`),
      step('continuousNumeric', `Δτ = ${fmt(dt)}`),
    ],
  };
}
