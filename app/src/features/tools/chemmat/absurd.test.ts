// Every tool of the chemistry and materials kit with each number field in turn set to an absurd value (1e-12, 1e12,
// 0, a negative number): the answer holds only finite numbers (an equilibrium constant of Infinity is not an answer),
// or the tool names the problem. A RangeError or any other slip is not a crash.
import './text';
import { describe, expect, it } from 'vitest';
import { hasNonFinite } from '../../../core/finite';
import { buildInput } from './input';
import { solveChecked } from './solve';
import { CHEMMAT_TOOLS } from './tools';

const ABSURD = ['1e-12', '1e12', '0', '-5'];

describe('absurd inputs in the chemistry and materials window', () => {
  for (const spec of CHEMMAT_TOOLS) {
    it(`${spec.id} never gives NaN or Infinity as an answer`, () => {
      const first = Object.fromEntries(spec.fields.map((field) => [field.id, field.initial]));
      for (const field of spec.fields) {
        if (field.kind !== 'number') continue;
        for (const absurd of ABSURD) {
          const built = buildInput(spec, { ...first, [field.id]: absurd }, {});
          if (!built.ok) continue;
          const outcome = solveChecked(spec, built.input);
          const where = `${spec.id}.${field.id}=${absurd}`;
          if (outcome.ok) expect(hasNonFinite([outcome.rows, outcome.plot?.series]), where).toBe(false);
        }
      }
    });
  }

  it('says out of range for the equilibrium constant that overflows', () => {
    const thermo = CHEMMAT_TOOLS.find((spec) => spec.id === 'thermochem')!;
    const values = Object.fromEntries(thermo.fields.map((field) => [field.id, field.initial]));
    const kinds: string[] = [];
    for (const field of thermo.fields) {
      if (field.kind !== 'number') continue;
      for (const absurd of ABSURD) {
        const built = buildInput(thermo, { ...values, [field.id]: absurd }, {});
        if (built.ok) {
          const outcome = solveChecked(thermo, built.input);
          if (!outcome.ok) kinds.push(outcome.key);
        }
      }
    }
    expect(kinds).toContain('kitChemMat.err.outOfRange');
  });
});
