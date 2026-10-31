// A worked step: a message key under kitSignals.step, the values it names, and the math line it shows. Engines
// return steps; the tool shows them as a numbered list and can put them in the page.
import type { en } from '../../../../strings/en';

export type StepKey = keyof (typeof en)['kitSignals']['step'];

export interface Step {
  readonly key: StepKey;
  readonly vars?: Readonly<Record<string, string | number>>;
  /** The math under the words, as plain text a student can copy. */
  readonly math?: string;
}

export const step = (key: StepKey, math?: string, vars?: Record<string, string | number>): Step => ({
  key,
  ...(math === undefined ? {} : { math }),
  ...(vars ? { vars } : {}),
});
