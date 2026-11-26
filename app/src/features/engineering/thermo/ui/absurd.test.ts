// Every thermodynamics tool, with each number field in turn set to an absurd value (1e-12, 1e12, 0, a negative number):
// a result is shown only when everything in it is finite. Otherwise the tool says so (a ThermoError, or a plain
// failure the window words as "could not"), and it never returns NaN or Infinity to print or to draw.
import '../text';
import { describe, expect, it } from 'vitest';
import { hasInfinity, hasNonFinite } from '../../../../core/finite';
import { solveChecked } from '../common/spec';
import { ThermoError, type ThermoResult } from '../common/types';
import { THERMO_LOADERS } from '../kit';
import { THERMO_TOOL_IDS } from '../meta';
import { fieldsOf, valuesOf } from './formState';

const ABSURD = [1e-12, 1e12, 0, -5];

describe('absurd inputs in the thermodynamics window', () => {
  it.each(THERMO_TOOL_IDS)('%s never gives NaN or Infinity as an answer', async (id) => {
    const { spec } = await THERMO_LOADERS[id]();
    for (const mode of spec.modes) {
      const form = { mode: mode.id, text: {}, unit: {} };
      const fields = fieldsOf(mode, form, 'SI');
      const { values } = valuesOf(fields, form, 'SI');
      for (const field of fields) {
        if (typeof values[field.id] !== 'number') continue;
        for (const absurd of ABSURD) {
          let result: ThermoResult | null = null;
          try {
            result = solveChecked(spec, mode.id, { ...values, [field.id]: absurd });
          } catch {
            // A named problem (or a failure the window words as "could not be worked out"): nothing is shown.
          }
          if (result) {
            const where = `${id} ${mode.id} ${field.id}=${absurd}`;
            expect(hasNonFinite([result.rows, result.states]) || hasInfinity(result.plots), where).toBe(false);
          }
        }
      }
    }
  });

  it('names the problem for an input that overflows an engine', async () => {
    const { spec } = await THERMO_LOADERS.realgas();
    const mode = spec.modes[0];
    const form = { mode: mode.id, text: {}, unit: {} };
    const fields = fieldsOf(mode, form, 'SI');
    const { values } = valuesOf(fields, form, 'SI');
    const codes = new Set<string>();
    for (const field of fields) {
      if (typeof values[field.id] !== 'number') continue;
      for (const absurd of ABSURD) {
        try {
          solveChecked(spec, mode.id, { ...values, [field.id]: absurd });
        } catch (error) {
          if (error instanceof ThermoError) codes.add(error.code);
        }
      }
    }
    expect([...codes].length).toBeGreaterThan(0);
  });
});
