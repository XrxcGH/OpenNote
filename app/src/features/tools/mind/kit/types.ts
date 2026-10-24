// What every psychology tool shares. A worked step is a message key in the kit's strings, the values it names,
// and the equation it shows in LaTeX. Engines never write sentences: they return numbers, step keys, and error
// codes, and the window turns them into words.
import type { en } from '../../../../strings/en';

type Kit = (typeof en)['kitMind'];

/** A step's key: the tool's name, then the step's name under kitMind.<tool>.step. */
export type StepKey = {
  [T in keyof Kit & string]: Kit[T] extends { step: infer S } ? `${T}.${keyof S & string}` : never;
}[keyof Kit & string];

export type ErrorCode = keyof Kit['error'];

export type StepValue = string | number;
export type Vars = Readonly<Record<string, StepValue>>;

export interface KitStep {
  readonly key: StepKey;
  readonly vars?: Vars;
  /** LaTeX for the equation the step shows. [[name]] stands for a value from `vars`. */
  readonly math?: string;
}

export const step = (key: StepKey, math?: string, vars?: Vars): KitStep => ({
  key,
  ...(math === undefined ? {} : { math }),
  ...(vars === undefined ? {} : { vars }),
});

/** Why a tool could not go on. The window turns the code into words from kitMind.error. */
export class MindError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly vars: Vars = {},
    /** The field the problem is in, when it is in one. */
    readonly field?: string,
  ) {
    super(code);
  }
}

export function fail(code: ErrorCode, vars: Vars = {}, field?: string): never {
  throw new MindError(code, vars, field);
}

/** Stops when a value is not between low and high (inclusive). */
export function within(value: number, low: number, high: number, field: string): number {
  if (!(value >= low && value <= high)) fail('range', { low, high }, field);
  return value;
}

/** Stops when a value is not above zero. */
export function positive(value: number, field: string): number {
  if (!(value > 0) || !Number.isFinite(value)) fail('positive', {}, field);
  return value;
}

/** Stops when a value is below zero. */
export function notNegative(value: number, field: string): number {
  if (!(value >= 0) || !Number.isFinite(value)) fail('notNegative', {}, field);
  return value;
}

/** Stops when a value is not a whole number from low up. */
export function whole(value: number, low: number, field: string): number {
  if (!Number.isInteger(value) || value < low) fail('whole', { low }, field);
  return value;
}
