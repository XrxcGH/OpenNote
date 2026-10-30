// Checks a tool's modes for its tests: every mode solves with the numbers it starts with, in SI and in US units,
// and every message it says names a key that exists and gets a value for each of its placeholders.
import { kitPhysics } from '../../../../strings/en/kitPhysics';
import { currentInputs, solveMode } from './read';
import type { KitStep, Outcome, ToolSpec, UnitSystem } from './types';

function message(key: string): string | null {
  const parts = key.split('.');
  if (parts[0] !== 'kitPhysics') return null;
  const value = parts.slice(1).reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], kitPhysics);
  return typeof value === 'string' ? value : null;
}

function stepProblems(step: KitStep, where: string): string[] {
  const text = message(step.key);
  if (text === null) return [`${where}: no message ${step.key}`];
  const given = new Set([...Object.keys(step.vars ?? {}), ...Object.keys(step.labels ?? {})]);
  const problems = [...text.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .filter((name) => !given.has(name))
    .map((name) => `${where}: ${step.key} has no value for {${name}}`);
  for (const key of Object.values(step.labels ?? {}))
    if (message(key) === null) problems.push(`${where}: no label message ${key}`);
  return problems;
}

/** Problems with the outcome's messages. */
export function outcomeProblems(outcome: Outcome, where: string): string[] {
  if (!outcome.ok) return stepProblems(outcome.problem, `${where} (problem)`);
  const steps: KitStep[] = [
    ...outcome.steps,
    ...(outcome.notes ?? []),
    ...outcome.rows.flatMap((row) => [{ key: row.key }, ...(row.word ? [{ key: row.word }] : [])]),
    ...(outcome.plot?.legend ?? []).map((entry) => ({ key: entry.key })),
    ...(outcome.plot ? [outcome.plot.alt] : []),
    ...(outcome.source ? [{ key: outcome.source }] : []),
  ];
  return steps.flatMap((step, i) => stepProblems(step, `${where} #${i}`));
}

/** Every problem in a tool's spec, or none. */
export function specProblems(spec: ToolSpec): string[] {
  const problems: string[] = [];
  for (const mode of spec.modes) {
    if (message(mode.label) === null) problems.push(`${mode.id}: no label ${mode.label}`);
    for (const field of mode.fields) {
      if (message(field.label) === null) problems.push(`${mode.id}.${field.id}: no label ${field.label}`);
      for (const option of field.options ?? [])
        if (message(option.label) === null) problems.push(`${mode.id}.${field.id}: no option ${option.label}`);
    }
    for (const system of ['SI', 'US'] as UnitSystem[]) {
      const { inputs } = currentInputs(spec, { mode: mode.id, modes: {} });
      const outcome = solveMode(mode, inputs, system);
      const where = `${spec.id}.${mode.id} (${system})`;
      if (!outcome.ok) problems.push(`${where} does not solve: ${outcome.problem.key}`);
      problems.push(...outcomeProblems(outcome, where));
    }
  }
  return problems;
}
