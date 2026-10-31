// The nuclear science tool's shielding and reactor calculations: narrow-beam attenuation, a point source's dose rate
// with distance and shielding, and the four- and six-factor formulas with one-group criticality of a bare core.
import type { MessageKey } from '../../../../strings/t';
import { N_A } from '../kit/constants';
import { fmt, q, qIn } from '../kit/format';
import type { Reader } from '../kit/read';
import type { KitStep, ModeDef, Outcome, ResultRow } from '../kit/types';
import { fromSI } from '../kit/units';
import {
  attenuate,
  criticalSize,
  geometricBuckling,
  inverseSquare,
  kEffective,
  macroscopic,
  multiplication,
  volume,
} from './engine';
import type { Shape } from './engine';

const K = 'kitPhysics.nuclear';
const perCm = (mu: number) => qIn(mu, 'perLength', '1/cm');
const cm = (m: number) => qIn(m, 'length', 'cm');

/** The linear attenuation coefficient in 1/m, from whichever form was typed, with the step that gets it. */
function readMu(read: Reader): { mu: number; step?: KitStep; macro?: boolean } {
  const given = read.choice('given');
  if (given === 'mass') {
    const muRho = read.num('muRho', 'positive');
    const rho = read.num('rho', 'positive');
    const mu = muRho * rho;
    return {
      mu,
      step: {
        key: `${K}.s.muMass`,
        vars: { muRho: qIn(muRho, 'massAttenuation', 'cm²/g'), rho: qIn(rho, 'density', 'g/cm³'), mu: perCm(mu) },
      },
    };
  }
  if (given === 'cross') {
    const sigma = read.num('sigma', 'positive');
    const rho = read.num('rho', 'positive');
    const molar = read.num('molar', 'positive') / 1000; // g/mol to kg/mol
    const mu = macroscopic(sigma, rho, molar, N_A);
    const atoms = (rho * N_A) / molar;
    return {
      mu,
      macro: true,
      step: {
        key: `${K}.s.macroscopic`,
        vars: {
          rho: qIn(rho, 'density', 'g/cm³'),
          M: q(molar * 1000, 'g/mol'),
          N: q(atoms / 1e6, 'cm⁻³'),
          sigma: qIn(sigma, 'crossSection', 'b'),
          mu: perCm(mu),
        },
      },
    };
  }
  return { mu: read.num('mu', 'positive') };
}

const muFields = [
  {
    id: 'given',
    label: `${K}.f.muGiven` as MessageKey,
    kind: 'choice' as const,
    initial: 'linear',
    options: [
      { value: 'linear', label: `${K}.o.linear` as MessageKey },
      { value: 'mass', label: `${K}.o.massCoefficient` as MessageKey },
      { value: 'cross', label: `${K}.o.crossSection` as MessageKey },
    ],
  },
  {
    id: 'mu',
    label: `${K}.f.mu` as MessageKey,
    dim: 'perLength' as const,
    unit: '1/cm',
    usUnit: '1/in',
    initial: '0.5',
    when: (ch: (id: string) => string) => ch('given') === 'linear',
  },
  {
    id: 'muRho',
    label: `${K}.f.muRho` as MessageKey,
    dim: 'massAttenuation' as const,
    unit: 'cm²/g',
    usUnit: 'cm²/g',
    initial: '0.06',
    when: (ch: (id: string) => string) => ch('given') === 'mass',
  },
  {
    id: 'sigma',
    label: `${K}.f.sigma` as MessageKey,
    dim: 'crossSection' as const,
    unit: 'b',
    usUnit: 'b',
    initial: '2.56',
    when: (ch: (id: string) => string) => ch('given') === 'cross',
  },
  {
    id: 'rho',
    label: `${K}.f.rho` as MessageKey,
    dim: 'density' as const,
    unit: 'g/cm³',
    usUnit: 'g/cm³',
    initial: '7.874',
    when: (ch: (id: string) => string) => ch('given') !== 'linear',
  },
  {
    id: 'molar',
    label: `${K}.f.molar` as MessageKey,
    initial: '55.845',
    when: (ch: (id: string) => string) => ch('given') === 'cross',
  },
];

