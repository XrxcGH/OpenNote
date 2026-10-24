// The cycles tool's form: one mode per family of cycles. The first values are textbook problems, so a student
// sees a sensible cycle before typing anything: an 8 MPa to 10 kPa Rankine cycle, a pressure-ratio-10 gas
// turbine, an r = 8 Otto engine, and a 0.14 to 0.8 MPa R-134a refrigerator.
import { choice, num, optionalNum, pick, q, type FieldSpec, type ToolSpec, type Values } from '../common/spec';
import type { GasModel } from '../idealgas/gas';
import { MODEL_FIELD } from '../idealgas/spec';
import { solveBrayton, solveCarnot, solvePiston, type PistonInput } from './gas';
import { solveFridge, solveRankine, type RankineInput } from './vapor';

const C = { SI: '°C' } as const;
type Variant = RankineInput['variant'];

/** First values per Rankine layout: the simple one is the validation case, the others a 15 MPa, 600 °C plant. */
const RANKINE_FIRST: Record<Variant, { pHigh: number; inlet: 'sat' | 'T'; T3: number }> = {
  simple: { pHigh: 8000, inlet: 'sat', T3: 753.15 },
  reheat: { pHigh: 15000, inlet: 'T', T3: 873.15 },
  openFwh: { pHigh: 15000, inlet: 'T', T3: 873.15 },
  closedFwh: { pHigh: 15000, inlet: 'T', T3: 873.15 },
};

const temp = (id: string, label: Parameters<typeof q>[1], initial: number | null, optional = false): FieldSpec => ({
  ...q(id, label, 'T', initial, optional),
  unit: C,
});

function rankineFields(values: Values): FieldSpec[] {
  const variant = choice<Variant>(values, 'variant', 'simple');
  const first = RANKINE_FIRST[variant];
  const inlet = choice(values, 'inlet', first.inlet);
  return [
    pick('variant', 'layout', [
      ['simple', 'simpleRankine'],
      ['reheat', 'reheatRankine'],
      ['openFwh', 'openFwh'],
      ['closedFwh', 'closedFwh'],
    ]),
    q('pHigh', 'boilerP', 'p', first.pHigh),
    q('pLow', 'condenserP', 'p', 10),
    pick(
      'inlet',
      'turbineInlet',
      [
        ['sat', 'satVaporInlet'],
        ['T', 'superheatedInlet'],
      ],
      first.inlet,
    ),
    ...(inlet === 'T' ? [temp('T3', 'turbineInletT', first.T3)] : []),
    ...(variant === 'reheat'
      ? [q('pReheat', 'reheatP', 'p', 4000), temp('tReheat', 'reheatTOptional', null, true)]
      : []),
    ...(variant === 'openFwh' || variant === 'closedFwh' ? [q('pFwh', 'fwhP', 'p', 1200)] : []),
    q('etaT', 'turbineEta', 'percent', 100),
    q('etaP', 'pumpEta', 'percent', 100),
    q('power', 'netPowerOptional', 'power', null, true),
  ];
}

const BRAYTON_FIELDS: readonly FieldSpec[] = [
  MODEL_FIELD,
  q('T1', 'compressorInletT', 'T', 300),
  q('p1', 'compressorInletP', 'p', 100),
  q('rp', 'pressureRatio', 'none', 10),
  q('T3', 'turbineInletT', 'T', 1200),
  q('etaC', 'compressorEta', 'percent', 100),
  q('etaT', 'turbineEta', 'percent', 100),
  q('regen', 'regenerator', 'percent', 0),
  pick('intercool', 'intercool', [
    ['no', 'off'],
    ['yes', 'twoStages'],
  ]),
  pick('reheat', 'reheatGas', [
    ['no', 'off'],
    ['yes', 'twoStages'],
  ]),
  q('power', 'netPowerOptional', 'power', null, true),
];

