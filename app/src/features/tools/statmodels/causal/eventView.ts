// The event-study analysis of the causal tool. It shows the coefficient of each period relative to the one before
// the treatment began, the gaps they come from, and a plot of the coefficients with their confidence band.
import { completeRows, numbersAt, parseTable, wordsAt } from '../kit/data';
import { percent } from '../kit/format';
import type { Outcome, Picture, Values } from '../kit/spec';
import { fail, step, type KitStep } from '../kit/types';
import { eventStudy, type EventCoef, type EventStudy } from './eventStudy';

export const EVENT =
  'county,year,treated,y\nA,2019,1,10\nA,2020,1,11\nA,2021,1,15\nA,2022,1,16\nB,2019,1,12\nB,2020,1,14\n' +
  'B,2021,1,17\nB,2022,1,19\nC,2019,0,9\nC,2020,0,10\nC,2021,0,11\nC,2022,0,12\nD,2019,0,11\nD,2020,0,12\n' +
  'D,2021,0,12\nD,2022,0,14';

function readEvent(values: Values): EventStudy {
  const table = parseTable(String(values.data));
  const names = [values.outcome, values.entity, values.time, values.treated].map(String);
  if (!names[2]) fail('needTime');
  if (new Set(names).size < names.length) fail('sameColumn');
  const rows = completeRows(table, names);
  const [y, time, treated] = [names[0], names[2], names[3]].map((n) => numbersAt(table, n, rows));
  const entity = wordsAt(table, names[1], rows);
  const cluster = values.se === 'cluster';
  const adoption = Number(values.adoption);
  return eventStudy(y, entity, time, treated, adoption, cluster, Number(values.level), names[3]);
}

function eventSteps(fit: EventStudy, first: EventCoef): KitStep[] {
  const gapAt = (p: number) => fit.gaps.find((g) => g.period === p)?.gap ?? NaN;
  const pre = fit.coefs.filter((c) => c.k < 0);
  const worst = pre.reduce<EventCoef | null>(
    (w, c) => (w === null || Math.abs(c.coef) > Math.abs(w.coef) ? c : w),
    null,
  );
  return [
    step('causal.eventSetup', undefined, { adoption: fit.adoption, reference: fit.reference }),
    step(
      'causal.eventModel',
      'y_{it} = \\alpha_i + \\lambda_t + \\sum_{k \\ne -1} \\beta_k\\, T_i \\cdot 1[t = k] + u_{it}',
    ),
    fit.balanced
      ? step('causal.eventGap', '\\hat\\beta_{[[k]]} = [[gap]] - [[ref]] = [[b]]', {
          k: first.k,
          period: first.period,
          gap: gapAt(first.period),
          ref: gapAt(fit.reference),
          b: first.coef,
        })
      : step('causal.eventUnbalanced'),
    fit.clustered
      ? step('causal.clusterSe', undefined, { se: first.se, groups: fit.groups })
      : step('causal.eventClassicalSe', undefined, { se: first.se, df: fit.df }),
    worst ? step('causal.eventPre', undefined, { b: worst.coef, k: worst.k, p: worst.p }) : step('causal.eventNoPre'),
  ];
}

function eventPicture(fit: EventStudy): Picture {
  const byK = <T extends readonly number[]>(rows: T[]) => rows.sort((a, b) => a[0] - b[0]);
  const points = byK<[number, number]>([...fit.coefs.map((c): [number, number] => [c.k, c.coef]), [-1, 0]]);
  const band = byK<[number, number, number]>([
    ...fit.coefs.map((c): [number, number, number] => [c.k, c.low, c.high]),
    [-1, 0, 0],
  ]);
  return {
    id: 'event',
    type: 'plot',
    plot: {
      x: { label: 'eventTime' },
      y: { label: 'eventEffect' },
      series: [{ id: 'eventEstimate', points, style: 'points' }],
      bands: [{ points: band, pen: 0 }],
      hlines: [0],
      vlines: [-0.5],
    },
  };
}

export function eventOutcome(values: Values): Outcome {
  const fit = readEvent(values);
  const first = fit.coefs.find((c) => c.k === 0) ?? fit.coefs[0];
  return {
    rows: [
      { id: 'eventEffect', value: first.coef, answer: true, sym: '\\hat\\beta_0' },
      { id: 'se', value: first.se },
      { id: 'p', value: first.p },
      { id: 'low', value: first.low },
      { id: 'high', value: first.high },
      { id: 'reference', value: fit.reference },
      { id: 'n', value: fit.n },
      { id: 'groups', value: fit.groups },
    ],
    tables: [
      {
        id: 'eventCoefs',
        columns: ['k', 'period', 'estimate', 'se', 'p', 'low', 'high'],
        rows: fit.coefs.map((c) => [c.k, c.period, c.coef, c.se, c.p, c.low, c.high]),
      },
      {
        id: 'eventGaps',
        columns: ['k', 'period', 'treatedMean', 'controlMean', 'gap'],
        rows: fit.gaps.map((g) => [g.k, g.period, g.treated, g.control, g.gap]),
      },
    ],
    steps: eventSteps(fit, first),
    words: step('causal.wordsEvent', undefined, {
      y: String(values.outcome),
      b: first.coef,
      lo: first.low,
      hi: first.high,
      level: percent(Number(values.level)),
    }),
    pictures: [eventPicture(fit)],
    notes: ['parallelTrends', 'noAnticipation', 'commonStart'],
  };
}