export const attenuationMode: ModeDef = {
  id: 'attenuation',
  label: `${K}.modes.attenuation`,
  fields: [
    ...muFields,
    { id: 'x', label: `${K}.f.thickness`, dim: 'length', unit: 'cm', usUnit: 'in', initial: '2' },
    { id: 'I0', label: `${K}.f.I0`, initial: '', optional: true, help: `${K}.help.I0` },
  ],
  solve(read): Outcome {
    const { mu, step, macro } = readMu(read);
    const x = read.num('x', 'nonNegative');
    const I0 = read.opt('I0', 'nonNegative');
    const out = attenuate(mu, x);
    const lenRow = (key: MessageKey, symbol: string, value: number): ResultRow => ({
      key,
      symbol,
      value,
      dim: 'length',
      unit: 'cm',
      usUnit: 'in',
    });
    const rows: ResultRow[] = [
      { key: `${K}.r.transmitted`, symbol: 'I/I₀', value: out.transmitted, primary: true },
      ...(I0 !== null ? [{ key: `${K}.r.I` as MessageKey, symbol: 'I', value: I0 * out.transmitted }] : []),
      {
        key: macro ? `${K}.r.macro` : `${K}.r.mu`,
        symbol: macro ? 'Σ' : 'μ',
        value: mu,
        dim: 'perLength',
        unit: '1/cm',
        usUnit: '1/in',
      },
      lenRow(`${K}.r.hvl`, 'HVL', out.hvl),
      lenRow(`${K}.r.tvl`, 'TVL', out.tvl),
      lenRow(`${K}.r.mfp`, 'λ', out.mfp),
      { key: `${K}.r.mfpCount`, symbol: 'μx', value: mu * x },
    ];
    const steps: KitStep[] = [
      ...(step ? [step] : []),
      { key: `${K}.s.attenuate`, vars: { mu: perCm(mu), x: cm(x), mux: fmt(mu * x), T: fmt(out.transmitted) } },
      { key: `${K}.s.hvl`, vars: { mu: perCm(mu), hvl: cm(out.hvl), tvl: cm(out.tvl) } },
    ];
    return {
      ok: true,
      rows,
      latex:
        'I=I_0e^{-\\mu x},\\qquad \\mathrm{HVL}=\\frac{\\ln 2}{\\mu},\\qquad \\mu=\\left(\\frac{\\mu}{\\rho}\\right)\\rho=N\\sigma',
      steps,
      notes: [{ key: `${K}.notes.attenuation` }],
      plot: {
        frame: 'axes',
        alt: { key: `${K}.plot.attenuation`, vars: { hvl: cm(out.hvl) } },
        x: { label: 'x (cm)', min: 0 },
        y: { label: 'I / I₀', min: 0, max: 1 },
        series: [
          {
            points: Array.from({ length: 161 }, (_, i): [number, number] => {
              const at = (Math.max(1.5 * x, 4 * out.hvl) * i) / 160;
              return [fromSI(at, 'length', 'cm'), Math.exp(-mu * at)];
            }),
            tone: 'accent',
            width: 2,
          },
          {
            points: [
              [fromSI(x, 'length', 'cm'), 0],
              [fromSI(x, 'length', 'cm'), out.transmitted],
            ],
            tone: 'danger',
            dash: true,
          },
        ],
        legend: [
          { tone: 'accent', key: `${K}.legend.transmitted` },
          { tone: 'danger', key: `${K}.legend.thickness`, dash: true },
        ],
      },
    };
  },
};

