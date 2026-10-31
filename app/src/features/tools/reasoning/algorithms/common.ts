// Helpers the algorithms tool's forms share: its strings, error wording, and number fields.
import { fail, integers, numbers } from '../core/util';
import { attempt, say } from '../ui/say';
import type { Field, Outcome, Values } from '../ui/types';

export const T = 'algorithms';
export const s = (path: string, vars?: Record<string, string | number>): string => say(`${T}.${path}`, vars);
export const solveWith =
  (fn: (v: Values) => Outcome) =>
  (v: Values): Outcome =>
    attempt(T, () => fn(v));
export const f = (id: string, initial: string, extra: Partial<Field> = {}): Field => ({ id, initial, ...extra });

export const numList = (v: Values, id: string): number[] => {
  const x = numbers(v[id] ?? '');
  return x ?? fail('numberList', { field: s(`fields.${id}`) });
};
export const whole = (v: Values, id: string): number => {
  const x = integers(v[id] ?? '');
  return x?.length === 1 ? x[0] : fail('wholeField', { field: s(`fields.${id}`) });
};
