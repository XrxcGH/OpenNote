// Helpers the math family files share: building a scalar function from a plain number function.

import { err, finish, toNumbers, type Value } from '../../values';
import type { FnSpec2, Param } from './types';

export const number = (name = 'number'): Param => ({ name, kind: 'number' });
export const optional = (name: string, fallback?: number): Param => ({
  name,
  kind: 'number',
  optional: true,
  ...(fallback === undefined ? {} : { default: fallback }),
});

/** A function of numbers. Text that is not a number gives #VALUE!, as the compiler's coercion decides. */
export function scalar(name: string, params: Param[], run: (n: number[]) => Value, example: string): FnSpec2 {
  const signature = `${name}(${params.map((p) => (p.optional === true ? `[${p.name}]` : p.name)).join(', ')})`;
  return {
    name,
    family: 'math',
    params,
    run: (args) => {
      const nums = toNumbers(args);
      if (!Array.isArray(nums)) return nums;
      const result = run(nums);
      return result === 0 ? 0 : result; // never negative zero
    },
    meta: { signature, example },
  };
}

/** A function of one number whose domain is limited: outside it, #NUM!. */
export function math1(
  name: string,
  f: (x: number) => number,
  example: string,
  ok: (x: number) => boolean = () => true,
) {
  return scalar(name, [number()], ([x]) => (ok(x) ? finish(f(x)) : err('NUM')), example);
}

/** A function of one number that divides by something that may be zero: then #DIV/0!. */
export function math1d(name: string, f: (x: number) => number, example: string, zero: (x: number) => boolean) {
  return scalar(name, [number()], ([x]) => (zero(x) ? err('DIV0') : finish(f(x))), example);
}

/** Shifts the decimal point with exponent text, so 1.005 rounds as a person expects. */
export function shift(n: number, digits: number): number {
  const [mantissa, exponent] = n.toExponential().split('e');
  return Number(`${mantissa}e${Number(exponent) + digits}`);
}

/** A quotient with the noise of division removed, so 2.1 over 0.1 is 21 and not 21.000000000000004. */
export function quotient(n: number, step: number): number {
  const q = n / step;
  const r = Math.round(q);
  return Math.abs(q - r) <= 1e-12 * Math.max(1, Math.abs(q)) ? r : q;
}
