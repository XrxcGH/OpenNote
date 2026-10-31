// Check my work: step-by-step checking of worked math. Pure TypeScript with no screen and no network, so the page,
// tests, and the AI tutor share it. This file is the one public door; the API below stays stable.
//
//   checkSteps(lines, options) -> StepResult[]   one result per line: verdict, reason code, params, suggestion,
//                                                 method, and confidence
//   summarize(results)                            counts for a summary line
//   latexToLine(latex)                            LaTeX as the plain line text the checker reads
//
// Reasons are codes; strings/en/stepCheck.ts has the sentences (stepCheck.reasons.<code>).
import type { StepResult } from './types';

export { checkSteps } from './check';
export { latexToLine } from './latex';
export type { CheckOptions, Method, ReasonCode, StepLine, StepResult, Verdict } from './types';

export interface Summary {
  /** Steps checked as right (not counting the first line, definitions, and notes). */
  ok: number;
  broken: number;
  unchecked: number;
  /** The index of the first broken step, or null. */
  firstBroken: number | null;
}

/** Counts for a summary such as "4 steps follow, 1 needs a look". */
export function summarize(results: readonly StepResult[]): Summary {
  const steps = results.filter((r) => r.method !== 'given');
  const first = results.find((r) => r.verdict === 'broken');
  return {
    ok: steps.filter((r) => r.verdict === 'ok').length,
    broken: steps.filter((r) => r.verdict === 'broken').length,
    unchecked: steps.filter((r) => r.verdict === 'unchecked').length,
    firstBroken: first ? first.index : null,
  };
}
