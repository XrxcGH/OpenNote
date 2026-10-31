// The bench tool's calculations: what each form asks for, and which engine answers it. A molar mass field also
// takes a formula such as NaCl, worked out by the chemistry calculators' formula reader.
import { molarMass } from '../../chem/calc/formula';
import { LsError } from '../num/errors';
import type { CalcSpec, FieldSpec, Reader, ToolSpec } from '../types';
import { parseNumber } from '../ui/text';
import {
  bufferResult,
  calibrationResult,
  centrifugeResult,
  convertResult,
  ddctResult,
  dilution,
  growthResult,
  hemocytometerResult,
  masterMixResult,
  massResult,
  microscopeResult,
  moiResult,
  percentResult,
  pfafflResult,
  platesResult,
  reticleResult,
  seedingResult,
  serialResult,
  standardCurveResult,
} from './engine';
import type { Percent } from './engine';

const num = (id: string, label: FieldSpec['label'], initial: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({
  id,
  label,
  initial,
  ...extra,
});

const molarMassField: FieldSpec = {
  id: 'mm',
  label: 'bench.f.molarMass',
  kind: 'text',
  initial: '58.44',
  help: 'bench.h.molarMass',
};

function readMolarMass(read: Reader): number {
  const text = read.text('mm').trim();
  const typed = parseNumber(text);
  if (typed !== null && !Number.isNaN(typed)) return typed;
  const fromFormula = text === '' ? null : molarMass(text);
  if (fromFormula === null) throw new LsError('bench.e.formula');
  return fromFormula;
}

const calcs: CalcSpec[] = [
  {
    id: 'mass',
    label: 'bench.c.mass',
    fields: [
      num('c', 'bench.f.concentration', '0.5', { unit: 'molar' }),
      num('v', 'bench.f.volume', '250', { unit: 'volume' }),
      molarMassField,
    ],
    solve: (read) => massResult(read.num('c'), read.num('v'), readMolarMass(read)),
  },
  {
    id: 'percent',
    label: 'bench.c.percent',
    fields: [
      {
        id: 'kind',
        label: 'bench.f.percentKind',
        kind: 'select',
        options: [
          { value: 'wv', label: 'bench.o.wv' },
          { value: 'vv', label: 'bench.o.vv' },
          { value: 'ppm', label: 'bench.o.ppm' },
          { value: 'ppb', label: 'bench.o.ppb' },
        ],
      },
      num('x', 'bench.f.amount', '2'),
      num('v', 'bench.f.finalVolume', '500', { unit: 'volume' }),
    ],
    solve: (read) => percentResult(read.choice('kind') as Percent, read.num('x'), read.num('v')),
  },
  {
    id: 'convert',
    label: 'bench.c.convert',
    fields: [
      num('c', 'bench.f.concentration', '0.15', { unit: 'molar' }),
      molarMassField,
      num('rho', 'bench.f.density', '1.0', { help: 'bench.h.density' }),
    ],
    solve: (read) => convertResult(read.num('c'), readMolarMass(read), read.num('rho')),
  },
  {
    id: 'dilution',
    label: 'bench.c.dilution',
    intro: 'bench.i.dilution',
    fields: [
      num('c1', 'bench.f.c1', '10', { optional: true }),
      num('v1', 'bench.f.v1', '', { unit: 'volume', optional: true }),
      num('c2', 'bench.f.c2', '1', { optional: true }),
      num('v2', 'bench.f.v2', '500', { unit: 'volume', optional: true }),
    ],
    solve: (read) => dilution(read.opt('c1'), read.opt('v1'), read.opt('c2'), read.opt('v2')),
  },
  {
    id: 'serial',
    label: 'bench.c.serial',
    fields: [
      num('c0', 'bench.f.c0', '1000'),
      num('f', 'bench.f.factor', '10'),
      num('n', 'bench.f.tubes', '6'),
      num('v', 'bench.f.tubeVolume', '1', { unit: 'volume' }),
    ],
    solve: (read) => serialResult(read.num('c0'), read.num('f'), read.num('n'), read.num('v')),
  },
  {
    id: 'mix',
    label: 'bench.c.mix',
    fields: [
      {
        id: 'parts',
        label: 'bench.f.parts',
        kind: 'data',
        initial: 'Buffer (10x)\t2\nPrimer mix\t1\nPolymerase\t0.2\nWater\t13.8',
        help: 'bench.h.parts',
      },
      num('n', 'bench.f.reactions', '8'),
      num('o', 'bench.f.overage', '10'),
    ],
    solve: (read) => {
      const { labels, rows } = read.table('parts');
      return masterMixResult(
        labels,
        rows.map((r) => r[0]),
        read.num('n'),
        read.num('o'),
      );
    },
  },
  {
    id: 'buffer',
    label: 'bench.c.buffer',
    fields: [
      num('pH', 'bench.f.pH', '7.2'),
      num('pKa', 'bench.f.pKa', '7.21'),
      num('c', 'bench.f.bufferConc', '0.1', { unit: 'molar' }),
      num('v', 'bench.f.volume', '100', { unit: 'volume' }),
      num('ca', 'bench.f.acidStock', '', { unit: 'molar', optional: true }),
      num('cb', 'bench.f.baseStock', '', { unit: 'molar', optional: true }),
    ],
    solve: (read) =>
      bufferResult(read.num('pH'), read.num('pKa'), read.num('c'), read.num('v'), read.opt('ca'), read.opt('cb')),
  },
  {
    id: 'centrifuge',
    label: 'bench.c.centrifuge',
    fields: (choice) => [
      {
        id: 'mode',
        label: 'bench.f.centrifugeMode',
        kind: 'select',
        options: [
          { value: 'rcf', label: 'bench.o.toRcf' },
          { value: 'rpm', label: 'bench.o.toRpm' },
        ],
      },
      choice('mode') === 'rpm' ? num('x', 'bench.f.rcf', '1000') : num('x', 'bench.f.rpm', '5000'),
      num('r', 'bench.f.radius', '10', { unit: 'radius' }),
    ],
    solve: (read) => centrifugeResult(read.choice('mode') === 'rpm' ? 'rpm' : 'rcf', read.num('x'), read.num('r')),
  },
  {
    id: 'hemocytometer',
    label: 'bench.c.hemocytometer',
    fields: [
      num('live', 'bench.f.live', '100'),
      num('dead', 'bench.f.dead', '0'),
      num('q', 'bench.f.squares', '4'),
      num('d', 'bench.f.dilutionFactor', '2'),
      num('v', 'bench.f.suspensionVolume', '', { unit: 'volume', optional: true }),
    ],
    solve: (read) =>
      hemocytometerResult(read.num('live'), read.num('dead'), read.num('q'), read.num('d'), read.opt('v')),
  },
  {
    id: 'seeding',
    label: 'bench.c.seeding',
    fields: [
      num('density', 'bench.f.seedDensity', '20000'),
      num('area', 'bench.f.wellArea', '0.32', { help: 'bench.h.wellArea' }),
      num('wells', 'bench.f.wells', '96'),
      num('c', 'bench.f.cellConc', '500000'),
      num('extra', 'bench.f.overage', '10'),
    ],
    solve: (read) =>
      seedingResult(read.num('density'), read.num('area'), read.num('wells'), read.num('c'), read.num('extra')),
  },
  {
    id: 'plates',
    label: 'bench.c.plates',
    fields: [
      {
        id: 'kind',
        label: 'bench.f.plateKind',
        kind: 'select',
        options: [
          { value: 'cfu', label: 'bench.o.cfu' },
          { value: 'pfu', label: 'bench.o.pfu' },
        ],
      },
      num('n', 'bench.f.colonies', '150'),
      num('v', 'bench.f.plated', '0.1', { unit: 'volume' }),
      num('d', 'bench.f.dilution', '1e-5', { help: 'bench.h.dilution' }),
    ],
    solve: (read) =>
      platesResult(read.num('n'), read.num('v'), read.num('d'), read.choice('kind') === 'pfu' ? 'pfu' : 'cfu'),
  },
  {
    id: 'moi',
    label: 'bench.c.moi',
    intro: 'bench.i.moi',
    fields: [
      num('m', 'bench.f.moi', '1', { optional: true }),
      num('cells', 'bench.f.cells', '', { optional: true }),
      num('titer', 'bench.f.titer', '', { optional: true }),
      num('v', 'bench.f.virusVolume', '', { unit: 'volume', optional: true }),
    ],
    solve: (read) => moiResult(read.opt('m'), read.opt('cells'), read.opt('titer'), read.opt('v')),
  },
  {
    id: 'growth',
    label: 'bench.c.growth',
    fields: [
      {
        id: 'data',
        label: 'bench.f.growthData',
        kind: 'data',
        initial: '0 0.05\n1 0.08\n2 0.15\n3 0.29\n4 0.55\n5 0.9\n6 1.2',
        help: 'bench.h.growthData',
      },
      num('from', 'bench.f.from', '0', { optional: true }),
      num('to', 'bench.f.to', '4', { optional: true }),
      { id: 'unit', label: 'bench.f.timeUnit', kind: 'text', initial: 'h' },
    ],
    solve: (read) => growthResult(read.rows('data'), read.opt('from'), read.opt('to'), read.text('unit').trim() || 'h'),
  },
  {
    id: 'ddct',
    label: 'bench.c.ddct',
    fields: [
      num('tt', 'bench.f.targetTreated', '25'),
      num('rt', 'bench.f.refTreated', '18'),
      num('tc', 'bench.f.targetControl', '27'),
      num('rc', 'bench.f.refControl', '18.5'),
    ],
    solve: (read) => ddctResult(read.num('tt'), read.num('rt'), read.num('tc'), read.num('rc')),
  },
  {
    id: 'pfaffl',
    label: 'bench.c.pfaffl',
    fields: [
      num('et', 'bench.f.eTarget', '1.95', { help: 'bench.h.efficiency' }),
      num('er', 'bench.f.eRef', '2.0'),
      num('dt', 'bench.f.dTarget', '2'),
      num('dr', 'bench.f.dRef', '0.5'),
    ],
    solve: (read) => pfafflResult(read.num('et'), read.num('er'), read.num('dt'), read.num('dr')),
  },
  {
    id: 'standard',
    label: 'bench.c.standard',
    fields: [
      {
        id: 'data',
        label: 'bench.f.standards',
        kind: 'data',
        initial: '7 14.1\n6 17.4\n5 20.8\n4 24.1\n3 27.4',
        help: 'bench.h.standards',
      },
      num('ct', 'bench.f.unknownCt', '22', { optional: true }),
    ],
    solve: (read) => standardCurveResult(read.rows('data'), read.opt('ct')),
  },
  {
    id: 'microscope',
    label: 'bench.c.microscope',
    fields: [
      num('o', 'bench.f.objective', '40'),
      num('e', 'bench.f.eyepiece', '10'),
      num('fn', 'bench.f.fieldNumber', '22', { optional: true }),
      num('l', 'bench.f.wavelength', '550', { unit: 'wavelength' }),
      num('na', 'bench.f.na', '0.65'),
    ],
    solve: (read) => microscopeResult(read.num('o'), read.num('e'), read.opt('fn'), read.num('l'), read.num('na')),
  },
  {
    id: 'reticle',
    label: 'bench.c.reticle',
    fields: [
      num('s', 'bench.f.stageLength', '100', { unit: 'micron' }),
      num('n', 'bench.f.divisions', '40'),
      num('bar', 'bench.f.bar', '10', { unit: 'micron', optional: true }),
    ],
    solve: (read) => reticleResult(read.num('s'), read.num('n'), read.opt('bar')),
  },
  {
    id: 'calibration',
    label: 'bench.c.calibration',
    fields: [
      {
        id: 'data',
        label: 'bench.f.calData',
        kind: 'data',
        initial: '0 0.002\n1 0.051\n2 0.099\n4 0.201\n8 0.398',
        help: 'bench.h.calData',
      },
      {
        id: 'degree',
        label: 'bench.f.model',
        kind: 'select',
        options: [
          { value: '1', label: 'bench.o.linear' },
          { value: '2', label: 'bench.o.quadratic' },
        ],
      },
      { id: 'unknowns', label: 'bench.f.unknowns', kind: 'data', initial: '0.15 0.3', help: 'bench.h.unknowns' },
      num('sigma', 'bench.f.sigma', '0.002', { optional: true }),
    ],
    solve: (read) => {
      const unknownText = read.text('unknowns').trim();
      const unknowns = unknownText === '' ? [] : read.rows('unknowns').flat();
      return calibrationResult(read.rows('data'), read.choice('degree') === '2' ? 2 : 1, unknowns, read.opt('sigma'));
    },
  },
];

export const tool: ToolSpec = { calcs };
