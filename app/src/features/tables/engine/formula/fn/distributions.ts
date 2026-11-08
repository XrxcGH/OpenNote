// The distribution functions and their compatibility names. Owner: tables:fn-stats. Lazy chunk only: the specs are
// declared in statsDeclared.ts and statsCompat.ts, and these are the runs they call once the chunk has loaded.
// Argument checks follow the documented #NUM! cases. Whole-number arguments such as degrees of freedom are truncated.

import { err, finish, isError, toNumber, type FormulaError, type Value } from '../../values';
import {
  betaPdf,
  binomCdf,
  binomPmf,
  choose,
  fCdf,
  fPdf,
  fSf,
  gammaCdf,
  gammaPdf,
  gammaSf,
  invert,
  invertUpper,
  normCdf,
  normInv,
  normPdf,
  poissonCdf,
  poissonPmf,
  tCdf,
  tPdf,
  tSf,
} from './distributionsKit';
import { betaInc } from '../../../../../core/num/special';
import { devsq, mean, numbersOf, numeric, pairsOf, type Run } from './statsKit';
import { asArray } from '../../arrays';

const T = Math.trunc;
const bad = NaN;
const flag = (b: number): boolean => b !== 0;

// Continuous laws.

const normDist = numeric(([x, m, s, c]) => (s <= 0 ? bad : flag(c) ? normCdf((x - m) / s) : normPdf((x - m) / s) / s));
const normInvRun = numeric(([p, m, s]) => (s <= 0 || p <= 0 || p >= 1 ? bad : m + s * normInv(p)));
const normSDist = numeric(([z, c]) => (flag(c) ? normCdf(z) : normPdf(z)));
const normSInv = numeric(([p]) => (p <= 0 || p >= 1 ? bad : normInv(p)));

function lognorm(x: number, m: number, s: number, cumulative: boolean): number {
  if (x <= 0 || s <= 0) return bad;
  const z = (Math.log(x) - m) / s;
  return cumulative ? normCdf(z) : normPdf(z) / (x * s);
}
const lognormInv = ([p, m, s]: number[]) => (p <= 0 || p >= 1 || s <= 0 ? bad : Math.exp(m + s * normInv(p)));

function expon(x: number, l: number, cumulative: boolean): number {
  if (x < 0 || l <= 0) return bad;
  return cumulative ? -Math.expm1(-l * x) : l * Math.exp(-l * x);
}

function weibull(x: number, a: number, b: number, cumulative: boolean): number {
  if (x < 0 || a <= 0 || b <= 0) return bad;
  const t = (x / b) ** a;
  return cumulative ? -Math.expm1(-t) : (a / b) * (x / b) ** (a - 1) * Math.exp(-t);
}

function gammaDist(x: number, a: number, b: number, cumulative: boolean): number {
  if (x < 0 || a <= 0 || b <= 0) return bad;
  return cumulative ? gammaCdf(x, a, b) : gammaPdf(x, a, b);
}

function gammaInv(p: number, a: number, b: number): number {
  if (p < 0 || p > 1 || a <= 0 || b <= 0) return bad;
  if (p === 0) return 0;
  if (p === 1) return bad;
  return invert((x) => gammaCdf(x, a, b), p, 0, Math.max(1, a * b));
}

function betaDist(x: number, a: number, b: number, cumulative: boolean, lo = 0, hi = 1): number {
  if (a <= 0 || b <= 0 || lo >= hi || x < lo || x > hi) return bad;
  const u = (x - lo) / (hi - lo);
  return cumulative ? betaInc(u, a, b) : betaPdf(u, a, b) / (hi - lo);
}

function betaInv(p: number, a: number, b: number, lo = 0, hi = 1): number {
  if (p <= 0 || p > 1 || a <= 0 || b <= 0 || lo >= hi) return bad;
  if (p === 1) return hi;
  const u = invert((x) => (x >= 1 ? 1 : betaInc(x, a, b)), p, 0, 1);
  return lo + u * (hi - lo);
}

