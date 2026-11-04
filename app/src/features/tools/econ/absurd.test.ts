// Absurd inputs to every economics and finance form: each number field in turn is set to 1e-12, 1e12, 0, and -5.
// The answer is a finite one or a named problem, never "Infinity" or "NaN" printed as a result.
// An array sized by the input (a bond of 1e12 years) is not a crash.
import './text';
import { describe, expect, it } from 'vitest';
import { printsNonFinite } from '../../../core/finite';
import { guardedSolve } from '../ui/ChemForm';
import type { EconForm, Values } from './forms';
import { ECON_TOOLS } from './tools';

const ABSURD = ['1e-12', '1e12', '0', '-5'];

/** The first text of every field of a form. */
function firstTexts(form: EconForm): { fields: ReturnType<typeof fieldsOf>; text: Record<string, string> } {
  const fields = fieldsOf(form);
  const text = Object.fromEntries(
    fields.map((f) => [f.id, f.initial ?? (f.kind === 'select' ? (f.options?.[0]?.value ?? '') : '')]),
  );
  return { fields, text };
}

function fieldsOf(form: EconForm) {
  return typeof form.fields === 'function' ? form.fields({ text: {}, unit: {} }) : form.fields;
}

/** The lines an answer shows, or its problem. */
function linesOf(form: EconForm, values: Values): string[] {
  const outcome = guardedSolve(form.solve, values);
  return outcome.ok ? [outcome.headline, ...outcome.steps] : [outcome.message];
}

/** Every line any absurd value of any number field gives the form, with where it came from. */
function absurdLines(form: EconForm): { where: string; line: string }[] {
  const { fields, text } = firstTexts(form);
  const numbers = fields.filter((f) => f.kind !== 'select' && f.kind !== 'text');
  return numbers.flatMap((field) =>
    ABSURD.flatMap((absurd) =>
      linesOf(form, { text: { ...text, [field.id]: absurd }, unit: {} }).map((line) => ({
        where: `${form.id} ${field.id}=${absurd}`,
        line,
      })),
    ),
  );
}

describe('absurd inputs in the economics window', () => {
  it.each(ECON_TOOLS.map((tool) => tool.id))('%s never prints NaN or Infinity as an answer', (id) => {
    const tool = ECON_TOOLS.find((one) => one.id === id)!;
    for (const form of tool.forms) {
      for (const { where, line } of absurdLines(form)) {
        expect(printsNonFinite(line), `${where}: ${line}`).toBe(false);
      }
    }
  });

  it('names the problem for a result that overflows', () => {
    const money = ECON_TOOLS.find((tool) => tool.id === 'money')!;
    const single = money.forms.find((form) => form.id === 'single')!;
    // FV = PV (1 + r)^n with 10% a period for 1e12 periods overflows a double.
    const values: Values = { text: { pv: '100', rate: '10', n: '1e12', fv: '' }, unit: {} };
    const outcome = guardedSolve(single.solve, values);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toMatch(/too large or too small/);
  });
});
