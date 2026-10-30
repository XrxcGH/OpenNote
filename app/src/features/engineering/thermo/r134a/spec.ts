// The R-134a tool's form: one refrigerant state from the pair of properties the student knows, in the IIR or
// ASHRAE reference state.
import { choice, optionalNum, pick, q, type FieldSpec, type ToolSpec } from '../common/spec';
import { PAIR_FIELD } from '../steam/spec';
import { solveRefrigerant, type RefrigerantPair } from './engine';
import type { Reference } from './refrigerant';

const C = { SI: '°C' } as const;

const FIELDS: Record<RefrigerantPair, readonly FieldSpec[]> = {
  Tp: [{ ...q('T', 'temperature', 'T', 313.15), unit: C }, q('p', 'pressure', 'p', 800)],
  ph: [q('p', 'pressure', 'p', 800), q('h', 'enthalpy', 'e', 270)],
  ps: [q('p', 'pressure', 'p', 800), q('s', 'entropy', 's', 1.75)],
  Tx: [{ ...q('T', 'temperature', 'T', 263.15), unit: C }, q('x', 'quality', 'none', 1)],
  px: [q('p', 'pressure', 'p', 140), q('x', 'quality', 'none', 1)],
};

export const REFERENCE_FIELD = pick('reference', 'reference', [
  ['iir', 'iir'],
  ['ashrae', 'ashrae'],
]);

export const spec: ToolSpec = {
  modes: [
    {
      id: 'state',
      label: 'state',
      fields: (values) => [
        PAIR_FIELD,
        ...(FIELDS[choice<RefrigerantPair>(values, 'pair', 'Tp')] ?? FIELDS.Tp),
        REFERENCE_FIELD,
      ],
    },
  ],
  solve(_mode, values) {
    const get = (id: string) => optionalNum(values, id) ?? undefined;
    return solveRefrigerant({
      pair: choice<RefrigerantPair>(values, 'pair', 'Tp'),
      reference: choice<Reference>(values, 'reference', 'iir'),
      T: get('T'),
      p: get('p'),
      h: get('h'),
      s: get('s'),
      x: get('x'),
    });
  },
};
