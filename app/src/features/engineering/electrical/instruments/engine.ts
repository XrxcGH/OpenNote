// The everyday calculations of a measurement lab: resistor codes, bridges, RTDs, signal levels, and converters.
// All values are SI (ohms, volts, seconds, hertz); temperatures are degrees Celsius.
import { fail } from '../shared';

// ---- Resistor color codes ----

const DIGIT: Record<string, number> = {
  black: 0,
  brown: 1,
  red: 2,
  orange: 3,
  yellow: 4,
  green: 5,
  blue: 6,
  violet: 7,
  purple: 7,
  gray: 8,
  grey: 8,
  white: 9,
};
const MULTIPLIER: Record<string, number> = {
  ...Object.fromEntries(Object.entries(DIGIT).map(([k, v]) => [k, 10 ** v])),
  gold: 0.1,
  silver: 0.01,
};
const TOLERANCE: Record<string, number> = {
  brown: 1,
  red: 2,
  green: 0.5,
  blue: 0.25,
  violet: 0.1,
  purple: 0.1,
  gray: 0.05,
  grey: 0.05,
  gold: 5,
  silver: 10,
};

export interface ColorCode {
  ohms: number;
  /** Percent. */
  tolerance: number;
  low: number;
  high: number;
  bands: number;
}

/** Reads 4 or 5 bands, such as "brown black red gold": digits, multiplier, tolerance (20 % when there is none). */
export function decodeBands(text: string): ColorCode {
  const words = text
    .toLowerCase()
    .split(/[\s,;/-]+/)
    .filter(Boolean);
  const unknown = words.find((w) => !(w in MULTIPLIER) && !(w in TOLERANCE));
  if (unknown) return fail('band', { band: unknown });
  if (words.length < 3 || words.length > 5) return fail('bandCount');
  // Three bands: two digits and a multiplier, 20 % tolerance. Four: with tolerance. Five: three digits.
  const digits = words.length === 5 ? 3 : 2;
  const digitWords = words.slice(0, digits);
  if (digitWords.some((w) => !(w in DIGIT))) return fail('bandDigit');
  const multiplier = MULTIPLIER[words[digits]!];
  if (multiplier === undefined) return fail('bandMultiplier', { band: words[digits]! });
  const toleranceWord = words[digits + 1];
  const tolerance = toleranceWord === undefined ? 20 : TOLERANCE[toleranceWord];
  if (tolerance === undefined) return fail('bandTolerance', { band: toleranceWord! });
  const base = digitWords.reduce((sum, w) => sum * 10 + DIGIT[w]!, 0);
  const ohms = Number((base * multiplier).toPrecision(12));
  return {
    ohms,
    tolerance,
    low: ohms * (1 - tolerance / 100),
    high: ohms * (1 + tolerance / 100),
    bands: words.length,
  };
}

const E12 = [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82];
const E24 = [10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51, 56, 62, 68, 75, 82, 91];
const E96 = Array.from({ length: 96 }, (_, k) => Math.round(10 ** (2 + k / 96)));

export type ESeries = 'E12' | 'E24' | 'E96';

/** The standard value of a series closest to `ohms`, comparing on a log scale (the way the series is spaced). */
export function nearestStandard(ohms: number, series: ESeries): number {
  if (!(ohms > 0)) return fail('positive', { field: 'resistance' });
  const values = series === 'E12' ? E12 : series === 'E24' ? E24 : E96;
  const scale = series === 'E96' ? 100 : 10;
  const decade = Math.floor(Math.log10(ohms));
  let best = 0;
  let bestError = Infinity;
  for (const d of [decade - 1, decade, decade + 1]) {
    for (const value of values) {
      const candidate = (value / scale) * 10 ** d;
      const error = Math.abs(Math.log(candidate / ohms));
      if (error < bestError) {
        best = candidate;
        bestError = error;
      }
    }
  }
  return Number(best.toPrecision(12));
}

// ---- RTD (Callendar–Van Dusen, IEC 60751) ----

export const RTD_A = 3.9083e-3;
export const RTD_B = -5.775e-7;
export const RTD_C = -4.183e-12;

/** Resistance of a platinum RTD of nominal resistance r0 at `celsius`. */
export function rtdResistance(celsius: number, r0 = 100): number {
  if (celsius < -200 || celsius > 850) return fail('rtdRange');
  const t = celsius;
  const base = 1 + RTD_A * t + RTD_B * t * t;
  return r0 * (celsius < 0 ? base + RTD_C * (t - 100) * t ** 3 : base);
}

