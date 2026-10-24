// Ideal op-amp circuits and filters. Pure functions: numbers in SI, numbers out. Both op-amp inputs are taken at the
// same voltage (the virtual short) and draw no current.
import { fail } from '../shared';

export const decibels = (ratio: number): number => 20 * Math.log10(Math.abs(ratio));

export interface Gain {
  /** The voltage gain, signed: negative inverts. */
  gain: number;
  /** The resistance the source sees, where the circuit fixes it; null when it does not. */
  inputResistance: number | null;
}

export const inverting = (rin: number, rf: number): Gain => ({ gain: -rf / rin, inputResistance: rin });
export const nonInverting = (rf: number, rg: number): Gain => ({ gain: 1 + rf / rg, inputResistance: null });

/** The inverting summer: each input adds with its own gain -Rf/Ri. */
export function summing(rf: number, rs: number[], vs: number[]): { vout: number; gains: number[] } {
  const gains = rs.map((r) => -rf / r);
  return { gains, vout: gains.reduce((sum, g, i) => sum + g * (vs[i] ?? 0), 0) };
}

/**
 * The 4-resistor difference amplifier. v1 goes through r1 to the inverting input (feedback r2); v2 goes through r3 to
 * the non-inverting input (r4 to ground). It is the sum of the inverting and the non-inverting gains.
 */
export function difference(r1: number, r2: number, r3: number, r4: number, v1: number, v2: number) {
  const gain1 = -r2 / r1;
  const gain2 = (r4 / (r3 + r4)) * (1 + r2 / r1);
  const matched = Math.abs(r2 / r1 - r4 / r3) <= 1e-9 * (r2 / r1);
  return { gain1, gain2, vout: gain1 * v1 + gain2 * v2, matched };
}

/** The 3-op-amp instrumentation amplifier: gain (1 + 2 Rf / Rg) from the input pair, times the output stage R3 / R2. */
export function instrumentation(rf: number, rg: number, r2: number, r3: number) {
  const first = 1 + (2 * rf) / rg;
  return { first, second: r3 / r2, gain: first * (r3 / r2) };
}

/** Inverting integrator at one frequency: gain = -1 / (j w R C); the unity-gain frequency is 1 / (2 pi R C). */
export function integrator(r: number, c: number, hz: number) {
  const unity = 1 / (2 * Math.PI * r * c);
  return { magnitude: unity / hz, unity, phase: 90 };
}

/** Inverting differentiator at one frequency: gain = -j w R C; the unity-gain frequency is 1 / (2 pi R C). */
export function differentiator(r: number, c: number, hz: number) {
  const unity = 1 / (2 * Math.PI * r * c);
  return { magnitude: hz / unity, unity, phase: -90 };
}

// ---- Second-order sections ----

export interface Section {
  /** The natural frequency in Hz. */
  f0: number;
  q: number;
  /** DC gain for a low-pass, gain at high frequency for a high-pass. */
  gain: number;
}

export type SectionKind = 'skLow' | 'skHigh' | 'mfbLow';

/**
 * Unity-gain Sallen-Key low-pass: r1 from the input, r2 to the amplifier, c1 from the middle node to the output
 * (the feedback capacitor), c2 from the amplifier input to ground.
 */
export function sallenKeyLow(r1: number, r2: number, c1: number, c2: number): Section {
  const root = Math.sqrt(r1 * r2 * c1 * c2);
  return { f0: 1 / (2 * Math.PI * root), q: root / (c2 * (r1 + r2)), gain: 1 };
}

/** Unity-gain Sallen-Key high-pass: c1 from the input, c2 to the amplifier, r1 from the middle node to the output, r2 to ground. */
export function sallenKeyHigh(r1: number, r2: number, c1: number, c2: number): Section {
  const root = Math.sqrt(r1 * r2 * c1 * c2);
  return { f0: 1 / (2 * Math.PI * root), q: root / (r2 * (c1 + c2)), gain: 1 };
}

/**
 * Multiple-feedback low-pass (inverting): r1 from the input to the node, r2 from the node to the inverting input, r3
 * from the node to the output, c1 from the node to ground, c2 from the inverting input to the output.
 */
export function multipleFeedbackLow(r1: number, r2: number, r3: number, c1: number, c2: number): Section {
  const root = Math.sqrt(r2 * r3 * c1 * c2);
  return {
    f0: 1 / (2 * Math.PI * root),
    q: root / (c2 * (r2 + r3 + (r2 * r3) / r1)),
    gain: -r3 / r1,
  };
}

/** The magnitude, in dB, of a low-pass or high-pass biquad at each frequency. */
export function biquadResponse(s: Section, high: boolean, freqs: number[]): number[] {
  return freqs.map((f) => {
    const x = f / s.f0;
    const num = high ? x * x : 1;
    return decibels((s.gain * num) / Math.hypot(1 - x * x, x / s.q));
  });
}

