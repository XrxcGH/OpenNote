// The power tool's reports: solve for the sample size, the power, the detectable effect, or alpha, with the
// noncentrality, the critical value, the search that found n, and a power curve. Effect sizes convert too.
import type { PlotSpec } from '../plot';
import { num, step, tex, type Cell, type Report } from '../report';
import {
  closedForm,
  convertEffect,
  designEffect,
  powerAt,
  solveAlpha,
  solveEffect,
  solveN,
  type Settings,
  type Solution,
} from './stats';

export type Unknown = 'n' | 'power' | 'effect' | 'alpha';

const SIZE_KEY = {
  tTwo: 'perGroup',
  tOne: 'pairsOrN',
  tost: 'perGroup',
  anova: 'perGroup',
  rmAnova: 'subjects',
  chi2: 'totalN',
  regression: 'totalN',
  correlation: 'totalN',
  proportions: 'perGroup',
  proportion: 'totalN',
  survival: 'events',
} as const;

function curve(s: Settings, es: number, alpha: number, n: number): PlotSpec {
  const top = Math.max(10, Math.ceil(n * 2));
  const from = Math.max(s.test === 'regression' ? s.predictors + 2 : s.test === 'correlation' ? 4 : 2, 1);
  const count = 60;
  const points = Array.from({ length: count }, (_, i) => Math.round(from + ((top - from) * i) / (count - 1)))
    .filter((v, i, all) => all.indexOf(v) === i)
    .map((m) => ({ x: m, y: powerAt(s, m, es, alpha).power }));
  return {
    title: 'powerCurve',
    x: { label: 'sizeAxis' },
    y: { label: 'powerAxis', min: 0, max: 1 },
    marks: [
      { kind: 'line', points },
      { kind: 'vline', x: n },
      { kind: 'hline', y: 0.8 },
    ],
  };
}

function rows(s: Settings, sol: Solution, extra: Cell[][]): Cell[][] {
  const totals: Cell[][] =
    s.test === 'tTwo' || s.test === 'proportions'
      ? [[{ key: 'totalN' }, Math.round(sol.n * (1 + s.ratio) * 1000) / 1000]]
      : s.test === 'anova'
        ? [[{ key: 'totalN' }, sol.n * s.groups]]
        : [];
  return [
    [{ key: SIZE_KEY[s.test] }, sol.n],
    ...totals,
    [{ key: 'achievedPower' }, sol.power],
    [{ key: 'criticalValue' }, sol.critical],
    ...(Number.isFinite(sol.ncp) ? [[{ key: 'noncentrality' }, sol.ncp] as Cell[]] : []),
    ...(Number.isFinite(sol.df1)
      ? [
          [
            { key: 'degrees' },
            Number.isFinite(sol.df2) ? `${num(sol.df1, 5)}, ${num(sol.df2, 5)}` : num(sol.df1, 5),
          ] as Cell[],
        ]
      : []),
    ...extra,
  ];
}

export interface PowerInput {
  readonly settings: Settings;
  readonly unknown: Unknown;
  readonly es: number;
  readonly alpha: number;
  readonly power: number;
  readonly n: number;
  /** Cluster size and ICC for a design effect, or null. */
  readonly cluster: { m: number; icc: number } | null;
}

export function powerReport(input: PowerInput): Report {
  const { settings: s, unknown, alpha, power } = input;
  let sol: Solution;
  let es = input.es;
  let a = alpha;
  let search: number[] = [];
  if (unknown === 'n') {
    const r = solveN(s, es, alpha, power);
    sol = r.solution;
    search = r.steps;
  } else if (unknown === 'effect') {
    const r = solveEffect(s, input.n, alpha, power);
    sol = r;
    es = r.es;
  } else if (unknown === 'alpha') {
    const r = solveAlpha(s, input.n, es, power);
    sol = r;
    a = r.alpha;
  } else {
    sol = powerAt(s, input.n, es, alpha);
  }
  const exact = unknown === 'n' ? closedForm(s, es, alpha, power) : null;
  const deff = input.cluster ? designEffect(input.cluster.m, input.cluster.icc) : null;
  const extra: Cell[][] = [
    ...(unknown === 'effect' ? [[{ key: 'detectable' }, es] as Cell[]] : []),
    ...(unknown === 'alpha' ? [[{ key: 'alphaSolved' }, a] as Cell[]] : []),
    ...(exact !== null ? [[{ key: 'closedForm' }, exact] as Cell[]] : []),
    ...(deff !== null
      ? [[{ key: 'designEffect' }, deff] as Cell[], [{ key: 'clusteredN' }, Math.ceil(sol.n * deff)] as Cell[]]
      : []),
  ];
  const answerKey =
    unknown === 'n'
      ? 'powerN'
      : unknown === 'power'
        ? 'powerPower'
        : unknown === 'effect'
          ? 'powerEffect'
          : 'powerAlpha';
  return {
    answer: {
      key: answerKey,
      vars: { n: `${num(sol.n, 6)}`, power: num(sol.power, 5), es: num(es, 5), alpha: num(a, 5), unit: '' },
      latex: `n = ${tex(sol.n, 6)},\\; 1 - \\beta = ${tex(sol.power, 5)}`,
    },
    tables: [{ title: 'powerTable', columns: ['measure', 'value'], rows: rows(s, sol, extra) }],
    steps: [
      step(`pEffect_${s.test}` as const, undefined, { es: num(es, 5) }),
      ...(Number.isFinite(sol.ncp) ? [step('pNcp', `\\lambda = ${tex(sol.ncp, 5)}`)] : []),
      step('pCritical', `c = ${tex(sol.critical, 5)}`, { alpha: num(a, 5) }),
      step('pPower', `1 - \\beta = ${tex(sol.power, 5)}`, { n: num(sol.n, 6) }),
      ...(search.length ? [step('pSearch', undefined, { tried: search.join(', '), n: num(sol.n, 6) })] : []),
      ...(deff !== null ? [step('pCluster', `n \\times ${tex(deff, 4)} = ${Math.ceil(sol.n * deff)}`)] : []),
    ],
    plots: [curve(s, es, a, sol.n)],
  };
}

export function convertReport(kind: 'd' | 'r' | 'f' | 'f2' | 'eta2' | 'or', value: number): Report {
  const c = convertEffect(kind, value);
  return {
    answer: {
      key: 'converted',
      vars: { d: num(c.d, 5), r: num(c.r, 5), f: num(c.f, 5) },
      latex: `d = ${tex(c.d, 5)},\\; r = ${tex(c.r, 5)}`,
    },
    tables: [
      {
        title: 'conversions',
        columns: ['measure', 'value'],
        rows: [
          [{ key: 'cohenD' }, c.d],
          [{ key: 'pointR' }, c.r],
          [{ key: 'cohenF' }, c.f],
          [{ key: 'f2' }, c.f2],
          [{ key: 'eta2' }, c.eta2],
          [{ key: 'oddsRatio' }, c.or],
        ],
      },
    ],
    steps: [
      step(
        'pConvert',
        `r = \\frac{d}{\\sqrt{d^2 + 4}},\\; f = \\frac{|d|}{2},\\; \\ln \\mathrm{OR} = \\frac{\\pi d}{\\sqrt 3}`,
      ),
    ],
  };
}
