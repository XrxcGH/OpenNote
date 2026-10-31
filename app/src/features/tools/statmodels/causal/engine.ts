// Estimators of causal effects from observational data. Fixed effects remove each entity's mean (and each period's,
// for two-way effects) before least squares, or take first differences. Two-stage least squares replaces the
// endogenous columns by their fitted values from the instruments: b = (X'P_Z X)^-1 X'P_Z y, with standard errors
// from the structural residuals. Difference-in-differences compares the change in the treated group with the
// change in the control group. Regression discontinuity fits a weighted line on each side of the cutoff and takes
// the gap between the intercepts. Propensity scores come from a logistic model and feed inverse-probability
// weighting and nearest-neighbor matching.
import { fitGlm } from '../glm/fit';
import { fUpper, normalQuantile, normalTwoSided, tQuantile, tTwoSided } from '../kit/dist';
import { crossprod, crossVec, inverse, leastSquares, matMul, matVec, mean, variance, type Matrix } from '../kit/linalg';
import { fail } from '../kit/types';
import { sandwich } from '../regression/ols';

export interface Estimate {
  readonly name: string;
  readonly coef: number;
  readonly se: number;
  readonly t: number;
  readonly p: number;
  readonly low: number;
  readonly high: number;
}

const sum = (xs: readonly number[]) => xs.reduce((s, v) => s + v, 0);

function estimates(names: readonly string[], coef: readonly number[], cov: Matrix, df: number, level: number) {
  const crit = Number.isFinite(df) ? tQuantile(1 - (1 - level) / 2, df) : normalQuantile(1 - (1 - level) / 2);
  return names.map((name, j): Estimate => {
    const se = Math.sqrt(Math.max(0, cov[j][j]));
    const t = coef[j] / se;
    return {
      name,
      coef: coef[j],
      se,
      t,
      p: tTwoSided(t, Number.isFinite(df) ? df : 1e9),
      low: coef[j] - crit * se,
      high: coef[j] + crit * se,
    };
  });
}

/** Subtracts each group's mean from the values. */
export function demean(values: readonly number[], groups: readonly string[]): number[] {
  const sums = new Map<string, [number, number]>();
  values.forEach((v, i) => {
    const s = sums.get(groups[i]) ?? [0, 0];
    sums.set(groups[i], [s[0] + v, s[1] + 1]);
  });
  return values.map((v, i) => {
    const s = sums.get(groups[i]) as [number, number];
    return v - s[0] / s[1];
  });
}

/** Removes entity and period means together by alternating projections, to 1e-12. */
function demeanTwoWay(values: readonly number[], entity: readonly string[], time: readonly string[]): number[] {
  let v = [...values];
  for (let k = 0; k < 10_000; k++) {
    const next = demean(demean(v, entity), time);
    const change = Math.max(...next.map((x, i) => Math.abs(x - v[i])));
    v = next;
    if (change < 1e-12 * (1 + Math.max(...v.map(Math.abs)))) break;
  }
  return v;
}

export type PanelKind = 'entity' | 'twoway' | 'firstdiff';

export interface PanelFit {
  readonly kind: PanelKind;
  readonly coefs: readonly Estimate[];
  readonly n: number;
  readonly groups: number;
  readonly periods: number;
  readonly df: number;
  readonly withinR2: number;
  /** The demeaned or differenced data of the first predictor, for the worked steps. */
  readonly xt: number[];
  readonly yt: number[];
  readonly clustered: boolean;
}

/**
 * Fixed effects by the within transformation, or first differences within each entity in time order. Standard
 * errors are clustered by entity when there are at least 2 entities and `cluster` is set.
 */
