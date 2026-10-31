// Describing one sample. It gives location, spread, and shape (bias-adjusted skewness G1 and kurtosis G2 with
// their standard errors), trimmed, winsorized, and other means, and a table of z-scores with percentile ranks.
// It sets the empirical rule beside Chebyshev's bound and runs 3 outlier screens: 1.5 IQR fences, |z| > 3, and
// Grubbs' 2-sided test.
import { histogram, mean, quantile, sorted, sum, sumSquares } from '../num/data';
import { tQuantile } from '../../subjects/stats/dist';
import type { PlotSpec } from '../plot';
import { check, num, step, tex, type Cell, type ColKey, type KitStep, type KitTable, type Report } from '../report';
import { dotPlot } from './stem';

export interface Moments {
  readonly n: number;
  readonly mean: number;
  readonly sd: number;
  readonly variance: number;
  /** Bias-adjusted sample skewness and excess kurtosis, and their standard errors. */
  readonly g1: number;
  readonly g2: number;
  readonly ses: number;
  readonly sek: number;
  readonly m2: number;
  readonly m3: number;
  readonly m4: number;
}

export function moments(values: readonly number[]): Moments {
  const n = values.length;
  const m = mean(values);
  const central = (power: number) => sum(values.map((x) => (x - m) ** power)) / n;
  const [m2, m3, m4] = [central(2), central(3), central(4)];
  const variance = (m2 * n) / (n - 1);
  const g1 = n > 2 && m2 > 0 ? ((Math.sqrt(n * (n - 1)) / (n - 2)) * m3) / m2 ** 1.5 : NaN;
  const g2 = n > 3 && m2 > 0 ? ((n - 1) / ((n - 2) * (n - 3))) * ((n + 1) * (m4 / m2 ** 2) - 3 * (n - 1)) : NaN;
  const ses = n > 2 ? Math.sqrt((6 * n * (n - 1)) / ((n - 2) * (n + 1) * (n + 3))) : NaN;
  const sek = n > 3 ? 2 * ses * Math.sqrt((n * n - 1) / ((n - 3) * (n + 5))) : NaN;
  return { n, mean: m, sd: Math.sqrt(variance), variance, g1, g2, ses, sek, m2, m3, m4 };
}

/** The trimmed and winsorized means, cutting floor(n × fraction) values from each end. */
export function trimmedMeans(values: readonly number[], fraction: number) {
  check(fraction >= 0 && fraction < 0.5, 'trimRange');
  const s = sorted(values);
  const cut = Math.floor(s.length * fraction + 1e-9);
  const kept = s.slice(cut, s.length - cut);
  const wins = s.map((x, i) => (i < cut ? s[cut] : i >= s.length - cut ? s[s.length - cut - 1] : x));
  return { cut, trimmed: mean(kept), winsorized: mean(wins) };
}

export interface Grubbs {
  readonly g: number;
  readonly critical: number;
  readonly t: number;
  readonly suspect: number;
  readonly outlier: boolean;
}

/** Grubbs' 2-sided test for one outlier: G = max |x − x̄| / s against (n − 1)/√n · √(t²/(n − 2 + t²)). */
export function grubbs(values: readonly number[], alpha: number): Grubbs {
  const n = values.length;
  check(n >= 3, 'tooFew', { min: '3' });
  check(alpha > 0 && alpha < 1, 'alphaRange');
  const m = mean(values);
  const s = Math.sqrt(sumSquares(values) / (n - 1));
  check(s > 0, 'constant');
  const suspect = values.reduce((far, x) => (Math.abs(x - m) > Math.abs(far - m) ? x : far), values[0]);
  const g = Math.abs(suspect - m) / s;
  const t = tQuantile(1 - alpha / (2 * n), n - 2);
  const critical = ((n - 1) / Math.sqrt(n)) * Math.sqrt((t * t) / (n - 2 + t * t));
  return { g, critical, t, suspect, outlier: g > critical };
}

/** The percentile rank of x: the share below it plus half the share equal to it, in percent. */
export function percentileRank(sortedValues: readonly number[], x: number): number {
  const below = sortedValues.filter((v) => v < x).length;
  const equal = sortedValues.filter((v) => v === x).length;
  return ((below + equal / 2) / sortedValues.length) * 100;
}

export interface SummaryInput {
  readonly values: readonly number[];
  readonly weights?: readonly number[];
  readonly unit: string;
  readonly trim: number;
  readonly alpha: number;
}