const dfOk = (df: number): boolean => df >= 1 && df <= 1e10;

function chisq(x: number, df: number, cumulative: boolean): number {
  const k = T(df);
  if (x < 0 || !dfOk(k)) return bad;
  return cumulative ? gammaCdf(x, k / 2, 2) : gammaPdf(x, k / 2, 2);
}
const chisqRt = (x: number, df: number) => (x < 0 || !dfOk(T(df)) ? bad : gammaSf(x, T(df) / 2, 2));
function chisqInv(p: number, df: number): number {
  const k = T(df);
  if (p < 0 || p >= 1 || !dfOk(k)) return bad;
  return p === 0 ? 0 : invert((x) => gammaCdf(x, k / 2, 2), p, 0, Math.max(1, k));
}
function chisqInvRt(p: number, df: number): number {
  const k = T(df);
  if (p <= 0 || p > 1 || !dfOk(k)) return bad;
  return p === 1 ? 0 : invertUpper((x) => gammaSf(x, k / 2, 2), p, 0, Math.max(1, k));
}

function fDist(x: number, d1: number, d2: number, cumulative: boolean): number {
  const [a, b] = [T(d1), T(d2)];
  if (x < 0 || !dfOk(a) || !dfOk(b)) return bad;
  return cumulative ? fCdf(x, a, b) : fPdf(x, a, b);
}
const fDistRt = (x: number, d1: number, d2: number) =>
  x < 0 || !dfOk(T(d1)) || !dfOk(T(d2)) ? bad : fSf(x, T(d1), T(d2));
function fInv(p: number, d1: number, d2: number): number {
  const [a, b] = [T(d1), T(d2)];
  if (p < 0 || p > 1 || !dfOk(a) || !dfOk(b)) return bad;
  return p === 0 ? 0 : p === 1 ? bad : invert((x) => fCdf(x, a, b), p, 0, 1);
}
function fInvRt(p: number, d1: number, d2: number): number {
  const [a, b] = [T(d1), T(d2)];
  if (p <= 0 || p > 1 || !dfOk(a) || !dfOk(b)) return bad;
  return p === 1 ? 0 : invertUpper((x) => fSf(x, a, b), p, 0, 1);
}

function tDist(x: number, df: number, cumulative: boolean): number {
  const k = T(df);
  if (k < 1) return bad;
  return cumulative ? tCdf(x, k) : tPdf(x, k);
}
const tDist2t = (x: number, df: number) => (x < 0 || T(df) < 1 ? bad : Math.min(1, 2 * tSf(x, T(df))));
const tDistRt = (x: number, df: number) => (T(df) < 1 ? bad : tSf(x, T(df)));
/** The t value with P(T > t) = q, for 0 < q <= 0.5. */
const tUpperInv = (q: number, k: number) => (q === 0.5 ? 0 : invertUpper((x) => tSf(x, k), q, 0, 1));
function tInv(p: number, df: number): number {
  const k = T(df);
  if (p <= 0 || p >= 1 || k < 1) return bad;
  return p < 0.5 ? -tUpperInv(p, k) : tUpperInv(1 - p, k);
}
const tInv2t = (p: number, df: number) => (p <= 0 || p > 1 || T(df) < 1 ? bad : tUpperInv(p / 2, T(df)));

// Discrete laws.

function binomDist(s: number, n: number, p: number, cumulative: boolean): number {
  const [k, m] = [T(s), T(n)];
  if (k < 0 || k > m || p < 0 || p > 1) return bad;
  return cumulative ? binomCdf(k, m, p) : binomPmf(k, m, p);
}

function binomRange([n, p, s, s2]: number[]): number {
  const [m, a] = [T(n), T(s)];
  const b = s2 === undefined ? a : T(s2);
  if (m < 0 || p < 0 || p > 1 || a < 0 || a > m || b < a || b > m) return bad;
  let total = 0;
  for (let i = a; i <= b; i++) total += binomPmf(i, m, p);
  return Math.min(1, total);
}

