// Every key the kit window builds at run time must have words in strings/en/kitMind, and every placeholder in
// those words must get a value. This runs each tool on its first texts and on each example, and checks them all.
import { describe, expect, it } from 'vitest';
import { en } from '../../../../strings/en';
import { kitMindWords } from '../../../../strings/en/kitMind/words';
import { formatMessage } from '../../../../strings/t';
import { MIND_TOOLS } from '../meta';
import { SPECS } from '../specs';
import { wordVars } from './format';
import { firstTexts, runTool, type Outcome } from './spec';
import type { Vars } from './types';

const at = (root: unknown, parts: readonly string[]): unknown =>
  parts.reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], root);

/** The words at a key: the start-up strings, else the tools' words that load with the window. */
const words = (key: string): string | undefined => {
  const parts = key.split('.');
  const value = at(en, parts) ?? (parts[0] === 'kitMind' ? at(kitMindWords, parts.slice(1)) : undefined);
  return typeof value === 'string' ? value : undefined;
};

function check(key: string, vars?: Vars): string[] {
  const text = words(key);
  if (text === undefined) return [`missing ${key}`];
  const out = formatMessage(text, wordVars(vars));
  return out.includes('undefined') ? [`${key} lacks a value: ${out}`] : [];
}

function outcomeKeys(tool: string, outcome: Outcome): string[] {
  const k = (rest: string) => `kitMind.${tool}.${rest}`;
  const problems: string[] = [];
  for (const row of outcome.rows) problems.push(...check(k(`row.${row.id}`), row.vars));
  for (const note of outcome.notes ?? []) problems.push(...check(k(`note.${note.id}`), note.vars));
  for (const one of outcome.steps) {
    const at = one.key.indexOf('.');
    problems.push(...check(`kitMind.${one.key.slice(0, at)}.step.${one.key.slice(at + 1)}`, one.vars));
  }
  for (const table of outcome.tables ?? []) {
    problems.push(...check(k(`table.${table.id}`)));
    for (const column of table.columns) if (typeof column === 'string') problems.push(...check(k(`col.${column}`)));
    for (const row of table.rows)
      for (const cell of row) if (typeof cell === 'object') problems.push(...check(k(`word.${cell.word}`)));
  }
  for (const picture of outcome.pictures ?? []) {
    problems.push(...check(k(`picture.${picture.id}`)));
    const plot = picture.plot;
    if (!plot) continue;
    problems.push(...check(k(`plot.${plot.x.id}`)), ...check(k(`plot.${plot.y.id}`)));
    for (const series of plot.series)
      if (series.label === undefined && series.id) problems.push(...check(k(`plot.${series.id}`), series.vars));
  }
  return problems;
}

describe('kit strings', () => {
  it('has words for every key each tool builds', async () => {
    const problems: string[] = [];
    for (const meta of MIND_TOOLS) {
      const spec = await SPECS[meta.id]();
      problems.push(...check(meta.title), ...check(meta.keywords));
      for (const field of spec.fields) {
        problems.push(...check(`kitMind.${meta.id}.field.${field.id}`));
        if (field.type === 'choice')
          for (const option of field.options) problems.push(...check(`kitMind.${meta.id}.option.${option}`));
      }
      const runs = [firstTexts(spec), ...(spec.examples ?? []).map((one) => ({ ...firstTexts(spec), ...one.values }))];
      for (const example of spec.examples ?? []) problems.push(...check(`kitMind.${meta.id}.example.${example.id}`));
      for (const texts of runs) {
        const run = runTool(spec, texts);
        if (!run.ok)
          problems.push(
            `${meta.id} fails on ${JSON.stringify(texts)}: ${run.error?.code ?? [...run.problems.keys()].join()}`,
          );
        else problems.push(...outcomeKeys(meta.id, run.outcome));
      }
    }
    expect(problems).toEqual([]);
  });

  it('has a spec for every tool in the list', () => {
    expect(Object.keys(SPECS).sort()).toEqual(MIND_TOOLS.map((tool) => tool.id).sort());
  });
});