function modes(values: readonly number[]): Cell {
  const counts = new Map<number, number>();
  for (const x of values) counts.set(x, (counts.get(x) ?? 0) + 1);
  const most = Math.max(...counts.values());
  if (most < 2) return { key: 'none' };
  return [...counts]
    .filter(([, c]) => c === most)
    .map(([x]) => num(x))
    .sort((a, b) => Number(a.replace('−', '-')) - Number(b.replace('−', '-')))
    .join(', ');
}

const positiveMean = (values: readonly number[], kind: 'geometric' | 'harmonic'): number => {
  if (values.some((x) => x <= 0)) return NaN;
  return kind === 'geometric' ? Math.exp(mean(values.map(Math.log))) : values.length / sum(values.map((x) => 1 / x));
};

function weighted(values: readonly number[], weights?: readonly number[]): number {
  if (!weights || weights.length === 0) return NaN;
  check(weights.length === values.length, 'weightsLength');
  check(
    weights.every((w) => w >= 0),
    'negativeWeight',
  );
  const total = sum(weights);
  check(total > 0, 'zeroWeights');
  return sum(values.map((x, i) => x * weights[i])) / total;
}

function summaryTable(input: SummaryInput, mo: Moments, s: readonly number[]): KitTable {
  const q1 = quantile(s, 0.25);
  const q3 = quantile(s, 0.75);
  const trims = trimmedMeans(input.values, input.trim);
  const u = input.unit;
  const u2 = u ? `${u}²` : '';
  const row = (key: ColKey, value: Cell, unit = u): Cell[] => [{ key }, value, unit];
  const rows: Cell[][] = [
    row('n', mo.n, ''),
    row('mean', mo.mean),
    row('median', quantile(s, 0.5)),
    row('mode', modes(input.values)),
    row('sd', mo.sd),
    row('variance', mo.variance, u2),
    row('min', s[0]),
    row('max', s[s.length - 1]),
    row('range', s[s.length - 1] - s[0]),
    row('q1', q1),
    row('q3', q3),
    row('iqr', q3 - q1),
    row('se', mo.sd / Math.sqrt(mo.n)),
    row('cv', mo.sd / mo.mean, ''),
    row('trimmed', trims.trimmed),
    row('winsorized', trims.winsorized),
    row('geometric', positiveMean(input.values, 'geometric')),
    row('harmonic', positiveMean(input.values, 'harmonic')),
    row('weighted', weighted(input.values, input.weights)),
    row('skewness', mo.g1, ''),
    row('seSkewness', mo.ses, ''),
    row('kurtosis', mo.g2, ''),
    row('seKurtosis', mo.sek, ''),
  ];
  return {
    title: 'summary',
    columns: ['statistic', 'value', 'unit'],
    rows: rows.filter((r) => !(typeof r[1] === 'number' && Number.isNaN(r[1]))),
  };
}

function ruleTable(values: readonly number[], mo: Moments): KitTable {
  const rows = [1, 2, 3].map((k): Cell[] => {
    const inside = values.filter((x) => Math.abs(x - mo.mean) <= k * mo.sd).length;
    return [`${k}`, (inside / values.length) * 100, [68.27, 95.45, 99.73][k - 1], (1 - 1 / (k * k)) * 100];
  });
  return { title: 'spreadRule', columns: ['withinSd', 'observedPct', 'normalPct', 'chebyshevPct'], rows };
}

function zTable(values: readonly number[], mo: Moments, s: readonly number[]): KitTable {
  const rows = values.slice(0, 200).map((x): Cell[] => [num(x), (x - mo.mean) / mo.sd, percentileRank(s, x)]);
  return { title: 'zScores', columns: ['value', 'z', 'percentileRank'], rows };
}

function outlierTable(values: readonly number[], mo: Moments, s: readonly number[], g: Grubbs | null): KitTable {
  const q1 = quantile(s, 0.25);
  const q3 = quantile(s, 0.75);
  const lo = q1 - 1.5 * (q3 - q1);
  const hi = q3 + 1.5 * (q3 - q1);
  const list = (picked: number[]): Cell => (picked.length ? picked.map((x) => num(x)).join(', ') : { key: 'none' });
  const rows: Cell[][] = [
    [{ key: 'fences' }, `${num(lo)} … ${num(hi)}`, list(values.filter((x) => x < lo || x > hi))],
    [{ key: 'zBeyond3' }, '|z| > 3', list(values.filter((x) => Math.abs(x - mo.mean) > 3 * mo.sd))],
  ];
  if (g) rows.push([{ key: 'grubbs' }, `G = ${num(g.g)}, G* = ${num(g.critical)}`, list(g.outlier ? [g.suspect] : [])]);
  return { title: 'outliers', columns: ['screen', 'rule', 'flagged'], rows };
}