function pistonFields(values: Values): FieldSpec[] {
  const cycle = choice<PistonInput['cycle']>(values, 'cycle', 'otto');
  return [
    pick('cycle', 'engineCycle', [
      ['otto', 'otto'],
      ['diesel', 'diesel'],
      ['dual', 'dual'],
    ]),
    MODEL_FIELD,
    q('T1', 'T1', 'T', 300),
    q('p1', 'p1', 'p', 100),
    q('r', 'ratio', 'none', cycle === 'otto' ? 8 : 18),
    ...(cycle === 'otto' ? [q('T3', 'peakT', 'T', 1800)] : [q('rc', 'cutoffRatio', 'none', 2)]),
    ...(cycle === 'dual' ? [q('rpv', 'pressureRatioV', 'none', 1.5)] : []),
  ];
}

const FRIDGE_FIELDS: readonly FieldSpec[] = [
  q('pLow', 'evaporatorP', 'p', 140),
  q('pHigh', 'condenserP', 'p', 800),
  q('etaC', 'compressorEta', 'percent', 100),
  q('superheat', 'superheat', 'dT', 0),
  q('subcool', 'subcool', 'dT', 0),
  q('load', 'coolingLoadOptional', 'power', null, true),
];

const CARNOT_FIELDS: readonly FieldSpec[] = [
  q('TH', 'hotT', 'T', 1000),
  q('TL', 'coldT', 'T', 300),
  q('QH', 'heatInOptional', 'power', null, true),
];

const fraction = (values: Values, id: string) => num(values, id) / 100;

export const spec: ToolSpec = {
  modes: [
    { id: 'rankine', label: 'rankine', fields: rankineFields },
    { id: 'brayton', label: 'brayton', fields: () => BRAYTON_FIELDS },
    { id: 'piston', label: 'piston', fields: pistonFields },
    { id: 'fridge', label: 'fridge', fields: () => FRIDGE_FIELDS },
    { id: 'carnot', label: 'carnot', fields: () => CARNOT_FIELDS },
  ],
  solve(mode, values) {
    const get = (id: string) => optionalNum(values, id) ?? undefined;
    const model = choice<GasModel>(values, 'model', 'variable');
    if (mode === 'brayton')
      return solveBrayton({
        model,
        T1: num(values, 'T1'),
        p1: num(values, 'p1'),
        rp: num(values, 'rp'),
        T3: num(values, 'T3'),
        etaC: fraction(values, 'etaC'),
        etaT: fraction(values, 'etaT'),
        regen: fraction(values, 'regen'),
        intercool: choice<string>(values, 'intercool', 'no') === 'yes',
        reheat: choice<string>(values, 'reheat', 'no') === 'yes',
        power: get('power'),
      });
    if (mode === 'piston') {
      const cycle = choice<PistonInput['cycle']>(values, 'cycle', 'otto');
      return solvePiston({
        cycle,
        model,
        T1: num(values, 'T1'),
        p1: num(values, 'p1'),
        r: num(values, 'r'),
        T3: cycle === 'otto' ? num(values, 'T3') : undefined,
        rc: cycle === 'otto' ? undefined : num(values, 'rc'),
        rp: cycle === 'dual' ? num(values, 'rpv') : undefined,
      });
    }
    if (mode === 'fridge')
      return solveFridge({
        pLow: num(values, 'pLow'),
        pHigh: num(values, 'pHigh'),
        etaC: fraction(values, 'etaC'),
        superheat: num(values, 'superheat'),
        subcool: num(values, 'subcool'),
        load: get('load'),
      });
    if (mode === 'carnot') return solveCarnot(num(values, 'TH'), num(values, 'TL'), get('QH'));
    const variant = choice<Variant>(values, 'variant', 'simple');
    return solveRankine({
      variant,
      pHigh: num(values, 'pHigh'),
      pLow: num(values, 'pLow'),
      T3: choice(values, 'inlet', RANKINE_FIRST[variant].inlet) === 'T' ? num(values, 'T3') : undefined,
      etaT: fraction(values, 'etaT'),
      etaP: fraction(values, 'etaP'),
      pReheat: get('pReheat'),
      tReheat: get('tReheat'),
      pFwh: get('pFwh'),
      power: get('power'),
    });
  },
};
