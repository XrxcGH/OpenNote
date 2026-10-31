// Agreement on measurements: the intraclass correlations of Shrout and Fleiss (1979) from the two-way analysis of
// variance of a targets-by-judges table, with their F tests and intervals, and the Bland-Altman bias and limits.
import { fCdf, fQuantile, mean, sd, tQuantile } from '../kit/num';
import { fail } from '../kit/types';

export interface MeanSquares {
  readonly n: number;
  readonly k: number;
  readonly bms: number;
  readonly jms: number;
  readonly wms: number;
  readonly ems: number;
  readonly grand: number;
}

/** The between-targets, between-judges, within-target, and residual mean squares. */
export function meanSquares(rows: readonly (readonly number[])[]): MeanSquares {
  const n = rows.length;
  if (n < 2) fail('fewTargets', {}, 'ratings');
  const k = rows[0].length;
  if (k < 2) fail('fewJudges', {}, 'ratings');
  if (rows.some((row) => row.some((v) => !Number.isFinite(v)))) fail('complete', {}, 'ratings');
  const grand = mean(rows.flat());
  const rowMeans = rows.map((row) => mean(row));
  const colMeans = rows[0].map((_, j) => mean(rows.map((row) => row[j])));
  const total = rows.flat().reduce((s, v) => s + (v - grand) ** 2, 0);
  const between = k * rowMeans.reduce((s, m) => s + (m - grand) ** 2, 0);
  const judges = n * colMeans.reduce((s, m) => s + (m - grand) ** 2, 0);
  return {
    n,
    k,
    grand,
    bms: between / (n - 1),
    jms: judges / (k - 1),
    wms: (total - between) / (n * (k - 1)),
    ems: (total - between - judges) / ((n - 1) * (k - 1)),
  };
}

export interface IccForm {
  /** Shrout and Fleiss's name, such as 1,1 for ICC(1,1). */
  readonly id: string;
  readonly value: number;
  readonly f: number;
  readonly df1: number;
  readonly df2: number;
  readonly p: number;
  readonly low: number;
  readonly high: number;
}

const spearmanBrown = (r: number, k: number) => (k * r) / (1 + (k - 1) * r);

/** The 6 intraclass correlations with 95% intervals (the formulas of McGraw and Wong 1996). */
export function iccForms(ms: MeanSquares, level = 0.95): IccForm[] {
  const { n, k, bms, jms, wms, ems } = ms;
  const a = 1 - level;
  const f1 = bms / wms;
  const f3 = bms / ems;
  const [d1, d2] = [n - 1, n * (k - 1)];
  const d3 = (n - 1) * (k - 1);
  const fl1 = f1 / fQuantile(1 - a / 2, d1, d2);
  const fu1 = f1 * fQuantile(1 - a / 2, d2, d1);
  const fl3 = f3 / fQuantile(1 - a / 2, d1, d3);
  const fu3 = f3 * fQuantile(1 - a / 2, d3, d1);
  const icc2 = (bms - ems) / (bms + (k - 1) * ems + (k * (jms - ems)) / n);
  const fj = jms / ems;
  const top = (k - 1) * (n - 1) * (k * icc2 * fj + n * (1 + (k - 1) * icc2) - k * icc2) ** 2;
  const bottom = (n - 1) * k * k * icc2 * icc2 * fj * fj + (n * (1 + (k - 1) * icc2) - k * icc2) ** 2;
  const v = top / bottom;
  const fUp = fQuantile(1 - a / 2, n - 1, v);
  const fDown = fQuantile(1 - a / 2, v, n - 1);
  const shared = k * jms + (k * n - k - n) * ems;
  const low2 = (n * (bms - fUp * ems)) / (fUp * shared + n * bms);
  const high2 = (n * (fDown * bms - ems)) / (shared + n * fDown * bms);
  const pOf = (f: number, x: number, y: number) => 1 - fCdf(f, x, y);
  return [
    {
      id: '1,1',
      value: (bms - wms) / (bms + (k - 1) * wms),
      f: f1,
      df1: d1,
      df2: d2,
      p: pOf(f1, d1, d2),
      low: (fl1 - 1) / (fl1 + k - 1),
      high: (fu1 - 1) / (fu1 + k - 1),
    },
    { id: '2,1', value: icc2, f: f3, df1: d1, df2: d3, p: pOf(f3, d1, d3), low: low2, high: high2 },
    {
      id: '3,1',
      value: (bms - ems) / (bms + (k - 1) * ems),
      f: f3,
      df1: d1,
      df2: d3,
      p: pOf(f3, d1, d3),
      low: (fl3 - 1) / (fl3 + k - 1),
      high: (fu3 - 1) / (fu3 + k - 1),
    },
    {
      id: '1,k',
      value: (bms - wms) / bms,
      f: f1,
      df1: d1,
      df2: d2,
      p: pOf(f1, d1, d2),
      low: 1 - 1 / fl1,
      high: 1 - 1 / fu1,
    },
    {
      id: '2,k',
      value: (bms - ems) / (bms + (jms - ems) / n),
      f: f3,
      df1: d1,
      df2: d3,
      p: pOf(f3, d1, d3),
      low: spearmanBrown(low2, k),
      high: spearmanBrown(high2, k),
    },
    {
      id: '3,k',
      value: (bms - ems) / bms,
      f: f3,
      df1: d1,
      df2: d3,
      p: pOf(f3, d1, d3),
      low: 1 - 1 / fl3,
      high: 1 - 1 / fu3,
    },
  ];
}

/** The Koo and Li (2016) words for an intraclass correlation, a convention rather than a test. */
export function kooLi(icc: number): string {
  if (icc < 0.5) return 'poor';
  if (icc < 0.75) return 'moderate';
  if (icc < 0.9) return 'good';
  return 'excellent';
}

export interface BlandAltman {
  readonly n: number;
  readonly bias: number;
  readonly sd: number;
  readonly lower: number;
  readonly upper: number;
  /** 95% intervals for the bias and for each limit (Bland and Altman 1999). */
  readonly biasCi: readonly [number, number];
  readonly lowerCi: readonly [number, number];
  readonly upperCi: readonly [number, number];
  readonly differences: readonly number[];
  readonly means: readonly number[];
}

/** The bias and 95% limits of agreement from paired differences, with the pairs' means where known. */
export function blandAltman(differences: readonly number[], means: readonly number[] = []): BlandAltman {
  const n = differences.length;
  if (n < 3) fail('fewPairs', {}, 'pairs');
  const bias = mean(differences);
  const s = sd(differences);
  // Bland and Altman's limits use 1.96 standard deviations, the rounded normal quantile.
  const z = 1.96;
  const t = tQuantile(0.975, n - 1);
  const seBias = s / Math.sqrt(n);
  const seLimit = s * Math.sqrt(3 / n);
  const lower = bias - z * s;
  const upper = bias + z * s;
  return {
    n,
    bias,
    sd: s,
    lower,
    upper,
    biasCi: [bias - t * seBias, bias + t * seBias],
    lowerCi: [lower - t * seLimit, lower + t * seLimit],
    upperCi: [upper - t * seLimit, upper + t * seLimit],
    differences,
    means,
  };
}