export const doseMode: ModeDef = {
  id: 'dose',
  label: `${K}.modes.dose`,
  fields: [
    { id: 'rate1', label: `${K}.f.rate1`, dim: 'doseRate', unit: 'mSv/h', usUnit: 'mrem/h', initial: '2' },
    { id: 'r1', label: `${K}.f.r1`, dim: 'length', unit: 'm', usUnit: 'ft', initial: '1' },
    { id: 'r2', label: `${K}.f.r2`, dim: 'length', unit: 'm', usUnit: 'ft', initial: '3' },
    {
      id: 'mu',
      label: `${K}.f.shieldMu`,
      dim: 'perLength',
      unit: '1/cm',
      usUnit: '1/in',
      initial: '',
      optional: true,
    },
    { id: 'x', label: `${K}.f.shieldX`, dim: 'length', unit: 'cm', usUnit: 'in', initial: '', optional: true },
    { id: 'hours', label: `${K}.f.stay`, dim: 'time', unit: 'h', usUnit: 'h', initial: '', optional: true },
  ],
  solve(read): Outcome {
    const rate1 = read.num('rate1', 'nonNegative');
    const r1 = read.num('r1', 'positive');
    const r2 = read.num('r2', 'positive');
    const mu = read.opt('mu', 'positive');
    const x = read.opt('x', 'nonNegative');
    const stay = read.opt('hours', 'nonNegative');
    const bare = inverseSquare(rate1, r1, r2);
    const shield = mu !== null && x !== null ? Math.exp(-mu * x) : 1;
    const rate2 = bare * shield;
    const rateText = (value: number) => qIn(value, 'doseRate', read.unit('rate1'));
    const rows: ResultRow[] = [
      {
        key: `${K}.r.rate2`,
        symbol: 'Ḋ₂',
        value: rate2,
        dim: 'doseRate',
        unit: 'mSv/h',
        usUnit: 'mrem/h',
        primary: true,
      },
      { key: `${K}.r.distanceFactor`, symbol: '(r₁/r₂)²', value: (r1 / r2) ** 2 },
    ];
    const steps: KitStep[] = [
      {
        key: `${K}.s.inverseSquare`,
        vars: {
          rate1: rateText(rate1),
          r1: qIn(r1, 'length', read.unit('r1')),
          r2: qIn(r2, 'length', read.unit('r2')),
          rate: rateText(bare),
        },
      },
    ];
    if (shield !== 1 && mu !== null && x !== null) {
      rows.push({ key: `${K}.r.shieldFactor`, symbol: 'e^(−μx)', value: shield });
      steps.push({ key: `${K}.s.shield`, vars: { mu: perCm(mu), x: cm(x), T: fmt(shield), rate: rateText(rate2) } });
    }
    if (stay !== null) {
      const dose = rate2 * stay;
      rows.push({ key: `${K}.r.dose`, symbol: 'D', value: dose * 1000, unit: 'mSv' });
      steps.push({
        key: `${K}.s.dose`,
        vars: { rate: rateText(rate2), t: qIn(stay, 'time', 'h'), D: q(dose * 1000, 'mSv') },
      });
    }
    return {
      ok: true,
      rows,
      latex: '\\dot D_2=\\dot D_1\\left(\\frac{r_1}{r_2}\\right)^2e^{-\\mu x}',
      steps,
      notes: [{ key: `${K}.notes.dose` }, { key: `${K}.notes.coursework` }],
    };
  },
};

const SHAPES: readonly Shape[] = ['sphere', 'cube', 'slab', 'cylinder'];
const optionalFactor = (id: string, label: MessageKey) => ({
  id,
  label,
  initial: '',
  optional: true,
  help: `${K}.help.nonLeakage` as MessageKey,
});

interface Part {
  rows: ResultRow[];
  steps: KitStep[];
}

/** k_inf from the four factors, and k_eff when non-leakage probabilities are given. */
function readFactors(read: Reader): Part & { kInf: number } {
  const chance = (id: string) => read.opt(id, { above: 0, max: 1 }) ?? undefined;
  const factors = {
    eta: read.num('eta', 'positive'),
    epsilon: read.num('epsilon', 'positive'),
    p: read.num('p', { above: 0, max: 1 }),
    f: read.num('f', { above: 0, max: 1 }),
  };
  const fast = chance('fast');
  const thermal = chance('thermal');
  const out = multiplication({
    ...factors,
    ...(fast !== undefined ? { fast } : {}),
    ...(thermal !== undefined ? { thermal } : {}),
  });
  const rows: ResultRow[] = [{ key: `${K}.r.kInf`, symbol: 'k∞', value: out.kInf, primary: true }];
  const vars = { eta: fmt(factors.eta), epsilon: fmt(factors.epsilon), p: fmt(factors.p), f: fmt(factors.f) };
  const steps: KitStep[] = [{ key: `${K}.s.fourFactor`, vars: { ...vars, k: fmt(out.kInf) } }];
  if (fast !== undefined || thermal !== undefined) {
    rows.push({ key: `${K}.r.kSix`, symbol: 'k_eff', value: out.kEff, primary: true });
    steps.push({
      key: `${K}.s.sixFactor`,
      vars: { k: fmt(out.kInf), fast: fmt(fast ?? 1), thermal: fmt(thermal ?? 1), keff: fmt(out.kEff) },
    });
  }
  return { kInf: out.kInf, rows, steps };
}

const lengthRow = (key: MessageKey, symbol: string, value: number, primary = false): ResultRow => ({
  key,
  symbol,
  value,
  dim: 'length',
  unit: 'cm',
  usUnit: 'in',
  primary,
});

const volumeRows = (v: number | null): ResultRow[] =>
  v === null ? [] : [{ key: `${K}.r.volume`, symbol: 'V', value: v * 1000, unit: 'L' }];