export function panel(
  y: readonly number[],
  x: Matrix,
  names: readonly string[],
  entity: readonly string[],
  time: readonly number[] | null,
  kind: PanelKind,
  cluster: boolean,
  level: number,
): PanelFit {
  const groups = new Set(entity).size;
  if (groups < 2) fail('oneEntity');
  const k = names.length;
  let yt: number[];
  let xt: Matrix;
  let ids: string[];
  let absorbed: number;
  if (kind === 'firstdiff') {
    if (!time) fail('needTime');
    const order = y
      .map((_, i) => i)
      .sort((a, b) => (entity[a] < entity[b] ? -1 : entity[a] > entity[b] ? 1 : time[a] - time[b]));
    yt = [];
    xt = [];
    ids = [];
    for (let r = 1; r < order.length; r++) {
      const [a, b] = [order[r - 1], order[r]];
      if (entity[a] !== entity[b]) continue;
      if (time[a] === time[b]) fail('repeatedPeriod', entity[a]);
      yt.push(y[b] - y[a]);
      xt.push(x[b].map((v, j) => v - x[a][j]));
      ids.push(entity[b]);
    }
    absorbed = 0;
  } else {
    const periods = time ? time.map(String) : [];
    if (kind === 'twoway' && !time) fail('needTime');
    const tr = (v: readonly number[]) => (kind === 'twoway' ? demeanTwoWay(v, entity, periods) : demean(v, entity));
    yt = tr(y);
    const cols = names.map((_, j) => tr(x.map((row) => row[j])));
    xt = yt.map((_, i) => cols.map((c) => c[i]));
    ids = [...entity];
    absorbed = groups + (kind === 'twoway' ? new Set(periods).size - 1 : 0);
  }
  const n = yt.length;
  const df = n - k - absorbed;
  if (df < 1) fail('tooFewRows', `${n}|${k + absorbed}`);
  const ls = leastSquares(xt, yt, names);
  const s2 = ls.rss / df;
  const cov = cluster
    ? sandwich(xt, ls.resid, ls.xtxInv, 'cluster', ids)
    : ls.xtxInv.map((row) => row.map((v) => v * s2));
  const tss = sum(yt.map((v) => v * v));
  return {
    kind,
    coefs: estimates(names, ls.coef, cov, cluster ? new Set(ids).size - 1 : df, level),
    n,
    groups,
    periods: time ? new Set(time).size : 0,
    df,
    withinR2: tss > 0 ? 1 - ls.rss / tss : NaN,
    xt: xt.map((r) => r[0]),
    yt,
    clustered: cluster,
  };
}

export interface IvFit {
  readonly coefs: readonly Estimate[];
  readonly firstStage: readonly {
    readonly name: string;
    readonly f: number;
    readonly p: number;
    readonly r2: number;
    readonly df1: number;
    readonly df2: number;
  }[];
  readonly hausman: { readonly stat: number; readonly df1: number; readonly df2: number; readonly p: number };
  readonly n: number;
  readonly sigma: number;
}

/** Two-stage least squares. `exog` includes the intercept column; `endog` and `instruments` are the other columns. */
export function tsls(
  y: readonly number[],
  endog: Matrix,
  exog: Matrix,
  instruments: Matrix,
  names: readonly string[],
  level: number,
): IvFit {
  const n = y.length;
  const ke = endog[0]?.length ?? 0;
  const kz = instruments[0]?.length ?? 0;
  if (ke === 0) fail('pickColumns');
  if (kz < ke) fail('fewInstruments', `${kz}|${ke}`);
  const z = exog.map((row, i) => [...row, ...instruments[i]]);
  const kx = exog[0].length + ke;
  if (n <= z[0].length) fail('tooFewRows', `${n}|${z[0].length}`);
  const fitted: number[][] = exog.map((row) => [...row]);
  const resid: number[][] = y.map(() => []);
  const firstStage = Array.from({ length: ke }, (_, j) => {
    const target = endog.map((row) => row[j]);
    const full = leastSquares(z, target);
    const reduced = leastSquares(exog, target);
    const df2 = n - z[0].length;
    const f = (reduced.rss - full.rss) / kz / (full.rss / df2);
    full.fitted.forEach((v, i) => {
      fitted[i].push(v);
      resid[i].push(full.resid[i]);
    });
    const m = mean(target);
    const tss = sum(target.map((v) => (v - m) ** 2));
    return { name: names[exog[0].length + j], f, p: fUpper(f, kz, df2), r2: 1 - full.rss / tss, df1: kz, df2 };
  });
  const x = exog.map((row, i) => [...row, ...endog[i]]);
  const xhInv = inverse(crossprod(fitted));
  if (!xhInv) fail('singularDesign');
  const coef = matVec(xhInv, crossVec(fitted, y));
  const e = y.map((v, i) => v - x[i].reduce((s, xv, j) => s + xv * coef[j], 0));
  const s2 = sum(e.map((v) => v * v)) / (n - kx);
  const cov = xhInv.map((row) => row.map((v) => v * s2));
  const aug = x.map((row, i) => [...row, ...resid[i]]);
  const full = leastSquares(aug, y);
  const restricted = leastSquares(x, y);
  const df2 = n - aug[0].length;
  const stat = (restricted.rss - full.rss) / ke / (full.rss / df2);
  return {
    coefs: estimates(names, coef, cov, n - kx, level),
    firstStage,
    hausman: { stat, df1: ke, df2, p: fUpper(stat, ke, df2) },
    n,
    sigma: Math.sqrt(s2),
  };
}

export interface TwoByTwo {
  readonly treatedPre: number;
  readonly treatedPost: number;
  readonly controlPre: number;
  readonly controlPost: number;
  readonly did: number;
}

/** DiD = (treated after − treated before) − (control after − control before). */
export const didFromMeans = (
  treatedPre: number,
  treatedPost: number,
  controlPre: number,
  controlPost: number,
): TwoByTwo => ({
  treatedPre,
  treatedPost,
  controlPre,
  controlPost,
  did: treatedPost - treatedPre - (controlPost - controlPre),
});

