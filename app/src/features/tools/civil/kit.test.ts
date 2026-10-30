// Every calculation of the kit runs from its first values, and every key it shows has words with the values they
// need. This catches a missing string or a calculation that fails on its own example.
import { describe, expect, it } from 'vitest';
import { en } from '../../../strings/en';
import { CivilError } from './core/types';
import type { Calc, Msg, Outcome } from './core/types';
import { CIVIL_KIT } from './kit';
import { CIVIL_TOOL_IDS } from './meta';
import { fieldsOf, initialState, parseFields } from './ui/parse';

function text(key: string): string {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en.kitCivil);
  if (typeof value !== 'string') throw new Error(`No kitCivil message "${key}"`);
  return value;
}

function checkMsg(msg: Msg): void {
  const message = text(msg.key);
  for (const [, name] of message.matchAll(/\{(\w+)\}/g))
    expect(msg.vars, `${msg.key} needs {${name}}`).toHaveProperty(name!);
  for (const value of Object.values(msg.vars ?? {}))
    if (typeof value === 'string' && value.startsWith('~')) text(value.slice(1));
}

function checkOutcome(outcome: Outcome): void {
  checkMsg(outcome.answer);
  outcome.steps.forEach(checkMsg);
  outcome.notes?.forEach(checkMsg);
  outcome.rows.forEach((row) => {
    text(row.label);
    if (typeof row.value === 'number') expect(Number.isFinite(row.value), row.label).toBe(true);
    else if (row.value.startsWith('~')) text(row.value.slice(1));
  });
  if (outcome.plot) {
    [outcome.plot.title, outcome.plot.x, outcome.plot.y, ...outcome.plot.series.map((s) => s.name)].forEach(text);
    for (const series of outcome.plot.series) expect(series.points.length, series.name).toBeGreaterThan(0);
  }
  if (outcome.grid) [outcome.grid.caption, ...outcome.grid.header].forEach(text);
  if (outcome.source) text(outcome.source);
}

function checkCalc(calc: Calc, choices: Readonly<Record<string, string>> = {}): void {
  text(calc.title);
  if (calc.intro) text(calc.intro);
  const first = initialState(calc);
  const state = { text: { ...first.text, ...choices }, unit: { ...first.unit } as Record<string, string> };
  const fields = fieldsOf(calc, state);
  const late = initialState({ ...calc, fields: fields });
  for (const [id, value] of Object.entries(late.text)) if (!(id in state.text)) state.text[id] = value;
  for (const [id, value] of Object.entries(late.unit)) if (!(id in state.unit)) state.unit[id] = value;
  for (const field of fields) {
    text(field.label);
    if (field.help) text(field.help);
    if (field.kind === 'select') field.options.forEach((option) => text(option.label));
    if (field.kind === 'table') field.columns.forEach((column) => text(column.label));
  }
  const parsed = parseFields(fields, state);
  expect(parsed.ok, `${calc.id} reads its first values ${JSON.stringify(choices)}`).toBe(true);
  if (!parsed.ok) return;
  let outcome: Outcome;
  try {
    outcome = calc.solve(parsed.input);
  } catch (error) {
    throw new Error(
      `${calc.id} ${JSON.stringify(choices)} fails on its first values: ${error instanceof CivilError ? error.key : String(error)}`,
      {
        cause: error,
      },
    );
  }
  checkOutcome(outcome);
}

describe('civil engineering kit', () => {
  it.each(CIVIL_TOOL_IDS)(
    'runs every %s calculation from its first values',
    async (tool) => {
      expect(text(`tools.${tool}.title`)).not.toBe('');
      text(`tools.${tool}.open`);
      const calcs = await CIVIL_KIT[tool]();
      expect(new Set(calcs.map((calc) => calc.id)).size).toBe(calcs.length);
      for (const calc of calcs) {
        checkCalc(calc);
        // Every choice of every list, one at a time, so the words of each mode are checked too.
        for (const field of fieldsOf(calc, initialState(calc)))
          if (field.kind === 'select')
            for (const option of field.options) checkCalc(calc, { [field.id]: option.value });
      }
      // The first tool also pays for loading the kit's modules, which can take longer than the default on a busy runner.
    },
    30_000,
  );

  it('words every error key the core can raise', () => {
    for (const key of Object.keys(en.kitCivil.errors)) text(`errors.${key}`);
  });
});
