// Every reasoning tool's modes: each label, help line, and option has its string, each example works out, and every
// choice of each list gives an answer or a worded problem rather than an exception.
import { describe, expect, it } from 'vitest';
import { loadTool } from '../kit';
import { REASONING_TOOLS } from '../meta';
import { say } from './say';
import type { Field, Mode, Values } from './types';

const fieldsOf = (mode: Mode, values: Values): readonly Field[] =>
  typeof mode.fields === 'function' ? mode.fields(values) : mode.fields;

function defaults(mode: Mode, values: Values = {}): Record<string, string> {
  const out: Record<string, string> = { ...values };
  for (let pass = 0; pass < 3; pass += 1)
    for (const f of fieldsOf(mode, out))
      if (out[f.id] === undefined) out[f.id] = f.initial ?? (f.kind === 'select' ? (f.options?.[0] ?? '') : '');
  return out;
}

describe.each(REASONING_TOOLS)('the %s tool', (tool) => {
  it('has a tab, a command, and a summary', () => {
    for (const key of ['tab', 'open', 'keywords', 'summary']) expect(say(`tools.${tool}.${key}`)).toBeTruthy();
  });

  it('words every mode, field, help line, and option', async () => {
    const spec = await loadTool(tool);
    for (const mode of spec.modes) {
      expect(say(`${tool}.modes.${mode.id}.name`)).toBeTruthy();
      expect(say(`${tool}.modes.${mode.id}.intro`)).toBeTruthy();
      const base = defaults(mode);
      const variants = fieldsOf(mode, base).flatMap((f) =>
        f.kind === 'select' ? (f.options ?? []).map((o) => defaults(mode, { [f.id]: o })) : [],
      );
      for (const values of [base, ...variants])
        for (const f of fieldsOf(mode, values)) {
          expect(say(`${tool}.fields.${f.id}`)).toBeTruthy();
          if (f.help) expect(say(`${tool}.help.${f.id}`)).toBeTruthy();
          for (const o of f.options ?? []) expect(say(`${tool}.options.${f.id}.${o}`)).toBeTruthy();
        }
    }
  });

  it('works out each example, and answers or explains for every choice', async () => {
    const spec = await loadTool(tool);
    for (const mode of spec.modes) {
      const base = defaults(mode);
      const outcome = mode.solve(base);
      expect(outcome.ok ? 'ok' : outcome.message, `${tool}.${mode.id}`).toBe('ok');
      for (const f of fieldsOf(mode, base))
        for (const o of f.kind === 'select' ? (f.options ?? []) : []) {
          const other = mode.solve(defaults(mode, { [f.id]: o }));
          expect(other.ok || other.message.length > 0, `${tool}.${mode.id} ${f.id}=${o}`).toBe(true);
        }
      const empty = mode.solve(Object.fromEntries(Object.keys(base).map((k) => [k, ''])));
      expect(empty.ok || empty.message.length > 0, `${tool}.${mode.id} empty`).toBe(true);
    }
  });
});
