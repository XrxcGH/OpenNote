// The event-study analysis of the causal tool: the coefficient of each period relative to the one before the
// treatment began, the gaps they come from, and the plot of the coefficients with their confidence band.
import { completeRows, numbersAt, parseTable, wordsAt } from '../kit/data';
import { percent } from '../kit/format';
import type { Outcome, Values } from '../kit/spec';
import { fail, step } from '../kit/types';
import { eventStudy } from './eventStudy';

export const EVENT =
  'county,year,treated,y\nA,2019,1,10\nA,2020,1,11\nA,2021,1,15\nA,2022,1,16\nB,2019,1,12\nB,2020,1,14\n' +
  'B,2021,1,17\nB,2022,1,19\nC,2019,0,9\nC,2020,0,10\nC,2021,0,11\nC,2022,0,12\nD,2019,0,11\nD,2020,0,12\n' +
  'D,2021,0,12\nD,2022,0,14';

export function eventOutcome(values: Values): Outcome {
  const table = parseTable(String(values.data));
  const yName = String(values.outcome);
  const entityName = String(values.entity);
  const timeName = String(values.time);
  const treatedName = String(values.treated);
  if (!timeName) fail('needTime');
  const used = [yName, entityName, timeName, treatedName];
  if (new Set(used).size < used.length) fail('sameColumn');
  const rows = completeRows(table, used);
  const y = numbersAt(table, yName, rows);
  const entity = wordsAt(table, entityName, rows);
  const time = numbersAt(table, timeName, rows);
  const treated = numbersAt(table, treatedName, rows);
  const level = Number(values.level);
  const cluster = values.se === 'cluster';
  const fit = eventStudy(y, entity, time, treated, Number(values.adoption), cluster, level, treatedName);
  const first = fit.coefs.find((c) => c.k === 0) ?? fit.coefs[0];
  const pre = fit.coefs.filter((c) => c.k < 0);
  const worstPre = pre.reduce<(typeof pre)[number] | null>(
    (w, c) => (w === null || Math.abs(c.coef) > Math.abs(w.coef) ? c : w),
    null,
  );
  const gapAt = (p: number) => fit.gaps.find((g) => g.period === p)?.gap ?? NaN;
  const refGap = gapAt(fit.reference);
  const points = [...fit.coefs.map((c) => [c.k, c.coef] as [number, number]), [-1, 0] as [number, number]].sort(
    (a, b) => a[0] - b[0],
  );
  const band = [
    ...fit.coefs.map((c) => [c.k, c.low, c.high] as [number, number, number]),
    [-1, 0, 0] as [number, number, number],
  ].sort((a, b) => a[0] - b[0]);
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
    steps: [
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
            ref: refGap,
            b: first.coef,
          })
        : step('causal.eventUnbalanced'),
      fit.clustered
        ? step('causal.clusterSe', undefined, { se: first.se, groups: fit.groups })
        : step('causal.eventClassicalSe', undefined, { se: first.se, df: fit.df }),
      worstPre
        ? step('causal.eventPre', undefined, { b: worstPre.coef, k: worstPre.k, p: worstPre.p })
        : step('causal.eventNoPre'),
    ],
    words: step('causal.wordsEvent', undefined, {
      y: yName,
      b: first.coef,
      se: first.se,
      lo: first.low,
      hi: first.high,
      level: percent(level),
    }),
    pictures: [
      {
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
      },
    ],
    notes: ['parallelTrends', 'noAnticipation', 'commonStart'],
  };
}
