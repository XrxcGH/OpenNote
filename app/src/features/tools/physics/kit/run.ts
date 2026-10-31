// Runs one calculation of a tool from typed text, as the window would, for the tools' tests: the fields not named
// keep their starting text, and units not named are the unit system's defaults.
import { currentInputs, solveMode } from './read';
import type { Outcome, ResultRow, ToolSpec, UnitSystem } from './types';

export function runMode(
  spec: ToolSpec,
  mode: string,
  text: Record<string, string> = {},
  options: { unit?: Record<string, string>; system?: UnitSystem } = {},
): Outcome {
  const { mode: def, inputs } = currentInputs(spec, { mode, modes: { [mode]: { text, unit: options.unit ?? {} } } });
  if (def.id !== mode) throw new Error(`No mode ${mode}`);
  return solveMode(def, inputs, options.system ?? 'SI');
}

/** The SI value of the result with this message key and symbol (or the first with the key). */
export function value(outcome: Outcome, key: string, symbol?: string): number {
  if (!outcome.ok) throw new Error(`Did not solve: ${outcome.problem.key}`);
  const row = outcome.rows.find((one: ResultRow) => one.key === key && (symbol === undefined || one.symbol === symbol));
  if (!row || typeof row.value !== 'number') throw new Error(`No result ${key} ${symbol ?? ''}`);
  return row.value;
}

/** The message key of the problem, or null when it solved. */
export const problem = (outcome: Outcome): string | null => (outcome.ok ? null : outcome.problem.key);
