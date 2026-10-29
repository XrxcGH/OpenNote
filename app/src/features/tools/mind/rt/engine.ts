// Response times and movement. Trials by subject and condition are trimmed (absolute cut-offs, then k SDs, the
// MAD rule, or recursive SD trimming within each subject and condition) and summarized: condition means and
// medians of subject means, accuracy, inverse efficiency, and within-subject (Cousineau-Morey) intervals. The
// ex-Gaussian is fitted by maximum likelihood; vincentized quantiles give quantile and delta plots; Fitts' law
// (Shannon form) and the Hick-Hyman law are fitted by least squares.
import { brent, lineFit, logNormCdf, mean, median, nelderMead, normCdf, quantile, sd, tQuantile } from '../kit/num';
import { columnOf, isMissing, readNumber, readTable } from '../kit/parse';
import { fail } from '../kit/types';

export interface Trial {
  readonly subject: string;
  readonly condition: string;
  readonly rt: number;
  /** True when the answer was correct (or no accuracy column was given). */
  readonly correct: boolean;
}

/** Trials from a table with columns subject, condition, rt, and optionally correct (1 or 0). */
export function readTrials(text: string): { trials: Trial[]; hasAccuracy: boolean; skipped: number } {
  const table = readTable(text, 'trials');
  if (!table.header) fail('trialHeader', {}, 'trials');
  const at = (name: string) => columnOf(table.header!, name);
  const [s, c, r, k] = [at('subject'), at('condition'), at('rt'), at('correct')];
  if (s < 0 || c < 0 || r < 0) fail('trialHeader', {}, 'trials');
  const trials: Trial[] = [];
  let skipped = 0;
  table.rows.forEach((row, i) => {
    const line = table.lineOf[i];
    if (isMissing(row[r] ?? '')) {
      skipped += 1;
      return;
    }
    const rt = readNumber(row[r]);
    if (Number.isNaN(rt)) fail('badCell', { cell: row[r], line }, 'trials');
    if (rt < 0) fail('negativeRt', { line }, 'trials');
    let correct = true;
    if (k >= 0) {
      const v = (row[k] ?? '').trim();
      if (v !== '0' && v !== '1') fail('correctCell', { line }, 'trials');
      correct = v === '1';
    }
    trials.push({ subject: row[s] ?? '', condition: row[c] ?? '', rt, correct });
  });
  if (trials.length === 0) fail('empty', {}, 'trials');
  return { trials, hasAccuracy: k >= 0, skipped };
}

export type TrimRule = 'none' | 'sd' | 'mad' | 'recursive';

export interface Trimmed {
  readonly kept: readonly Trial[];
  readonly belowMin: number;
  readonly aboveMax: number;
  /** Removed by the SD, MAD, or recursive rule. */
  readonly byRule: number;
  /** Error trials left out of the RT summaries. */
  readonly errors: number;
}

const cellKey = (t: Trial) => `${t.subject}\u0000${t.condition}`;

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/** Keeps the RTs within k of the centre of each cell, by the chosen rule. */
function trimCell(rts: number[], rule: TrimRule, k: number): number[] {
  if (rule === 'none' || rts.length < 3) return rts;
  if (rule === 'mad') {
    const m = median(rts);
    const mad = 1.4826 * median(rts.map((x) => Math.abs(x - m)));
    return mad === 0 ? rts : rts.filter((x) => Math.abs(x - m) <= k * mad);
  }
  if (rule === 'sd') {
    const m = mean(rts);
    const s = sd(rts);
    return s === 0 ? rts : rts.filter((x) => Math.abs(x - m) <= k * s);
  }
  // Recursive: drop the farthest RT while it lies beyond k SDs of the others, then look again.
  let left = [...rts];
  while (left.length >= 3) {
    const m = mean(left);
    let far = 0;
    left.forEach((x, i) => {
      if (Math.abs(x - m) > Math.abs(left[far] - m)) far = i;
    });
    const others = left.filter((_, i) => i !== far);
    const s = sd(others);
    if (s === 0 || Math.abs(left[far] - mean(others)) <= k * s) break;
    left = others;
  }
  return left;
}

export function trim(trials: readonly Trial[], min: number, max: number, rule: TrimRule, k: number): Trimmed {
  if (rule !== 'none' && !(k > 0)) fail('positive', {}, 'k');
  if (min >= max) fail('minMax', {}, 'max');
  const correct = trials.filter((t) => t.correct);
  const inRange = correct.filter((t) => t.rt >= min && t.rt <= max);
  const kept: Trial[] = [];
  for (const cell of groupBy(inRange, cellKey).values()) {
    const keep = trimCell(
      cell.map((t) => t.rt),
      rule,
      k,
    );
    const left = [...keep];
    for (const t of cell) {
      const i = left.indexOf(t.rt);
      if (i >= 0) {
        kept.push(t);
        left.splice(i, 1);
      }
    }
  }
  return {
    kept,
    belowMin: correct.filter((t) => t.rt < min).length,
    aboveMax: correct.filter((t) => t.rt > max).length,
    byRule: inRange.length - kept.length,
    errors: trials.length - correct.length,
  };
}

