// Helpers the automata and grammars tool's forms share: its strings, error wording, and field shapes.
import { attempt, say } from '../ui/say';
import type { Field, Outcome, Values } from '../ui/types';

export const T = 'automata';
export const s = (path: string, vars?: Record<string, string | number>): string => say(`${T}.${path}`, vars);
export const solveWith =
  (fn: (v: Values) => Outcome) =>
  (v: Values): Outcome =>
    attempt(T, () => fn(v));
export const f = (id: string, initial: string, extra: Partial<Field> = {}): Field => ({ id, initial, ...extra });
export const area = (id: string, initial: string, rows = 6): Field => ({ id, kind: 'area', initial, rows, help: true });
/** The empty string shown as ε. */
export const shown = (w: string): string => (w === '' ? 'ε' : w);