function binomInv(n: number, p: number, alpha: number): number {
  const m = T(n);
  if (m < 0 || p < 0 || p > 1 || alpha < 0 || alpha > 1) return bad;
  let total = 0;
  for (let k = 0; k <= m; k++) {
    total += binomPmf(k, m, p);
    if (total >= alpha * (1 - 1e-15)) return k;
  }
  return m;
}

function negbinom(f: number, s: number, p: number, cumulative: boolean): number {
  const [x, r] = [T(f), T(s)];
  if (x < 0 || r < 1 || p < 0 || p > 1) return bad;
  if (cumulative) return betaInc(p, r, x + 1);
  return choose(x + r - 1, r - 1) * p ** r * (1 - p) ** x;
}

function hypgeom(s: number, n: number, ms: number, np: number, cumulative: boolean): number {
  const [k, draws, succ, pop] = [T(s), T(n), T(ms), T(np)];
  const low = Math.max(0, draws - pop + succ);
  if (k < low || k > Math.min(draws, succ) || draws <= 0 || succ <= 0 || pop <= 0 || draws > pop || succ > pop) {
    return bad;
  }
  const pmf = (i: number) => (choose(succ, i) * choose(pop - succ, draws - i)) / choose(pop, draws);
  if (!cumulative) return pmf(k);
  let total = 0;
  for (let i = low; i <= k; i++) total += pmf(i);
  return Math.min(1, total);
}

function poisson(x: number, m: number, cumulative: boolean): number {
  const k = T(x);
  if (k < 0 || m < 0) return bad;
  return cumulative ? poissonCdf(k, m) : poissonPmf(k, m);
}

// Confidence and tests.

const confidenceNorm = ([a, sd, n]: number[]) =>
  a <= 0 || a >= 1 || sd <= 0 || T(n) < 1 ? bad : (normInv(1 - a / 2) * sd) / Math.sqrt(T(n));

function confidenceT([a, sd, n]: number[]): number | FormulaError {
  const k = T(n);
  if (a <= 0 || a >= 1 || sd <= 0 || k < 1) return bad;
  if (k === 1) return err('DIV0');
  return (tUpperInv(a / 2, k - 1) * sd) / Math.sqrt(k);
}

function chisqTest([actual, expected]: Value[]): Value {
  if (isError(actual)) return actual;
  if (isError(expected)) return expected;
  const a = asArray(actual);
  const e = asArray(expected);
  if (a.rows !== e.rows || a.cols !== e.cols) return err('NA');
  let chi = 0;
  for (let i = 0; i < a.data.length; i++) {
    const [o, x] = [a.data[i], e.data[i]];
    if (isError(o)) return o;
    if (isError(x)) return x;
    if (typeof o !== 'number' || typeof x !== 'number') continue;
    if (x === 0) return err('DIV0');
    chi += ((o - x) * (o - x)) / x;
  }
  const df = a.rows > 1 && a.cols > 1 ? (a.rows - 1) * (a.cols - 1) : a.data.length - 1;
  if (df < 1) return err('NA');
  return finish(gammaSf(chi, df / 2, 2));
}

function fTest([one, two]: Value[]): Value {
  const a = numbersOf(one);
  const b = numbersOf(two);
  if (!Array.isArray(a)) return a;
  if (!Array.isArray(b)) return b;
  if (a.length < 2 || b.length < 2) return err('DIV0');
  const [va, vb] = [devsq(a) / (a.length - 1), devsq(b) / (b.length - 1)];
  if (va === 0 || vb === 0) return err('DIV0');
  const lower = fCdf(va / vb, a.length - 1, b.length - 1);
  return finish(Math.min(1, 2 * Math.min(lower, 1 - lower)));
}

function tTestPaired(one: Value, two: Value): number[] | Value {
  const p = pairsOf(one, two);
  if (!('xs' in p)) return p;
  const d = p.xs.map((x, i) => x - p.ys[i]);
  if (d.length < 2) return err('DIV0');
  const sd = Math.sqrt(devsq(d) / (d.length - 1));
  return sd === 0 ? err('DIV0') : [(mean(d) / sd) * Math.sqrt(d.length), d.length - 1];
}