export interface DidFit {
  readonly means: TwoByTwo;
  readonly counts: readonly [number, number, number, number];
  readonly coefs: readonly Estimate[];
  readonly n: number;
  readonly clustered: boolean;
}

const binary = (v: readonly number[], what: string) => {
  if (v.some((x) => x !== 0 && x !== 1)) fail('notBinary', what);
};

/** The 2 x 2 table of means and the regression y = a + b treated + c post + d treated·post, with robust errors. */
export function differenceInDifferences(
  y: readonly number[],
  treated: readonly number[],
  post: readonly number[],
  names: { treated: string; post: string },
  cluster: readonly string[] | null,
  level: number,
): DidFit {
  binary(treated, names.treated);
  binary(post, names.post);
  const cell = (t: number, p: number) => y.filter((_, i) => treated[i] === t && post[i] === p);
  const cells = [cell(1, 0), cell(1, 1), cell(0, 0), cell(0, 1)];
  if (cells.some((c) => c.length === 0)) fail('emptyCell');
  const means = didFromMeans(mean(cells[0]), mean(cells[1]), mean(cells[2]), mean(cells[3]));
  const x = y.map((_, i) => [1, treated[i], post[i], treated[i] * post[i]]);
  const labels = ['(Intercept)', names.treated, names.post, `${names.treated}:${names.post}`];
  const ls = leastSquares(x, y, labels);
  const n = y.length;
  if (n <= 4) fail('tooFewRows', `${n}|4`);
  const cov = sandwich(x, ls.resid, ls.xtxInv, cluster ? 'cluster' : 'hc1', cluster ?? undefined);
  const df = cluster ? new Set(cluster).size - 1 : n - 4;
  return {
    means,
    counts: [cells[0].length, cells[1].length, cells[2].length, cells[3].length],
    coefs: estimates(labels, ls.coef, cov, df, level),
    n,
    clustered: cluster !== null,
  };
}

export type Kernel = 'triangular' | 'uniform';

export interface Side {
  readonly intercept: number;
  readonly slope: number;
  readonly se: number;
  readonly n: number;
}

/** A weighted line through the points within the bandwidth on one side; its intercept is the value at the cutoff. */
function localLine(x: readonly number[], y: readonly number[], cutoff: number, h: number, kernel: Kernel): Side {
  const rows: number[][] = [];
  const ys: number[] = [];
  const w: number[] = [];
  x.forEach((v, i) => {
    const u = Math.abs(v - cutoff) / h;
    if (u > 1 + 1e-12) return;
    rows.push([1, v - cutoff]);
    ys.push(y[i]);
    w.push(kernel === 'uniform' ? 1 : Math.max(0, 1 - u));
  });
  const used = w.filter((v) => v > 0).length;
  if (used < 2) fail('fewNearCutoff', String(h));
  const bread = inverse(crossprod(rows, w));
  if (!bread) fail('fewNearCutoff', String(h));
  const b = matVec(bread, crossVec(rows, ys, w));
  const e = ys.map((v, i) => v - b[0] - b[1] * rows[i][1]);
  const meat = crossprod(rows.map((r, i) => r.map((v) => v * w[i] * e[i])));
  const cov = matMul(matMul(bread, meat), bread);
  const scale = used > 2 ? used / (used - 2) : 1;
  return { intercept: b[0], slope: b[1], se: Math.sqrt(Math.max(0, cov[0][0] * scale)), n: used };
}

export interface RdFit {
  readonly left: Side;
  readonly right: Side;
  readonly effect: number;
  readonly se: number;
  readonly z: number;
  readonly p: number;
  readonly low: number;
  readonly high: number;
}

/** The jump at the cutoff: the right intercept minus the left, with robust standard errors added in quadrature. */
export function regressionDiscontinuity(
  x: readonly number[],
  y: readonly number[],
  cutoff: number,
  h: number,
  kernel: Kernel,
  level: number,
): RdFit {
  if (!(h > 0)) fail('bandwidthPositive');
  const leftRows = x.map((_, i) => i).filter((i) => x[i] < cutoff);
  const rightRows = x.map((_, i) => i).filter((i) => x[i] >= cutoff);
  const pick = (rows: number[], v: readonly number[]) => rows.map((i) => v[i]);
  const left = localLine(pick(leftRows, x), pick(leftRows, y), cutoff, h, kernel);
  const right = localLine(pick(rightRows, x), pick(rightRows, y), cutoff, h, kernel);
  const effect = right.intercept - left.intercept;
  const se = Math.hypot(left.se, right.se);
  const z = se > 0 ? effect / se : NaN;
  const crit = normalQuantile(1 - (1 - level) / 2);
  return {
    left,
    right,
    effect,
    se,
    z,
    p: se > 0 ? normalTwoSided(z) : NaN,
    low: effect - crit * se,
    high: effect + crit * se,
  };
}

