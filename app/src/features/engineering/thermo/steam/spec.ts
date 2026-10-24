// The steam tool's form: one state of water from the pair of properties the student knows.
import { choice, optionalNum, pick, q, type FieldSpec, type ToolSpec } from '../common/spec';
import { solveSteam, type SteamPair } from './engine';

const C = { SI: '°C' } as const;

const FIELDS: Record<SteamPair, readonly FieldSpec[]> = {
  Tp: [{ ...q('T', 'temperature', 'T', 673.15), unit: C }, q('p', 'pressure', 'p', 1000)],
  ph: [q('p', 'pressure', 'p', 1000), q('h', 'enthalpy', 'e', 2800)],
  ps: [q('p', 'pressure', 'p', 1000), q('s', 'entropy', 's', 6.6)],
  Tx: [{ ...q('T', 'temperature', 'T', 373.15), unit: C }, q('x', 'quality', 'none', 0.5)],
  px: [q('p', 'pressure', 'p', 100), q('x', 'quality', 'none', 0.5)],
};

export const PAIR_FIELD = pick('pair', 'pair', [
  ['Tp', 'pairTp'],
  ['ph', 'pairPh'],
  ['ps', 'pairPs'],
  ['Tx', 'pairTx'],
  ['px', 'pairPx'],
]);

export const spec: ToolSpec = {
  modes: [
    {
      id: 'state',
      label: 'state',
      fields: (values) => [PAIR_FIELD, ...(FIELDS[choice<SteamPair>(values, 'pair', 'Tp')] ?? FIELDS.Tp)],
    },
  ],
  solve(_mode, values) {
    const get = (id: string) => optionalNum(values, id) ?? undefined;
    return solveSteam({
      pair: choice<SteamPair>(values, 'pair', 'Tp'),
      T: get('T'),
      p: get('p'),
      h: get('h'),
      s: get('s'),
      x: get('x'),
    });
  },
};