export interface ConditionSummary {
  readonly condition: string;
  readonly trials: number;
  /** Mean over subjects of each subject's mean RT. */
  readonly mean: number;
  /** Mean over subjects of each subject's median RT. */
  readonly median: number;
  /** Share correct over all trials in the condition; NaN without an accuracy column. */
  readonly accuracy: number;
  /** Mean RT divided by accuracy. */
  readonly ies: number;
  /** Cousineau-Morey 95% half-width; NaN when not every subject has every condition. */
  readonly halfWidth: number;
}

/** Each subject's mean in each condition, rows subjects and columns conditions; NaN where a cell is empty. */
export function cellMeans(trials: readonly Trial[], subjects: readonly string[], conditions: readonly string[]) {
  const cells = groupBy(trials, cellKey);
  const at = (s: string, c: string, f: (xs: number[]) => number) => {
    const list = cells.get(`${s}\u0000${c}`);
    return list && list.length > 0 ? f(list.map((t) => t.rt)) : NaN;
  };
  return {
    means: subjects.map((s) => conditions.map((c) => at(s, c, mean))),
    medians: subjects.map((s) => conditions.map((c) => at(s, c, median))),
  };
}

/**
 * Cousineau-Morey half-widths: each score minus its subject's mean plus the grand mean, the SD of each column
 * over sqrt(n), times sqrt(k/(k - 1)), times t at (1 + level)/2 with n - 1 degrees of freedom.
 */
export function cousineauMorey(rows: readonly (readonly number[])[], level = 0.95): number[] {
  const n = rows.length;
  const k = rows[0]?.length ?? 0;
  if (n < 2) fail('fewSubjects', {}, 'trials');
  if (k < 2) fail('fewConditions', {}, 'trials');
  const grand = mean(rows.flat());
  const normed = rows.map((row) => {
    const m = mean(row);
    return row.map((y) => y - m + grand);
  });
  const t = tQuantile((1 + level) / 2, n - 1);
  return Array.from({ length: k }, (_, j) => {
    const column = normed.map((row) => row[j]);
    return t * (sd(column) / Math.sqrt(n)) * Math.sqrt(k / (k - 1));
  });
}

export function summarizeConditions(
  all: readonly Trial[],
  kept: readonly Trial[],
  hasAccuracy: boolean,
): { subjects: string[]; conditions: string[]; summaries: ConditionSummary[] } {
  const subjects = [...new Set(all.map((t) => t.subject))];
  const conditions = [...new Set(all.map((t) => t.condition))];
  const { means, medians } = cellMeans(kept, subjects, conditions);
  const complete = means.every((row) => row.every((v) => !Number.isNaN(v)));
  const half =
    complete && subjects.length >= 2 && conditions.length >= 2 ? cousineauMorey(means) : conditions.map(() => NaN);
  const summaries = conditions.map((condition, j) => {
    const column = means.map((row) => row[j]).filter((v) => !Number.isNaN(v));
    const meds = medians.map((row) => row[j]).filter((v) => !Number.isNaN(v));
    const inCondition = all.filter((t) => t.condition === condition);
    const accuracy = hasAccuracy ? inCondition.filter((t) => t.correct).length / inCondition.length : NaN;
    const m = column.length > 0 ? mean(column) : NaN;
    return {
      condition,
      trials: kept.filter((t) => t.condition === condition).length,
      mean: m,
      median: meds.length > 0 ? mean(meds) : NaN,
      accuracy,
      ies: hasAccuracy && accuracy > 0 ? m / accuracy : NaN,
      halfWidth: half[j],
    };
  });
  return { subjects, conditions, summaries };
}

export interface ExGauss {
  readonly mu: number;
  readonly sigma: number;
  readonly tau: number;
}

/** The ex-Gaussian density: a normal (mu, sigma) plus an exponential with mean tau. */
export function exGaussPdf(x: number, { mu, sigma, tau }: ExGauss): number {
  const z = (x - mu) / sigma - sigma / tau;
  const logTail = mu / tau + (sigma * sigma) / (2 * tau * tau) - x / tau;
  // In logs, so a large exponent and a tiny Phi far below mu do not overflow and underflow.
  return Math.exp(logTail - Math.log(tau) + logNormCdf(z));
}

export function exGaussCdf(x: number, { mu, sigma, tau }: ExGauss): number {
  const u = (x - mu) / sigma;
  const tail = Math.exp(mu / tau + (sigma * sigma) / (2 * tau * tau) - x / tau) * normCdf(u - sigma / tau);
  return Math.min(1, Math.max(0, normCdf(u) - (Number.isFinite(tail) ? tail : 0)));
}

