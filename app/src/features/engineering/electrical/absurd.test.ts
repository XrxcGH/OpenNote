// Every tool of the circuits and energy kit, in every choice of each list, with each number field in turn set to an
// absurd value (1e-12, 1e12, 0, a negative number): the answer never prints NaN or Infinity as a number. The tool says
// the input is out of range, or names the field, or answers.
import './text';
import { describe, expect, it } from 'vitest';
import { printsNonFinite } from '../../../core/finite';
import { LOADERS } from './kit';
import { ELECTRICAL_TOOLS } from './meta';
import { initialValues, runTool } from './spec';
import type { ToolSpec } from './spec';

const ABSURD = ['1e-12', '1e12', '0', '-5'];

/** The starting values, and each starting value with one list set to each of its other choices. */
function bases(spec: ToolSpec): Record<string, string>[] {
  const first = initialValues(spec);
  const out = [first];
  for (const field of spec.fields) {
    if (field.kind !== 'select') continue;
    for (const option of field.options ?? []) out.push({ ...first, [field.id]: option.value });
  }
  return out;
}

describe('absurd inputs in the circuits and energy window', () => {
  it.each(ELECTRICAL_TOOLS.map((tool) => tool.id))('%s never prints NaN or Infinity as an answer', async (id) => {
    const { spec } = await LOADERS[id]();
    for (const base of bases(spec)) {
      for (const field of spec.fields) {
        if (field.kind === 'select' || field.kind === 'area') continue;
        for (const absurd of ABSURD) {
          const result = runTool(spec, { ...base, [field.id]: absurd });
          if (!result.ok) continue;
          for (const line of [result.answer, ...result.rows.map((row) => row.value)]) {
            expect(printsNonFinite(line), `${id}.${field.id}=${absurd}: ${line}`).toBe(false);
          }
        }
      }
    }
  });
});
