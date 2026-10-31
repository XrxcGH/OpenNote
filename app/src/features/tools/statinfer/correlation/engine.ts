// The correlation tool's reports: one pair of columns (Pearson, Spearman, Kendall, and point-biserial), a matrix of
// correlations with adjusted p-values, partial correlation, and the comparison of two correlations.
import type { Alternative } from '../../subjects/stats/dist';
import { adjust, type Adjustment } from '../num/adjust';
import type { PlotSpec } from '../plot';
import { check, num, pTex, pText, step, tex, type Cell, type Report } from '../report';
import { compareDependent, compareIndependent, kendall, partial, pearson, spearman } from './stats';

export interface Column {
  readonly name: string;
  readonly values: readonly number[];
}

const pct = (c: number) => `${num(c * 100, 4)}%`;

function scatter(x: Column, y: Column, slope: number, intercept: number): PlotSpec {
  const lo = Math.min(...x.values);
  const hi = Math.max(...x.values);
  return {
    title: 'scatter',
    x: { label: 'xAxis' },
    y: { label: 'yAxis' },
    marks: [
      { kind: 'points', points: x.values.map((v, i) => ({ x: v, y: y.values[i] })) },
      { kind: 'line', tone: 1, points: [lo, hi].map((v) => ({ x: v, y: intercept + slope * v })) },
    ],
  };
}

const binary = (values: readonly number[]) => new Set(values).size === 2;

/** Every correlation of one pair of columns. */
export function pairReport(x: Column, y: Column, alternative: Alternative, confidence: number): Report {
  const p = pearson(x.values, y.values, alternative, confidence);
  const s = spearman(x.values, y.values, alternative);
  const k = kendall(x.values, y.values, alternative);
  const rows: Cell[][] = [
    [{ key: 'pearsonR' }, p.r, `t = ${num(p.t, 5)}`, p.p, `${num(p.lower, 5)} to ${num(p.upper, 5)}`],
    [{ key: s.exact ? 'spearmanExact' : 'spearmanT' }, s.rho, '', s.p, ''],
    [{ key: k.exact ? 'kendallExact' : 'kendallZ' }, k.tau, k.exact ? '' : `z = ${num(k.z, 5)}`, k.p, ''],
  ];
  if (binary(x.values) || binary(y.values)) rows.push([{ key: 'pointBiserial' }, p.r, '', p.p, '']);
  return {
    answer: {
      key: 'pair',
      vars: {
        r: num(p.r),
        p: pText(p.p),
        lo: num(p.lower, 4),
        hi: num(p.upper, 4),
        level: pct(confidence),
        n: `${p.s.n}`,
      },
      latex: `r = ${tex(p.r)},\\; t(${p.df}) = ${tex(p.t, 5)},\\; ${pTex(p.p)}`,
    },
    tables: [{ title: 'correlations', columns: ['measure', 'value', 'statistic', 'p', 'interval'], rows }],
    steps: [
      step('cSums', `S_{xx} = ${tex(p.s.sxx)},\\; S_{yy} = ${tex(p.s.syy)},\\; S_{xy} = ${tex(p.s.sxy)}`, {
        n: `${p.s.n}`,
      }),
      step('cR', `r = \\frac{S_{xy}}{\\sqrt{S_{xx}S_{yy}}} = ${tex(p.r)}`),
      step('cT', `t = r\\sqrt{\\frac{n-2}{1-r^2}} = ${tex(p.t)},\\quad df = ${p.df},\\quad ${pTex(p.p)}`),
      step('cZ', `z = \\operatorname{atanh} r = ${tex(Math.atanh(p.r))} \\pm \\frac{z_{\\alpha/2}}{\\sqrt{n-3}}`),
      step('cBack', `\\tanh(\\cdot) = (${tex(p.lower, 5)},\\ ${tex(p.upper, 5)})`, { level: pct(confidence) }),
    ],
    plots: [scatter(x, y, p.slope, p.intercept)],
    notes: [{ key: 'pairNames', vars: { x: x.name, y: y.name } }],
  };
}