/** Temperature of a platinum RTD from its resistance. */
export function rtdTemperature(ohms: number, r0 = 100): number {
  const low = rtdResistance(-200, r0);
  const high = rtdResistance(850, r0);
  if (!(ohms >= low && ohms <= high))
    return fail('rtdOhms', { low: String(low.toFixed(2)), high: String(high.toFixed(2)) });
  if (ohms >= r0) {
    const ratio = ohms / r0;
    return (-RTD_A + Math.sqrt(RTD_A * RTD_A - 4 * RTD_B * (1 - ratio))) / (2 * RTD_B);
  }
  let a = -200;
  let b = 0;
  for (let i = 0; i < 100; i++) {
    const mid = (a + b) / 2;
    if (rtdResistance(mid, r0) < ohms) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}

// ---- Bridges ----

export type BridgeKind = 'quarter' | 'half' | 'full';

export interface StrainBridge {
  /** Output with the small-strain formula, volts. */
  linear: number;
  /** Output from the bridge equations, volts. */
  exact: number;
}

/**
 * The output of a strain-gauge bridge for gauge factor `gf`, strain `strain` (a ratio, 1000 microstrain = 0.001),
 * and excitation `vex`. One active gauge: Vex x / 4 (1 + x/2) with x = GF ε; two active gauges of opposite sign in
 * adjacent arms, or four gauges: the bridge is linear.
 */
export function strainBridge(kind: BridgeKind, gf: number, strain: number, vex: number): StrainBridge {
  const x = gf * strain;
  if (kind === 'quarter') {
    if (1 + x / 2 <= 0) return fail('bridgeLimit');
    return { linear: (vex * x) / 4, exact: (vex * x) / 4 / (1 + x / 2) };
  }
  if (kind === 'half') return { linear: (vex * x) / 2, exact: (vex * x) / 2 };
  return { linear: vex * x, exact: vex * x };
}

/**
 * A Wheatstone bridge with R1 over R2 on the left and R4 over R3 on the right; the output is read from the left
 * midpoint (between R1 and R2) to the right midpoint (between R4 and R3), measured as left minus right.
 * The bridge balances when R1 R3 = R2 R4.
 */
export function wheatstone(vex: number, r1: number, r2: number, r3: number, r4: number): number {
  return vex * (r2 / (r1 + r2) - r3 / (r3 + r4));
}

// ---- Signals ----

export type AmplitudeKind = 'peak' | 'peakToPeak' | 'rms';

export interface SineLevels {
  peak: number;
  peakToPeak: number;
  rms: number;
  /** Mean of the rectified wave. */
  average: number;
}

/** The levels of a sine wave from one of them. */
export function sineLevels(kind: AmplitudeKind, value: number): SineLevels {
  const peak = kind === 'peak' ? value : kind === 'peakToPeak' ? value / 2 : value * Math.SQRT2;
  return { peak, peakToPeak: 2 * peak, rms: peak / Math.SQRT2, average: (2 * peak) / Math.PI };
}

/** 20 log₁₀ of a voltage ratio (or 10 log₁₀ of a power ratio). */
export function decibels(ratio: number, power = false): number {
  if (!(ratio > 0)) return fail('ratio');
  return (power ? 10 : 20) * Math.log10(ratio);
}

/** The ratio for a number of decibels. */
export const fromDecibels = (db: number, power = false): number => 10 ** (db / (power ? 10 : 20));

/** Phase lead (positive) or lag (negative) in degrees from a time shift read on a scope, for a signal of `hz`. */
export function phaseFromShift(shift: number, hz: number): number {
  if (!(hz > 0)) return fail('positive', { field: 'frequency' });
  return 360 * hz * shift;
}

// ---- Converters ----

export interface Adc {
  levels: number;
  lsb: number;
  /** The ideal code for the input, clamped to the range. */
  code: number;
  /** The voltage the code stands for (the middle of its step, so the error is at most half a step). */
  reconstructed: number;
  /** The largest error of an ideal converter, half a step. */
  maxError: number;
  rmsError: number;
  /** Ideal signal-to-noise ratio for a full-scale sine, dB. */
  snr: number;
}

export function adc(bits: number, vref: number, input: number): Adc {
  if (!Number.isInteger(bits) || bits < 1 || bits > 32) return fail('bits');
  const levels = 2 ** bits;
  const lsb = vref / levels;
  const code = Math.max(0, Math.min(levels - 1, Math.round(input / lsb)));
  return {
    levels,
    lsb,
    code,
    reconstructed: code * lsb,
    maxError: lsb / 2,
    rmsError: lsb / Math.sqrt(12),
    snr: 6.02 * bits + 1.76,
  };
}
