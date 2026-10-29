// The numbers behind the contingency-table tool, each a plain function of a table of counts: expected counts, the
// chi-square and G statistics, Fisher's exact test, McNemar's and Cochran's tests, and association measures. The
// linear-by-linear trend test and the forecast skill scores of a 2 × 2 table are here too.
import { logFactorial, Rng } from '../../subjects/num/rng';
import { binomialCdf, chiSquareSf, hypergeometricLogPmf } from '../../subjects/stats/dist';
import type { Hypergeometric } from '../../subjects/stats/dist';
import { check } from '../report';

export type Table = readonly (readonly number[])[];

export interface Margins {
  readonly rows: number[];
  readonly cols: number[];
  readonly n: number;
}

export function margins(table: Table): Margins {
  const rows = table.map((row) => row.reduce((a, b) => a + b, 0));
  const cols = table[0].map((_, j) => table.reduce((a, row) => a + row[j], 0));
  return { rows, cols, n: rows.reduce((a, b) => a + b, 0) };
}

/** Checks a table of counts: at least 2 × 2, whole numbers of 0 or more, and no empty row or column. */
export function checkTable(table: Table): Margins {
  check(table.length >= 2 && table[0].length >= 2, 'tableSize');
  check(
    table.every((row) => row.length === table[0].length),
    'ragged',
  );
  for (const value of table.flat()) {
    check(Number.isFinite(value) && value >= 0, 'negativeCount', { text: String(value) });
    check(Number.isInteger(value), 'wholeCount', { text: String(value) });
  }
  const m = margins(table);
  check(m.rows.every((r) => r > 0) && m.cols.every((c) => c > 0), 'emptyLine');
  return m;
}

export const expected = (m: Margins): number[][] => m.rows.map((r) => m.cols.map((c) => (r * c) / m.n));

export interface ChiSquare {
  readonly chi2: number;
  readonly df: number;
  readonly p: number;
}

const degrees = (table: Table): number => (table.length - 1) * (table[0].length - 1);

/** Pearson's chi-square; with `yates`, each |O − E| is cut by ½ first (the 2 × 2 continuity correction). */
export function chiSquare(table: Table, yates = false): ChiSquare {
  const e = expected(checkTable(table));
  let chi2 = 0;
  table.forEach((row, i) =>
    row.forEach((o, j) => {
      const d = yates ? Math.max(0, Math.abs(o - e[i][j]) - 0.5) : o - e[i][j];
      chi2 += (d * d) / e[i][j];
    }),
  );
  return { chi2, df: degrees(table), p: chiSquareSf(chi2, degrees(table)) };
}

/** The likelihood-ratio statistic G = 2 Σ O ln(O/E); empty cells add nothing. */
export function gTest(table: Table): ChiSquare {
  const e = expected(checkTable(table));
  let g = 0;
  table.forEach((row, i) => row.forEach((o, j) => (g += o > 0 ? 2 * o * Math.log(o / e[i][j]) : 0)));
  return { chi2: g, df: degrees(table), p: chiSquareSf(g, degrees(table)) };
}

export interface FisherTerm {
  /** The top-left count of a table with the observed margins. */
  readonly a: number;
  readonly p: number;
  readonly counted: boolean;
}

export interface Fisher2 {
  readonly p: number;
  readonly terms: readonly FisherTerm[];
}

/** Fisher's exact test on a 2 × 2 table: the tables with the same margins as likely as the observed one or less. */
export function fisher2x2(table: Table): Fisher2 {
  check(table.length === 2 && table[0].length === 2, 'needs2x2');
  const m = checkTable(table);
  const h: Hypergeometric = { total: m.n, successes: m.cols[0], draws: m.rows[0] };
  const lo = Math.max(0, m.rows[0] + m.cols[0] - m.n);
  const hi = Math.min(m.rows[0], m.cols[0]);
  const observed = hypergeometricLogPmf(table[0][0], h);
  const terms: FisherTerm[] = [];
  let p = 0;
  for (let a = lo; a <= hi; a += 1) {
    const log = hypergeometricLogPmf(a, h);
    // A relative tolerance of 1e-7 keeps tables tied with the observed one in the sum.
    const counted = log <= observed + 1e-7;
    if (counted) p += Math.exp(log);
    terms.push({ a, p: Math.exp(log), counted });
  }
  return { p: Math.min(1, p), terms };
}

