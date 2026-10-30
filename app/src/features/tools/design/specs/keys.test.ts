// Every word a spec asks for exists in the strings: fields, choices, rows, tables, notes, plots, steps, and errors.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '../../../../strings/en';
import { firstTexts, firstUnits, readFields } from '../kit/read';
import { SPECS } from './index';
import { DESIGN_TOOL_IDS } from '../meta';
import type { Outcome, ToolSpec } from '../kit/spec';

const words = en.kitDesign as unknown as Record<string, unknown>;
const at = (path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], words);
const has = (path: string) => typeof at(path) === 'string';

function outcomeKeys(tool: string, o: Outcome): string[] {
  const keys: string[] = [];
  for (const r of o.rows) {
    keys.push(`${tool}.row.${r.id}`);
    if (r.word) keys.push(`${tool}.word.${r.word}`);
  }
  for (const s of o.steps) keys.push(`step.${s.key}`);
  for (const tb of o.tables ?? []) {
    keys.push(`${tool}.table.${tb.id}`);
    for (const c of tb.columns) keys.push(`${tool}.col.${c}`);
  }
  for (const n of o.notes ?? []) keys.push(`${tool}.note.${n}`);
  if (o.plot) keys.push(`${tool}.plot.${o.plot.id}.x`, `${tool}.plot.${o.plot.id}.y`, `${tool}.plot.${o.plot.id}.alt`);
  return keys;
}

function runs(spec: ToolSpec): Record<string, string>[] {
  const base = firstTexts(spec);
  const all: Record<string, string>[] = [base];
  for (const ex of spec.examples ?? []) all.push({ ...base, ...ex.values });
  for (const f of spec.fields) if (f.type === 'choice') for (const o of f.options) all.push({ ...base, [f.id]: o });
  return all;
}

describe('the design kit strings', () => {
  it('lists every tool in meta with a spec or a window of its own', () => {
    for (const id of DESIGN_TOOL_IDS) {
      expect(has(`${id}.title`), id).toBe(true);
      expect(has(`${id}.keywords`), id).toBe(true);
    }
  });
  for (const [tool, load] of Object.entries(SPECS)) {
    it(`${tool} has every word its fields, results and errors need`, async () => {
      const spec = await load();
      const missing = new Set<string>();
      const need = (key: string) => {
        if (!has(key)) missing.add(key);
      };
      need(`${tool}.about`);
      for (const f of spec.fields) {
        need(`${tool}.field.${f.id}`);
        if (f.type === 'choice') f.options.forEach((o) => need(`${tool}.option.${o}`));
        if (f.type === 'text') need(`${tool}.hint.${f.id}`);
      }
      for (const ex of spec.examples ?? []) need(`${tool}.example.${ex.id}`);
      for (const texts of runs(spec)) {
        const read = readFields(spec, texts, firstUnits(spec, 'si'));
        expect(read.ok, JSON.stringify(texts)).toBe(true);
        const result = spec.run(read.values);
        if (result.ok) outcomeKeys(tool, result.outcome).forEach(need);
        else need(`error.${result.problem}`);
      }
      expect([...missing]).toEqual([]);
    });
  }
});

describe('the command palette', () => {
  it('has a command for every tool in the window, and no other', () => {
    const file = join(import.meta.dirname, '../../../page/registrations/kitDesign.ts');
    const source = readFileSync(file, 'utf8');
    const block = /const TOOLS = \[([\s\S]*?)\n\] as const;/.exec(source)?.[1] ?? '';
    const ids = [...block.matchAll(/\['(\w+)',/g)].map((m) => m[1]);
    expect(ids.sort()).toEqual([...DESIGN_TOOL_IDS].sort());
  });
});
