// The Kaplan-Meier view of the survival tool: the survival table with Greenwood errors and Nelson-Aalen hazards,
// medians and quartiles, the number at risk at round times, the log-rank or Peto-Peto test, the curves with
// censoring marks, and the log-minus-log check of proportional hazards.
import { numberText } from '../kit/format';
import { ticks, type PlotSeries } from '../kit/picture';
import type { Outcome, Picture, ResultRow, ResultTable } from '../kit/spec';
import { step, type KitStep } from '../kit/types';
import { kaplanMeier, logRank, type KmCurve } from './engine';

export interface KmInput {
  readonly time: readonly number[];
  readonly event: readonly number[];
  readonly group?: readonly string[];
  readonly strata?: readonly string[];
  readonly peto: boolean;
  readonly level: number;
}

const split = (input: KmInput) => {
  const names = input.group ? [...new Set(input.group)].sort((a, b) => a.localeCompare(b)) : [''];
  return names.map((name) => {
    const rows = input.time.map((_, i) => i).filter((i) => !input.group || input.group[i] === name);
    return {
      name,
      curve: kaplanMeier(
        rows.map((i) => input.time[i]),
        rows.map((i) => input.event[i]),
        input.level,
      ),
    };
  });
};

function curvesPicture(curves: readonly { name: string; curve: KmCurve }[]): Picture {
  const series: PlotSeries[] = [];
  curves.forEach(({ name, curve }, g) => {
    const points: [number, number][] = [[0, 1], ...curve.rows.map((r) => [r.time, r.survival] as [number, number])];
    series.push({ id: 'survival', ...(name ? { name } : {}), points, style: 'step', pen: g });
    const marks = curve.rows.filter((r) => r.censored > 0).map((r) => [r.time, r.survival] as [number, number]);
    if (marks.length > 0) series.push({ id: 'censored', points: marks, style: 'points', pen: g, legend: false });
  });
  return {
    id: 'curves',
    type: 'plot',
    plot: { x: { label: 'time' }, y: { label: 'survival' }, series, yRange: [0, 1.02] },
  };
}

function logLogPicture(curves: readonly { name: string; curve: KmCurve }[]): Picture {
  return {
    id: 'loglog',
    type: 'plot',
    plot: {
      x: { label: 'logTime' },
      y: { label: 'logMinusLog' },
      series: curves.map(({ name, curve }, g) => ({
        id: 'survival',
        name,
        style: 'step' as const,
        pen: g,
        points: curve.rows
          .filter((r) => r.events > 0 && r.time > 0 && r.survival > 0 && r.survival < 1)
          .map((r) => [Math.log(r.time), Math.log(-Math.log(r.survival))] as [number, number]),
      })),
    },
  };
}

function riskTable(curves: readonly { name: string; curve: KmCurve }[]): ResultTable {
  const last = Math.max(...curves.flatMap(({ curve }) => curve.rows.map((r) => r.time)));
  const times = ticks(0, last).filter((t) => t >= 0 && t <= last);
  const atRisk = (curve: KmCurve, t: number) => curve.rows.find((r) => r.time >= t)?.atRisk ?? 0;
  return {
    id: 'risk',
    columns: ['time', ...curves.map(({ name }) => (name ? `=${name}` : 'atRisk'))],
    rows: times.map((t) => [numberText(t), ...curves.map(({ curve }) => atRisk(curve, t))]),
  };
}