function tTestTwo(one: Value, two: Value, equal: boolean): number[] | Value {
  const a = numbersOf(one);
  const b = numbersOf(two);
  if (!Array.isArray(a)) return a;
  if (!Array.isArray(b)) return b;
  const [n1, n2] = [a.length, b.length];
  if (n1 < 2 || n2 < 2) return err('DIV0');
  const [v1, v2] = [devsq(a) / (n1 - 1), devsq(b) / (n2 - 1)];
  const diff = mean(a) - mean(b);
  if (equal) {
    const pooled = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2);
    const se = Math.sqrt(pooled * (1 / n1 + 1 / n2));
    return se === 0 ? err('DIV0') : [diff / se, n1 + n2 - 2];
  }
  const [q1, q2] = [v1 / n1, v2 / n2];
  if (q1 + q2 === 0) return err('DIV0');
  // Welch's degrees of freedom, used as they are rather than rounded.
  const df = (q1 + q2) ** 2 / ((q1 * q1) / (n1 - 1) + (q2 * q2) / (n2 - 1));
  return [diff / Math.sqrt(q1 + q2), df];
}

/** The p-value of the t statistic for a Welch fraction of degrees of freedom: the t law by the incomplete beta. */
const tTail = (t: number, df: number) => 0.5 * betaInc(df / (df + t * t), df / 2, 0.5);

function tTest([one, two, tailsV, typeV]: Value[]): Value {
  const tails = toNumber(tailsV);
  const type = toNumber(typeV);
  if (typeof tails !== 'number') return tails;
  if (typeof type !== 'number') return type;
  const [k, kind] = [T(tails), T(type)];
  if ((k !== 1 && k !== 2) || kind < 1 || kind > 3) return err('NUM');
  const st = kind === 1 ? tTestPaired(one, two) : tTestTwo(one, two, kind === 2);
  if (!Array.isArray(st)) return st;
  const [t, df] = st;
  return finish(Math.min(1, k * tTail(Math.abs(t), df)));
}

function zTest([array, xV, sigmaV]: Value[]): Value {
  const nums = numbersOf(array);
  if (!Array.isArray(nums)) return nums;
  const x = toNumber(xV);
  if (typeof x !== 'number') return x;
  if (nums.length === 0) return err('NA');
  let sigma: number;
  if (sigmaV === undefined) {
    if (nums.length < 2) return err('DIV0');
    sigma = Math.sqrt(devsq(nums) / (nums.length - 1));
  } else {
    const s = toNumber(sigmaV);
    if (typeof s !== 'number') return s;
    sigma = s;
  }
  if (sigma <= 0) return err(sigma === 0 ? 'DIV0' : 'NUM');
  return finish(1 - normCdf((mean(nums) - x) / (sigma / Math.sqrt(nums.length))));
}

// The runs by name. The compatibility names reuse the modern runs where the arguments agree.

const c = (f: (...n: number[]) => number) => numeric((n) => f(...n));

