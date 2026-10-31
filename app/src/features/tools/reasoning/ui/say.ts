// The reasoning kit's strings by path: engines name a step or an error by key, and the window words it here.
import '../text';
import { t } from '../../../../strings/t';
import type { MessageKey } from '../../../../strings/t';
import type { Step } from '../core/step';
import { KitError } from '../core/util';
import type { Outcome } from './types';

type Vars = Readonly<Record<string, string | number>>;

const lookup = t as unknown as (key: MessageKey, values?: Vars) => string;

/** The kit string at `path`, under kitReasoning. */
export const say = (path: string, vars?: Vars): string => lookup(`kitReasoning.${path}` as MessageKey, vars);

/** Each step in words: a tool's steps.<key> string with its values. */
export const sayStep = (tool: string, s: Step): string => say(`${tool}.steps.${s.key}`, s.vars);

export const saySteps = (tool: string, steps: readonly Step[]): string[] => steps.map((s) => sayStep(tool, s));

/** Runs a solver, and words an engine error as the tool's errors.<key> string. */
export function attempt(tool: string, run: () => Outcome): Outcome {
  try {
    return run();
  } catch (error) {
    if (error instanceof KitError) return { ok: false, message: say(`${tool}.errors.${error.key}`, error.vars) };
    throw error;
  }
}

export const bad = (tool: string, key: string, vars?: Vars): Outcome => ({
  ok: false,
  message: say(`${tool}.errors.${key}`, vars),
});