function kmSteps(first: KmCurve, level: number): KitStep[] {
  const out: KitStep[] = [step('survival.product', 'S(t) = \\prod_{t_j \\le t} \\left(1 - \\frac{d_j}{n_j}\\right)')];
  let s = 1;
  for (const r of first.rows.filter((one) => one.events > 0).slice(0, 6)) {
    const next = s * (1 - r.events / r.atRisk);
    out.push(
      step('survival.kmStep', 'S = [[before]] \\times \\left(1 - \\frac{[[d]]}{[[n]]}\\right) = [[after]]', {
        t: r.time,
        n: r.atRisk,
        d: r.events,
        before: s,
        after: next,
      }),
    );
    s = next;
  }
  out.push(
    step('survival.greenwood', '\\widehat{\\operatorname{SE}}(S) = S \\sqrt{\\sum \\frac{d_j}{n_j (n_j - d_j)}}'),
    step(
      'survival.loglog',
      'S^{\\exp(\\pm z\\,\\sigma)},\\quad \\sigma = \\frac{\\sqrt{\\sum d_j / (n_j(n_j - d_j))}}{|\\ln S|}',
      {
        level: Number((level * 100).toPrecision(6)),
      },
    ),
    step('survival.median', undefined, { median: first.median }),
  );
  return out;
}

export function kmOutcome(input: KmInput): Outcome {
  const curves = split(input);
  const all = kaplanMeier(input.time, input.event, input.level);
  const rows: ResultRow[] = [
    { id: 'n', value: all.n },
    { id: 'events', value: all.events },
    { id: 'censored', value: all.n - all.events },
  ];
  const tables: ResultTable[] = [];
  const steps = kmSteps(curves[0].curve, input.level);
  const grouped = input.group !== undefined;
  const km = curves.flatMap(({ name, curve }) =>
    curve.rows.map((r) => [
      ...(grouped ? [name] : []),
      r.time,
      r.atRisk,
      r.events,
      r.censored,
      r.survival,
      r.se,
      r.low,
      r.high,
      r.hazard,
    ]),
  );
  const kmColumns = ['time', 'atRisk', 'events', 'censored', 'survival', 'se', 'low', 'high', 'hazard'];
  tables.push({ id: 'km', columns: grouped ? ['group', ...kmColumns] : kmColumns, rows: km });
  tables.push({
    id: 'medians',
    columns: ['group', 'n', 'events', 'median', 'low', 'high', 'q25', 'q75'],
    rows: curves.map(({ name, curve: c }) => [
      name || '—',
      c.n,
      c.events,
      c.median,
      c.medianLow,
      c.medianHigh,
      c.q25,
      c.q75,
    ]),
  });
  tables.push(riskTable(curves));
  const pictures = [curvesPicture(curves)];
  let words: KitStep | undefined;
  if (input.group) {
    const test = logRank(input.time, input.event, input.group, {
      peto: input.peto,
      ...(input.strata ? { strata: input.strata } : {}),
    });
    rows.unshift(
      { id: 'chi2', value: test.chi2, answer: true, sym: '\\chi^2' },
      { id: 'df', value: test.df },
      { id: 'p', value: test.p, answer: true, sym: 'p' },
    );
    tables.push({
      id: 'logrank',
      columns: ['group', 'observed', 'expected', 'difference'],
      rows: test.groups.map((g, i) => [g, test.observed[i], test.expected[i], test.observed[i] - test.expected[i]]),
    });
    steps.push(
      step(
        input.peto ? 'survival.peto' : 'survival.logrank',
        'E_g = \\sum_j d_j \\frac{n_{gj}}{n_j},\\quad \\chi^2 = U^\\top V^{-1} U = [[chi2]]',
        {
          chi2: test.chi2,
          df: test.df,
          p: test.p,
        },
      ),
    );
    pictures.push(logLogPicture(curves));
    words = step('survival.wordsTest', undefined, { chi2: test.chi2, df: test.df, p: test.p });
  } else {
    rows.unshift(
      { id: 'median', value: all.median, answer: true, sym: '\\tilde t' },
      { id: 'medianLow', value: all.medianLow },
      { id: 'medianHigh', value: all.medianHigh },
      { id: 'q25', value: all.q25 },
      { id: 'q75', value: all.q75 },
    );
    words = step('survival.wordsMedian', undefined, { median: all.median, lo: all.medianLow, hi: all.medianHigh });
  }
  const notes = ['censoring', ...(input.group ? ['proportional'] : []), ...(input.strata ? ['strata'] : [])];
  return { rows, tables, steps, pictures, notes, words };
}