function summarySteps(input: SummaryInput, mo: Moments, g: Grubbs | null): KitStep[] {
  const total = sum(input.values);
  const ss = sumSquares(input.values);
  const steps: KitStep[] = [
    step('dMean', `\\bar{x} = \\frac{\\sum x}{n} = \\frac{${tex(total)}}{${mo.n}} = ${tex(mo.mean)}`),
    step(
      'dVariance',
      `s^2 = \\frac{\\sum (x - \\bar{x})^2}{n - 1} = \\frac{${tex(ss)}}{${mo.n - 1}} = ${tex(mo.variance)},\\quad ` +
        `s = ${tex(mo.sd)}`,
    ),
  ];
  if (Number.isFinite(mo.g1))
    steps.push(
      step(
        'dSkew',
        `G_1 = \\frac{\\sqrt{n(n-1)}}{n-2}\\,\\frac{m_3}{m_2^{3/2}} = \\frac{\\sqrt{${mo.n}\\cdot${mo.n - 1}}}{${mo.n - 2}}` +
          `\\cdot\\frac{${tex(mo.m3)}}{${tex(mo.m2)}^{3/2}} = ${tex(mo.g1)}`,
      ),
    );
  if (Number.isFinite(mo.g2))
    steps.push(
      step('dKurt', `G_2 = \\frac{n-1}{(n-2)(n-3)}\\left((n+1)\\frac{m_4}{m_2^2} - 3(n-1)\\right) = ${tex(mo.g2)}`),
    );
  const trims = trimmedMeans(input.values, input.trim);
  steps.push(
    step('dTrim', `\\bar{x}_t = ${tex(trims.trimmed)},\\quad \\bar{x}_w = ${tex(trims.winsorized)}`, {
      cut: `${trims.cut}`,
    }),
  );
  if (g) {
    steps.push(step('dGrubbs', `G = \\frac{|${tex(g.suspect)} - ${tex(mo.mean)}|}{${tex(mo.sd)}} = ${tex(g.g)}`));
    steps.push(
      step(
        'dGrubbsCrit',
        `t = ${tex(g.t)},\\quad G^{*} = \\frac{n-1}{\\sqrt{n}}\\sqrt{\\frac{t^2}{n-2+t^2}} = ${tex(g.critical)}`,
      ),
    );
    steps.push(
      step(g.outlier ? 'dGrubbsYes' : 'dGrubbsNo', undefined, { value: num(g.suspect), alpha: num(input.alpha) }),
    );
  }
  return steps;
}

export function histogramPlot(values: readonly number[]): PlotSpec {
  const bins = histogram(values);
  return {
    title: 'histogram',
    x: { label: 'value' },
    y: { label: 'count', min: 0 },
    marks: [{ kind: 'bars', bars: bins.map((b) => ({ x0: b.from, x1: b.to, y: b.count })) }],
  };
}

/** Everything the Summary mode shows for one sample. */
export function summaryReport(input: SummaryInput): Report {
  const values = input.values;
  check(values.length >= 2, 'tooFew', { min: '2' });
  const mo = moments(values);
  const s = sorted(values);
  const g = values.length >= 3 && mo.sd > 0 ? grubbs(values, input.alpha) : null;
  const unit = input.unit ? ` ${input.unit}` : '';
  return {
    answer: {
      key: 'describe',
      vars: { mean: num(mo.mean), sd: num(mo.sd), n: `${mo.n}`, unit },
      latex: `\\bar{x} = ${tex(mo.mean)},\\; s = ${tex(mo.sd)},\\; n = ${mo.n}`,
    },
    tables: [
      summaryTable(input, mo, s),
      outlierTable(values, mo, s, g),
      ...(mo.sd > 0 ? [ruleTable(values, mo), zTable(values, mo, s)] : []),
    ],
    steps: summarySteps(input, mo, g),
    plots: [histogramPlot(values), dotPlot(values)],
    notes: values.length > 200 ? [{ key: 'zFirst200' }] : [],
  };
}
