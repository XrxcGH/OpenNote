// What the electrical tools share: complex numbers, a complex linear solver, number reading and showing, and the
// shapes of a tool's answer. Everything here is pure; the interface text lives in strings/en/kitElectrical.ts and
// is looked up by key, so an engine names a message and never builds a sentence.
import { formatNumber } from '../../../core/expr';
import { parsePrefixed } from '../../../core/units';
import type { kitElectrical } from '../../../strings/en/kitElectrical';

type Ns = typeof kitElectrical;
export type StepKey = keyof Ns['s'] & string;
export type RowKey = keyof Ns['r'] & string;
export type ErrorKey = keyof Ns['e'] & string;
export type FieldKey = keyof Ns['f'] & string;
export type NoteKey = keyof Ns['n'] & string;

export interface KitStep {
  key: StepKey;
  vars?: Record<string, string>;
  /** LaTeX for the step's equation, copied with the step. */
  math?: string;
}

export interface KitRow {
  key: RowKey;
  value: string;
  /** A word from the row labels shown instead of `value`, such as "Underdamped". */
  word?: RowKey;
  vars?: Record<string, string>;
}

export interface PlotSeries {
  name: string;
  x: number[];
  y: number[];
  /** Draw this series as dots rather than a line. */
  dots?: boolean;
  /** Half the length of the error bar on each y, for dots. */
  err?: number[];
}

export interface Plot {
  xLabel: string;
  yLabel: string;
  logX?: boolean;
  series: PlotSeries[];
  /** Points drawn as dots, such as measured data. */
  dots?: boolean;
}

export interface KitOk {
  ok: true;
  rows: KitRow[];
  steps: KitStep[];
  /** The one-line answer inserted into the page. */
  answer: string;
  latex?: string;
  /** Text for a code block, such as a netlist. */
  code?: string;
  plot?: Plot;
  /** A second plot, such as the residuals of a fit. */
  plot2?: Plot;
  notes: NoteKey[];
  source?: string;
}

export interface KitFail {
  ok: false;
  error: ErrorKey;
  vars?: Record<string, string>;
}

export type KitResult = KitOk | KitFail;

/** A problem with an input, named by message key so the interface says it in words. */
export class KitError extends Error {
  constructor(
    readonly key: ErrorKey,
    readonly vars: Record<string, string> = {},
  ) {
    super(key);
  }
}

export const fail = (key: ErrorKey, vars?: Record<string, string>): never => {
  throw new KitError(key, vars);
};

// ---- Numbers ----

/** A number to `digits` significant figures, with a true minus sign. */
export function fmt(value: number, digits = 5): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return '0';
  return formatNumber(value, { digits }).replace(/^-/, '−');
}

const PREFIXES: Record<number, string> = { [-12]: 'p', [-9]: 'n', [-6]: 'µ', [-3]: 'm', 0: '', 3: 'k', 6: 'M', 9: 'G' };

const SUPERSCRIPT: Record<string, string> = {
  '-': '⁻',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
};
const superscript = (n: number): string => [...String(n)].map((c) => SUPERSCRIPT[c] ?? c).join('');

/** The value with an engineering prefix and unit, such as "4.7 kΩ". */
export function eng(value: number, unit: string, digits = 5): string {
  if (!Number.isFinite(value)) return `${value} ${unit}`;
  if (value === 0) return `0 ${unit}`;
  const power = Math.max(-12, Math.min(9, Math.floor(Math.log10(Math.abs(value)) / 3) * 3));
  if (unit === '1/s' || unit === 'rad/s') {
    // A prefix on 1/s reads as "k1" ("12.5 k1/s"), so rates take a power of ten instead.
    const shown = unit === '1/s' ? 's⁻¹' : 'rad/s';
    return power === 0
      ? `${fmt(value, digits)} ${shown}`
      : `${fmt(value / 10 ** power, digits)} × 10${superscript(power)} ${shown}`;
  }
  return `${fmt(value / 10 ** power, digits)} ${PREFIXES[power] ?? ''}${unit}`.trim();
}

/** Reads a number the way a student types it: 4.7k, 10u, 2e-3, with or without the unit. */
export function readNumber(text: string, unit = ''): number | null {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed === '') return null;
  const direct = unit === '' ? null : parsePrefixed(trimmed, unit);
  const value = direct ?? parsePrefixed(trimmed);
  if (value !== null) return value;
  // "10 meg" is a common way to write 10 mega in circuit work (M alone would mean milli in SPICE).
  const meg = /^([+-]?\d*\.?\d+(?:e[+-]?\d+)?)\s*meg$/i.exec(trimmed);
  if (meg) return Number(meg[1]) * 1e6;
  return null;
}

