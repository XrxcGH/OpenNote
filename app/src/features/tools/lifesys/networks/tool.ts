// The network tool's calculations: what each form asks for, and which engine answers it. Stochastic and grid models
// are simulations, so they run when Run is pressed; each takes a seed, shown with its result.
import type { CalcSpec, FieldSpec, Reader, ToolSpec } from '../types';
import {
  PRESETS,
  elementaryResult,
  epidemicResult,
  latticeSirResult,
  lifeResult,
  networkResult,
  networkSirResult,
  r0Result,
  reactionResult,
  reedFrostResult,
  schellingResult,
  thresholdModelResult,
  voterResult,
  type Compartment,
  type Generator,
  type Preset,
} from './engine';

const num = (id: string, label: FieldSpec['label'], initial: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({
  id,
  label,
  initial,
  ...extra,
});
const select = (id: string, label: FieldSpec['label'], options: [string, FieldSpec['label']][]): FieldSpec => ({
  id,
  label,
  kind: 'select',
  options: options.map(([value, l]) => ({ value, label: l })),
});
const SEED = num('seed', 'networks.f.seed', '1');

const graphFields = (choice: (id: string) => string): FieldSpec[] => {
  const kind = choice('gen') || 'er';
  return [
    select('gen', 'networks.f.generator', [
      ['er', 'networks.o.er'],
      ['ws', 'networks.o.ws'],
      ['ba', 'networks.o.ba'],
    ]),
    num('n', 'networks.f.nodes', '200'),
    ...(kind === 'er' ? [num('p', 'networks.f.edgeP', '0.03')] : []),
    ...(kind === 'ws' ? [num('k', 'networks.f.k', '4'), num('beta', 'networks.f.rewire', '0.1')] : []),
    ...(kind === 'ba' ? [num('m', 'networks.f.m', '2')] : []),
  ];
};
const readGraph = (read: Reader) => {
  const kind = (read.choice('gen') || 'er') as Generator;
  return {
    kind,
    n: read.num('n'),
    p: kind === 'er' ? read.num('p') : kind === 'ws' ? read.num('beta') : 0,
    k: kind === 'ws' ? read.num('k') : 0,
    m: kind === 'ba' ? read.num('m') : 0,
  };
};

const calcs: CalcSpec[] = [
  {
    id: 'epidemic',
    label: 'networks.c.epidemic',
    fields: (choice) => {
      const model = (choice('model') || 'sir') as Compartment;
      return [
        select('model', 'networks.f.model', [
          ['sir', 'networks.o.sir'],
          ['seir', 'networks.o.seir'],
          ['sirs', 'networks.o.sirs'],
          ['sis', 'networks.o.sis'],
          ['si', 'networks.o.si'],
        ]),
        num('n', 'networks.f.population', '1000'),
        num('i0', 'networks.f.i0', '1'),
        num('beta', 'networks.f.beta', '0.5', { help: 'networks.h.beta' }),
        ...(model === 'si' ? [] : [num('gamma', 'networks.f.gamma', '0.2')]),
        ...(model === 'seir' ? [num('sigma', 'networks.f.sigma', '0.5')] : []),
        ...(model === 'sirs' ? [num('omega', 'networks.f.omega', '0.01')] : []),
        num('mu', 'networks.f.mu', '0'),
        num('vacc', 'networks.f.vacc', '0'),
        num('t', 'networks.f.tEnd', '100'),
      ];
    },
    solve: (read) => {
      const model = (read.choice('model') || 'sir') as Compartment;
      return epidemicResult({
        model,
        n: read.num('n'),
        i0: read.num('i0'),
        beta: read.num('beta'),
        gamma: model === 'si' ? 0 : read.num('gamma'),
        sigma: model === 'seir' ? read.num('sigma') : 0,
        omega: model === 'sirs' ? read.num('omega') : 0,
        mu: read.num('mu'),
        vacc: read.num('vacc'),
        t: read.num('t'),
      });
    },
  },
  {
    id: 'r0',
    label: 'networks.c.r0',
    fields: [num('r0', 'networks.f.r0', '2.5'), num('eff', 'networks.f.efficacy', '', { optional: true })],
    solve: (read) => r0Result(read.num('r0'), read.opt('eff')),
  },
  {
    id: 'reedFrost',
    label: 'networks.c.reedFrost',
    manual: true,
    fields: [
      num('n', 'networks.f.population', '50'),
      num('i0', 'networks.f.i0', '1'),
      num('p', 'networks.f.contactP', '0.04'),
      num('g', 'networks.f.generations', '20'),
      num('runs', 'networks.f.runs', '500'),
      SEED,
    ],
    solve: (read) =>
      reedFrostResult(read.num('n'), read.num('i0'), read.num('p'), read.num('g'), read.num('runs'), read.num('seed')),
  },
  {
    id: 'reactions',
    label: 'networks.c.reactions',
    intro: 'networks.i.reactions',
    manual: true,
    fields: (choice) => {
      const preset = (choice('preset') || 'birthDeath') as Preset;
      const p = PRESETS[preset] ?? PRESETS.birthDeath;
      return [
        select('preset', 'networks.f.preset', [
          ['birthDeath', 'networks.o.birthDeath'],
          ['gene', 'networks.o.gene'],
          ['toggle', 'networks.o.toggle'],
          ['repressilator', 'networks.o.repressilator'],
          ['enzyme', 'networks.o.enzyme'],
          ['lotka', 'networks.o.lotka'],
          ['box', 'networks.o.box'],
        ]),
        // Each preset keeps its own text, so switching back finds the edits made there.
        {
          id: `rx_${preset}`,
          label: 'networks.f.reactions',
          kind: 'data',
          initial: p.text,
          help: 'networks.h.reactions',
        },
        { id: `x0_${preset}`, label: 'networks.f.initial', kind: 'data', initial: p.init, help: 'networks.h.initial' },
        num(`t_${preset}`, 'networks.f.tEnd', String(p.t)),
        select('method', 'networks.f.method', [
          ['both', 'networks.o.both'],
          ['ode', 'networks.o.ode'],
          ['ssa', 'networks.o.ssa'],
        ]),
        num('runs', 'networks.f.runs', '50'),
        SEED,
      ];
    },
    solve: (read) => {
      const preset = read.choice('preset') || 'birthDeath';
      return reactionResult(
        read.text(`rx_${preset}`),
        read.table(`x0_${preset}`),
        read.num(`t_${preset}`),
        (read.choice('method') || 'both') as 'ode' | 'ssa' | 'both',
        read.num('runs'),
        read.num('seed'),
      );
    },
  },
  {
    id: 'schelling',
    label: 'networks.c.schelling',
    manual: true,
    fields: [
      num('n', 'networks.f.gridSize', '20'),
      num('empty', 'networks.f.empty', '0.1'),
      num('tol', 'networks.f.tolerance', '0.3', { help: 'networks.h.tolerance' }),
      num('steps', 'networks.f.maxRounds', '100'),
      SEED,
    ],
    solve: (read) =>
      schellingResult(read.num('n'), read.num('empty'), read.num('tol'), read.num('seed'), read.num('steps')),
  },
  {
    id: 'latticeSir',
    label: 'networks.c.latticeSir',
    manual: true,
    fields: [
      num('n', 'networks.f.gridSize', '50'),
      num('beta', 'networks.f.betaContact', '0.3'),
      num('gamma', 'networks.f.gammaStep', '0.1'),
      num('i0', 'networks.f.i0', '5'),
      num('steps', 'networks.f.maxSteps', '500'),
      SEED,
    ],
    solve: (read) =>
      latticeSirResult(
        read.num('n'),
        read.num('beta'),
        read.num('gamma'),
        read.num('i0'),
        read.num('seed'),
        read.num('steps'),
      ),
  },
  {
    id: 'networkSir',
    label: 'networks.c.networkSir',
    manual: true,
    fields: (choice) => [
      ...graphFields(choice),
      num('sirBeta', 'networks.f.betaContact', '0.1'),
      num('sirGamma', 'networks.f.gammaStep', '0.2'),
      num('i0', 'networks.f.i0', '2'),
      SEED,
    ],
    solve: (read) => {
      const g = readGraph(read);
      return networkSirResult(
        g.kind,
        g.n,
        g.p,
        g.k,
        g.m,
        read.num('sirBeta'),
        read.num('sirGamma'),
        read.num('i0'),
        read.num('seed'),
      );
    },
  },
  {
    id: 'threshold',
    label: 'networks.c.threshold',
    manual: true,
    fields: (choice) => [
      select('shape', 'networks.f.thresholds', [
        ['uniform', 'networks.o.uniform'],
        ['normal', 'networks.o.normal'],
      ]),
      num('n', 'networks.f.population', '100'),
      ...(choice('shape') === 'normal'
        ? [num('mean', 'networks.f.meanThreshold', '0.25'), num('sd', 'networks.f.sdThreshold', '0.12'), SEED]
        : []),
    ],
    solve: (read) => {
      const normal = read.choice('shape') === 'normal';
      return thresholdModelResult(
        read.num('n'),
        normal ? 'normal' : 'uniform',
        normal ? read.num('mean') : 0,
        normal ? read.num('sd') : 0,
        normal ? read.num('seed') : 0,
      );
    },
  },
  {
    id: 'voter',
    label: 'networks.c.voter',
    manual: true,
    fields: [num('n', 'networks.f.gridSize', '20'), num('sweeps', 'networks.f.sweeps', '2000'), SEED],
    solve: (read) => voterResult(read.num('n'), read.num('seed'), read.num('sweeps')),
  },
  {
    id: 'life',
    label: 'networks.c.life',
    manual: true,
    fields: (choice) => [
      select('pattern', 'networks.f.pattern', [
        ['glider', 'networks.o.glider'],
        ['blinker', 'networks.o.blinker'],
        ['rPentomino', 'networks.o.rPentomino'],
        ['random', 'networks.o.random'],
      ]),
      num('n', 'networks.f.gridSize', '20'),
      num('g', 'networks.f.generations', '40'),
      ...(choice('pattern') === 'random' ? [num('density', 'networks.f.density', '0.3'), SEED] : []),
    ],
    solve: (read) => {
      const random = read.choice('pattern') === 'random';
      return lifeResult(
        read.num('n'),
        read.choice('pattern') || 'glider',
        random ? read.num('density') : 0,
        random ? read.num('seed') : 0,
        read.num('g'),
      );
    },
  },
  {
    id: 'eca',
    label: 'networks.c.eca',
    manual: true,
    fields: (choice) => [
      num('rule', 'networks.f.rule', '30'),
      num('width', 'networks.f.width', '101'),
      num('steps', 'networks.f.ecaSteps', '50'),
      select('start', 'networks.f.start', [
        ['single', 'networks.o.single'],
        ['random', 'networks.o.randomRow'],
      ]),
      ...(choice('start') === 'random' ? [SEED] : []),
    ],
    solve: (read) => {
      const random = read.choice('start') === 'random';
      return elementaryResult(
        read.num('rule'),
        read.num('width'),
        read.num('steps'),
        random ? 'random' : 'single',
        random ? read.num('seed') : 0,
      );
    },
  },
  {
    id: 'network',
    label: 'networks.c.network',
    manual: true,
    fields: (choice) => [...graphFields(choice), SEED],
    solve: (read) => {
      const g = readGraph(read);
      return networkResult(g.kind, g.n, g.p, g.k, g.m, read.num('seed'));
    },
  },
];

export const tool: ToolSpec = { calcs };
