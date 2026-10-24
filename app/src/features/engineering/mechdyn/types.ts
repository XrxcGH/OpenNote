// Shapes the mechanisms and dynamics engines return: worked steps keyed into the lane's strings, plot series, and a
// result-or-error outcome. Engines never hold interface text; the screens turn keys into words.
import { formatNumber } from '../../../core/expr';
import type { kitMechDyn } from '../../../strings/en/kitMechDyn';

export type StepKey = keyof (typeof kitMechDyn)['steps'];
export type ErrorKey = keyof (typeof kitMechDyn)['errors'];

/** One worked step: a sentence (by key, with values) and an optional LaTeX line. */
export interface MechStep {
  key: StepKey;
  vars?: Record<string, string>;
  math?: string;
}

export interface Series {
  /** A key into the lane strings' `series` group. */
  name: keyof (typeof kitMechDyn)['series'];
  /** Values for the name's placeholders, such as the mode number. */
  vars?: Record<string, string>;
  points: [number, number][];
  /** Drawn as separate dots, for a cloud of samples such as a workspace. */
  dots?: boolean;
}

export interface Plot {
  x: keyof (typeof kitMechDyn)['axes'];
  y: keyof (typeof kitMechDyn)['axes'];
  series: Series[];
  /** Equal scales on both axes, for drawings and paths. */
  equal?: boolean;
}

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: ErrorKey; vars?: Record<string, string> };

export const fail = (
  error: ErrorKey,
  vars?: Record<string, string>,
): { ok: false; error: ErrorKey; vars?: Record<string, string> } =>
  vars ? { ok: false, error, vars } : { ok: false, error };

/** A number for a worked step: five significant digits, no trailing zeros. */
export const fmt = (x: number, digits = 5): string =>
  Number.isFinite(x) ? formatNumber(Math.abs(x) < 1e-12 ? 0 : x, { digits }) : String(x);

/** True when every value is a finite number. */
export const finite = (...values: number[]): boolean => values.every((v) => Number.isFinite(v));
