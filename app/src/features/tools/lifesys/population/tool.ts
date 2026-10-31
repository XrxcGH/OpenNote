// The population dynamics tool's calculations: what each form asks for, and which engine answers it.
import type { CalcSpec, FieldSpec, ToolSpec } from '../types';
import {
  bifurcationResult,
  cobwebResult,
  competitionResult,
  functionalResult,
  growthResult,
  harvestResult,
  islandResult,
  levinsResult,
  predatorPreyResult,
  speciesAreaResult,
} from './engine';
import type { Growth } from './engine';

const n = (id: string, label: FieldSpec['label'], initial: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({
  id,
  label,
  initial,
  ...extra,
});

const GROWTH: readonly Growth[] = [
  'logistic',
  'exponential',
  'allee',
  'geometric',
  'discreteLogistic',
  'ricker',
  'bevertonHolt',
];

const calcs: CalcSpec[] = [
  {
    id: 'growth',
    label: 'population.c.growth',
    fields: (choice) => {
      const model = (choice('model') || 'logistic') as Growth;
      return [
        {
          id: 'model',
          label: 'population.f.model',
          kind: 'select',
          options: GROWTH.map((g) => ({ value: g, label: `population.o.${g}` as const })),
        },
        n('N0', 'population.f.N0', '10'),
        n(
          'r',
          model === 'geometric'
            ? 'population.f.lambda'
            : model === 'bevertonHolt'
              ? 'population.f.R'
              : 'population.f.r',
          '0.5',
        ),
        ...(model === 'exponential' || model === 'geometric' ? [] : [n('K', 'population.f.K', '1000')]),
        ...(model === 'allee' ? [n('A', 'population.f.A', '50')] : []),
        n('t', 'population.f.t', '10'),
      ];
    },
    solve: (read) => {
      const model = (read.choice('model') || 'logistic') as Growth;
      // K and A are asked only for the models that use them; the others get NaN.
      const hasK = model !== 'exponential' && model !== 'geometric';
      const K = hasK ? read.num('K') : NaN;
      const A = model === 'allee' ? read.num('A') : NaN;
      return growthResult({ model, N0: read.num('N0'), r: read.num('r'), K, A, t: read.num('t') });
    },
  },
  {
    id: 'harvest',
    label: 'population.c.harvest',
    fields: (choice) => [
      {
        id: 'mode',
        label: 'population.f.harvestMode',
        kind: 'select',
        options: [
          { value: 'quota', label: 'population.o.quota' },
          { value: 'effort', label: 'population.o.effort' },
        ],
      },
      n('r', 'population.f.r', '0.5'),
      n('K', 'population.f.K', '1000'),
      choice('mode') === 'effort' ? n('x', 'population.f.E', '0.2') : n('x', 'population.f.H', '100'),
    ],
    solve: (read) =>
      harvestResult(read.num('r'), read.num('K'), read.choice('mode') === 'effort' ? 'effort' : 'quota', read.num('x')),
  },
  {
    id: 'predatorPrey',
    label: 'population.c.predatorPrey',
    fields: (choice) => [
      {
        id: 'model',
        label: 'population.f.model',
        kind: 'select',
        options: [
          { value: 'lv', label: 'population.o.lv' },
          { value: 'rm', label: 'population.o.rm' },
        ],
      },
      n('r', 'population.f.r', '1'),
      n('a', 'population.f.a', '0.1'),
      n('b', 'population.f.b', '0.5'),
      n('m', 'population.f.m', '0.5'),
      ...(choice('model') === 'rm' ? [n('K', 'population.f.K', '100'), n('h', 'population.f.h', '0.2')] : []),
      n('N0', 'population.f.prey0', '20'),
      n('P0', 'population.f.pred0', '5'),
      n('t', 'population.f.t', '60'),
    ],
    solve: (read) => {
      const rm = read.choice('model') === 'rm';
      return predatorPreyResult({
        r: read.num('r'),
        a: read.num('a'),
        b: read.num('b'),
        m: read.num('m'),
        K: rm ? read.num('K') : Infinity,
        h: rm ? read.num('h') : 0,
        N0: read.num('N0'),
        P0: read.num('P0'),
        t: read.num('t'),
      });
    },
  },
  {
    id: 'functional',
    label: 'population.c.functional',
    fields: [n('a', 'population.f.a', '0.5'), n('h', 'population.f.h', '0.2'), n('N', 'population.f.preyMax', '100')],
    solve: (read) => functionalResult(read.num('a'), read.num('h'), read.num('N')),
  },
  {
    id: 'competition',
    label: 'population.c.competition',
    fields: [
      n('r1', 'population.f.r1', '1'),
      n('r2', 'population.f.r2', '1'),
      n('K1', 'population.f.K1', '100'),
      n('K2', 'population.f.K2', '100'),
      n('a12', 'population.f.a12', '0.5'),
      n('a21', 'population.f.a21', '0.5'),
      n('N1', 'population.f.n1', '10'),
      n('N2', 'population.f.n2', '20'),
      n('t', 'population.f.t', '30'),
    ],
    solve: (read) =>
      competitionResult({
        r1: read.num('r1'),
        r2: read.num('r2'),
        K1: read.num('K1'),
        K2: read.num('K2'),
        a12: read.num('a12'),
        a21: read.num('a21'),
        N1: read.num('N1'),
        N2: read.num('N2'),
        t: read.num('t'),
      }),
  },
  {
    id: 'levins',
    label: 'population.c.levins',
    fields: [
      n('c', 'population.f.colonize', '0.5'),
      n('e', 'population.f.extinct', '0.2'),
      n('p0', 'population.f.p0', '0.1'),
      n('t', 'population.f.t', '40'),
    ],
    solve: (read) => levinsResult(read.num('c'), read.num('e'), read.num('p0'), read.num('t')),
  },
  {
    id: 'island',
    label: 'population.c.island',
    fields: [n('I', 'population.f.I0', '10'), n('E', 'population.f.E0', '5'), n('P', 'population.f.pool', '300')],
    solve: (read) => islandResult(read.num('I'), read.num('E'), read.num('P')),
  },
  {
    id: 'speciesArea',
    label: 'population.c.speciesArea',
    fields: [
      {
        id: 'data',
        label: 'population.f.areaData',
        kind: 'data',
        initial: '1 10\n10 19\n100 37\n1000 72\n10000 140',
        help: 'population.h.areaData',
      },
    ],
    solve: (read) => speciesAreaResult(read.rows('data')),
  },
  {
    id: 'cobweb',
    label: 'population.c.cobweb',
    fields: [
      n('r', 'population.f.mapR', '3.2'),
      n('x0', 'population.f.x0', '0.2'),
      n('n', 'population.f.iterations', '40'),
    ],
    solve: (read) => cobwebResult(read.num('r'), read.num('x0'), read.num('n')),
  },
  {
    id: 'bifurcation',
    label: 'population.c.bifurcation',
    fields: [n('lo', 'population.f.rMin', '2.5'), n('hi', 'population.f.rMax', '4')],
    solve: (read) => bifurcationResult(read.num('lo'), read.num('hi')),
  },
];

export const tool: ToolSpec = { calcs };