export const runs: Readonly<Record<string, Run>> = {
  'NORM.DIST': normDist,
  'NORM.INV': normInvRun,
  'NORM.S.DIST': normSDist,
  'NORM.S.INV': normSInv,
  PHI: numeric(([z]) => normPdf(z)),
  GAUSS: numeric(([z]) => normCdf(z) - 0.5),
  'LOGNORM.DIST': numeric(([x, m, s, k]) => lognorm(x, m, s, flag(k))),
  'LOGNORM.INV': numeric(lognormInv),
  'EXPON.DIST': numeric(([x, l, k]) => expon(x, l, flag(k))),
  'WEIBULL.DIST': numeric(([x, a, b, k]) => weibull(x, a, b, flag(k))),
  'GAMMA.DIST': numeric(([x, a, b, k]) => gammaDist(x, a, b, flag(k))),
  'GAMMA.INV': c(gammaInv),
  'BETA.DIST': numeric(
    ([x, a, b, k, lo, hi]) => betaDist(x, a, b, flag(k), lo, hi),
    [undefined, undefined, undefined, undefined, 0, 1],
  ),
  'BETA.INV': numeric(([p, a, b, lo, hi]) => betaInv(p, a, b, lo, hi), [undefined, undefined, undefined, 0, 1]),
  'CHISQ.DIST': numeric(([x, k, f]) => chisq(x, k, flag(f))),
  'CHISQ.DIST.RT': c(chisqRt),
  'CHISQ.INV': c(chisqInv),
  'CHISQ.INV.RT': c(chisqInvRt),
  'CHISQ.TEST': chisqTest,
  'F.DIST': numeric(([x, a, b, k]) => fDist(x, a, b, flag(k))),
  'F.DIST.RT': c(fDistRt),
  'F.INV': c(fInv),
  'F.INV.RT': c(fInvRt),
  'F.TEST': fTest,
  'T.DIST': numeric(([x, k, f]) => tDist(x, k, flag(f))),
  'T.DIST.2T': c(tDist2t),
  'T.DIST.RT': c(tDistRt),
  'T.INV': c(tInv),
  'T.INV.2T': c(tInv2t),
  'T.TEST': tTest,
  'Z.TEST': zTest,
  'BINOM.DIST': numeric(([s, n, p, k]) => binomDist(s, n, p, flag(k))),
  'BINOM.DIST.RANGE': numeric(binomRange),
  'BINOM.INV': c(binomInv),
  'NEGBINOM.DIST': numeric(([f, s, p, k]) => negbinom(f, s, p, flag(k))),
  'HYPGEOM.DIST': numeric(([s, n, m, p, k]) => hypgeom(s, n, m, p, flag(k))),
  'POISSON.DIST': numeric(([x, m, k]) => poisson(x, m, flag(k))),
  'CONFIDENCE.NORM': numeric(confidenceNorm),
  'CONFIDENCE.T': numeric(confidenceT),
  // Compatibility names.
  BETADIST: numeric(([x, a, b, lo, hi]) => betaDist(x, a, b, true, lo, hi), [undefined, undefined, undefined, 0, 1]),
  BETAINV: numeric(([p, a, b, lo, hi]) => betaInv(p, a, b, lo, hi), [undefined, undefined, undefined, 0, 1]),
  BINOMDIST: numeric(([s, n, p, k]) => binomDist(s, n, p, flag(k))),
  CHIDIST: c(chisqRt),
  CHIINV: c(chisqInvRt),
  CHITEST: chisqTest,
  CONFIDENCE: numeric(confidenceNorm),
  CRITBINOM: c(binomInv),
  EXPONDIST: numeric(([x, l, k]) => expon(x, l, flag(k))),
  FDIST: c(fDistRt),
  FINV: c(fInvRt),
  FTEST: fTest,
  GAMMADIST: numeric(([x, a, b, k]) => gammaDist(x, a, b, flag(k))),
  GAMMAINV: c(gammaInv),
  HYPGEOMDIST: c((s, n, m, p) => hypgeom(s, n, m, p, false)),
  LOGINV: numeric(lognormInv),
  LOGNORMDIST: c((x, m, s) => lognorm(x, m, s, true)),
  NEGBINOMDIST: c((f, s, p) => negbinom(f, s, p, false)),
  NORMDIST: normDist,
  NORMINV: normInvRun,
  NORMSDIST: numeric(([z]) => normCdf(z)),
  NORMSINV: normSInv,
  POISSON: numeric(([x, m, k]) => poisson(x, m, flag(k))),
  TDIST: c((x, df, tails) => {
    const k = T(tails);
    if (x < 0 || T(df) < 1 || (k !== 1 && k !== 2)) return bad;
    return Math.min(1, k * tSf(x, T(df)));
  }),
  TINV: c(tInv2t),
  TTEST: tTest,
  WEIBULL: numeric(([x, a, b, k]) => weibull(x, a, b, flag(k))),
  ZTEST: zTest,
};