/** The size at which a bare core of this shape goes critical. */
function criticalPart(shape: Shape, kInf: number, m2: number, ratio: number): Part {
  const crit = criticalSize(shape, kInf, m2, ratio);
  const rows: ResultRow[] = [
    { key: `${K}.r.buckling`, symbol: 'B²', value: crit.b2, unit: 'm⁻²' },
    lengthRow(`${K}.size.${shape}`, shape === 'slab' || shape === 'cube' ? 'a' : 'R', crit.size, true),
    ...(shape === 'cylinder' ? [lengthRow(`${K}.r.height`, 'H', 2 * ratio * crit.size)] : []),
    ...volumeRows(crit.volume),
  ];
  const steps: KitStep[] = [
    { key: `${K}.s.buckling`, vars: { k: fmt(kInf), m2: qIn(m2, 'area', 'cm²'), b2: q(crit.b2 / 1e4, 'cm⁻²') } },
    {
      key: `${K}.s.size.${shape}`,
      vars: { B: q(Math.sqrt(crit.b2) / 100, 'cm⁻¹'), size: cm(crit.size), ratio: fmt(ratio) },
    },
  ];
  return { rows, steps };
}

/** k_eff of a bare core of a given size. */
function barePart(shape: Shape, kInf: number, m2: number, size: number, ratio: number): Part {
  const b2 = geometricBuckling(shape, size, ratio);
  const keff = kEffective(kInf, m2, b2);
  const state: MessageKey =
    keff.kEff > 1.00005 ? `${K}.kind.super` : keff.kEff < 0.99995 ? `${K}.kind.sub` : `${K}.kind.critical`;
  const rows: ResultRow[] = [
    { key: `${K}.r.kBare`, symbol: 'k_eff', value: keff.kEff, primary: true },
    { key: `${K}.r.geometric`, symbol: 'B_g²', value: b2, unit: 'm⁻²' },
    { key: `${K}.r.nonLeakage`, symbol: 'P_NL', value: keff.nonLeakage },
    { key: `${K}.r.state`, value: '', word: state },
    ...volumeRows(volume(shape, size, ratio)),
  ];
  const b2Text = q(b2 / 1e4, 'cm⁻²');
  const steps: KitStep[] = [
    { key: `${K}.s.geometric.${shape}`, vars: { size: cm(size), ratio: fmt(ratio), b2: b2Text } },
    {
      key: `${K}.s.kBare`,
      vars: { k: fmt(kInf), m2: qIn(m2, 'area', 'cm²'), b2: b2Text, P: fmt(keff.nonLeakage), keff: fmt(keff.kEff) },
    },
  ];
  return { rows, steps };
}

export const reactorMode: ModeDef = {
  id: 'reactor',
  label: `${K}.modes.reactor`,
  fields: [
    { id: 'eta', label: `${K}.f.eta`, initial: '2.02' },
    { id: 'epsilon', label: `${K}.f.epsilon`, initial: '1.03' },
    { id: 'p', label: `${K}.f.p`, initial: '0.75' },
    { id: 'f', label: `${K}.f.f`, initial: '0.71' },
    optionalFactor('fast', `${K}.f.fast`),
    optionalFactor('thermal', `${K}.f.thermal`),
    {
      id: 'm2',
      label: `${K}.f.m2`,
      dim: 'area',
      unit: 'cm²',
      usUnit: 'in²',
      initial: '300',
      optional: true,
      help: `${K}.help.m2`,
    },
    {
      id: 'shape',
      label: `${K}.f.shape`,
      kind: 'choice',
      initial: 'sphere',
      options: SHAPES.map((shape) => ({ value: shape, label: `${K}.o.${shape}` as MessageKey })),
    },
    {
      id: 'ratio',
      label: `${K}.f.ratio`,
      initial: '0.924',
      when: (ch) => ch('shape') === 'cylinder',
      help: `${K}.help.ratio`,
    },
    {
      id: 'size',
      label: `${K}.f.size`,
      dim: 'length',
      unit: 'cm',
      usUnit: 'in',
      initial: '',
      optional: true,
      help: `${K}.help.size`,
    },
  ],
  solve(read): Outcome {
    const { kInf, rows, steps } = readFactors(read);
    const m2 = read.opt('m2', 'positive');
    const shape = SHAPES.find((one) => one === read.choice('shape')) ?? 'sphere';
    const ratio = shape === 'cylinder' ? read.num('ratio', 'positive') : 1;
    const size = read.opt('size', 'positive');
    if (m2 !== null) {
      const part = size === null ? criticalPart(shape, kInf, m2, ratio) : barePart(shape, kInf, m2, size, ratio);
      rows.push(...part.rows);
      steps.push(...part.steps);
    }
    return {
      ok: true,
      rows,
      latex:
        'k_\\infty=\\eta\\varepsilon pf,\\qquad B^2=\\frac{k_\\infty-1}{M^2},\\qquad ' +
        'k_\\mathrm{eff}=\\frac{k_\\infty}{1+M^2B_g^2}',
      steps,
      notes: [{ key: `${K}.notes.reactor` }],
    };
  },
};
