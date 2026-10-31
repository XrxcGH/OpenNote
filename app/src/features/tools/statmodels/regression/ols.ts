// Ordinary least squares with the numbers a methods course reads off: coefficients with standard errors, t tests,
// intervals and standardized betas; R², adjusted R², the F test, AIC, and BIC; and the case diagnostics (leverage,
// studentized residuals, Cook's distance). Robust standard errors use the sandwich (X'X)^-1 X' Ω X (X'X)^-1, with Ω
// from HC0 to HC3 or from clusters (CR1).
import { chiSquareUpper, fUpper, tQuantile, tTwoSided } from '../kit/dist';
import { crossprod, dot, leastSquares, matMul, matVec, transpose, variance, type Matrix } from '../kit/linalg';
import { fail } from '../kit/types';

export type Robust = 'classical' | 'hc0' | 'hc1' | 'hc2' | 'hc3' | 'cluster';

export interface OlsFit {
  readonly names: readonly string[];
  readonly n: number;
  readonly p: number;
  readonly df: number;
  readonly coef: readonly number[];
  readonly se: readonly number[];
  readonly t: readonly number[];
  readonly pValue: readonly number[];
  readonly low: readonly number[];
  readonly high: readonly number[];
  readonly beta: readonly number[];
  readonly fitted: readonly number[];
  readonly resid: readonly number[];
  readonly rss: number;
  readonly tss: number;
  readonly sigma: number;
  readonly r2: number;
  readonly adjR2: number;
  readonly f: number;
  readonly fDf1: number;
  readonly fP: number;
  readonly logLik: number;
  readonly aic: number;
  readonly bic: number;
  readonly xtxInv: Matrix;
  /** The covariance of the coefficients that the standard errors come from. */
  readonly cov: Matrix;
  readonly tCrit: number;
  readonly intercept: boolean;
}

export interface OlsOptions {
  readonly level?: number;
  readonly robust?: Robust;
  readonly cluster?: readonly string[];
}

/** h_ii = x_i' (X'X)^-1 x_i for each row. */
export const leverage = (x: Matrix, xtxInv: Matrix): number[] => x.map((row) => dot(row, matVec(xtxInv, row)));

/** The sandwich covariance for the chosen kind of robust standard error. */
export function sandwich(
  x: Matrix,
  resid: readonly number[],
  xtxInv: Matrix,
  kind: Robust,
  cluster?: readonly string[],
): Matrix {
  const n = x.length;
  const p = x[0].length;
  if (kind === 'cluster') {
    if (!cluster) fail('pickColumn');
    const groups = new Map<string, number[]>();
    x.forEach((row, i) => {
      const score = groups.get(cluster[i]) ?? new Array<number>(p).fill(0);
      row.forEach((v, j) => (score[j] += v * resid[i]));
      groups.set(cluster[i], score);
    });
    const g = groups.size;
    if (g < 2) fail('oneCluster');
    const meat = crossprod([...groups.values()]);
    const scale = (g / (g - 1)) * ((n - 1) / (n - p));
    return matMul(matMul(xtxInv, meat), xtxInv).map((row) => row.map((v) => v * scale));
  }
  const h = kind === 'hc2' || kind === 'hc3' ? leverage(x, xtxInv) : [];
  const omega = resid.map((e, i) => {
    if (kind === 'hc2') return e ** 2 / (1 - h[i]);
    if (kind === 'hc3') return e ** 2 / (1 - h[i]) ** 2;
    return e ** 2;
  });
  const meat = crossprod(x, omega);
  const scale = kind === 'hc1' ? n / (n - p) : 1;
  return matMul(matMul(xtxInv, meat), xtxInv).map((row) => row.map((v) => v * scale));
}

