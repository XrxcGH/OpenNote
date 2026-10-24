// Words for the kits' shared parts, from keys built at run time (a step's key, an error's code). Every such key must
// exist in strings/en, in the kits namespace or the namespace of the kit that built it.
import { t } from '../../../../strings/t';
import { NumError } from '../num/errors';
import { KitProblem } from '../problem';
import type { KitStep } from '../types';

export { KitProblem } from '../problem';

/** t for keys built at run time. */
export const say = t as unknown as (key: string, params?: Readonly<Record<string, string | number>>) => string;

/** The words of one step. */
export const stepWords = (step: KitStep): string => say(step.key, step.vars);

/** The steps as numbered plain lines, with each step's math on the line after it, for the page and the clipboard. */
export function stepsText(steps: readonly KitStep[], title = say('kits.steps.title')): string {
  const lines = steps.map((step, i) => `${i + 1}. ${stepWords(step)}${step.math ? `\n    ${step.math}` : ''}`);
  return [title, ...lines].join('\n');
}

/** What went wrong, in words: a NumError's code, a tool's own message key, or the general words. */
export function problemWords(error: unknown): string {
  if (error instanceof NumError) return say(`kits.error.${error.code}`);
  if (error instanceof KitProblem) return say(error.key, error.vars);
  return say('kits.error.unknown');
}