export type Values = Record<string, string>;

/** A required number from the form, in the given unit; throws a message naming the field when it is not one. */
export function need(values: Values, id: string, label: FieldKey, unit = ''): number {
  const value = readNumber(values[id] ?? '', unit);
  if (value === null || !Number.isFinite(value)) return fail('number', { field: label });
  return value;
}

/** need(), and the number must be above zero. */
export function positive(values: Values, id: string, label: FieldKey, unit = ''): number {
  const value = need(values, id, label, unit);
  return value > 0 ? value : fail('positive', { field: label });
}

export const nonNegative = (values: Values, id: string, label: FieldKey, unit = ''): number => {
  const value = need(values, id, label, unit);
  return value >= 0 ? value : fail('nonNegative', { field: label });
};

// ---- Complex numbers ----

export interface Cx {
  re: number;
  im: number;
}

export const cx = (re: number, im = 0): Cx => ({ re, im });
export const cAdd = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im });
export const cSub = (a: Cx, b: Cx): Cx => ({ re: a.re - b.re, im: a.im - b.im });
export const cMul = (a: Cx, b: Cx): Cx => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
export const cScale = (a: Cx, k: number): Cx => ({ re: a.re * k, im: a.im * k });
export const cConj = (a: Cx): Cx => ({ re: a.re, im: -a.im });
export const cAbs = (a: Cx): number => Math.hypot(a.re, a.im);
export const cArg = (a: Cx): number => Math.atan2(a.im, a.re);
export const cPolar = (magnitude: number, radians: number): Cx => ({
  re: magnitude * Math.cos(radians),
  im: magnitude * Math.sin(radians),
});
export function cDiv(a: Cx, b: Cx): Cx {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}
export const cInv = (a: Cx): Cx => cDiv(cx(1), a);

/** A complex number as "a + jb" (engineers write j). */
export function cText(a: Cx, digits = 5): string {
  const sign = a.im < 0 ? '−' : '+';
  return `${fmt(a.re, digits)} ${sign} j${fmt(Math.abs(a.im), digits)}`;
}

/** A complex number as magnitude ∠ degrees. */
export function cPolarText(a: Cx, digits = 5): string {
  return `${fmt(cAbs(a), digits)} ∠ ${fmt((cArg(a) * 180) / Math.PI, digits)}°`;
}

/**
 * Solves A x = b for complex A by Gaussian elimination with partial pivoting. Returns null when the matrix is
 * singular (a floating node, a loop of ideal sources, or a circuit with no path to ground).
 */
export function solveComplex(a: Cx[][], b: Cx[]): Cx[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row.map((v) => ({ ...v })), { ...b[i]! }]);
  let scale = 0;
  for (const row of a) for (const v of row) scale = Math.max(scale, cAbs(v));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (cAbs(m[r]![col]!) > cAbs(m[pivot]![col]!)) pivot = r;
    if (cAbs(m[pivot]![col]!) <= 1e-13 * (scale || 1)) return null;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    for (let r = col + 1; r < n; r++) {
      const factor = cDiv(m[r]![col]!, m[col]![col]!);
      if (factor.re === 0 && factor.im === 0) continue;
      for (let c = col; c <= n; c++) m[r]![c] = cSub(m[r]![c]!, cMul(factor, m[col]![c]!));
    }
  }
  const x: Cx[] = Array.from({ length: n }, () => cx(0));
  for (let r = n - 1; r >= 0; r--) {
    let sum = m[r]![n]!;
    for (let c = r + 1; c < n; c++) sum = cSub(sum, cMul(m[r]![c]!, x[c]!));
    x[r] = cDiv(sum, m[r]![r]!);
  }
  return x;
}

/** Solves a real system; null when singular. */
export function solveReal(a: number[][], b: number[]): number[] | null {
  const x = solveComplex(
    a.map((row) => row.map((v) => cx(v))),
    b.map((v) => cx(v)),
  );
  return x ? x.map((v) => v.re) : null;
}

export const toDegrees = (radians: number): number => (radians * 180) / Math.PI;
export const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Logarithmically spaced points, `count` of them from `start` to `stop` inclusive. */
export function logSpace(start: number, stop: number, count: number): number[] {
  const a = Math.log10(start);
  const b = Math.log10(stop);
  return Array.from({ length: count }, (_, i) => 10 ** (a + ((b - a) * i) / Math.max(1, count - 1)));
}

export const ok = (result: Omit<KitOk, 'ok' | 'notes'> & { notes?: NoteKey[] }): KitOk => ({
  ok: true,
  notes: [],
  ...result,
});
