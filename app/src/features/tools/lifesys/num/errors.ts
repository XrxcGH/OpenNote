// The one error the life-systems engines throw. It names a message in the kitLifeSys strings and the values that
// fill it, so an engine never needs t() and the window can say in words what to change.
import type { DottedKeys } from '../../../../strings/t';
import type { kitLifeSys } from '../../../../strings/en/kitLifeSys';
import type { kitLifeSysTools } from '../../../../strings/en/kitLifeSysTools';

/** A key in the kitLifeSys strings or in a tool's own strings, such as 'errors.positive' or 'bench.c.mass'. */
export type LsKey = DottedKeys<typeof kitLifeSys> | DottedKeys<typeof kitLifeSysTools>;

/** Values for a message: numbers are shown rounded, strings as written (symbols such as V or Km). */
export type LsVars = Readonly<Record<string, string | number>>;

export class LsError extends Error {
  readonly key: LsKey;
  readonly vars: LsVars;

  constructor(key: LsKey, vars: LsVars = {}) {
    super(key);
    this.name = 'LsError';
    this.key = key;
    this.vars = vars;
  }
}

/** Throws unless value is a finite number. */
export function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new LsError('errors.number', { name });
  return value;
}

/** Throws unless value is a finite number above 0. */
export function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new LsError('errors.positive', { name });
  return value;
}

/** Throws unless value is a finite number of 0 or more. */
export function nonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new LsError('errors.nonNegative', { name });
  return value;
}

/** Throws unless low <= value <= high. */
export function within(value: number, name: string, low: number, high: number): number {
  if (!Number.isFinite(value) || value < low || value > high) throw new LsError('errors.range', { name, low, high });
  return value;
}

/** Throws unless value is a whole number of at least min. */
export function whole(value: number, name: string, min = 0): number {
  if (!Number.isInteger(value) || value < min) throw new LsError('errors.whole', { name, min });
  return value;
}
