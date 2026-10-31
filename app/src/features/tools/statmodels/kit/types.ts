// What every statistical models tool shares. A worked step is a message key in the kit's strings, the values it
// names, and the equation it shows in LaTeX. The engines never write sentences: they return numbers, names, and
// message keys, and the window turns them into words.
import type { en } from '../../../../strings/en';

type Steps = (typeof en)['kitStatModels']['step'];

/** A step's key: the tool's group in kitStatModels.step, then the step's name. */
export type StepKey = { [T in keyof Steps]: `${T & string}.${keyof Steps[T] & string}` }[keyof Steps];

export type ErrorCode = keyof (typeof en)['kitStatModels']['error'];

/** A value a step or a table shows: a number, or text such as a term's name. */
export type StepValue = string | number;

export interface KitStep {
  readonly key: StepKey;
  readonly vars?: Readonly<Record<string, StepValue>>;
  /** LaTeX for the equation the step shows. [[name]] stands for a value from `vars`. */
  readonly math?: string;
}

export const step = (key: StepKey, math?: string, vars?: Record<string, StepValue>): KitStep => ({
  key,
  ...(math === undefined ? {} : { math }),
  ...(vars === undefined ? {} : { vars }),
});

/** Why a tool could not go on. The window turns the code into words from kitStatModels.error. */
export class StatError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly detail = '',
  ) {
    super(code);
  }
}

export function fail(code: ErrorCode, detail = ''): never {
  throw new StatError(code, detail);
}
