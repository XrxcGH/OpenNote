import type { FieldSpec, ToolSpec } from '../spec';
import { arrhenius, globalRate, initialRates, integrated, orderFromData } from './engine';

const mode = (v: Readonly<Record<string, string>>) => v.mode ?? 'integrated';
const only = (name: string) => (v: Readonly<Record<string, string>>) => mode(v) === name;

const choice = (id: string, label: FieldSpec['label'], values: [string, FieldSpec['label']][], initial: string) => ({
  id,
  label,
  kind: 'choice' as const,
  initial,
  choices: values.map(([value, text]) => ({ value, label: text })),
});

const TIME_UNITS: [string, FieldSpec['label']][] = [
  ['s', 'kitChemMat.kin.unit.s'],
  ['min', 'kitChemMat.kin.unit.min'],
  ['h', 'kitChemMat.kin.unit.h'],
  ['d', 'kitChemMat.kin.unit.d'],
];

export const kineticsTool: ToolSpec = {
  id: 'kinetics',
  title: 'kitChemMat.kin.title',
  intro: 'kitChemMat.kin.intro',
  keywords: 'kitChemMat.kin.keywords',
  open: 'kitChemMat.kin.open',
  icon: 'Flask',
  fields: [
    choice(
      'mode',
      'kitChemMat.kin.field.mode',
      [
        ['integrated', 'kitChemMat.kin.mode.integrated'],
        ['data', 'kitChemMat.kin.mode.data'],
        ['rates', 'kitChemMat.kin.mode.rates'],
        ['arrhenius', 'kitChemMat.kin.mode.arrhenius'],
        ['global', 'kitChemMat.kin.mode.global'],
      ],
      'integrated',
    ),
    {
      ...choice(
        'order',
        'kitChemMat.kin.field.order',
        [
          ['0', 'kitChemMat.kin.order.zero'],
          ['1', 'kitChemMat.kin.order.first'],
          ['2', 'kitChemMat.kin.order.second'],
        ],
        '1',
      ),
      when: only('integrated'),
    },
    { id: 'k', label: 'kitChemMat.kin.field.k', kind: 'number', initial: '0.0231', when: only('integrated') },
    {
      id: 'c0',
      label: 'kitChemMat.kin.field.c0',
      kind: 'number',
      dim: 'concentration',
      initial: '1',
      when: only('integrated'),
    },
    { id: 't', label: 'kitChemMat.kin.field.t', kind: 'number', initial: '30', when: only('integrated') },
    {
      id: 'target',
      label: 'kitChemMat.kin.field.target',
      kind: 'number',
      dim: 'concentration',
      initial: '',
      optional: true,
      when: only('integrated'),
    },
    {
      ...choice('tunit', 'kitChemMat.kin.field.tunit', TIME_UNITS, 'min'),
      when: (v) => ['integrated', 'data'].includes(mode(v)),
    },
    {
      id: 'table',
      label: 'kitChemMat.kin.field.table',
      kind: 'area',
      initial: '0, 1\n10, 0.607\n20, 0.368\n30, 0.223\n40, 0.135',
      help: 'kitChemMat.kin.field.tableHelp',
      when: only('data'),
    },
    {
      ...choice(
        'species',
        'kitChemMat.kin.field.species',
        [
          ['1', 'kitChemMat.kin.species.one'],
          ['2', 'kitChemMat.kin.species.two'],
          ['3', 'kitChemMat.kin.species.three'],
        ],
        '2',
      ),
      when: only('rates'),
    },
    {
      id: 'rates',
      label: 'kitChemMat.kin.field.rates',
      kind: 'area',
      initial: '0.1, 0.1, 0.005\n0.2, 0.1, 0.02\n0.1, 0.2, 0.01',
      help: 'kitChemMat.kin.field.ratesHelp',
      when: only('rates'),
    },
    {
      id: 'arr',
      label: 'kitChemMat.kin.field.arr',
      kind: 'area',
      initial: '300, 0.001\n320, 0.01',
      help: 'kitChemMat.kin.field.arrHelp',
      when: only('arrhenius'),
    },
    {
      id: 'predict',
      label: 'kitChemMat.kin.field.predict',
      kind: 'number',
      dim: 'temperature',
      initial: '',
      optional: true,
      when: only('arrhenius'),
    },
    { id: 'A', label: 'kitChemMat.kin.field.A', kind: 'number', initial: '1e10', when: only('global') },
    {
      id: 'Ea',
      label: 'kitChemMat.kin.field.Ea',
      kind: 'number',
      dim: 'energyMol',
      initial: '150',
      when: only('global'),
    },
    {
      id: 'T',
      label: 'kitChemMat.kin.field.T',
      kind: 'number',
      dim: 'temperature',
      initial: '1000',
      when: only('global'),
    },
    {
      id: 'cF',
      label: 'kitChemMat.kin.field.cF',
      kind: 'number',
      dim: 'concentration',
      initial: '0.01',
      when: only('global'),
    },
    { id: 'a', label: 'kitChemMat.kin.field.a', kind: 'number', initial: '0.5', when: only('global') },
    {
      id: 'cO',
      label: 'kitChemMat.kin.field.cO',
      kind: 'number',
      dim: 'concentration',
      initial: '0.02',
      when: only('global'),
    },
    { id: 'b', label: 'kitChemMat.kin.field.b', kind: 'number', initial: '1', when: only('global') },
  ],
  solve: (input) => {
    switch (input.mode) {
      case 'data':
        return orderFromData(String(input.table), String(input.tunit));
      case 'rates':
        return initialRates(String(input.rates), Number(input.species));
      case 'arrhenius':
        return arrhenius(String(input.arr), Number(input.predict));
      case 'global':
        return globalRate({
          A: Number(input.A),
          Ea: Number(input.Ea),
          T: Number(input.T),
          cF: Number(input.cF),
          a: Number(input.a),
          cO: Number(input.cO),
          b: Number(input.b),
        });
      default:
        return integrated({
          order: Number(input.order),
          k: Number(input.k),
          c0: Number(input.c0),
          t: Number(input.t),
          target: Number(input.target),
          tunit: String(input.tunit),
        });
    }
  },
};
