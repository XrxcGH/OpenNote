// Comparing actual output with expected output (DESIGN 9.1). Each mode is a known-answer test in compare.test.ts.
// `number` follows the rule judges such as Kattis document: a number is right when its absolute or its relative
// error is within the tolerance.
import { TEST_DEFAULTS } from '../contracts';
import type { CompareSpec } from '../contracts';

export interface Comparison {
  pass: boolean;
  /** Why it failed, in one short English clause for tests and logs. The panel words its own text. */
  reason?: 'different' | 'count' | 'token' | 'pattern' | 'badPattern' | 'notJson';
  /** The first differing line (from 1) and token (from 1), when there is one. */
  line?: number;
  token?: number;
}

const lineEnds = (text: string) => text.replace(/\r\n?/g, '\n');
const tokensOf = (text: string) => text.split(/\s+/).filter((token) => token !== '');

/** A token read as a number, or null when it is not one (empty, "0x10", "Infinity", and "1e400" are not). */
export function asNumber(token: string): number | null {
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(token)) return null;
  const value = Number(token);
  return Number.isFinite(value) ? value : null;
}

/** True when `actual` is within the tolerance of `expected`. `relative`: true is relative only, false absolute only. */
export function closeEnough(actual: number, expected: number, tolerance: number, relative?: boolean): boolean {
  const error = Math.abs(actual - expected);
  const absolute = error <= tolerance;
  const rel = error <= tolerance * Math.abs(expected);
  return relative === true ? rel : relative === false ? absolute : absolute || rel;
}

function trimmed(text: string): string {
  return lineEnds(text)
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n+$/, '');
}

/** The first line where two texts differ, from 1, or null when they are the same. */
export function firstDifferentLine(actual: string, expected: string): number | null {
  const a = lineEnds(actual).split('\n');
  const e = lineEnds(expected).split('\n');
  for (let at = 0; at < Math.max(a.length, e.length); at++) if (a[at] !== e[at]) return at + 1;
  return null;
}

function compareTokens(actual: string, expected: string, spec: CompareSpec): Comparison {
  const a = tokensOf(actual);
  const e = tokensOf(expected);
  const tolerance = spec.mode === 'number' ? (spec.tolerance ?? TEST_DEFAULTS.tolerance) : 0;
  for (let at = 0; at < Math.min(a.length, e.length); at++) {
    const x = a[at]!;
    const y = e[at]!;
    if (x === y) continue;
    const nx = spec.mode === 'number' ? asNumber(x) : null;
    const ny = spec.mode === 'number' ? asNumber(y) : null;
    if (
      nx !== null &&
      ny !== null &&
      closeEnough(nx, ny, tolerance, spec.mode === 'number' ? spec.relative : undefined)
    )
      continue;
    return { pass: false, reason: 'token', token: at + 1 };
  }
  return a.length === e.length
    ? { pass: true }
    : { pass: false, reason: 'count', token: Math.min(a.length, e.length) + 1 };
}

/** Compares a program's output (or any text) with the expected text. */
export function compareText(actual: string, expected: string, spec: CompareSpec): Comparison {
  switch (spec.mode) {
    case 'exact':
      return actual === expected ? { pass: true } : { pass: false, reason: 'different', ...at(actual, expected) };
    case 'trim':
      return trimmed(actual) === trimmed(expected)
        ? { pass: true }
        : { pass: false, reason: 'different', ...at(trimmed(actual), trimmed(expected)) };
    case 'tokens':
    case 'number':
      return compareTokens(actual, expected, spec);
    case 'lines-unordered': {
      const sorted = (text: string) => trimmed(text).split('\n').sort().join('\n');
      return sorted(actual) === sorted(expected) ? { pass: true } : { pass: false, reason: 'different' };
    }
    case 'regex':
      try {
        return new RegExp(expected).test(lineEnds(actual).replace(/\n+$/, ''))
          ? { pass: true }
          : { pass: false, reason: 'pattern' };
      } catch {
        return { pass: false, reason: 'badPattern' };
      }
  }
}

function at(actual: string, expected: string): { line?: number } {
  const line = firstDifferentLine(actual, expected);
  return line === null ? {} : { line };
}

// --- JSON values, for `call` cases.

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function sameJson(a: Json, e: Json, spec: CompareSpec): boolean {
  if (typeof a === 'number' && typeof e === 'number') {
    if (spec.mode !== 'number') return a === e;
    return closeEnough(a, e, spec.tolerance ?? TEST_DEFAULTS.tolerance, spec.relative);
  }
  if (Array.isArray(a) || Array.isArray(e)) {
    if (!Array.isArray(a) || !Array.isArray(e) || a.length !== e.length) return false;
    return a.every((item, index) => sameJson(item, e[index]!, spec));
  }
  if (a && e && typeof a === 'object' && typeof e === 'object') {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(e).length) return false;
    return keys.every((key) => key in e && sameJson(a[key]!, e[key]!, spec));
  }
  return a === e;
}

/** JSON text parsed, or undefined when it is not valid JSON. */
export function parseJson(text: string): Json | undefined {
  try {
    return JSON.parse(text) as Json;
  } catch {
    return undefined;
  }
}

function spaced(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(spaced).join(', ')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .map(([key, item]) => `${JSON.stringify(key)}: ${spaced(item)}`)
      .join(', ')}}`;
  return JSON.stringify(value);
}

/** One line of a JSON value with ", " and ": " between items (what the diff shows); other text stays as it is. */
export function showJson(text: string): string {
  const value = parseJson(text.trim());
  return value === undefined ? text : spaced(value);
}

/**
 * Compares a function's returned value, as JSON text, with the expected JSON text. Spacing and key order do not
 * matter. `number` mode gives numbers a tolerance; the other modes need equal numbers. When the expected text is
 * not JSON, the two texts are compared as text.
 */
export function compareJson(actual: string, expected: string, spec: CompareSpec): Comparison {
  const e = parseJson(expected.trim());
  if (e === undefined) return compareText(actual, expected, spec);
  const a = parseJson(actual.trim());
  if (a === undefined) return { pass: false, reason: 'notJson' };
  return sameJson(a, e, spec) ? { pass: true } : { pass: false, reason: 'different' };
}