export interface Propensity {
  readonly score: number[];
  readonly ate: number;
  readonly ateSe: number;
  readonly att: number;
  readonly attSe: number;
  readonly matched: number;
  readonly dropped: number;
  readonly matchAtt: number;
  readonly matchSe: number;
  readonly balance: readonly {
    readonly name: string;
    readonly raw: number;
    readonly weighted: number;
    readonly matched: number;
  }[];
  readonly treated: number;
  readonly controls: number;
}

/** Normalized (Hajek) weighted means and their linearized standard errors, treating the weights as known. */
function weightedMean(y: readonly number[], w: readonly number[]): { m: number; v: number } {
  const total = sum(w);
  const m = sum(y.map((v, i) => w[i] * v)) / total;
  const v = sum(y.map((yy, i) => (w[i] * (yy - m)) ** 2)) / total ** 2;
  return { m, v };
}

/** IPW for the ATE and ATT from given propensity scores. */
export function ipw(y: readonly number[], t: readonly number[], e: readonly number[]) {
  const ti = y.map((_, i) => i).filter((i) => t[i] === 1);
  const ci = y.map((_, i) => i).filter((i) => t[i] === 0);
  const at = (rows: number[], v: readonly number[]) => rows.map((i) => v[i]);
  const m1 = weightedMean(
    at(ti, y),
    ti.map((i) => 1 / e[i]),
  );
  const m0 = weightedMean(
    at(ci, y),
    ci.map((i) => 1 / (1 - e[i])),
  );
  const a1 = weightedMean(
    at(ti, y),
    ti.map(() => 1),
  );
  const a0 = weightedMean(
    at(ci, y),
    ci.map((i) => e[i] / (1 - e[i])),
  );
  return { ate: m1.m - m0.m, ateSe: Math.sqrt(m1.v + m0.v), att: a1.m - a0.m, attSe: Math.sqrt(a1.v + a0.v) };
}

const smd = (a: readonly number[], b: readonly number[], wa?: readonly number[], wb?: readonly number[]) => {
  const wm = (v: readonly number[], w?: readonly number[]) => (w ? sum(v.map((x, i) => x * w[i])) / sum(w) : mean(v));
  const pooled = Math.sqrt((variance(a) + variance(b)) / 2);
  return pooled > 0 ? (wm(a, wa) - wm(b, wb)) / pooled : 0;
};

/** Propensity scores by logistic regression, then IPW (ATE, ATT), 1:1 nearest-neighbor matching, and balance. */
export function propensity(
  y: readonly number[],
  t: readonly number[],
  x: Matrix,
  names: readonly string[],
  caliper: number,
): Propensity {
  binary(t, 'treatment');
  const ti = t.map((_, i) => i).filter((i) => t[i] === 1);
  const ci = t.map((_, i) => i).filter((i) => t[i] === 0);
  if (ti.length < 2 || ci.length < 2) fail('fewEachArm');
  const design = x.map((row) => [1, ...row]);
  const fit = fitGlm('logistic', { x: design, y: t, columns: ['(Intercept)', ...names] });
  const score = fit.mu.map((p) => Math.min(1 - 1e-9, Math.max(1e-9, p)));
  const w = ipw(y, t, score);
  const logit = score.map((p) => Math.log(p / (1 - p)));
  const sd = Math.sqrt(variance(logit));
  const pairs: [number, number][] = [];
  for (const i of ti) {
    let best = -1;
    let gap = Infinity;
    for (const j of ci) {
      const d = Math.abs(logit[i] - logit[j]);
      if (d < gap) [gap, best] = [d, j];
    }
    if (gap <= caliper * sd) pairs.push([i, best]);
  }
  if (pairs.length === 0) fail('noMatches');
  const diffs = pairs.map(([i, j]) => y[i] - y[j]);
  const matchAtt = mean(diffs);
  const matchSe = pairs.length > 1 ? Math.sqrt(variance(diffs) / pairs.length) : NaN;
  const balance = names.map((name, k) => {
    const col = (rows: number[]) => rows.map((i) => x[i][k]);
    return {
      name,
      raw: smd(col(ti), col(ci)),
      weighted: smd(
        col(ti),
        col(ci),
        ti.map((i) => 1 / score[i]),
        ci.map((i) => 1 / (1 - score[i])),
      ),
      matched: smd(
        pairs.map(([i]) => x[i][k]),
        pairs.map(([, j]) => x[j][k]),
      ),
    };
  });
  return {
    score,
    ...w,
    matched: pairs.length,
    dropped: ti.length - pairs.length,
    matchAtt,
    matchSe,
    balance,
    treated: ti.length,
    controls: ci.length,
  };
}
