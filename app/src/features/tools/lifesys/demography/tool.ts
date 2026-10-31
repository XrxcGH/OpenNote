// The demography tool's calculations: what each form asks for, and which engine answers it.
import { LsError } from '../num/errors';
import type { CalcSpec, ToolSpec } from '../types';
import {
  cohortComponentResult,
  cohortTable,
  fecundityResult,
  fertilityResult,
  lifeTableResult,
  matrixResult,
  periodTable,
  pyramidResult,
  ratesResult,
  survivorsFromDeaths,
} from './engine';

const column = (rows: number[][], i: number) => rows.map((r) => r[i]);

const calcs: CalcSpec[] = [
  {
    id: 'cohort',
    label: 'demography.c.cohort',
    fields: [
      {
        id: 'data',
        label: 'demography.f.cohortData',
        kind: 'data',
        initial: '0 1000\n1 800\n2 500\n3 200\n4 0',
        help: 'demography.h.cohortData',
      },
      {
        id: 'kind',
        label: 'demography.f.cohortKind',
        kind: 'select',
        options: [
          { value: 'survivors', label: 'demography.o.survivors' },
          { value: 'deaths', label: 'demography.o.deaths' },
        ],
      },
    ],
    solve: (read) => {
      const rows = read.rows('data');
      const ages = column(rows, 0);
      if (read.choice('kind') === 'deaths') {
        const deaths = column(rows, 1);
        const step = ages.length > 1 ? ages[ages.length - 1] - ages[ages.length - 2] : 1;
        return lifeTableResult(
          cohortTable([...ages, ages[ages.length - 1] + step], survivorsFromDeaths(deaths)),
          'cohort',
        );
      }
      return lifeTableResult(cohortTable(ages, column(rows, 1)), 'cohort');
    },
  },
  {
    id: 'period',
    label: 'demography.c.period',
    fields: [
      {
        id: 'data',
        label: 'demography.f.periodData',
        kind: 'data',
        initial:
          '0 0.02 0.1\n1 0.002 1.6\n5 0.0005\n10 0.0004\n15 0.001\n20 0.0015\n30 0.002\n40 0.004\n50 0.009\n60 0.02\n70 0.05\n80 0.15',
        help: 'demography.h.periodData',
      },
    ],
    solve: (read) => {
      const rows = read.rows('data');
      return lifeTableResult(
        periodTable(
          column(rows, 0),
          column(rows, 1),
          rows.map((r) => (r.length > 2 ? r[2] : null)),
        ),
        'period',
      );
    },
  },
  {
    id: 'fecundity',
    label: 'demography.c.fecundity',
    fields: [
      {
        id: 'data',
        label: 'demography.f.fecundityData',
        kind: 'data',
        initial: '0 1 0\n1 0.8 1\n2 0.5 2\n3 0.2 1',
        help: 'demography.h.fecundityData',
      },
    ],
    solve: (read) => {
      const rows = read.rows('data');
      if (rows.some((r) => r.length < 3)) throw new LsError('demography.e.columns', { n: 3 });
      return fecundityResult(column(rows, 0), column(rows, 1), column(rows, 2));
    },
  },
  {
    id: 'fertility',
    label: 'demography.c.fertility',
    fields: [
      {
        id: 'data',
        label: 'demography.f.asfr',
        kind: 'data',
        initial: '15 0.05\n20 0.10\n25 0.12\n30 0.08\n35 0.03\n40 0.01\n45 0.002',
        help: 'demography.h.asfr',
      },
      { id: 'n', label: 'demography.f.width', initial: '5' },
      { id: 'f', label: 'demography.f.femaleShare', initial: '0.4878', help: 'demography.h.femaleShare' },
    ],
    solve: (read) => {
      const rows = read.rows('data');
      return fertilityResult(
        column(rows, 0),
        column(rows, 1),
        read.num('n'),
        read.num('f'),
        rows.map((r) => (r.length > 2 ? r[2] : null)),
      );
    },
  },
  {
    id: 'rates',
    label: 'demography.c.rates',
    fields: [
      { id: 'B', label: 'demography.f.births', initial: '12000' },
      { id: 'D', label: 'demography.f.deaths', initial: '8000' },
      { id: 'P', label: 'demography.f.population', initial: '1000000' },
      { id: 'M', label: 'demography.f.migrants', initial: '2000' },
      { id: 'young', label: 'demography.f.young', initial: '', optional: true },
      { id: 'old', label: 'demography.f.old', initial: '', optional: true },
    ],
    solve: (read) =>
      ratesResult(read.num('B'), read.num('D'), read.num('P'), read.opt('M') ?? 0, read.opt('young'), read.opt('old')),
  },
  {
    id: 'matrix',
    label: 'demography.c.matrix',
    fields: [
      {
        id: 'A',
        label: 'demography.f.matrix',
        kind: 'data',
        initial: '0 1.5 1.0\n0.5 0 0\n0 0.4 0',
        help: 'demography.h.matrix',
      },
      { id: 'start', label: 'demography.f.start', kind: 'data', initial: '100 50 20', help: 'demography.h.start' },
      { id: 't', label: 'demography.f.steps', initial: '20' },
    ],
    solve: (read) => {
      const start = read.text('start').trim() === '' ? null : read.rows('start').flat();
      return matrixResult(read.rows('A'), start, read.num('t'));
    },
  },
  {
    id: 'projection',
    label: 'demography.c.projection',
    fields: [
      {
        id: 'data',
        label: 'demography.f.groups',
        kind: 'data',
        initial:
          '0 5000 0.995 0 0\n5 4800 0.998 0 0\n10 4700 0.997 0 100\n15 4600 0.996 0.03 200\n20 4500 0.995 0.1 200\n' +
          '25 4400 0.994 0.12 100\n30 4300 0.993 0.08 0\n35 4200 0.99 0.03 0\n40 4100 0.985 0.01 0\n45 4000 0.6 0 0',
        help: 'demography.h.groups',
      },
      { id: 'steps', label: 'demography.f.projectionSteps', initial: '4' },
      { id: 'srb', label: 'demography.f.srb', initial: '1.05' },
      { id: 's0', label: 'demography.f.birthSurvival', initial: '0.98' },
    ],
    solve: (read) => {
      const rows = read.rows('data');
      if (rows.some((r) => r.length < 4)) throw new LsError('demography.e.columns', { n: 4 });
      const groups = rows.map(([start, population, survival, asfr, migrants]) => ({
        start,
        population,
        survival,
        asfr,
        migrants: migrants ?? 0,
      }));
      return cohortComponentResult(groups, read.num('steps'), read.num('srb'), read.num('s0'));
    },
  },
  {
    id: 'pyramid',
    label: 'demography.c.pyramid',
    fields: [
      {
        id: 'data',
        label: 'demography.f.pyramid',
        kind: 'data',
        initial:
          '0–9\t620\t590\t540\t520\n10–19\t600\t580\t600\t580\n20–29\t560\t550\t590\t575\n30–39\t500\t505\t550\t545\n' +
          '40–49\t430\t440\t490\t495\n50–59\t340\t360\t420\t430\n60–69\t220\t260\t320\t350\n70+\t120\t190\t180\t260',
        help: 'demography.h.pyramid',
      },
      {
        id: 'scale',
        label: 'demography.f.scale',
        kind: 'select',
        options: [
          { value: 'percent', label: 'demography.o.percent' },
          { value: 'count', label: 'demography.o.count' },
        ],
      },
    ],
    solve: (read) => {
      const { labels, rows } = read.table('data');
      return pyramidResult(labels, rows, read.choice('scale') !== 'count');
    },
  },
];

export const tool: ToolSpec = { calcs };
