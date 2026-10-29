// Every calculation of every life science tool answers with the values its form starts with, under every choice of
// its first select field, and every word in the answer resolves to a string with its placeholders filled.
import { describe, expect, it } from 'vitest';
import { KIT_LOADERS } from './kit';
import type { CalcResult, CalcSpec, FieldSpec } from './types';
import { initialValues, makeReader } from './ui/reader';
import { word } from './ui/words';

const fieldsFor = (spec: CalcSpec, text: Record<string, string>): readonly FieldSpec[] =>
  typeof spec.fields === 'function' ? spec.fields((id) => text[id] ?? '') : spec.fields;

function allWords(result: CalcResult): string[] {
  const out: string[] = [];
  for (const row of result.rows) {
    out.push(word(row.label, row.vars));
    if (row.word) out.push(word(row.word, row.wordVars));
  }
  for (const step of [...result.steps, ...(result.notes ?? [])]) out.push(word(step.key, step.vars));
  for (const plot of result.plots ?? []) {
    out.push(word(plot.title, plot.vars), word(plot.x.label, plot.x.vars), word(plot.y.label, plot.y.vars));
    for (const s of plot.series) out.push(word(s.name, s.vars));
  }
  for (const h of result.table?.header ?? []) out.push(word(h.key, h.vars));
  for (const row of result.table?.rows ?? [])
    for (const cell of row) if (typeof cell === 'object') out.push(word(cell.key, cell.vars));
  if (result.source) out.push(word(result.source));
  return out;
}

describe.each(Object.keys(KIT_LOADERS) as (keyof typeof KIT_LOADERS)[])('the %s tool', (id) => {
  it('answers every calculation from its starting values', async () => {
    const tool = await KIT_LOADERS[id]();
    for (const spec of tool.calcs) {
      const first = fieldsFor(spec, {});
      const select = first.find((f) => f.kind === 'select');
      for (const option of select?.options ?? [{ value: '' }]) {
        const start = initialValues(first);
        if (select) start.text[select.id] = option.value;
        const fields = fieldsFor(spec, start.text);
        const values = initialValues(fields);
        if (select) values.text[select.id] = option.value;
        let result: CalcResult;
        try {
          result = spec.solve(makeReader(fields, values));
        } catch (e) {
          throw new Error(`${id}/${spec.id}/${option.value}: ${(e as Error).message}`, { cause: e });
        }
        expect(result.rows.length, `${id}/${spec.id}`).toBeGreaterThan(0);
        for (const text of allWords(result)) expect(text, `${id}/${spec.id}`).not.toMatch(/\{\w+\}/);
        for (const plot of result.plots ?? [])
          for (const s of plot.series)
            for (const [x, y] of s.points) expect(Number.isNaN(x) || Number.isNaN(y)).toBe(false);
        word(spec.label);
      }
    }
  }, 60_000);
});
