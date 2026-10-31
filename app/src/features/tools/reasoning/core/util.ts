// Small shared helpers for the reasoning kit's engines: a seeded random source, number text, and list parsing.

/** A seeded random source (mulberry32): the same seed gives the same sequence on every device. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A number as short text: up to `digits` significant figures, no trailing zeros, no -0. */
export function num(x: number, digits = 6): string {
  if (!Number.isFinite(x)) return x > 0 ? '∞' : x < 0 ? '−∞' : 'NaN';
  if (Object.is(x, -0) || Math.abs(x) < 1e-12) return '0';
  const fixed = Number(x.toPrecision(digits));
  const text = Math.abs(fixed) >= 1e9 || Math.abs(fixed) < 1e-5 ? fixed.toExponential() : String(fixed);
  return text.replace('-', '−');
}

/** Numbers from text separated by commas, spaces, or semicolons; null when any part is not a number. */
export function numbers(text: string): number[] | null {
  const parts = text
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const values = parts.map((p) => (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(p) ? Number(p) : NaN));
  return values.some((v) => Number.isNaN(v)) ? null : values;
}

/** Whole numbers from text; null when any part is not a whole number. */
export function integers(text: string): number[] | null {
  const values = numbers(text);
  return values && values.every((v) => Number.isSafeInteger(v)) ? values : null;
}

/** The non-empty lines of a text box, trimmed, without comment lines that start with #. */
export const lines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));

/** Rows of numbers, one row per line; null when any entry is not a number or rows differ in length. */
export function matrix(text: string): number[][] | null {
  const rows = lines(text).map(numbers);
  if (rows.length === 0 || rows.some((r) => r === null || r.length === 0)) return null;
  const width = rows[0]!.length;
  return rows.every((r) => r!.length === width) ? (rows as number[][]) : null;
}

/** An error an engine raises for input it cannot use; `key` names the message in the tool's strings. */
export class KitError extends Error {
  constructor(
    readonly key: string,
    readonly vars: Readonly<Record<string, string | number>> = {},
  ) {
    super(key);
  }
}

export const fail = (key: string, vars: Record<string, string | number> = {}): never => {
  throw new KitError(key, vars);
};

/** All subsets of 0..n-1 as bit masks, in increasing order. */
export const masks = (n: number): number[] => Array.from({ length: 1 << n }, (_, i) => i);

export const popcount = (x: number): number => {
  let c = 0;
  for (let v = x; v; v &= v - 1) c += 1;
  return c;
};
