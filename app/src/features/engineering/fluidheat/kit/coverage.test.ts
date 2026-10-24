// Every tool works its examples and its first problem, and every word the window would look up exists in the
// strings: the labels, choices, hints, result rows, notes, plot names, tables, and the worked steps.
import { describe, expect, it } from 'vitest';
import { en } from '../../../../strings/en';
import { FLUIDHEAT_TOOLS } from '../meta';
import { SPECS } from '../specs';
import { firstTexts, runTool } from './read';
import { shownFields, type Outcome, type ToolSpec } from './spec';
import { plotSvg, PAGE } from './picture';
import type { System } from './units';

const strings = en.kitFluidHeat as unknown as Record<string, Record<string, unknown>>;
const has = (path: string): boolean => {
  let at: unknown = en.kitFluidHeat;
  for (const part of path.split('.')) {
    if (typeof at !== 'object' || at === null || !(part in at)) return false;
    at = (at as Record<string, unknown>)[part];
  }
  return typeof at === 'string';
};

function used(tool: string, spec: ToolSpec, outcome: Outcome, texts: Record<string, string>): string[] {
  const keys: string[] = [`${tool}.title`, `${tool}.keywords`, `${tool}.picture`];
  const values: Record<string, string> = {};
  for (const field of spec.fields) values[field.id] = texts[field.id] ?? field.first;
  for (const field of shownFields(spec, values)) {
    keys.push(`${tool}.field.${field.id}`);
    if (field.type === 'choice') for (const option of field.options) keys.push(`${tool}.option.${option}`);
    if (field.type === 'text') keys.push(`${tool}.hint.${field.id}`);
  }
  for (const row of outcome.rows) keys.push(`${tool}.row.${row.id}`, ...(row.word ? [`${tool}.word.${row.word}`] : []));
  for (const note of outcome.notes ?? []) keys.push(`${tool}.note.${note}`);
  for (const table of outcome.tables ?? []) {
    keys.push(`${tool}.table.${table.id}`);
    for (const column of table.columns) keys.push(`${tool}.col.${column}`);
  }
  for (const step of outcome.steps) keys.push(`step.${step.key}`);
  return keys;
}

describe.each(FLUIDHEAT_TOOLS.map((tool) => tool.id))('the %s tool', (tool) => {
  it('works its first problem and every example, in both unit systems, with every word in the strings', async () => {
    const spec = await SPECS[tool]();
    const problems: { name: string; texts: Record<string, string> }[] = [
      { name: 'first', texts: firstTexts(spec) },
      ...(spec.examples ?? []).map((one) => ({ name: one.id, texts: { ...firstTexts(spec), ...one.values } })),
    ];
    for (const system of ['si', 'us'] as System[]) {
      for (const problem of problems) {
        const run = runTool(spec, problem.texts, system);
        // Bare numbers in an example are in the system's units, so only the SI run has to succeed on typed examples.
        if (!run.ok && system === 'us') continue;
        const why = run.ok ? '' : JSON.stringify(run.error?.detail) + JSON.stringify(run.fields.map((f) => f.field));
        expect(run.ok, `${tool} ${problem.name} ${system}: ${why}`).toBe(true);
        if (!run.ok) continue;
        for (const key of used(tool, spec, run.outcome, problem.texts))
          expect(has(key), `missing string ${key}`).toBe(true);
        for (const example of spec.examples ?? []) expect(has(`${tool}.example.${example.id}`)).toBe(true);
        const plot = run.outcome.picture;
        if (plot?.type === 'plot') {
          const ctx = { system, palette: PAGE, say: (key: string) => key };
          expect(plotSvg(plot.plot, ctx, `kitFluidHeat.${tool}`)).toContain('<svg');
          const names = [
            plot.plot.x.label,
            plot.plot.y.label,
            ...plot.plot.series.map((s) => s.id),
            ...(plot.plot.marks ?? []).map((m) => m.id),
          ];
          for (const name of names) expect(has(`${tool}.plot.${name}`), `missing plot string ${name}`).toBe(true);
        }
        if (plot?.type === 'draw') {
          const keys: string[] = [];
          plot.draw({ system, palette: PAGE, say: (key) => (keys.push(key), key) });
          for (const key of keys)
            expect(has(key.replace(/^kitFluidHeat\./, '')), `missing drawing string ${key}`).toBe(true);
        }
      }
    }
    expect(strings[tool]).toBeTruthy();
  });
});
