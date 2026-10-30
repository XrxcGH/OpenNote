// Helpers for the spec tests: solve a form from typed texts, and read a row's number from the outcome.
import { firstTexts, runTool } from './read';
import type { Outcome, ToolSpec } from './spec';
import type { System } from './units';

/** A solver for one tool: the typed texts on top of the tool's first values, run in the given system. */
export function solver(spec: ToolSpec) {
  return (texts: Record<string, string> = {}, system: System = 'si'): Outcome => {
    const run = runTool(spec, { ...firstTexts(spec), ...texts }, system);
    if (!run.ok)
      throw new Error(
        run.error ? `${run.error.code}: ${run.error.detail}` : `fields ${run.fields.map((f) => f.field)}`,
      );
    return run.outcome;
  };
}

/** Whether the form refuses these texts. */
export function refuses(spec: ToolSpec, texts: Record<string, string>, system: System = 'si'): boolean {
  return !runTool(spec, { ...firstTexts(spec), ...texts }, system).ok;
}

/** The message the form gives for these texts, or '' when it works. */
export function refusal(spec: ToolSpec, texts: Record<string, string>): string {
  const run = runTool(spec, { ...firstTexts(spec), ...texts }, 'si');
  if (run.ok) return '';
  return run.error ? run.error.detail : `fields ${run.fields.map((f) => f.field)}`;
}

/** A row's number (base SI), whether it is a plain number or a quantity. */
export function row(outcome: Outcome, id: string): number {
  const value = outcome.rows.find((r) => r.id === id)?.value;
  if (value === undefined) throw new Error(`no row ${id}`);
  return typeof value === 'object' ? value.v : (value as number);
}
