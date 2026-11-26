// Shared pieces of the text function files: parameter shorthands, the `define` helper, and small coercions.
// Owner: tables:fn-text.

import { err, isArray, toNumber, toScalar, toText, type FormulaError, type Value } from '../../values';
import type { FnSpec2, Param } from './types';

/** Lower or upper case one character at a time, keeping any character whose case form has another length. */
export function mapCase(s: string, upper: boolean): string {
  let out = '';
  for (const ch of s) {
    const m = upper ? ch.toUpperCase() : ch.toLowerCase();
    out += m.length === ch.length ? m : ch;
  }
  return out;
}

/** The most decimal places DOLLAR and FIXED accept. More give #VALUE!. */
export const MAX_DECIMALS = 127;

/** The most characters a cell holds. A function that would build more gives #VALUE!. */
export const MAX_TEXT = 32767;

// ---------------------------------------------------------------------------------------------------------------
// Small helpers.

export const text = (name: string, optional = false): Param => ({
  name,
  kind: 'text',
  ...(optional ? { optional } : {}),
});
export const num = (name: string, optional = false): Param => ({
  name,
  kind: 'number',
  ...(optional ? { optional } : {}),
});
export const bool = (name: string, optional = false): Param => ({
  name,
  kind: 'bool',
  ...(optional ? { optional } : {}),
});
export const value = (name: string, optional = false): Param => ({
  name,
  kind: 'value',
  ...(optional ? { optional } : {}),
});
export const array = (name: string, optional = false): Param => ({
  name,
  kind: 'array',
  ...(optional ? { optional } : {}),
});

export function signatureOf(name: string, params: readonly (Param | { repeat: readonly Param[] })[]): string {
  const parts = params.map((p) =>
    'repeat' in p ? `${p.repeat.map((r) => r.name).join(', ')}, ...` : p.optional === true ? `[${p.name}]` : p.name,
  );
  return `${name}(${parts.join(', ')})`;
}

export function define(
  name: string,
  params: readonly (Param | { repeat: readonly Param[]; min?: number })[],
  run: FnSpec2['run'],
  example: string,
  extra: Partial<FnSpec2> = {},
): FnSpec2 {
  return { name, family: 'text', params, run, meta: { signature: signatureOf(name, params), example }, ...extra };
}

/** A whole number from an argument, or its error. An omitted argument is the default. */
export function int(v: Value | undefined, dflt: number): number | FormulaError {
  if (v === undefined) return dflt;
  const n = toNumber(v);
  return typeof n === 'number' ? Math.trunc(n) : n;
}

/** An argument as a list of texts: an array gives every item, a single value gives itself. */
export function listOf(v: Value | undefined): string[] | FormulaError {
  if (v === undefined || v === null) return [];
  const items = isArray(v) ? v.data : [toScalar(v)];
  const out: string[] = [];
  for (const item of items) {
    const s = toText(item);
    if (typeof s !== 'string') return s;
    out.push(s);
  }
  return out;
}

export const tooLong = (s: string): FormulaError | string => (s.length > MAX_TEXT ? err('VALUE') : s);

/** Rounds half away from zero at a number of decimal digits, by shifting the exponent so 1.005 rounds as written. */
export function roundAt(n: number, digits: number): number {
  // Past 15 significant digits there is nothing left to round, and shifting the exponent could overflow.
  if (!Number.isFinite(n) || n === 0 || Math.floor(Math.log10(Math.abs(n))) + digits >= 15) return n;
  const shift = (x: number, d: number): number => {
    const [mantissa, exponent] = x.toExponential().split('e');
    return Number(`${mantissa}e${Number(exponent) + d}`);
  };
  const out = Math.sign(n) * shift(Math.round(shift(Math.abs(n), digits)), -digits);
  return Number.isFinite(out) ? out : n;
}
