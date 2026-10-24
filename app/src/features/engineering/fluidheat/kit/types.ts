// What every fluid mechanics and heat transfer tool shares. A worked step is a message key in the kit's strings, the
// values it names, and the equation it shows in LaTeX. A value is kept as a number in base SI with its kind, so the
// window can show it in SI or US units without working it out again. The engines never write sentences.
import type { en } from '../../../../strings/en';
import type { Kind } from './units';

/** A step's key: its name under kitFluidHeat.step. */
export type StepKey = keyof (typeof en)['kitFluidHeat']['step'];

export type ErrorCode = keyof (typeof en)['kitFluidHeat']['error'];

/** A value in base SI and the kind of quantity it is. */
export interface Q {
  readonly v: number;
  readonly k: Kind;
}

export const q = (v: number, k: Kind): Q => ({ v, k });

export type StepValue = string | number | Q;

export interface KitStep {
  readonly key: StepKey;
  readonly vars?: Readonly<Record<string, StepValue>>;
  /** LaTeX for the equation the step shows. [[name]] stands for a value from `vars`, written with its unit. */
  readonly math?: string;
}

export const step = (key: StepKey, math?: string, vars?: Record<string, StepValue>): KitStep => ({
  key,
  ...(math === undefined ? {} : { math }),
  ...(vars === undefined ? {} : { vars }),
});

/** Why a tool could not go on. The window turns the code into words from kitFluidHeat.error. */
export class FluidHeatError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly detail = '',
  ) {
    super(code);
  }
}

export function fail(code: ErrorCode, detail = ''): never {
  throw new FluidHeatError(code, detail);
}

/** Stops with `positive` when a value that must be above zero is not. `name` is the symbol the message shows. */
export function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) fail('positive', name);
  return value;
}

/** Stops with `notNegative` when a value is below zero. */
export function notNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) fail('notNegative', name);
  return value;
}

/** Stops with `notFinite` when a value is not a finite number. */
export function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) fail('notFinite', name);
  return value;
}
