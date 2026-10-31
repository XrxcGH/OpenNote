// The biodiversity tool's calculations: what each form asks for, and which engine answers it.
import type { CalcSpec, FieldSpec, ToolSpec } from '../types';
import {
  accumulationResult,
  dispersionResult,
  indicesResult,
  petersenResult,
  pointQuarterResult,
  quadratResult,
  rarefactionResult,
  richnessResult,
  schnabelResult,
  similarityResult,
} from './engine';
import type { Similarity } from './engine';

const abundances: FieldSpec = {
  id: 'counts',
  label: 'diversity.f.counts',
  kind: 'data',
  initial: '10\n20\n30\n40',
  help: 'diversity.h.counts',
};

const siteTable: FieldSpec = {
  id: 'sites',
  label: 'diversity.f.sites',
  kind: 'data',
  initial: 'Species A\t10\t5\t0\nSpecies B\t0\t5\t3\nSpecies C\t5\t5\t8\nSpecies D\t2\t0\t1',
  help: 'diversity.h.sites',
};

/** All numbers in a data box, whether typed in one column or on one line. */
const flat = (rows: number[][]) => rows.flat();

const calcs: CalcSpec[] = [
  {
    id: 'indices',
    label: 'diversity.c.indices',
    fields: [
      abundances,
      {
        id: 'base',
        label: 'diversity.f.base',
        kind: 'select',
        options: [
          { value: 'e', label: 'diversity.o.ln' },
          { value: '2', label: 'diversity.o.log2' },
        ],
      },
    ],
    solve: (read) => indicesResult(flat(read.rows('counts')), read.choice('base') === '2' ? '2' : 'e'),
  },
  {
    id: 'richness',
    label: 'diversity.c.richness',
    fields: [{ ...abundances, initial: '1\n1\n1\n1\n2\n2\n5\n6\n7\n8' }],
    solve: (read) => richnessResult(flat(read.rows('counts'))),
  },
  {
    id: 'rarefaction',
    label: 'diversity.c.rarefaction',
    fields: [abundances, { id: 'n', label: 'diversity.f.subsample', initial: '10' }],
    solve: (read) => rarefactionResult(flat(read.rows('counts')), read.num('n')),
  },
  {
    id: 'accumulation',
    label: 'diversity.c.accumulation',
    manual: true,
    fields: [
      siteTable,
      { id: 'runs', label: 'diversity.f.runs', initial: '200' },
      { id: 'seed', label: 'diversity.f.seed', initial: '1' },
    ],
    solve: (read) => accumulationResult(read.table('sites').rows, Math.min(read.num('runs'), 5000), read.num('seed')),
  },
  {
    id: 'similarity',
    label: 'diversity.c.similarity',
    fields: [
      siteTable,
      {
        id: 'index',
        label: 'diversity.f.index',
        kind: 'select',
        options: [
          { value: 'jaccard', label: 'diversity.o.jaccard' },
          { value: 'sorensen', label: 'diversity.o.sorensen' },
          { value: 'brayCurtis', label: 'diversity.o.brayCurtis' },
          { value: 'morisitaHorn', label: 'diversity.o.morisitaHorn' },
        ],
      },
    ],
    solve: (read) => similarityResult(read.table('sites').rows, read.choice('index') as Similarity),
  },
  {
    id: 'quadrat',
    label: 'diversity.c.quadrat',
    fields: [
      {
        id: 'species',
        label: 'diversity.f.quadratTable',
        kind: 'data',
        initial: 'Oak\t12\t6\t180\nMaple\t30\t9\t120\nBirch\t8\t4\t40',
        help: 'diversity.h.quadratTable',
      },
      { id: 'q', label: 'diversity.f.quadrats', initial: '10' },
      { id: 'area', label: 'diversity.f.area', initial: '1' },
    ],
    solve: (read) => {
      const { labels, rows } = read.table('species');
      return quadratResult(labels, rows, read.num('q'), read.num('area'));
    },
  },
  {
    id: 'pointQuarter',
    label: 'diversity.c.pointQuarter',
    fields: [
      {
        id: 'distances',
        label: 'diversity.f.distances',
        kind: 'data',
        initial: '1.2 2.0 0.8 1.5\n2.2 1.1 1.7 0.9',
        help: 'diversity.h.distances',
      },
      { id: 'unit', label: 'diversity.f.distanceUnit', kind: 'text', initial: 'm' },
    ],
    solve: (read) => pointQuarterResult(read.rows('distances'), read.text('unit').trim() || 'm'),
  },
  {
    id: 'dispersion',
    label: 'diversity.c.dispersion',
    fields: [
      {
        ...abundances,
        label: 'diversity.f.quadratCounts',
        initial: '0 2 1 4 3 0 5 1',
        help: 'diversity.h.quadratCounts',
      },
    ],
    solve: (read) => dispersionResult(flat(read.rows('counts'))),
  },
  {
    id: 'petersen',
    label: 'diversity.c.petersen',
    fields: [
      { id: 'M', label: 'diversity.f.marked', initial: '50' },
      { id: 'C', label: 'diversity.f.caught', initial: '40' },
      { id: 'R', label: 'diversity.f.recaptured', initial: '10' },
    ],
    solve: (read) => petersenResult(read.num('M'), read.num('C'), read.num('R')),
  },
  {
    id: 'schnabel',
    label: 'diversity.c.schnabel',
    fields: [
      {
        id: 'samples',
        label: 'diversity.f.samples',
        kind: 'data',
        initial: '10 0\n15 2\n12 4\n18 7\n14 6',
        help: 'diversity.h.samples',
      },
    ],
    solve: (read) => schnabelResult(read.rows('samples')),
  },
];

export const tool: ToolSpec = { calcs };
