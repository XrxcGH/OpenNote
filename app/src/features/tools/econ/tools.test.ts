import { describe, expect, it } from 'vitest';
import type { EconForm, Values } from './forms';
import { tx } from './forms';
import { ECON_TOOLS } from './tools';

function defaults(form: EconForm): Values {
  const first: Values = { text: {}, unit: {} };
  const fields = typeof form.fields === 'function' ? form.fields(first) : form.fields;
  return {
    text: Object.fromEntries(
      fields.map((f) => [f.id, f.initial ?? (f.kind === 'select' ? (f.options?.[0]?.value ?? '') : '')]),
    ),
    unit: {},
  };
}

describe('every economics calculator', () => {
  for (const tool of ECON_TOOLS) {
    it(`${tool.id} has words for its title and each calculator`, () => {
      expect(tx(`${tool.id}.title`).length).toBeGreaterThan(0);
      for (const form of tool.forms) {
        expect(tx(`${tool.id}.forms.${form.id}`).length).toBeGreaterThan(0);
        if (form.intro) expect(tx(`${tool.id}.intro.${form.id}`).length).toBeGreaterThan(0);
      }
    });
    for (const form of tool.forms) {
      it(`${tool.id}: ${form.id} answers from its starting values with words and steps`, () => {
        const out = form.solve(defaults(form));
        if (!out.ok) throw new Error(out.message);
        expect(out.headline.length).toBeGreaterThan(0);
        expect(out.headline).not.toMatch(/NaN|undefined|Infinity/);
        for (const step of out.steps) expect(step).not.toMatch(/NaN|undefined|\{[a-z]/i);
      });
    }
  }
});
