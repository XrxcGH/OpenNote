// What the music-and-studio tools share: number reading and showing, and the shapes of a tool's answer. Everything
// here is pure. The interface text lives in strings/en/kitMusic and is looked up by key, so an engine names a
// message and never builds a sentence.
import { formatNumber } from '../../../core/expr';
import { parsePrefixed } from '../../../core/units';
import type { kitMusic } from '../../../strings/en/kitMusic';

type Ns = typeof kitMusic;
export type StepKey = keyof Ns['s'] & string;
export type RowKey = keyof Ns['r'] & string;
export type ErrorKey = keyof Ns['e'] & string;
export type FieldKey = keyof Ns['f'] & string;
export type NoteKey = keyof Ns['n'] & string;

export interface KitStep {
  key: StepKey;
  vars?: Record<string, string>;
}

export interface KitRow {
  key: RowKey;
  value: string;
  vars?: Record<string, string>;
}

export interface KitOk {
  ok: true;
  rows: KitRow[];
  steps: KitStep[];
  /** The one-line answer inserted into the page. */
  answer: string;
  /** A picture drawn as SVG markup, such as a keyboard or a grid. */
  svg?: { markup: string; label: string };
  /** Text for a code block or a plain-text table. */
  code?: string;
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

export type Values = Record<string, string>;

/** A number to `digits` significant figures, with a true minus sign. */
export function fmt(value: number, digits = 5): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0 || Math.abs(value) < 1e-15) return '0';
  return formatNumber(value, { digits }).replace(/^-/, '−');
}

/** A number with a fixed count of decimals and a true minus sign. */
export function fixed(value: number, decimals: number): string {
  return value
    .toFixed(decimals)
    .replace(/^-/, '−')
    .replace(/^−0(\.0*)?$/, '0$1');
}

/** Reads a number the way a student types it: 4.7k, 2e-3, 1/48, with or without a unit. */
export function readNumber(text: string, unit = ''): number | null {
  const trimmed = text.trim().replace(/\s+/g, ' ').replace(/−/g, '-');
  if (trimmed === '') return null;
  const fraction = /^([+-]?\d*\.?\d+)\s*\/\s*(\d*\.?\d+)$/.exec(trimmed);
  if (fraction) {
    const bottom = Number(fraction[2]);
    return bottom === 0 ? null : Number(fraction[1]) / bottom;
  }
  const direct = unit === '' ? null : parsePrefixed(trimmed, unit);
  return direct ?? parsePrefixed(trimmed);
}

/** A required number from the form; throws a message naming the field when it is not one. */
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

export const ok = (result: Omit<KitOk, 'ok' | 'notes'> & { notes?: NoteKey[] }): KitOk => ({
  ok: true,
  notes: [],
  ...result,
});

export const degrees = (radians: number): number => (radians * 180) / Math.PI;
export const radians = (deg: number): number => (deg * Math.PI) / 180;
