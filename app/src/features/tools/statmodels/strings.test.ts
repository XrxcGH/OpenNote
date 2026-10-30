// Every key the kit builds at run time exists in strings/en/kitStatModels.ts: each tool's fields, choices and
// examples, and, for its first problem and each example, every result row, table, column, note, plot label,
// picture, step, and paragraph in words. Each first problem and example must also work out without an error.
import { describe, expect, it } from 'vitest';
import { en } from '../../../strings/en';
import { firstTexts, runTool } from './kit/read';
import type { Outcome, ToolSpec } from './kit/spec';
import { STATMODELS_TOOLS } from './meta';
import { SPECS } from './specs';

const has = (key: string): boolean => {
  let node: unknown = en;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string';
};

function outcomeKeys(tool: string, outcome: Outcome): string[] {
  const base = `kitStatModels.${tool}`;
  const keys = outcome.rows.map((row) => `${base}.row.${row.id}`);
  for (const row of outcome.rows) if (row.word !== undefined) keys.push(`${base}.word.${row.word}`);
  for (const table of outcome.tables ?? []) {
    const named = table.columns.filter((c) => !c.startsWith('='));
    keys.push(`${base}.table.${table.id}`, ...named.map((c) => `${base}.col.${c}`));
  }
  for (const note of outcome.notes ?? []) keys.push(`${base}.note.${note}`);
  for (const picture of outcome.pictures ?? []) {
    keys.push(`${base}.picture.${picture.id}`);
    if (picture.type !== 'plot') continue;
    const plot = picture.plot;
    keys.push(`${base}.plot.${plot.x.label}`, `${base}.plot.${plot.y.label}`);
    for (const s of plot.series) if (s.name === undefined) keys.push(`${base}.plot.${s.id}`);
  }
  for (const one of [...outcome.steps, ...(outcome.words ? [outcome.words] : [])])
    keys.push(`kitStatModels.step.${one.key}`);
  return keys;
}

function specKeys(tool: string, spec: ToolSpec): string[] {
  const base = `kitStatModels.${tool}`;
  const keys = [`${base}.title`, `${base}.keywords`];
  for (const field of spec.fields) {
    keys.push(`${base}.field.${field.id}`);
    if (field.type === 'choice') keys.push(...field.options.map((o) => `${base}.option.${o}`));
    if (field.type === 'text') keys.push(`${base}.hint.${field.id}`);
  }
  for (const example of spec.examples ?? []) keys.push(`${base}.example.${example.id}`);
  return keys;
}

describe('the statistical models kit strings', () => {
  for (const tool of STATMODELS_TOOLS) {
    it(`has every word the ${tool.id} tool shows, and works its examples`, async () => {
      const spec = await SPECS[tool.id]();
      const missing = specKeys(tool.id, spec).filter((key) => !has(key));
      const cases = [firstTexts(spec), ...(spec.examples ?? []).map((e) => ({ ...firstTexts(spec), ...e.values }))];
      for (const texts of cases) {
        const run = runTool(spec, texts);
        expect(
          run.ok ? '' : `${run.error?.code ?? ''} ${run.fields.map((f) => `${f.field}:${f.error.code}`).join(' ')}`,
        ).toBe('');
        if (run.ok) missing.push(...outcomeKeys(tool.id, run.outcome).filter((key) => !has(key)));
      }
      expect([...new Set(missing)]).toEqual([]);
      // The machine learning examples train a small network, which takes seconds on a busy machine.
    }, 30_000);
  }
});
