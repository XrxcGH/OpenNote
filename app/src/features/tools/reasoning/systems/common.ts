// Helpers the computer systems tool's forms share: its strings, error wording, and number and quantity fields.
import { fail, integers, numbers } from '../core/util';
import { attempt, say } from '../ui/say';
import type { Field, Outcome, Values } from '../ui/types';
import { quantity } from './units';
import type { QuantityKind } from './units';

export const T = 'systems';
export const s = (path: string, vars?: Record<string, string | number>): string => say(`${T}.${path}`, vars);
export const solveWith =
  (fn: (v: Values) => Outcome) =>
  (v: Values): Outcome =>
    attempt(T, () => fn(v));
export const f = (id: string, initial: string, extra: Partial<Field> = {}): Field => ({ id, initial, ...extra });
export const pick = <K extends string>(v: Values, id: string, options: readonly K[]): K =>
  (options as readonly string[]).includes(v[id] ?? '') ? (v[id] as K) : options[0];

const label = (id: string) => s(`fields.${id}`);

export const one = (v: Values, id: string): number => {
  const x = numbers(v[id] ?? '');
  return x?.length === 1 ? x[0] : fail('number', { field: label(id) });
};
export const whole = (v: Values, id: string, min = 0): number => {
  const x = integers(v[id] ?? '');
  return x?.length === 1 && x[0] >= min ? x[0] : fail('wholeField', { field: label(id), min });
};
export const list = (v: Values, id: string): number[] => {
  const x = numbers(v[id] ?? '');
  return x && x.length ? x : fail('numberList', { field: label(id) });
};
/** A quantity in base units; a bare number is in `bare` base units (1000 for a field labeled in km, say). */
export const qty = (v: Values, id: string, kind: QuantityKind, bare = 1): number =>
  quantity(v[id] ?? '', kind, label(id), bare);
export const yes = (b: boolean): string => s(b ? 'yes' : 'no');
