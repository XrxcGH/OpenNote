// Helpers the numbers, counting, and groups tool's forms share: its strings, error wording, and number fields.
import { fail, integers } from '../core/util';
import { attempt, say } from '../ui/say';
import type { Outcome, Values } from '../ui/types';
import { big } from './numbers';

export const ds = (path: string, vars?: Record<string, string | number>): string => say(`discrete.${path}`, vars);

export const solveWith =
  (fn: (v: Values) => Outcome) =>
  (v: Values): Outcome =>
    attempt('discrete', () => fn(v));

export const bigOf = (v: Values, id: string): bigint => big(v[id] ?? '', ds(`fields.${id}`));

export const smallOf = (v: Values, id: string, max = 1e6): number => {
  const x = integers(v[id] ?? '');
  if (!x || x.length !== 1) return fail('wholeField', { field: ds(`fields.${id}`) });
  if (Math.abs(x[0]) > max) return fail('tooBig', { field: ds(`fields.${id}`), max });
  return x[0];
};