/** Pearson correlations of every pair of columns, with p-values adjusted for the number of pairs. */
export function matrixReport(columns: readonly Column[], method: Adjustment): Report {
  check(columns.length >= 2, 'twoColumns');
  const pairs: { i: number; j: number; r: number; p: number }[] = [];
  for (let i = 0; i < columns.length; i += 1) {
    for (let j = i + 1; j < columns.length; j += 1) {
      const p = pearson(columns[i].values, columns[j].values);
      pairs.push({ i, j, r: p.r, p: p.p });
    }
  }
  const adjusted = adjust(
    pairs.map((pair) => pair.p),
    method,
  );
  const cell = (i: number, j: number): Cell => {
    if (i === j) return 1;
    const at = pairs.findIndex((pair) => (pair.i === i && pair.j === j) || (pair.i === j && pair.j === i));
    return i < j ? pairs[at].r : `p ${pText(adjusted[at])}`;
  };
  const strongest = pairs.reduce((best, pair) => (Math.abs(pair.r) > Math.abs(best.r) ? pair : best), pairs[0]);
  return {
    answer: {
      key: 'matrix',
      vars: {
        a: columns[strongest.i].name,
        b: columns[strongest.j].name,
        r: num(strongest.r, 4),
        count: `${pairs.length}`,
      },
      latex: `r_{\\max} = ${tex(strongest.r, 4)}`,
    },
    tables: [
      {
        title: 'matrixTable',
        columns: [{ text: '' }, ...columns.map((c) => ({ text: c.name }))],
        rows: columns.map((c, i): Cell[] => [c.name, ...columns.map((_, j) => cell(i, j))]),
      },
    ],
    steps: [step('cMatrix', undefined, { count: `${pairs.length}`, method })],
    notes: [{ key: 'matrixRead' }],
  };
}

/** The partial and semipartial correlation from three correlations and, when known, the sample size. */
export function partialReport(rxy: number, rxz: number, ryz: number, n: number | null): Report {
  const p = partial(rxy, rxz, ryz, n);
  const rows: Cell[][] = [
    [
      { key: 'partialR' },
      p.partial,
      Number.isFinite(p.t) ? `t(${p.df}) = ${num(p.t, 5)}` : '',
      Number.isFinite(p.p) ? p.p : '',
    ],
    [{ key: 'semipartialX' }, p.semipartialX, '', ''],
    [{ key: 'semipartialY' }, p.semipartialY, '', ''],
  ];
  return {
    answer: { key: 'partial', vars: { r: num(p.partial) }, latex: `r_{xy\\cdot z} = ${tex(p.partial)}` },
    tables: [{ title: 'partialTable', columns: ['measure', 'value', 'statistic', 'p'], rows }],
    steps: [
      step(
        'cPartial',
        `r_{xy\\cdot z} = \\frac{r_{xy} - r_{xz}r_{yz}}{\\sqrt{(1-r_{xz}^2)(1-r_{yz}^2)}}` +
          ` = \\frac{${tex(rxy)} - ${tex(rxz)}\\cdot${tex(ryz)}}{\\sqrt{(1-${tex(rxz)}^2)(1-${tex(ryz)}^2)}}` +
          ` = ${tex(p.partial)}`,
      ),
      step(
        'cSemipartialX',
        `r_{y(x\\cdot z)} = \\frac{r_{xy} - r_{xz}r_{yz}}{\\sqrt{1-r_{xz}^2}} = ${tex(p.semipartialX)}`,
      ),
      step(
        'cSemipartialY',
        `r_{x(y\\cdot z)} = \\frac{r_{xy} - r_{xz}r_{yz}}{\\sqrt{1-r_{yz}^2}} = ${tex(p.semipartialY)}`,
      ),
    ],
  };
}

export type Compare =
  | { kind: 'independent'; r1: number; n1: number; r2: number; n2: number }
  | { kind: 'dependent'; r12: number; r13: number; r23: number; n: number };

/** Whether two correlations differ, from independent samples or sharing a variable in one sample. */
export function compareReport(c: Compare): Report {
  const result =
    c.kind === 'independent' ? compareIndependent(c.r1, c.n1, c.r2, c.n2) : compareDependent(c.r12, c.r13, c.r23, c.n);
  const steps =
    c.kind === 'independent'
      ? [
          step(
            'cFisher',
            `z_1 = \\operatorname{atanh} ${tex(c.r1)} = ${tex(Math.atanh(c.r1))},\\; z_2` +
              ` = \\operatorname{atanh} ${tex(c.r2)} = ${tex(Math.atanh(c.r2))}`,
          ),
          step(
            'cCompare',
            `z = \\frac{z_1 - z_2}{\\sqrt{\\frac{1}{n_1-3} + \\frac{1}{n_2-3}}} = ${tex(result.z)},\\;` +
              ` ${pTex(result.p)}`,
          ),
        ]
      : [step('cSteiger', `Z = ${tex(result.z)},\\; ${pTex(result.p)}`)];
  return {
    answer: {
      key: 'compare',
      vars: { z: num(result.z, 4), p: pText(result.p) },
      latex: `z = ${tex(result.z, 4)},\\; ${pTex(result.p)}`,
    },
    tables: [
      {
        title: 'tests',
        columns: ['test', 'statistic', 'p'],
        rows: [[{ key: c.kind === 'independent' ? 'fisherCompare' : 'steiger' }, result.z, result.p]],
      },
    ],
    steps,
  };
}