export const exGaussMoments = (p: ExGauss) => ({
  mean: p.mu + p.tau,
  sd: Math.sqrt(p.sigma * p.sigma + p.tau * p.tau),
});

export function exGaussQuantile(q: number, p: ExGauss): number {
  const { mean: m, sd: s } = exGaussMoments(p);
  return brent((x) => exGaussCdf(x, p) - q, m - 10 * s, m + 20 * s, 1e-10);
}

export function checkExGauss(p: ExGauss): ExGauss {
  if (!(p.sigma > 0)) fail('positive', {}, 'sigma');
  if (!(p.tau > 0)) fail('positive', {}, 'tau');
  if (!Number.isFinite(p.mu)) fail('number', {}, 'mu');
  return p;
}

/**
 * Fits mu, sigma, and tau by maximum likelihood (Nelder-Mead on mu, ln sigma, ln tau), starting from the method
 * of moments with tau from the skewness.
 */
export function fitExGauss(rts: readonly number[]): ExGauss & { logLik: number } {
  if (rts.length < 10) fail('fewRts', { low: 10 }, 'rts');
  const m = mean(rts);
  const s = sd(rts);
  if (!(s > 0)) fail('noVariation', {}, 'rts');
  const skew = rts.reduce((acc, x) => acc + ((x - m) / s) ** 3, 0) / rts.length;
  const tau0 = s * Math.cbrt(Math.max(skew, 0.05) / 2);
  const sigma0 = Math.sqrt(Math.max(s * s - tau0 * tau0, (s * s) / 10));
  const nll = ([mu, ls, lt]: number[]) => {
    const p = { mu, sigma: Math.exp(ls), tau: Math.exp(lt) };
    let total = 0;
    for (const x of rts) {
      const d = exGaussPdf(x, p);
      total -= d > 0 ? Math.log(d) : -745;
    }
    return total;
  };
  const best = nelderMead(nll, [m - tau0, Math.log(sigma0), Math.log(tau0)], [s / 2, 0.5, 0.5]);
  const [mu, ls, lt] = best.x;
  return { mu, sigma: Math.exp(ls), tau: Math.exp(lt), logLik: -best.value };
}

/** Each subject's quantiles of each condition, averaged over subjects (vincentizing). */
export function vincentize(
  trials: readonly Trial[],
  condition: string,
  probabilities: readonly number[],
): { quantiles: number[]; subjects: number } {
  const bySubject = groupBy(
    trials.filter((t) => t.condition === condition),
    (t) => t.subject,
  );
  const per = [...bySubject.values()].map((list) =>
    probabilities.map((p) =>
      quantile(
        list.map((t) => t.rt),
        p,
      ),
    ),
  );
  if (per.length === 0) fail('noCondition', { condition }, 'compare');
  return { quantiles: probabilities.map((_, i) => mean(per.map((q) => q[i]))), subjects: per.length };
}

export interface Law {
  readonly a: number;
  readonly b: number;
  readonly r2: number;
  readonly x: readonly number[];
}

/** Fitts' law, Shannon form: ID = log2(D/W + 1), MT = a + b ID. */
export function fitts(rows: readonly (readonly number[])[]): Law & { throughput: number; ids: number[] } {
  if (rows.length < 2) fail('fewPoints', { low: 2 }, 'fitts');
  const ids = rows.map(([d, w], i) => {
    if (!(d > 0) || !(w > 0)) fail('fittsRow', { line: i + 1 }, 'fitts');
    return Math.log2(d / w + 1);
  });
  const mts = rows.map((row) => row[2]);
  const fit = lineFit(ids, mts);
  if (Number.isNaN(fit.slope)) fail('sameId', {}, 'fitts');
  return { a: fit.intercept, b: fit.slope, r2: fit.r2, x: ids, ids, throughput: mean(ids.map((id, i) => id / mts[i])) };
}

/** The Hick-Hyman law: H = log2(N) (or log2(N + 1) with a no-choice option), RT = a + b H. */
export function hick(rows: readonly (readonly number[])[], plusOne: boolean): Law {
  if (rows.length < 2) fail('fewPoints', { low: 2 }, 'hick');
  const hs = rows.map(([n], i) => {
    if (!Number.isInteger(n) || n < 1) fail('hickRow', { line: i + 1 }, 'hick');
    return Math.log2(plusOne ? n + 1 : n);
  });
  const fit = lineFit(
    hs,
    rows.map((row) => row[1]),
  );
  if (Number.isNaN(fit.slope)) fail('sameId', {}, 'hick');
  return { a: fit.intercept, b: fit.slope, r2: fit.r2, x: hs };
}
