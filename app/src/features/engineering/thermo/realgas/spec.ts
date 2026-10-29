// The real-gas tool's form: one state from a cubic equation of state, with the gas's critical constants shown so
// they can be overwritten, and an ideal-gas mixture of up to four gases by mass or by moles.
import {
  choice,
  num,
  pick,
  q,
  type FieldSpec,
  type ThermoChoiceKey,
  type ThermoFieldKey,
  type ToolSpec,
  type Values,
} from '../common/spec';
import { CRITICAL, CRITICAL_IDS, type CriticalId } from './critical';
import type { EosId, RootChoice } from './cubic';
import { MIX_GASES, solveEos, solveMixture, type MixGas } from './engine';

type GasChoice = CriticalId | 'custom';

const GAS_LABELS: Record<GasChoice, ThermoChoiceKey> = {
  CO2: 'CO2',
  N2: 'N2',
  O2: 'O2',
  air: 'air',
  Ar: 'Ar',
  CH4: 'CH4',
  C2H6: 'C2H6',
  C3H8: 'C3H8',
  C4H10: 'C4H10',
  H2O: 'H2O',
  NH3: 'NH3',
  CO: 'CO',
  H2: 'H2',
  He: 'He',
  custom: 'customGas',
};

const GAS_FIELD = pick(
  'gas',
  'gas',
  [...CRITICAL_IDS, 'custom' as const].map((id) => [id, GAS_LABELS[id]] as const),
  'CO2',
);

/** The critical constants, under ids that name the gas, so each gas starts from its own values. */
function constantFields(gas: GasChoice, eos: EosId): FieldSpec[] {
  const known = gas === 'custom' ? null : CRITICAL[gas];
  const fields = [
    q(`Tc_${gas}`, 'criticalT', 'T', known?.Tc ?? null),
    q(`pc_${gas}`, 'criticalP', 'p', known?.pc ?? null),
    ...(eos === 'srk' || eos === 'pr' ? [q(`omega_${gas}`, 'acentric', 'none', known?.omega ?? null)] : []),
    q(`M_${gas}`, 'molarMass', 'molarM', known?.M ?? null),
  ];
  return fields.map((field) => (field.qty === 'p' ? { ...field, unit: { SI: 'MPa' } } : field));
}

const MIX_OPTIONS = [['off', 'off'], ...MIX_GASES.map((id) => [id, id] as const)] as const;
const PART_LABELS: Record<'mass' | 'mole', readonly ThermoFieldKey[]> = {
  mass: ['massPart1', 'massPart2', 'massPart3', 'massPart4'],
  mole: ['molePart1', 'molePart2', 'molePart3', 'molePart4'],
};
const PART_START: readonly (readonly [string, number])[] = [
  ['N2', 0.5],
  ['CO2', 0.5],
  ['off', 0.2],
  ['off', 0.2],
];

function mixFields(values: Values): FieldSpec[] {
  const basis = choice<'mass' | 'mole'>(values, 'basis', 'mass');
  const fields: FieldSpec[] = [
    pick('basis', 'basis', [
      ['mass', 'byMass'],
      ['mole', 'byMoles'],
    ]),
  ];
  PART_START.forEach(([gas, amount], i) => {
    const id = `gas${i + 1}`;
    fields.push(pick(id, `mixGas${i + 1}` as ThermoFieldKey, MIX_OPTIONS, gas));
    if (choice(values, id, gas) !== 'off') fields.push(q(`x${i + 1}`, PART_LABELS[basis][i], 'none', amount));
  });
  fields.push(q('T', 'temperature', 'T', 300), q('p', 'pressure', 'p', 100));
  return fields;
}

export const spec: ToolSpec = {
  modes: [
    {
      id: 'eosState',
      label: 'eosState',
      fields: (values) => {
        const gas = choice<GasChoice>(values, 'gas', 'CO2');
        const eos = choice<EosId>(values, 'eos', 'pr');
        const given = choice<'Tp' | 'Tv'>(values, 'pair', 'Tp');
        return [
          GAS_FIELD,
          pick(
            'eos',
            'eos',
            [
              ['pr', 'pengRobinson'],
              ['srk', 'srk'],
              ['rk', 'redlichKwong'],
              ['vdw', 'vanDerWaals'],
            ],
            'pr',
          ),
          ...constantFields(gas, eos),
          pick('pair', 'pair', [
            ['Tp', 'pairTp'],
            ['Tv', 'pairTv'],
          ]),
          q('T', 'temperature', 'T', 320),
          ...(given === 'Tv'
            ? [q('v', 'specificVolume', 'v', 0.009118)]
            : [
                { ...q('p', 'pressure', 'p', 5000), unit: { SI: 'MPa' } },
                pick('root', 'root', [
                  ['stable', 'rootStable'],
                  ['gas', 'rootGas'],
                  ['liquid', 'rootLiquid'],
                ]),
              ]),
        ];
      },
    },
    { id: 'mixture', label: 'mixture', fields: mixFields },
  ],
  solve(mode, values) {
    if (mode === 'mixture') {
      const parts: { gas: MixGas; amount: number }[] = [];
      for (let i = 1; i <= 4; i++) {
        const gas = choice<MixGas | 'off'>(values, `gas${i}`, 'off');
        if (gas !== 'off') parts.push({ gas, amount: num(values, `x${i}`) });
      }
      return solveMixture({
        basis: choice(values, 'basis', 'mass'),
        parts,
        T: num(values, 'T'),
        p: num(values, 'p'),
      });
    }
    const gas = choice<GasChoice>(values, 'gas', 'CO2');
    const eos = choice<EosId>(values, 'eos', 'pr');
    const given = choice<'Tp' | 'Tv'>(values, 'pair', 'Tp');
    return solveEos({
      eos,
      Tc: num(values, `Tc_${gas}`),
      pc: num(values, `pc_${gas}`),
      omega: eos === 'srk' || eos === 'pr' ? num(values, `omega_${gas}`) : 0,
      M: num(values, `M_${gas}`),
      given,
      T: num(values, 'T'),
      ...(given === 'Tv' ? { v: num(values, 'v') } : { p: num(values, 'p') }),
      root: choice<RootChoice>(values, 'root', 'stable'),
    });
  },
};
