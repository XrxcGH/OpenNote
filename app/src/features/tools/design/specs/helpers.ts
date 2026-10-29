// Small builders the specs share, so a tool's fields and results read as a list rather than as plumbing.
import type { ChoiceField, Field, NumField, Outcome, Row, Values } from '../kit/spec';
import type { DimId } from '../kit/units';
import type { Problem } from '../types';

/** True when the tool's mode is one of these. */
export const inMode =
  (...modes: string[]) =>
  (v: Values): boolean =>
    modes.includes(String(v.mode));

/** A number field shown in some modes. */
export function numField(id: string, def: string, dim: DimId | undefined, ...modes: string[]): NumField {
  return { type: 'num', id, def, ...(dim ? { dim } : {}), ...(modes.length ? { when: inMode(...modes) } : {}) };
}

/** A number field that may be left empty (the value is then NaN). */
export const optionalField = (id: string, dim: DimId | undefined, ...modes: string[]): NumField => ({
  ...numField(id, '', dim, ...modes),
  optional: true,
});

export function choiceField(id: string, options: string[], def: string, ...modes: string[]): ChoiceField {
  return { type: 'choice', id, options, def, ...(modes.length ? { when: inMode(...modes) } : {}) };
}

export const modeField = (options: string[]): Field => ({ type: 'choice', id: 'mode', options, def: options[0] ?? '' });

/** A failed engine result as the window's problem. */
export const failed = (r: Problem): { ok: false; problem: string } => ({ ok: false, problem: r.problem });

export const success = (outcome: Outcome) => ({ ok: true as const, outcome });

export type { Row };
