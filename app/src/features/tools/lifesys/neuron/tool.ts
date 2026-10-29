// The neuron tool's calculations: what each form asks for, and which engine answers it. The Hodgkin-Huxley forms are
// simulations, so they run when Run is pressed.
import type { CalcSpec, FieldSpec, ToolSpec } from '../types';
import {
  cableResult,
  currentClampResult,
  donnanResult,
  ghkCurrentResult,
  ghkResult,
  lifResult,
  nernstResult,
  rcResult,
  synapseResult,
  thresholdResult,
  velocityResult,
  voltageClampResult,
  type Block,
  type Kinetics,
  type Protocol,
} from './engine';

const num = (id: string, label: FieldSpec['label'], initial: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({
  id,
  label,
  initial,
  ...extra,
});
const temp = (initial: string): FieldSpec => num('T', 'neuron.f.T', initial, { unit: 'temperature' });
const BLOCK: FieldSpec = {
  id: 'block',
  label: 'neuron.f.block',
  kind: 'select',
  options: [
    { value: 'none', label: 'neuron.o.none' },
    { value: 'ttx', label: 'neuron.o.ttx' },
    { value: 'tea', label: 'neuron.o.tea' },
  ],
};
const ION: Record<string, number> = { K: 1, Na: 1, Cl: -1, Ca: 2 };

const calcs: CalcSpec[] = [
  {
    id: 'nernst',
    label: 'neuron.c.nernst',
    fields: (choice) => [
      {
        id: 'ion',
        label: 'neuron.f.ion',
        kind: 'select',
        options: [
          { value: 'K', label: 'neuron.o.K' },
          { value: 'Na', label: 'neuron.o.Na' },
          { value: 'Cl', label: 'neuron.o.Cl' },
          { value: 'Ca', label: 'neuron.o.Ca' },
          { value: 'other', label: 'neuron.o.other' },
        ],
      },
      ...(choice('ion') === 'other' ? [num('z', 'neuron.f.z', '1')] : []),
      num('out', 'neuron.f.out', '5', { unit: 'mM' }),
      num('in', 'neuron.f.in', '140', { unit: 'mM' }),
      temp('37'),
    ],
    solve: (read) => {
      const ion = read.choice('ion') || 'K';
      return nernstResult(ion === 'other' ? read.num('z') : ION[ion], read.num('out'), read.num('in'), read.num('T'));
    },
  },
  {
    id: 'ghk',
    label: 'neuron.c.ghk',
    fields: [
      num('pK', 'neuron.f.pK', '1'),
      num('pNa', 'neuron.f.pNa', '0.04'),
      num('pCl', 'neuron.f.pCl', '0.45'),
      num('kOut', 'neuron.f.kOut', '5', { unit: 'mM' }),
      num('kIn', 'neuron.f.kIn', '140', { unit: 'mM' }),
      num('naOut', 'neuron.f.naOut', '145', { unit: 'mM' }),
      num('naIn', 'neuron.f.naIn', '15', { unit: 'mM' }),
      num('clOut', 'neuron.f.clOut', '110', { unit: 'mM' }),
      num('clIn', 'neuron.f.clIn', '10', { unit: 'mM' }),
      temp('37'),
    ],
    solve: (read) =>
      ghkResult(
        {
          pK: read.num('pK'),
          pNa: read.num('pNa'),
          pCl: read.num('pCl'),
          kOut: read.num('kOut'),
          kIn: read.num('kIn'),
          naOut: read.num('naOut'),
          naIn: read.num('naIn'),
          clOut: read.num('clOut'),
          clIn: read.num('clIn'),
        },
        read.num('T'),
      ),
  },
  {
    id: 'ghkCurrent',
    label: 'neuron.c.ghkCurrent',
    fields: [
      num('P', 'neuron.f.P', '1e-6'),
      num('z', 'neuron.f.z', '1'),
      num('in', 'neuron.f.in', '140', { unit: 'mM' }),
      num('out', 'neuron.f.out', '5', { unit: 'mM' }),
      num('V', 'neuron.f.V', '-60'),
      temp('37'),
    ],
    solve: (read) =>
      ghkCurrentResult(read.num('P'), read.num('z'), read.num('in'), read.num('out'), read.num('V'), read.num('T')),
  },
  {
    id: 'donnan',
    label: 'neuron.c.donnan',
    fields: [
      num('c', 'neuron.f.salt', '100', { unit: 'mM' }),
      num('a', 'neuron.f.anion', '50', { unit: 'mM' }),
      num('zA', 'neuron.f.zA', '-1'),
      temp('25'),
    ],
    solve: (read) => donnanResult(read.num('c'), read.num('a'), read.num('zA'), read.num('T')),
  },
  {
    id: 'rc',
    label: 'neuron.c.rc',
    fields: [
      num('rm', 'neuron.f.rm', '20000'),
      num('cm', 'neuron.f.cm', '1'),
      num('d', 'neuron.f.cellD', '20'),
      num('I', 'neuron.f.iPa', '50'),
    ],
    solve: (read) => rcResult(read.num('rm'), read.num('cm'), read.num('d'), read.num('I')),
  },
  {
    id: 'hh',
    label: 'neuron.c.hh',
    manual: true,
    fields: (choice) => {
      const protocol = (choice('protocol') || 'step') as Protocol;
      return [
        {
          id: 'protocol',
          label: 'neuron.f.protocol',
          kind: 'select',
          options: [
            { value: 'step', label: 'neuron.o.step' },
            { value: 'pulse', label: 'neuron.o.pulse' },
            { value: 'train', label: 'neuron.o.train' },
            { value: 'pair', label: 'neuron.o.pair' },
          ],
        },
        num('amp', 'neuron.f.amp', '10'),
        num('start', 'neuron.f.start', '0', { unit: 'ms' }),
        ...(protocol === 'step' ? [] : [num('width', 'neuron.f.width', '0.5', { unit: 'ms' })]),
        ...(protocol === 'train' ? [num('rate', 'neuron.f.freq', '50')] : []),
        ...(protocol === 'pair' ? [num('rate', 'neuron.f.interval', '10', { unit: 'ms' })] : []),
        num('tEnd', 'neuron.f.tEnd', '50', { unit: 'ms' }),
        BLOCK,
        temp('6.3'),
      ];
    },
    solve: (read) => {
      const protocol = (read.choice('protocol') || 'step') as Protocol;
      return currentClampResult(
        {
          protocol,
          amp: read.num('amp'),
          start: read.num('start'),
          width: protocol === 'step' ? 0 : read.num('width'),
          rate: protocol === 'train' || protocol === 'pair' ? read.num('rate') : 0,
        },
        read.num('tEnd'),
        (read.choice('block') || 'none') as Block,
        read.num('T'),
      );
    },
  },
  {
    id: 'clamp',
    label: 'neuron.c.clamp',
    fields: [
      num('hold', 'neuron.f.hold', '-65'),
      num('step', 'neuron.f.stepV', '0'),
      num('width', 'neuron.f.clampWidth', '10', { unit: 'ms' }),
      BLOCK,
      temp('6.3'),
    ],
    solve: (read) =>
      voltageClampResult(
        read.num('hold'),
        read.num('step'),
        read.num('width'),
        (read.choice('block') || 'none') as Block,
        read.num('T'),
      ),
  },
  {
    id: 'threshold',
    label: 'neuron.c.threshold',
    manual: true,
    fields: [
      num('width', 'neuron.f.width', '0.5', { unit: 'ms' }),
      num('interval', 'neuron.f.testInterval', '', { unit: 'ms', optional: true, help: 'neuron.h.testInterval' }),
      temp('6.3'),
    ],
    solve: (read) => thresholdResult(read.num('width'), read.num('T'), read.opt('interval')),
  },
  {
    id: 'lif',
    label: 'neuron.c.lif',
    fields: [
      num('tau', 'neuron.f.tauM', '10', { unit: 'ms' }),
      num('el', 'neuron.f.eL', '-65'),
      num('reset', 'neuron.f.reset', '-65'),
      num('th', 'neuron.f.th', '-50'),
      num('r', 'neuron.f.rMohm', '10'),
      num('i', 'neuron.f.iNa', '2'),
      num('ref', 'neuron.f.ref', '0', { unit: 'ms' }),
      num('t', 'neuron.f.tEnd', '100', { unit: 'ms' }),
    ],
    solve: (read) =>
      lifResult(
        {
          tau: read.num('tau'),
          el: read.num('el'),
          reset: read.num('reset'),
          th: read.num('th'),
          r: read.num('r'),
          i: read.num('i'),
          ref: read.num('ref'),
        },
        read.num('t'),
      ),
  },
  {
    id: 'cable',
    label: 'neuron.c.cable',
    fields: [
      num('rm', 'neuron.f.rm', '20000'),
      num('ri', 'neuron.f.ri', '100'),
      num('d', 'neuron.f.axonD', '2'),
      num('cm', 'neuron.f.cm', '1'),
      num('x', 'neuron.f.x', '2'),
    ],
    solve: (read) => cableResult(read.num('rm'), read.num('ri'), read.num('d'), read.num('cm'), read.num('x')),
  },
  {
    id: 'velocity',
    label: 'neuron.c.velocity',
    fields: [num('d', 'neuron.f.axonD', '10'), num('L', 'neuron.f.distance', '', { optional: true })],
    solve: (read) => velocityResult(read.num('d'), read.opt('L')),
  },
  {
    id: 'synapse',
    label: 'neuron.c.synapse',
    manual: true,
    fields: (choice) => [
      {
        id: 'kind',
        label: 'neuron.f.kinetics',
        kind: 'select',
        options: [
          { value: 'alpha', label: 'neuron.o.alpha' },
          { value: 'dual', label: 'neuron.o.dual' },
        ],
      },
      num('g', 'neuron.f.gSyn', '1'),
      num('tau', choice('kind') === 'dual' ? 'neuron.f.tauDecay' : 'neuron.f.tauSyn', '2', { unit: 'ms' }),
      ...(choice('kind') === 'dual' ? [num('rise', 'neuron.f.tauRise', '0.5', { unit: 'ms' })] : []),
      num('eSyn', 'neuron.f.eSyn', '0'),
      num('events', 'neuron.f.events', '1'),
      num('interval', 'neuron.f.eventInterval', '5', { unit: 'ms' }),
      num('synapses', 'neuron.f.synapses', '1'),
      num('eL', 'neuron.f.eL', '-70'),
      num('rin', 'neuron.f.rin', '100'),
      num('tauM', 'neuron.f.tauM', '20', { unit: 'ms' }),
      num('gInh', 'neuron.f.gInh', '0', { help: 'neuron.h.gInh' }),
      num('eInh', 'neuron.f.eInh', '-70'),
    ],
    solve: (read) => {
      const kind = (read.choice('kind') || 'alpha') as Kinetics;
      return synapseResult({
        kind,
        g: read.num('g'),
        tau: read.num('tau'),
        rise: kind === 'dual' ? read.num('rise') : 0,
        eSyn: read.num('eSyn'),
        events: read.num('events'),
        interval: read.num('interval'),
        synapses: read.num('synapses'),
        eL: read.num('eL'),
        rin: read.num('rin'),
        tauM: read.num('tauM'),
        gInh: read.num('gInh'),
        eInh: read.num('eInh'),
      });
    },
  },
];

export const tool: ToolSpec = { calcs };