export function fitOls(x: Matrix, y: readonly number[], names: readonly string[], options: OlsOptions = {}): OlsFit {
  const n = y.length;
  const p = names.length;
  const ls = leastSquares(x, y, names);
  const df = n - p;
  const s2 = ls.rss / df;
  const intercept = names[0] === '(Intercept)';
  const ybar = y.reduce((a, b) => a + b, 0) / n;
  const tss = intercept ? y.reduce((s, v) => s + (v - ybar) ** 2, 0) : dot(y, y);
  const robust = options.robust ?? 'classical';
  const cov =
    robust === 'classical'
      ? ls.xtxInv.map((row) => row.map((v) => v * s2))
      : sandwich(x, ls.resid, ls.xtxInv, robust, options.cluster);
  const se = cov.map((row, j) => Math.sqrt(row[j]));
  const tCrit = tQuantile(1 - (1 - (options.level ?? 0.95)) / 2, df);
  const t = ls.coef.map((b, j) => b / se[j]);
  const sy = Math.sqrt(variance(y));
  const cols = transpose(x);
  const r2 = 1 - ls.rss / tss;
  const fDf1 = intercept ? p - 1 : p;
  const f = fDf1 > 0 ? (tss - ls.rss) / fDf1 / s2 : NaN;
  const logLik = (-n / 2) * (Math.log(2 * Math.PI) + Math.log(ls.rss / n) + 1);
  return {
    names,
    n,
    p,
    df,
    coef: ls.coef,
    se,
    t,
    pValue: t.map((v) => tTwoSided(v, df)),
    low: ls.coef.map((b, j) => b - tCrit * se[j]),
    high: ls.coef.map((b, j) => b + tCrit * se[j]),
    beta: ls.coef.map((b, j) => (names[j] === '(Intercept)' ? NaN : (b * Math.sqrt(variance(cols[j]))) / sy)),
    fitted: ls.fitted,
    resid: ls.resid,
    rss: ls.rss,
    tss,
    sigma: Math.sqrt(s2),
    r2,
    adjR2: 1 - ((1 - r2) * (intercept ? n - 1 : n)) / df,
    f,
    fDf1,
    fP: fDf1 > 0 ? fUpper(f, fDf1, df) : NaN,
    logLik,
    aic: -2 * logLik + 2 * (p + 1),
    bic: -2 * logLik + Math.log(n) * (p + 1),
    xtxInv: ls.xtxInv,
    cov,
    tCrit,
    intercept,
  };
}

export interface CaseDiagnostics {
  readonly leverage: readonly number[];
  readonly standardized: readonly number[];
  readonly studentized: readonly number[];
  readonly cook: readonly number[];
  readonly vif: readonly number[];
  readonly durbinWatson: number;
  readonly breuschPagan: number;
  readonly bpDf: number;
  readonly bpP: number;
}

/** 1 / (1 − R²) of each predictor column on the others, with an intercept. NaN for the intercept. */
export function vifs(x: Matrix, names: readonly string[]): number[] {
  return names.map((name, j) => {
    if (name === '(Intercept)') return NaN;
    const others = x.map((row) => [1, ...row.filter((_, k) => k !== j && names[k] !== '(Intercept)')]);
    const yj = x.map((row) => row[j]);
    if (others[0].length === 1) return 1;
    const fit = leastSquares(others, yj);
    const mean = yj.reduce((a, b) => a + b, 0) / yj.length;
    const tss = yj.reduce((s, v) => s + (v - mean) ** 2, 0);
    return 1 / (fit.rss / tss);
  });
}

export function diagnostics(x: Matrix, fit: OlsFit): CaseDiagnostics {
  const { n, p, resid, sigma } = fit;
  const h = leverage(x, fit.xtxInv);
  const standardized = resid.map((e, i) => e / (sigma * Math.sqrt(1 - h[i])));
  const studentized = standardized.map((r) => r * Math.sqrt((n - p - 1) / Math.max(n - p - r * r, 1e-300)));
  const cook = resid.map((e, i) => (e ** 2 * h[i]) / (p * sigma ** 2 * (1 - h[i]) ** 2));
  let dw = 0;
  for (let i = 1; i < n; i += 1) dw += (resid[i] - resid[i - 1]) ** 2;
  const e2 = resid.map((e) => e * e);
  const aux = leastSquares(x, e2);
  const mean = e2.reduce((a, b) => a + b, 0) / n;
  const tss = e2.reduce((s, v) => s + (v - mean) ** 2, 0);
  const bp = n * (1 - aux.rss / tss);
  const bpDf = fit.intercept ? p - 1 : p;
  return {
    leverage: h,
    standardized,
    studentized,
    cook,
    vif: vifs(x, fit.names),
    durbinWatson: dw / fit.rss,
    breuschPagan: bp,
    bpDf,
    bpP: chiSquareUpper(bp, bpDf),
  };
}

/** The fitted mean at a new row, with its confidence and prediction intervals. */
export function predictAt(fit: OlsFit, row: readonly number[]) {
  const value = dot(row, fit.coef);
  const q = dot(row, matVec(fit.xtxInv, row));
  const se = fit.sigma * Math.sqrt(q);
  const sePred = fit.sigma * Math.sqrt(1 + q);
  return {
    value,
    se,
    low: value - fit.tCrit * se,
    high: value + fit.tCrit * se,
    predLow: value - fit.tCrit * sePred,
    predHigh: value + fit.tCrit * sePred,
  };
}

/** The F test of a reduced model nested in a full one. */
export function nestedF(full: OlsFit, reduced: OlsFit) {
  const dfNum = reduced.df - full.df;
  if (dfNum <= 0) fail('notNested');
  const f = (reduced.rss - full.rss) / dfNum / (full.rss / full.df);
  return { f, df1: dfNum, df2: full.df, p: fUpper(Math.max(f, 0), dfNum, full.df) };
}
