// What the numerical methods share: the shape of an answer (lines of words, tables, plots, worked steps), and the
// reading of numbers and lists the fields hold. An engine fills an answer; one view in the window draws any of them.
import { numberOf } from '../expr';
import { KitError, type KitStep } from '../types';
import type { Series } from '../ui/parts';

/** A line of the answer: a message under kitMath.numerics.line and the numbers it names. */
export interface NumLine {
  readonly key: string;
  readonly vars?: Readonly<Record<string, string>>;
}

/** A table. A column is a key under kitMath.numerics.col, or literal text when it starts with "~". */
export interface NumTable {
  readonly title: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface NumPlot {
  readonly label: string;
  readonly series: readonly Series[];
  readonly logx?: boolean;
  readonly logy?: boolean;
}

/** A grid of values for a field such as a temperature, drawn as shaded cells. Row 0 is the top. */
export interface NumField {
  readonly label: string;
  readonly values: readonly (readonly number[])[];
}

export interface NumOut {
  readonly lines: readonly NumLine[];
  readonly tables: readonly NumTable[];
  readonly plots: readonly NumPlot[];
  readonly fields: readonly NumField[];
  readonly steps: readonly KitStep[];
  /** The main equation, as LaTeX, for the Insert menu. */
  readonly latex?: string;
}

export const line = (key: string, vars?: Record<string, string>): NumLine => (vars ? { key, vars } : { key });

/** A number from a field; a clear error naming the field when it is not one. */
export function num(text: string, name: string): number {
  const value = numberOf(text);
  if (!Number.isFinite(value)) throw new KitError('badNumber', name);
  return value;
}

/** A whole number from a field within a range. */
export function whole(text: string, name: string, min: number, max: number): number {
  const value = num(text, name);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new KitError('badWhole', `${name}: ${min} to ${max}`);
  }
  return value;
}

/** A list of numbers separated by commas, semicolons, spaces, or lines. */
export function numbers(text: string, name: string): number[] {
  const parts = /[,;\n]/.test(text) ? text.split(/[,;\n]+/) : text.split(/\s+/);
  const values = parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map(numberOf);
  if (values.length === 0 || values.some((v) => !Number.isFinite(v))) throw new KitError('badNumber', name);
  return values;
}

/** Rows of numbers, one row per line. */
export function rowsOf(text: string, name: string): number[][] {
  const rows = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => numbers(l, name));
  if (rows.length === 0) throw new KitError('badNumber', name);
  return rows;
}

/** A polynomial with ascending coefficients as LaTeX. */
export function polyLatex(coefficients: readonly number[], variable = 'x', digits = 6): string {
  const parts: string[] = [];
  coefficients.forEach((raw, k) => {
    const v = Number(raw.toPrecision(digits));
    if (v === 0) return;
    const abs = Math.abs(v);
    const mag = abs >= 1e6 || abs < 1e-4 ? abs.toExponential(digits - 1).replace(/\.?0+e/, 'e') : String(abs);
    const power = k === 0 ? '' : k === 1 ? variable : `${variable}^{${k}}`;
    const body = k === 0 ? mag : mag === '1' ? power : `${mag}${power}`;
    if (parts.length === 0) parts.push(v < 0 ? `-${body}` : body);
    else parts.push(` ${v < 0 ? '-' : '+'} ${body}`);
  });
  return parts.length ? parts.join('') : '0';
}