/** The log probability of a table with fixed margins: Π r! Π c! / (N! Π n_ij!). */
function tableLogProbability(table: Table, m: Margins): number {
  let log = -logFactorial(m.n);
  for (const r of m.rows) log += logFactorial(r);
  for (const c of m.cols) log += logFactorial(c);
  for (const v of table.flat()) log -= logFactorial(v);
  return log;
}

export interface FisherMonteCarlo {
  readonly p: number;
  readonly se: number;
  readonly draws: number;
}

/** The most cases times draws the Monte Carlo test works through, so the window stays responsive. */
export const MAX_FISHER_WORK = 20_000_000;

/**
 * Fisher's exact test on an r × c table by Monte Carlo. Each draw shuffles the column of every case against its
 * row, which keeps the margins, and counts the tables no more likely than the observed one. p = (1 + count)/(1 + B).
 */
export function fisherMonteCarlo(table: Table, seed: bigint, draws: number): FisherMonteCarlo {
  const m = checkTable(table);
  check(Number.isInteger(draws) && draws >= 100 && draws <= 1_000_000, 'drawsRange');
  check(m.n * draws <= MAX_FISHER_WORK, 'tooMuchWork');
  const observed = tableLogProbability(table, m);
  const rowOf: number[] = m.rows.flatMap((r, i) => new Array<number>(r).fill(i));
  const colOf: number[] = m.cols.flatMap((c, j) => new Array<number>(c).fill(j));
  const rng = new Rng(seed);
  const cells = table.map((row) => row.map(() => 0));
  let count = 0;
  for (let b = 0; b < draws; b += 1) {
    for (const row of cells) row.fill(0);
    for (let k = colOf.length - 1; k > 0; k -= 1) {
      const pick = rng.integer(k + 1);
      [colOf[k], colOf[pick]] = [colOf[pick], colOf[k]];
    }
    for (let k = 0; k < rowOf.length; k += 1) cells[rowOf[k]][colOf[k]] += 1;
    if (tableLogProbability(cells, m) <= observed + 1e-7) count += 1;
  }
  const p = (1 + count) / (1 + draws);
  return { p, se: Math.sqrt((p * (1 - p)) / draws), draws };
}

export interface McNemar {
  readonly b: number;
  readonly c: number;
  readonly chi2: number;
  readonly p: number;
  readonly corrected: number;
  readonly pCorrected: number;
  readonly pExact: number;
}

/** McNemar's test on the discordant pairs b (yes, then no) and c (no, then yes) of a paired 2 × 2 table. */
export function mcNemar(table: Table): McNemar {
  check(table.length === 2 && table.every((row) => row.length === 2), 'needs2x2');
  for (const value of table.flat()) {
    check(Number.isInteger(value) && value >= 0, 'wholeCount', { text: String(value) });
  }
  const b = table[0][1];
  const c = table[1][0];
  check(b + c > 0, 'noDiscordant');
  const chi2 = (b - c) ** 2 / (b + c);
  const corrected = Math.max(0, Math.abs(b - c) - 1) ** 2 / (b + c);
  const pExact = Math.min(1, 2 * binomialCdf(Math.min(b, c), b + c, 0.5));
  return { b, c, chi2, p: chiSquareSf(chi2, 1), corrected, pCorrected: chiSquareSf(corrected, 1), pExact };
}

export interface CochranQ {
  readonly q: number;
  readonly df: number;
  readonly p: number;
  readonly columns: readonly number[];
  readonly rows: readonly number[];
  readonly total: number;
}

/** Cochran's Q for k matched 0-or-1 outcomes per subject: Q = (k − 1)(k Σ C² − T²)/(k T − Σ R²). */
export function cochranQ(data: Table): CochranQ {
  check(data.length >= 2, 'tooFew', { min: '2' });
  const k = data[0].length;
  check(k >= 2, 'cochranColumns');
  check(
    data.every((row) => row.length === k),
    'ragged',
  );
  check(
    data.flat().every((v) => v === 0 || v === 1),
    'binaryOnly',
  );
  const columns = data[0].map((_, j) => data.reduce((s, row) => s + row[j], 0));
  const rows = data.map((row) => row.reduce((s, v) => s + v, 0));
  const total = rows.reduce((s, v) => s + v, 0);
  const denominator = k * total - rows.reduce((s, r) => s + r * r, 0);
  check(denominator > 0, 'cochranConstant');
  const q = ((k - 1) * (k * columns.reduce((s, c) => s + c * c, 0) - total * total)) / denominator;
  return { q, df: k - 1, p: chiSquareSf(q, k - 1), columns, rows, total };
}

