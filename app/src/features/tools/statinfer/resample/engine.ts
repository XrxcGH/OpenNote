// The resampling tool's reports: the bootstrap, permutation tests, the sampling-distribution lab, and simulations.
// Every report prints its seed, so the same numbers come back from the same inputs.
import type { Alternative } from '../../subjects/stats/dist';
import { normalPdf } from '../../subjects/stats/dist';
import { histogram } from '../num/data';
import type { PlotSpec } from '../plot';
import { num, pTex, pText, step, tex, type Cell, type Report } from '../report';
import {
  bootstrap,
  permutationTest,
  samplingLab,
  simulate,
  type PermutationKind,
  type Population,
  type Simulation,
  type Statistic,
} from './stats';

function histogramOf(
  values: readonly number[],
  title: 'bootDistribution' | 'permDistribution' | 'meansDistribution',
  mark?: number,
): PlotSpec {
  const bins = histogram(values);
  return {
    title,
    x: { label: 'value' },
    y: { label: 'count', min: 0 },
    marks: [
      { kind: 'bars', bars: bins.map((b) => ({ x0: b.from, x1: b.to, y: b.count })) },
      ...(mark === undefined ? [] : [{ kind: 'vline' as const, x: mark }]),
    ],
  };
}

const pair = (v: readonly [number, number]) => `${num(v[0])} to ${num(v[1])}`;

export function bootstrapReport(
  kind: Statistic,
  x: readonly number[],
  y: readonly number[],
  resamples: number,
  seed: bigint,
  confidence: number,
): Report {
  const b = bootstrap(kind, x, y, resamples, seed, confidence);
  const level = `${num(confidence * 100, 4)}%`;
  return {
    answer: {
      key: 'bootstrap',
      vars: {
        stat: num(b.observed),
        se: num(b.se, 4),
        lo: num(b.percentile[0]),
        hi: num(b.percentile[1]),
        level,
        seed: seed.toString(),
      },
      latex: `\\hat\\theta = ${tex(b.observed)},\\; \\widehat{SE}_{boot} = ${tex(b.se, 4)}`,
    },
    tables: [
      {
        title: 'bootTable',
        columns: ['measure', 'value'],
        rows: [
          [{ key: 'observedStat' }, b.observed],
          [{ key: 'bootSe' }, b.se],
          [{ key: 'bootBias' }, b.bias],
          [{ key: 'percentileInterval' }, pair(b.percentile)],
          [{ key: 'basicInterval' }, pair(b.basic)],
          [{ key: 'bcaInterval' }, b.bca ? pair(b.bca) : '—'],
        ],
      },
    ],
    steps: [
      step('bPlan', undefined, { b: `${resamples}`, n: `${x.length}`, seed: seed.toString() }),
      step('bSe', `\\widehat{SE} = \\sqrt{\\frac{\\sum(\\theta^*_b - \\bar\\theta^*)^2}{B - 1}} = ${tex(b.se)}`),
      step(
        'bPercentile',
        `(\\theta^*_{(\\alpha/2)},\\ \\theta^*_{(1-\\alpha/2)}) = (${tex(b.percentile[0])},\\ ${tex(b.percentile[1])})`,
        { level },
      ),
      step(
        'bBasic',
        `(2\\hat\\theta - \\theta^*_{(1-\\alpha/2)},\\ 2\\hat\\theta - \\theta^*_{(\\alpha/2)})` +
          ` = (${tex(b.basic[0])},\\ ${tex(b.basic[1])})`,
      ),
      ...(Number.isFinite(b.z0) ? [step('bBca', `z_0 = ${tex(b.z0, 4)},\\quad a = ${tex(b.acceleration, 4)}`)] : []),
    ],
    plots: [histogramOf(b.replicates, 'bootDistribution', b.observed)],
  };
}

export function permutationReport(
  kind: PermutationKind,
  x: readonly number[],
  y: readonly number[],
  alternative: Alternative,
  resamples: number,
  seed: bigint,
): Report {
  const r = permutationTest(kind, x, y, alternative, resamples, seed);
  return {
    answer: {
      key: 'permutation',
      vars: { stat: num(r.observed), p: pText(r.p), how: r.exact ? `${r.total}` : `${r.total}` },
      latex: `T = ${tex(r.observed)},\\; ${pTex(r.p)}`,
    },
    tables: [
      {
        title: 'permTable',
        columns: ['measure', 'value'],
        rows: [
          [{ key: 'observedStat' }, r.observed],
          [{ key: 'arrangements' }, r.total],
          [{ key: 'asExtreme' }, r.count],
          [{ key: 'p' }, r.p],
          ...(r.exact ? [] : [[{ key: 'pSe' }, r.se] as Cell[]]),
        ],
      },
    ],
    steps: [
      step(r.exact ? 'pExact' : 'pMonteCarlo', undefined, { total: `${r.total}`, seed: seed.toString() }),
      step(
        'pCount',
        r.exact
          ? `p = \\frac{${r.count}}{${r.total}} = ${tex(r.p)}`
          : `p = \\frac{${r.count} + 1}{${r.total} + 1} = ${tex(r.p)}`,
      ),
    ],
    plots: [histogramOf(r.values, 'permDistribution', r.observed)],
    notes: [{ key: kind === 'twoSample' ? 'permTwo' : kind === 'paired' ? 'permPaired' : 'permCorrelation' }],
  };
}

