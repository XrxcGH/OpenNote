// Every tool of the kit solves from its own starting values, every message it can show exists in the strings with all
// the variables it needs, and the meta list (read at start-up) matches the tools.
import { describe, expect, it } from 'vitest';
import { en } from '../../../strings/en';
import { buildInput } from './input';
import { CHEMMAT_META } from './meta';
import type { Outcome } from './types';
import { CHEMMAT_TOOLS } from './tools';

function message(key: string): string | undefined {
  let at: unknown = en;
  for (const part of key.split('.')) {
    if (typeof at !== 'object' || at === null) return undefined;
    at = (at as Record<string, unknown>)[part];
  }
  return typeof at === 'string' ? at : undefined;
}

function check(key: string, vars: Record<string, string> | undefined, where: string) {
  const text = message(key);
  expect(text, `${where}: missing message ${key}`).toBeTypeOf('string');
  for (const m of text!.matchAll(/\{(\w+)\}/g)) {
    expect(vars && m[1] in vars, `${where}: ${key} needs {${m[1]}}`).toBe(true);
  }
}

export function keysOf(outcome: Outcome, where: string) {
  if (!outcome.ok) return check(outcome.key, outcome.vars, where);
  for (const r of outcome.rows) {
    check(r.key, r.keyVars, where);
    if (r.word) check(r.word, r.wordVars, where);
  }
  for (const s of outcome.steps) check(s.key, s.vars, where);
  for (const n of outcome.notes) check(n.key, n.vars, where);
  for (const tb of outcome.tables ?? []) {
    check(tb.title, undefined, where);
    for (const h of tb.header) if (h.startsWith('kitChemMat.')) check(h, undefined, where);
    for (const row of tb.rows) for (const c of row) if (c.startsWith('kitChemMat.')) check(c, undefined, where);
  }
  if (outcome.plot) {
    check(outcome.plot.xLabel, undefined, where);
    check(outcome.plot.yLabel, undefined, where);
    check(outcome.plot.alt, undefined, where);
    for (const s of outcome.plot.series) check(s.label, s.labelVars, where);
  }
}

describe('the kit', () => {
  it('lists the same tools in the palette list and in the window', () => {
    expect(CHEMMAT_TOOLS.map((t) => t.id)).toEqual(CHEMMAT_META.map((m) => m.id));
    for (const m of CHEMMAT_META) {
      const spec = CHEMMAT_TOOLS.find((t) => t.id === m.id)!;
      expect(spec.title).toBe(m.title);
      check(m.title, undefined, m.id);
      check(m.open, undefined, m.id);
      check(m.keywords, undefined, m.id);
    }
  });

  for (const spec of CHEMMAT_TOOLS) {
    it(`${spec.id} solves from its starting values and every message exists`, () => {
      check(spec.intro, undefined, spec.id);
      for (const f of spec.fields) {
        check(f.label, undefined, `${spec.id}.${f.id}`);
        if (f.help) check(f.help, undefined, `${spec.id}.${f.id}`);
        for (const c of f.choices ?? []) check(c.label, undefined, `${spec.id}.${f.id}`);
      }
      const values = Object.fromEntries(spec.fields.map((f) => [f.id, f.initial]));
      const built = buildInput(spec, values, {});
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      const outcome = spec.solve(built.input);
      expect(outcome.ok, spec.id).toBe(true);
      keysOf(outcome, spec.id);
    });

    // Each choice of every choice field must also solve, so no mode is left broken.
    for (const f of spec.fields.filter((x) => x.kind === 'choice')) {
      for (const c of f.choices ?? []) {
        it(`${spec.id} with ${f.id} = ${c.value} reaches its messages`, () => {
          const values = Object.fromEntries(spec.fields.map((x) => [x.id, x.initial]));
          values[f.id] = c.value;
          const built = buildInput(spec, values, {});
          if (!built.ok) return;
          keysOf(spec.solve(built.input), `${spec.id}/${c.value}`);
        });
      }
    }
  }
});
