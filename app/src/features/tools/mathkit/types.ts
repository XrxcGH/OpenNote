// What every tool of the kit shares: a worked step is a message key in the kit's strings, the numbers it names,
// and the equation it shows. The engines build steps; the window says them in words.
import type { en } from '../../../strings/en';

export type StepKey = keyof (typeof en)['kitMath']['step'];

export interface KitStep {
  readonly key: StepKey;
  readonly vars?: Readonly<Record<string, string>>;
  /** LaTeX for the equation or matrix the step shows. */
  readonly math?: string;
}

export const step = (key: StepKey, math?: string, vars?: Record<string, string>): KitStep => ({
  key,
  ...(math === undefined ? {} : { math }),
  ...(vars === undefined ? {} : { vars }),
});

/** Why a tool could not go on. The window turns the code into words (kitMath.error). */
export class KitError extends Error {
  constructor(
    readonly code: string,
    readonly detail = '',
  ) {
    super(code);
  }
}
