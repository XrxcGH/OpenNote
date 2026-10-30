// The ideal-gas tool's form: a process from state 1 to an end condition, or a single state.
import { choice, num, pick, q, type FieldSpec, type ToolSpec } from '../common/spec';
import { solveProcess, solveState, type EndKind, type Process } from './engine';
import type { GasId, GasModel } from './gas';

export const GAS_FIELD = pick('gas', 'gas', [
  ['air', 'air'],
  ['N2', 'N2'],
  ['O2', 'O2'],
  ['H2O', 'H2O'],
  ['CO2', 'CO2'],
  ['CO', 'CO'],
  ['H2', 'H2'],
  ['Ar', 'Ar'],
  ['He', 'He'],
  ['CH4', 'CH4'],
  ['C3H8', 'C3H8'],
]);

/** The property models for a gas. The cold-air standard's constants are air's, so only air offers it. */
export const modelField = (gas: string): FieldSpec =>
  pick('model', 'gasModel', [
    ['variable', 'variable'],
    ['constant', 'constant'],
    ...(gas === 'air' ? ([['cold', 'cold']] as const) : []),
  ]);

/** The model field for air, which the gas cycles use. */
export const MODEL_FIELD = modelField('air');

const ENDS: Record<Process, readonly EndKind[]> = {
  isothermal: ['p2', 'r'],
  isobaric: ['T2', 'r'],
  isochoric: ['T2', 'p2'],
  isentropic: ['p2', 'T2', 'r'],
  polytropic: ['p2', 'T2', 'r'],
};

function endField(end: EndKind): FieldSpec {
  if (end === 'p2') return q('p2', 'p2', 'p', 1000);
  if (end === 'T2') return q('T2', 'T2', 'T', 600);
  return q('r', 'ratio', 'none', 8);
}

export const spec: ToolSpec = {
  modes: [
    {
      id: 'process',
      label: 'process',
      fields: (values) => {
        const process = choice<Process>(values, 'process', 'isentropic');
        const ends = ENDS[process] ?? ENDS.isentropic;
        const end = ends.includes(values.end as EndKind) ? (values.end as EndKind) : ends[0];
        return [
          GAS_FIELD,
          modelField(choice<GasId>(values, 'gas', 'air')),
          pick('process', 'process', [
            ['isentropic', 'isentropic'],
            ['polytropic', 'polytropic'],
            ['isothermal', 'isothermal'],
            ['isobaric', 'isobaric'],
            ['isochoric', 'isochoric'],
          ]),
          q('T1', 'T1', 'T', 300),
          q('p1', 'p1', 'p', 100),
          ...(process === 'polytropic' ? [q('n', 'polyN', 'none', 1.3)] : []),
          pick(
            'end',
            'endKind',
            ends.map((one) => [one, `end_${one}`] as const),
            end,
          ),
          endField(end),
        ];
      },
    },
    {
      id: 'state',
      label: 'state',
      fields: (values) => [
        GAS_FIELD,
        modelField(choice<GasId>(values, 'gas', 'air')),
        q('T', 'temperature', 'T', 300),
        q('p', 'pressure', 'p', 100),
      ],
    },
  ],
  solve(mode, values) {
    const gas = choice<GasId>(values, 'gas', 'air');
    const model = choice<GasModel>(values, 'model', 'variable');
    if (mode === 'state') return solveState({ gas, model, T: num(values, 'T'), p: num(values, 'p') });
    const process = choice<Process>(values, 'process', 'isentropic');
    const end = choice<EndKind>(values, 'end', ENDS[process][0]);
    return solveProcess({
      gas,
      model,
      process,
      T1: num(values, 'T1'),
      p1: num(values, 'p1'),
      end,
      value: num(values, end),
      n: process === 'polytropic' ? num(values, 'n') : 1,
    });
  },
};
