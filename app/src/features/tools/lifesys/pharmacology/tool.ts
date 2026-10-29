// The pharmacology tool's calculations: what each form asks for, and which engine answers it. Elimination can be
// given as a rate constant, a half-life, or a clearance; the form turns it into k before the engine runs.
import { positive } from '../num/errors';
import type { CalcSpec, FieldSpec, Reader, ToolSpec } from '../types';
import {
  biexponentialResult,
  michaelisResult,
  multipleDoseResult,
  ncaResult,
  oneCompartmentResult,
  pdResult,
  pkpdResult,
  releaseResult,
  scalingResult,
  twoCompartmentResult,
} from './engine';

const num = (id: string, label: FieldSpec['label'], initial: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({
  id,
  label,
  initial,
  ...extra,
});

const elimination = (choice: (id: string) => string): FieldSpec[] => {
  const given = choice('elim') || 'k';
  return [
    {
      id: 'elim',
      label: 'pharmacology.f.elim',
      kind: 'select',
      options: [
        { value: 'k', label: 'pharmacology.o.k' },
        { value: 'half', label: 'pharmacology.o.half' },
        { value: 'CL', label: 'pharmacology.o.CL' },
      ],
    },
    given === 'half'
      ? num('half', 'pharmacology.f.half', '6.93147', { unit: 'hours' })
      : given === 'CL'
        ? num('CL', 'pharmacology.f.CL', '5', { unit: 'clearance' })
        : num('k', 'pharmacology.f.k', '0.1', { help: 'pharmacology.h.k' }),
  ];
};

/** k from whichever elimination value the form was given: k itself, ln 2 / t½, or CL / V. */
function rateConstant(read: Reader): number {
  const given = read.choice('elim') || 'k';
  if (given === 'half') return Math.LN2 / positive(read.num('half'), 't½');
  if (given === 'CL') return positive(read.num('CL'), 'CL') / positive(read.num('V'), 'V');
  return read.num('k');
}

const calcs: CalcSpec[] = [
  {
    id: 'oneCompartment',
    label: 'pharmacology.c.oneCompartment',
    fields: (choice) => {
      const route = choice('route') || 'bolus';
      return [
        {
          id: 'route',
          label: 'pharmacology.f.route',
          kind: 'select',
          options: [
            { value: 'bolus', label: 'pharmacology.o.bolus' },
            { value: 'infusion', label: 'pharmacology.o.infusion' },
            { value: 'oral', label: 'pharmacology.o.oral' },
          ],
        },
        num('D', 'pharmacology.f.dose', '500', { unit: 'dose' }),
        num('V', 'pharmacology.f.V', '50', { unit: 'volumeL' }),
        ...elimination(choice),
        ...(route === 'oral'
          ? [
              num('ka', 'pharmacology.f.ka', '1'),
              num('F', 'pharmacology.f.F', '1', { help: 'pharmacology.h.F' }),
            ]
          : []),
        ...(route === 'infusion' ? [num('tinf', 'pharmacology.f.tinf', '1', { unit: 'hours' })] : []),
        num('t', 'pharmacology.f.t', '4', { unit: 'hours' }),
      ];
    },
    solve: (read) => {
      const route = (read.choice('route') || 'bolus') as 'bolus' | 'infusion' | 'oral';
      return oneCompartmentResult({
        route,
        dose: read.num('D'),
        V: read.num('V'),
        k: rateConstant(read),
        ka: route === 'oral' ? read.num('ka') : 0,
        F: route === 'oral' ? read.num('F') : 1,
        tinf: route === 'infusion' ? read.num('tinf') : 0,
        t: read.num('t'),
      });
    },
  },
  {
    id: 'multiple',
    label: 'pharmacology.c.multiple',
    fields: (choice) => [
      {
        id: 'route',
        label: 'pharmacology.f.route',
        kind: 'select',
        options: [
          { value: 'bolus', label: 'pharmacology.o.bolus' },
          { value: 'oral', label: 'pharmacology.o.oral' },
        ],
      },
      num('D', 'pharmacology.f.dose', '500', { unit: 'dose' }),
      num('tau', 'pharmacology.f.tau', '8', { unit: 'hours' }),
      num('V', 'pharmacology.f.V', '50', { unit: 'volumeL' }),
      ...elimination(choice),
      ...(choice('route') === 'oral'
        ? [num('ka', 'pharmacology.f.ka', '1'), num('F', 'pharmacology.f.F', '1', { help: 'pharmacology.h.F' })]
        : []),
      num('n', 'pharmacology.f.doses', '8'),
    ],
    solve: (read) => {
      const oral = read.choice('route') === 'oral';
      return multipleDoseResult(
        read.num('D'),
        read.num('tau'),
        rateConstant(read),
        read.num('V'),
        oral ? read.num('F') : 1,
        oral ? read.num('ka') : null,
        read.num('n'),
      );
    },
  },
  {
    id: 'twoCompartment',
    label: 'pharmacology.c.twoCompartment',
    fields: [
      num('D', 'pharmacology.f.dose', '500', { unit: 'dose' }),
      num('V1', 'pharmacology.f.V1', '20', { unit: 'volumeL' }),
      num('k10', 'pharmacology.f.k10', '0.2'),
      num('k12', 'pharmacology.f.k12', '0.5'),
      num('k21', 'pharmacology.f.k21', '0.3'),
    ],
    solve: (read) =>
      twoCompartmentResult(read.num('D'), read.num('V1'), read.num('k10'), read.num('k12'), read.num('k21')),
  },
  {
    id: 'biexponential',
    label: 'pharmacology.c.biexponential',
    fields: [
      {
        id: 'data',
        label: 'pharmacology.f.ctData',
        kind: 'data',
        initial:
          '0.25 8.18103\n0.5 6.75470\n1 4.75271\n2 2.72014\n3 1.87993\n4 1.48717\n6 1.11745\n8 0.901342\n12 0.602438\n24 0.181436',
        help: 'pharmacology.h.ctData',
      },
      num('D', 'pharmacology.f.doseOptional', '', { unit: 'dose', optional: true }),
    ],
    solve: (read) => biexponentialResult(read.rows('data'), read.opt('D')),
  },
  {
    id: 'nca',
    label: 'pharmacology.c.nca',
    fields: [
      {
        id: 'data',
        label: 'pharmacology.f.ctData',
        kind: 'data',
        initial: '0 0\n1 8\n2 6\n4 4\n8 2',
        help: 'pharmacology.h.ctData',
      },
      num('terminal', 'pharmacology.f.terminal', '2', { help: 'pharmacology.h.terminal' }),
      {
        id: 'method',
        label: 'pharmacology.f.method',
        kind: 'select',
        options: [
          { value: 'linear', label: 'pharmacology.o.linear' },
          { value: 'logDown', label: 'pharmacology.o.logDown' },
        ],
      },
      {
        id: 'route',
        label: 'pharmacology.f.ncaRoute',
        kind: 'select',
        options: [
          { value: 'iv', label: 'pharmacology.o.iv' },
          { value: 'extravascular', label: 'pharmacology.o.extravascular' },
        ],
      },
      num('D', 'pharmacology.f.doseOptional', '', { unit: 'dose', optional: true }),
    ],
    solve: (read) =>
      ncaResult(
        read.rows('data'),
        read.num('terminal'),
        read.choice('method') === 'logDown' ? 'logDown' : 'linear',
        read.opt('D'),
        read.choice('route') === 'extravascular' ? 'extravascular' : 'iv',
      ),
  },
  {
    id: 'michaelis',
    label: 'pharmacology.c.michaelis',
    fields: [
      num('c0', 'pharmacology.f.C0', '20', { unit: 'drugConc' }),
      num('vmax', 'pharmacology.f.vmax', '2'),
      num('km', 'pharmacology.f.km', '4', { unit: 'drugConc' }),
      num('c1', 'pharmacology.f.C1', '5', { unit: 'drugConc', optional: true }),
      num('t', 'pharmacology.f.t', '12', { unit: 'hours' }),
    ],
    solve: (read) => michaelisResult(read.num('c0'), read.num('vmax'), read.num('km'), read.opt('c1'), read.num('t')),
  },
  {
    id: 'scaling',
    label: 'pharmacology.c.scaling',
    fields: [
      num('h', 'pharmacology.f.height', '170', { unit: 'height' }),
      num('w', 'pharmacology.f.weight', '70', { unit: 'bodyMass' }),
      num('perKg', 'pharmacology.f.perKg', '', { optional: true }),
      num('perM2', 'pharmacology.f.perM2', '', { optional: true }),
    ],
    solve: (read) => scalingResult(read.num('h'), read.num('w'), read.opt('perKg'), read.opt('perM2')),
  },
  {
    id: 'release',
    label: 'pharmacology.c.release',
    fields: [
      {
        id: 'data',
        label: 'pharmacology.f.releaseData',
        kind: 'data',
        initial: '0.5 0.18\n1 0.26\n2 0.36\n4 0.51\n6 0.62\n8 0.71\n12 0.85',
        help: 'pharmacology.h.releaseData',
      },
    ],
    solve: (read) => releaseResult(read.rows('data')),
  },
  {
    id: 'pd',
    label: 'pharmacology.c.pd',
    fields: [
      num('c', 'pharmacology.f.C', '2', { unit: 'drugConc' }),
      num('e0', 'pharmacology.f.E0', '0'),
      num('em', 'pharmacology.f.Emax', '100'),
      num('ec50', 'pharmacology.f.EC50', '1', { unit: 'drugConc' }),
      num('n', 'pharmacology.f.hill', '1'),
      num('kd', 'pharmacology.f.Kd', '', { unit: 'drugConc', optional: true }),
      num('td50', 'pharmacology.f.TD50', '', { optional: true }),
      num('ed50', 'pharmacology.f.ED50', '', { optional: true }),
    ],
    solve: (read) =>
      pdResult(
        read.num('c'),
        read.num('e0'),
        read.num('em'),
        read.num('ec50'),
        read.num('n'),
        read.opt('kd'),
        read.opt('td50'),
        read.opt('ed50'),
      ),
  },
  {
    id: 'pkpd',
    label: 'pharmacology.c.pkpd',
    fields: [
      num('D', 'pharmacology.f.dose', '100', { unit: 'dose' }),
      num('V', 'pharmacology.f.V', '10', { unit: 'volumeL' }),
      num('k', 'pharmacology.f.k', '0.2', { help: 'pharmacology.h.k' }),
      num('ke0', 'pharmacology.f.ke0', '0.5'),
      num('e0', 'pharmacology.f.E0', '0'),
      num('em', 'pharmacology.f.Emax', '100'),
      num('ec50', 'pharmacology.f.EC50', '2', { unit: 'drugConc' }),
      num('n', 'pharmacology.f.hill', '1'),
      num('t', 'pharmacology.f.tEnd', '24', { unit: 'hours' }),
    ],
    solve: (read) =>
      pkpdResult({
        dose: read.num('D'),
        V: read.num('V'),
        k: read.num('k'),
        ke0: read.num('ke0'),
        e0: read.num('e0'),
        em: read.num('em'),
        ec50: read.num('ec50'),
        n: read.num('n'),
        t: read.num('t'),
      }),
  },
];

export const tool: ToolSpec = { calcs, clinical: true };
