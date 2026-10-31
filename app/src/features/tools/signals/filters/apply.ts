// Running and inspecting a filter: its frequency response (magnitude, unwrapped phase, group delay), impulse and step
// responses, poles and zeros, causal filtering, zero-phase forward-backward filtering, and a median filter.
import { SignalError } from '../shared/errors';
import { cabs, carg, polyRoots, type Complex } from '../shared/num';
import { groupDelay, response } from './design';

export interface FrequencyResponse {
  /** Frequencies in hertz from 0 to fs/2. */
  f: number[];
  magnitude: number[];
  db: number[];
  /** Unwrapped phase in degrees. */
  phase: number[];
  /** Group delay in samples. */
  delay: number[];
}

export function frequencyResponse(
  b: readonly number[],
  a: readonly number[],
  fs: number,
  points = 512,
): FrequencyResponse {
  const f: number[] = [];
  const magnitude: number[] = [];
  const db: number[] = [];
  const phase: number[] = [];
  const delay: number[] = [];
  let previous = 0;
  let offset = 0;
  for (let i = 0; i < points; i += 1) {
    const omega = (Math.PI * i) / (points - 1);
    const h = response(b, a, omega);
    const m = cabs(h);
    let angle = carg(h);
    // Unwrap: keep each step within ±π of the last.
    if (i > 0) {
      while (angle + offset - previous > Math.PI) offset -= 2 * Math.PI;
      while (angle + offset - previous < -Math.PI) offset += 2 * Math.PI;
    }
    angle += offset;
    previous = angle;
    f.push((omega * fs) / (2 * Math.PI));
    magnitude.push(m);
    db.push(20 * Math.log10(Math.max(m, 1e-12)));
    phase.push((angle * 180) / Math.PI);
    const d = groupDelay(b, a, omega);
    delay.push(Number.isFinite(d) && m > 1e-9 ? d : Number.NaN);
  }
  return { f, magnitude, db, phase, delay };
}

/** Direct form II transposed: y[n] = (Σ b_k x[n−k] − Σ_{k≥1} a_k y[n−k]) / a_0. */
export function lfilter(
  b: readonly number[],
  a: readonly number[],
  x: readonly number[],
  initial?: number[],
): number[] {
  if (!a.length || a[0] === 0) throw new SignalError('leadingZero');
  const a0 = a[0]!;
  const n = Math.max(b.length, a.length);
  const bn = Array.from({ length: n }, (_, i) => (b[i] ?? 0) / a0);
  const an = Array.from({ length: n }, (_, i) => (a[i] ?? 0) / a0);
  const state = initial ? [...initial] : Array<number>(n - 1).fill(0);
  const y: number[] = [];
  for (const value of x) {
    const out = bn[0]! * value + (state[0] ?? 0);
    for (let k = 0; k < n - 2; k += 1) state[k] = bn[k + 1]! * value + state[k + 1]! - an[k + 1]! * out;
    if (n > 1) state[n - 2] = bn[n - 1]! * value - an[n - 1]! * out;
    y.push(out);
  }
  return y;
}

/** The filter's state at rest for a step input of 1, so filtering starts without a transient (lfilter_zi). */
function steadyState(b: readonly number[], a: readonly number[]): number[] {
  const n = Math.max(b.length, a.length);
  if (n < 2) return [];
  const a0 = a[0]!;
  const bn = Array.from({ length: n }, (_, i) => (b[i] ?? 0) / a0);
  const an = Array.from({ length: n }, (_, i) => (a[i] ?? 0) / a0);
  const sumA = an.reduce((s, v) => s + v, 0);
  if (Math.abs(sumA) < 1e-14) return Array<number>(n - 1).fill(0);
  const dc = bn.reduce((s, v) => s + v, 0) / sumA;
  // For a constant input of 1 the output is dc; the transposed states follow backward from the last.
  const state = Array<number>(n - 1).fill(0);
  state[n - 2] = bn[n - 1]! - an[n - 1]! * dc;
  for (let k = n - 3; k >= 0; k -= 1) state[k] = bn[k + 1]! - an[k + 1]! * dc + state[k + 1]!;
  return state;
}

/**
 * Zero-phase filtering: forward, then backward, so the phase cancels and the magnitude is squared. The ends are
 * extended by odd reflection (3 × the filter length) and the filter starts from rest at each end.
 */
export function filtfilt(b: readonly number[], a: readonly number[], x: readonly number[]): number[] {
  const pad = 3 * Math.max(b.length, a.length);
  if (x.length <= pad) throw new SignalError('tooFewSamples', { count: pad + 1 });
  const first = x[0]!;
  const last = x[x.length - 1]!;
  const extended = [
    ...Array.from({ length: pad }, (_, i) => 2 * first - x[pad - i]!),
    ...x,
    ...Array.from({ length: pad }, (_, i) => 2 * last - x[x.length - 2 - i]!),
  ];
  const zi = steadyState(b, a);
  const forward = lfilter(
    b,
    a,
    extended,
    zi.map((v) => v * extended[0]!),
  );
  const reversed = [...forward].reverse();
  const backward = lfilter(
    b,
    a,
    reversed,
    zi.map((v) => v * reversed[0]!),
  ).reverse();
  return backward.slice(pad, pad + x.length);
}

/** A running median of an odd window, with the ends using the samples there are. */
export function medianFilter(x: readonly number[], window: number): number[] {
  if (!Number.isInteger(window) || window < 1 || window % 2 === 0) throw new SignalError('medianWindow');
  const half = (window - 1) / 2;
  return x.map((_, i) => {
    const part = x.slice(Math.max(0, i - half), Math.min(x.length, i + half + 1)).sort((p, q) => p - q);
    const mid = Math.floor(part.length / 2);
    return part.length % 2 ? part[mid]! : (part[mid - 1]! + part[mid]!) / 2;
  });
}

/** Poles and zeros in the z-plane: the roots of A and B as polynomials in z. */
export function polesZeros(b: readonly number[], a: readonly number[]): { poles: Complex[]; zeros: Complex[] } {
  const n = Math.max(b.length, a.length);
  const padded = (c: readonly number[]) => [...c, ...Array<number>(n - c.length).fill(0)];
  return { zeros: polyRoots(padded(b)), poles: polyRoots(padded(a)) };
}

export function impulseAndStep(
  b: readonly number[],
  a: readonly number[],
  length = 64,
): { impulse: number[]; step: number[] } {
  const impulse = lfilter(
    b,
    a,
    Array.from({ length }, (_, n) => (n === 0 ? 1 : 0)),
  );
  let running = 0;
  return { impulse, step: impulse.map((v) => (running += v)) };
}
