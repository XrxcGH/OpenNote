// The curve-fitting tool's calculations: what each form asks for, and which engine answers it. Concentrations stay in
// the unit the student types, except Cheng-Prusoff, which converts molar units and answers in nM.
import type { CalcSpec, FieldSpec, Reader, ToolSpec } from '../types';
import {
  apparentResult,
  betResult,
  bindingResult,
  chengPrusoffResult,
  doseResponseResult,
  fourPlResult,
  hillFitResult,
  hillResult,
  inhibitionResult,
  isothermResult,
  lqResult,
  michaelisResult,
  probitResult,
  schildResult,
  standardCurveResult,
  type Binding,
  type Inhibition,
} from './engine';

const num = (id: string, label: FieldSpec['label'], initial: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({
  id,
  label,
  initial,
  ...extra,
});
const data = (id: string, label: FieldSpec['label'], initial: string, help: FieldSpec['help']): FieldSpec => ({
  id,
  label,
  kind: 'data',
  initial,
  help,
});
const list = (read: Reader, id: string): number[] => (read.text(id).trim() === '' ? [] : read.rows(id).flat());

const MM_DATA = '0.5 2.05\n1 3.27\n2 5.08\n4 6.61\n8 8.06\n16 8.84';

const calcs: CalcSpec[] = [
  {
    id: 'michaelis',
    label: 'curves.c.michaelis',
    fields: [
      data('data', 'curves.f.mmData', MM_DATA, 'curves.h.mmData'),
      num('E', 'curves.f.enzyme', '', { optional: true, help: 'curves.h.enzyme' }),
    ],
    solve: (read) => michaelisResult(read.rows('data'), read.opt('E')),
  },
  {
    id: 'inhibition',
    label: 'curves.c.inhibition',
    fields: [
      data(
        'data',
        'curves.f.inhibitionData',
        '1 0 3.31\n2 0 5.04\n4 0 6.62\n8 0 8.05\n16 0 8.86\n1 1 2.02\n2 1 3.3\n4 1 5.03\n8 1 6.64\n16 1 8.03\n' +
          '1 3 1.12\n2 3 1.98\n4 3 3.35\n8 3 4.98\n16 3 6.7',
        'curves.h.inhibitionData',
      ),
    ],
    solve: (read) => inhibitionResult(read.rows('data')),
  },
  {
    id: 'apparent',
    label: 'curves.c.apparent',
    fields: (choice) => [
      {
        id: 'type',
        label: 'curves.f.type',
        kind: 'select',
        options: [
          { value: 'competitive', label: 'curves.o.competitive' },
          { value: 'uncompetitive', label: 'curves.o.uncompetitive' },
          { value: 'noncompetitive', label: 'curves.o.noncompetitive' },
          { value: 'mixed', label: 'curves.o.mixed' },
        ],
      },
      num('vmax', 'curves.f.vmax', '10'),
      num('km', 'curves.f.km', '2'),
      num('ki', 'curves.f.ki', '1'),
      num('i', 'curves.f.i', '1'),
      ...(choice('type') === 'mixed' ? [num('alpha', 'curves.f.alpha', '2', { help: 'curves.h.alpha' })] : []),
    ],
    solve: (read) => {
      const type = (read.choice('type') || 'competitive') as Inhibition;
      return apparentResult(
        type,
        read.num('vmax'),
        read.num('km'),
        read.num('ki'),
        read.num('i'),
        type === 'mixed' ? read.num('alpha') : 1,
      );
    },
  },
  {
    id: 'hill',
    label: 'curves.c.hill',
    fields: [num('L', 'curves.f.ligand', '10'), num('K', 'curves.f.k05', '26'), num('n', 'curves.f.hillN', '2.8')],
    solve: (read) => hillResult(read.num('L'), read.num('K'), read.num('n')),
  },
  {
    id: 'hillFit',
    label: 'curves.c.hillFit',
    fields: [
      data(
        'data',
        'curves.f.hillData',
        '5 0.0098\n10 0.0644\n20 0.324\n26 0.5\n40 0.77\n80 0.959',
        'curves.h.hillData',
      ),
    ],
    solve: (read) => hillFitResult(read.rows('data')),
  },
  {
    id: 'binding',
    label: 'curves.c.binding',
    fields: [
      {
        id: 'model',
        label: 'curves.f.bindingModel',
        kind: 'select',
        options: [
          { value: 'one', label: 'curves.o.one' },
          { value: 'oneNs', label: 'curves.o.oneNs' },
          { value: 'two', label: 'curves.o.two' },
        ],
      },
      data(
        'data',
        'curves.f.bindingData',
        '0.1 54.02\n0.3 121.6\n1 238\n3 343.2\n10 524.2\n30 711.5\n100 886.3\n300 946.2',
        'curves.h.bindingData',
      ),
    ],
    solve: (read) => bindingResult(read.rows('data'), (read.choice('model') || 'one') as Binding),
  },
  {
    id: 'chengPrusoff',
    label: 'curves.c.chengPrusoff',
    fields: [
      num('ic50', 'curves.f.ic50', '100', { unit: 'molar', unitInitial: 'nM' }),
      num('L', 'curves.f.radioligand', '10', { unit: 'molar', unitInitial: 'nM' }),
      num('kd', 'curves.f.kd', '5', { unit: 'molar', unitInitial: 'nM' }),
    ],
    solve: (read) => chengPrusoffResult(read.num('ic50'), read.num('L'), read.num('kd')),
  },
  {
    id: 'isotherm',
    label: 'curves.c.isotherm',
    fields: [
      data(
        'data',
        'curves.f.isothermData',
        '1 1.67\n2 2.5\n5 3.57\n10 4.17\n20 4.55\n50 4.81',
        'curves.h.isothermData',
      ),
    ],
    solve: (read) => isothermResult(read.rows('data')),
  },
  {
    id: 'bet',
    label: 'curves.c.bet',
    fields: [
      data(
        'data',
        'curves.f.betData',
        '0.05 2.37\n0.1 2.85\n0.15 3.2\n0.2 3.53\n0.25 3.86\n0.3 4.21\n0.35 4.6',
        'curves.h.betData',
      ),
    ],
    solve: (read) => betResult(read.rows('data')),
  },
  {
    id: 'fourPl',
    label: 'curves.c.fourPl',
    fields: [
      num('a', 'curves.f.a', '0.05', { help: 'curves.h.a' }),
      num('d', 'curves.f.d', '2', { help: 'curves.h.d' }),
      num('c', 'curves.f.c', '10'),
      num('b', 'curves.f.b', '1.2'),
      num('g', 'curves.f.g', '1', { help: 'curves.h.g' }),
      num('x', 'curves.f.x', '5', { optional: true }),
      num('y', 'curves.f.y', '0.641376', { optional: true }),
    ],
    solve: (read) =>
      fourPlResult(
        read.num('a'),
        read.num('b'),
        read.num('c'),
        read.num('d'),
        read.num('g'),
        read.opt('x'),
        read.opt('y'),
      ),
  },
  {
    id: 'standard',
    label: 'curves.c.standard',
    fields: [
      {
        id: 'model',
        label: 'curves.f.plModel',
        kind: 'select',
        options: [
          { value: '4', label: 'curves.o.fourPl' },
          { value: '5', label: 'curves.o.fivePl' },
        ],
      },
      data(
        'data',
        'curves.f.standardData',
        '0.5 0.141\n1 0.231\n2 0.398\n5 0.651\n10 1.03\n20 1.39\n50 1.72\n100 1.86',
        'curves.h.standardData',
      ),
      { id: 'unknowns', label: 'curves.f.unknowns', kind: 'data', initial: '0.5 1.2', help: 'curves.h.unknowns' },
    ],
    solve: (read) => standardCurveResult(read.rows('data'), read.choice('model') === '5', list(read, 'unknowns')),
  },
  {
    id: 'doseResponse',
    label: 'curves.c.doseResponse',
    fields: [
      data(
        'data',
        'curves.f.doseData',
        '0.01 2.1\n0.03 5.8\n0.1 15.2\n0.3 36.4\n1 61.9\n3 83.5\n10 94\n30 98.1',
        'curves.h.doseData',
      ),
    ],
    solve: (read) => doseResponseResult(read.rows('data')),
  },
  {
    id: 'schild',
    label: 'curves.c.schild',
    fields: [data('data', 'curves.f.schildData', '1e-8 2.1\n3e-8 3.8\n1e-7 11.5\n3e-7 29', 'curves.h.schildData')],
    solve: (read) => schildResult(read.rows('data')),
  },
  {
    id: 'probit',
    label: 'curves.c.probit',
    fields: [data('data', 'curves.f.probitData', '1 20 1\n2 20 4\n4 20 9\n8 20 15\n16 20 19', 'curves.h.probitData')],
    solve: (read) => probitResult(read.rows('data')),
  },
  {
    id: 'lq',
    label: 'curves.c.lq',
    fields: [
      num('alpha', 'curves.f.lqAlpha', '0.3'),
      num('beta', 'curves.f.lqBeta', '0.03'),
      num('d', 'curves.f.fractionDose', '2', { unit: 'gray' }),
      num('n', 'curves.f.fractions', '30'),
    ],
    solve: (read) => lqResult(read.num('alpha'), read.num('beta'), read.num('d'), read.num('n')),
  },
];

export const tool: ToolSpec = { calcs };
