// What every kit does with an absurd input (1e12 of anything): an engine that cannot answer returns NaN or Infinity,
// or throws a RangeError when the size of an array or a loop comes from the input. A kit never shows those as an
// answer; it says the input is out of range. This is the one test every kit's runner uses.

/**
 * True for a number that is NaN or infinite, or a nested array or plain object that holds one. A kit that writes
 * an answer of +Infinity as "∞" (an infinite fatigue life, a safety factor with no load) passes
 * `allowInfinity`, and then only NaN and −Infinity count.
 */
export function hasNonFinite(value: unknown, allowInfinity = false, depth = 0): boolean {
  if (typeof value === 'number')
    return allowInfinity ? Number.isNaN(value) || value === -Infinity : !Number.isFinite(value);
  if (depth > 6 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => hasNonFinite(item, allowInfinity, depth + 1));
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(value).some((item) => hasNonFinite(item, allowInfinity, depth + 1));
}

/**
 * True for an infinite number (not NaN) in a value or anything nested in it. A plot draws NaN as a gap in a line, but
 * Infinity has no place on a page.
 */
export function hasInfinity(value: unknown, depth = 0): boolean {
  if (typeof value === 'number') return value === Infinity || value === -Infinity;
  if (depth > 6 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => hasInfinity(item, depth + 1));
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(value).some((item) => hasInfinity(item, depth + 1));
}

/** True for the RangeError an absurd size raises ("Invalid array length", "Maximum call stack size exceeded"). */
export const isRangeError = (error: unknown): error is RangeError => error instanceof RangeError;

/** A word a number prints as when it is not finite: NaN, Infinity, and the minus forms. */
const NOT_FINITE = /(?:^|[^A-Za-z])[-−]?(?:NaN|Infinity)(?![A-Za-z])/;

/** True when a line of an answer (a headline, a result value, a step) shows NaN or Infinity as a number. */
export const printsNonFinite = (line: string): boolean => NOT_FINITE.test(line);