// ---- Filter order and poles ----

export type Family = 'butterworth' | 'chebyshev';

export interface OrderSpec {
  family: Family;
  /** Passband edge in Hz, where the loss first reaches `ap` dB. */
  fp: number;
  fs: number;
  ap: number;
  as: number;
}

function checkSpec(s: OrderSpec): void {
  if (!(s.ap > 0)) fail('positive', { field: 'passbandLoss' });
  if (!(s.as > s.ap)) fail('stopLoss');
  if (!(s.fs > s.fp)) fail('stopFrequency');
}

/** The order the specification needs, before rounding up. */
export function exactOrder(s: OrderSpec): number {
  checkSpec(s);
  const ratio = (10 ** (s.as / 10) - 1) / (10 ** (s.ap / 10) - 1);
  return s.family === 'butterworth'
    ? Math.log10(ratio) / (2 * Math.log10(s.fs / s.fp))
    : Math.acosh(Math.sqrt(ratio)) / Math.acosh(s.fs / s.fp);
}

export const order = (s: OrderSpec): number => Math.max(1, Math.ceil(exactOrder(s) - 1e-9));

export interface Design {
  n: number;
  /** Each pole pair (or lone real pole) as a natural frequency in Hz and a Q, lowest Q first. */
  sections: { f0: number; q: number; real: boolean }[];
  /** For Butterworth the 3 dB frequency; for Chebyshev the ripple edge, in Hz. */
  edge: number;
  /** The ripple factor epsilon. */
  epsilon: number;
}

/** The poles of the low-pass filter of order n, as sections of natural frequency and Q. */
export function design(family: Family, n: number, fp: number, ap: number): Design {
  const epsilon = Math.sqrt(10 ** (ap / 10) - 1);
  const poles: { re: number; im: number }[] = [];
  let edge = fp;
  if (family === 'butterworth') {
    // The poles lie on a circle of radius wc, the 3 dB radian frequency, found from the loss at fp.
    const wc = (2 * Math.PI * fp) / epsilon ** (1 / n);
    edge = wc / (2 * Math.PI);
    for (let k = 1; k <= n; k++) {
      const angle = (Math.PI * (2 * k + n - 1)) / (2 * n);
      poles.push({ re: wc * Math.cos(angle), im: wc * Math.sin(angle) });
    }
  } else {
    const a = Math.asinh(1 / epsilon) / n;
    const wp = 2 * Math.PI * fp;
    for (let k = 1; k <= n; k++) {
      const theta = (Math.PI * (2 * k - 1)) / (2 * n);
      poles.push({ re: -wp * Math.sinh(a) * Math.sin(theta), im: wp * Math.cosh(a) * Math.cos(theta) });
    }
  }
  // One entry per conjugate pair (positive imaginary part) and per real pole.
  const sections = poles
    .filter((p) => p.im > -1e-9 * Math.abs(p.re))
    .map((p) => {
      const w0 = Math.hypot(p.re, p.im);
      const real = Math.abs(p.im) <= 1e-9 * Math.abs(p.re);
      return { f0: w0 / (2 * Math.PI), q: real ? 0.5 : w0 / (-2 * p.re), real };
    })
    .sort((a, b) => a.q - b.q);
  return { n, sections, edge, epsilon };
}

/** The loss of the low-pass filter at f, in dB (positive). */
export function loss(family: Family, n: number, fp: number, ap: number, f: number): number {
  const epsilon = Math.sqrt(10 ** (ap / 10) - 1);
  if (family === 'butterworth') return 10 * Math.log10(1 + epsilon ** 2 * (f / fp) ** (2 * n));
  const x = f / fp;
  const tn = x <= 1 ? Math.cos(n * Math.acos(x)) : Math.cosh(n * Math.acosh(x));
  return 10 * Math.log10(1 + epsilon ** 2 * tn ** 2);
}

/**
 * Component values for a unity-gain Sallen-Key low-pass stage with equal resistors: given c2 (to ground), the
 * feedback capacitor is c1 = 4 Q^2 c2 and R = 1 / (4 pi f0 Q c2).
 */
export function sallenKeyStage(f0: number, q: number, c2: number) {
  const c1 = 4 * q * q * c2;
  return { c1, c2, r: 1 / (4 * Math.PI * f0 * q * c2) };
}

/** The first-order stage for a lone real pole: R = 1 / (2 pi f0 C). */
export const firstOrderStage = (f0: number, c: number): number => 1 / (2 * Math.PI * f0 * c);

// ---- Passive filters ----

export const rcCutoff = (r: number, c: number): number => 1 / (2 * Math.PI * r * c);

export function seriesRlc(r: number, l: number, c: number) {
  const f0 = 1 / (2 * Math.PI * Math.sqrt(l * c));
  const q = Math.sqrt(l / c) / r;
  return { f0, q, bandwidth: f0 / q, z0: Math.sqrt(l / c) };
}