export interface Measures {
  readonly phi: number;
  readonly cramerV: number;
  readonly contingency: number;
  /** Goodman and Kruskal's λ: the share of errors in guessing the row (or column) that knowing the other removes. */
  readonly lambdaRows: number;
  readonly lambdaCols: number;
  readonly lambdaSymmetric: number;
  /** Goodman and Kruskal's γ, reading rows and columns as ordered from first to last. */
  readonly gamma: number;
}

function lambdas(table: Table, m: Margins) {
  const maxCol = Math.max(...m.cols);
  const maxRow = Math.max(...m.rows);
  const sumRowMax = table.reduce((s, row) => s + Math.max(...row), 0);
  const sumColMax = m.cols.reduce((s, _, j) => s + Math.max(...table.map((row) => row[j])), 0);
  const ratio = (top: number, bottom: number) => (bottom === 0 ? 0 : top / bottom);
  return {
    lambdaCols: ratio(sumRowMax - maxCol, m.n - maxCol),
    lambdaRows: ratio(sumColMax - maxRow, m.n - maxRow),
    lambdaSymmetric: ratio(sumRowMax + sumColMax - maxCol - maxRow, 2 * m.n - maxCol - maxRow),
  };
}

function gammaOf(table: Table): number {
  let concordant = 0;
  let discordant = 0;
  table.forEach((row, i) =>
    row.forEach((n, j) => {
      for (let k = i + 1; k < table.length; k += 1) {
        for (let l = 0; l < row.length; l += 1) {
          if (l > j) concordant += n * table[k][l];
          else if (l < j) discordant += n * table[k][l];
        }
      }
    }),
  );
  return concordant + discordant === 0 ? Number.NaN : (concordant - discordant) / (concordant + discordant);
}

/** Association measures. φ is signed for a 2 × 2 table (ad − bc over the root of the margins). */
export function measures(table: Table, chi2: number): Measures {
  const m = margins(table);
  const r = table.length;
  const c = table[0].length;
  const phi =
    r === 2 && c === 2
      ? (table[0][0] * table[1][1] - table[0][1] * table[1][0]) /
        Math.sqrt(m.rows[0] * m.rows[1] * m.cols[0] * m.cols[1])
      : Math.sqrt(chi2 / m.n);
  return {
    phi,
    cramerV: Math.sqrt(chi2 / (m.n * (Math.min(r, c) - 1))),
    contingency: Math.sqrt(chi2 / (chi2 + m.n)),
    ...lambdas(table, m),
    gamma: gammaOf(table),
  };
}

export interface Trend {
  readonly r: number;
  readonly m2: number;
  readonly p: number;
}

/** The linear-by-linear association test, M² = (N − 1) r², with scores 1, 2, 3, … for the rows and the columns. */
export function linearTrend(table: Table): Trend {
  const m = margins(table);
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  table.forEach((row, i) =>
    row.forEach((n, j) => {
      sx += n * (i + 1);
      sy += n * (j + 1);
      sxx += n * (i + 1) ** 2;
      syy += n * (j + 1) ** 2;
      sxy += n * (i + 1) * (j + 1);
    }),
  );
  const r = (sxy - (sx * sy) / m.n) / Math.sqrt((sxx - (sx * sx) / m.n) * (syy - (sy * sy) / m.n));
  const m2 = (m.n - 1) * r * r;
  return { r, m2, p: chiSquareSf(m2, 1) };
}

export interface Skill {
  readonly pod: number;
  readonly far: number;
  readonly pofd: number;
  readonly csi: number;
  readonly bias: number;
  readonly accuracy: number;
  readonly hss: number;
  readonly pss: number;
  /** The number correct by chance alone, E in the Heidke score. */
  readonly chance: number;
}

/** Forecast skill from hits a, false alarms b, misses c, and correct negatives d. */
export function skillScores(a: number, b: number, c: number, d: number): Skill {
  for (const v of [a, b, c, d]) check(Number.isFinite(v) && v >= 0, 'negativeCount', { text: String(v) });
  const n = a + b + c + d;
  check(n > 0, 'empty');
  check(a + c > 0 && b + d > 0, 'forecastObserved');
  const chance = ((a + b) * (a + c) + (c + d) * (b + d)) / n;
  const pod = a / (a + c);
  const pofd = b / (b + d);
  return {
    pod,
    far: a + b > 0 ? b / (a + b) : Number.NaN,
    pofd,
    csi: a / (a + b + c),
    bias: (a + b) / (a + c),
    accuracy: (a + d) / n,
    hss: n === chance ? Number.NaN : (a + d - chance) / (n - chance),
    pss: pod - pofd,
    chance,
  };
}