export function labReport(
  population: Population,
  parameter: number,
  pasted: readonly number[],
  n: number,
  reps: number,
  seed: bigint,
): Report {
  const lab = samplingLab(population, parameter, pasted, n, reps, seed);
  const se = lab.populationSd / Math.sqrt(n);
  const plot = histogramOf(lab.means, 'meansDistribution', lab.populationMean);
  const bins = histogram(lab.means);
  const width = bins.length ? bins[0].to - bins[0].from : 1;
  const xs = Array.from({ length: 81 }, (_, i) => lab.populationMean - 4 * se + (i * 8 * se) / 80);
  const curve = {
    kind: 'line' as const,
    tone: 1,
    points: xs.map((v) => ({ x: v, y: reps * width * normalPdf(v, lab.populationMean, se) })),
  };
  return {
    answer: {
      key: 'lab',
      vars: {
        mm: num(lab.meanOfMeans, 5),
        sdm: num(lab.sdOfMeans, 4),
        se: num(se, 4),
        coverage: num(lab.coverage * 100, 4),
      },
      latex: `\\bar{\\bar x} = ${tex(lab.meanOfMeans, 5)},\\; SD(\\bar x) = ${tex(lab.sdOfMeans, 4)}`,
    },
    tables: [
      {
        title: 'labTable',
        columns: ['measure', 'value'],
        rows: [
          [{ key: 'populationMean' }, lab.populationMean],
          [{ key: 'meanOfMeans' }, lab.meanOfMeans],
          [{ key: 'cltSe' }, se],
          [{ key: 'sdOfMeans' }, lab.sdOfMeans],
          [{ key: 'coverage' }, lab.coverage * 100],
        ],
      },
    ],
    steps: [
      step('lPlan', undefined, { reps: `${reps}`, n: `${n}`, seed: seed.toString() }),
      step(
        'lClt',
        `\\sigma_{\\bar x} = \\frac{\\sigma}{\\sqrt n} = \\frac{${tex(lab.populationSd, 4)}}{\\sqrt{${n}}} = ${tex(se, 4)}`,
      ),
      step('lCoverage', undefined, { coverage: num(lab.coverage * 100, 4) }),
    ],
    plots: [{ ...plot, marks: [...plot.marks, curve] }],
  };
}

export function simulationReport(
  kind: Simulation,
  steps: number,
  p: number,
  dice: number,
  urn: readonly [number, number],
  seed: bigint,
): Report {
  const s = simulate(kind, steps, p, dice, urn, seed);
  const thin = (path: readonly number[]) => {
    const every = Math.max(1, Math.floor(path.length / 2000));
    return path
      .filter((_, i) => i % every === 0)
      .map((v, i) => ({ x: i * every + (kind === 'brownian' ? 0 : 1), y: v }));
  };
  const plots: PlotSpec[] =
    kind === 'dice'
      ? [
          {
            title: 'diceSums',
            x: { label: 'diceTotal' },
            y: { label: 'count', min: 0 },
            marks: [{ kind: 'bars', bars: s.counts.map((c, i) => ({ x0: i + dice - 0.4, x1: i + dice + 0.4, y: c })) }],
          },
        ]
      : [
          {
            title: kind === 'coin' ? 'runningProportion' : kind === 'urn' ? 'urnDraws' : 'walkPath',
            x: { label: 'stepAxis' },
            y: { label: kind === 'coin' ? 'proportionAxis' : 'positionAxis' },
            marks: [
              { kind: 'line', points: thin(kind === 'brownian' ? s.path.map((v) => v) : s.path) },
              ...(kind === 'coin' ? [{ kind: 'hline' as const, y: p }] : []),
            ],
          },
        ];
  return {
    answer: {
      key: `sim_${kind}` as const,
      vars: { final: num(s.final, 5), steps: `${steps}`, seed: seed.toString() },
      latex: tex(s.final, 5),
    },
    tables:
      kind === 'dice'
        ? [{ title: 'diceTable', columns: ['total', 'count'], rows: s.counts.map((c, i) => [`${i + dice}`, c]) }]
        : [],
    steps: [step('sSeed', undefined, { seed: seed.toString(), steps: `${steps}` })],
    plots,
  };
}
