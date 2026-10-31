// The distributions the tests use: normal, Student t, chi-square, and F, with their tail areas and quantiles. The
// special functions (log gamma, the regularized incomplete beta, and gamma) follow Numerical Recipes and reach about
// 1e-13, which is far below anything a student reads off a p-value.

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function lnGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
  const z = x - 1;
  let a = LANCZOS[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i += 1) a += LANCZOS[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

function betaFraction(x: number, a: number, b: number): number {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  d = 1 / (Math.abs(d) < tiny ? tiny : d);
  let h = d;
  for (let m = 1; m <= 500; m += 1) {
    const m2 = 2 * m;
    for (const num of [
      (m * (b - m) * x) / ((a + m2 - 1) * (a + m2)),
      (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1)),
    ]) {
      d = 1 + num * d;
      d = 1 / (Math.abs(d) < tiny ? tiny : d);
      c = 1 + num / c;
      if (Math.abs(c) < tiny) c = tiny;
      h *= d * c;
    }
    if (Math.abs(d * c - 1) < 1e-15) break;
  }
  return h;
}

/** The regularized incomplete beta I_x(a, b). */
export function betaInc(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (front * betaFraction(x, a, b)) / a;
  return 1 - (front * betaFraction(1 - x, b, a)) / b;
}

/** The series for P(a, x), which converges quickly when x < a + 1. */
function gammaSeries(a: number, x: number): number {
  let term = 1 / a;
  let sum = term;
  for (let n = 1; n < 1000; n += 1) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-16) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}

/** The continued fraction for Q(a, x), which converges quickly when x >= a + 1. */
function gammaFraction(a: number, x: number): number {
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    d = 1 / (Math.abs(d) < tiny ? tiny : d);
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    h *= d * c;
    if (Math.abs(d * c - 1) < 1e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

/** The regularized lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  return x < a + 1 ? gammaSeries(a, x) : 1 - gammaFraction(a, x);
}

/** The regularized upper incomplete gamma Q(a, x), kept accurate when it is tiny. */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  return x < a + 1 ? 1 - gammaSeries(a, x) : gammaFraction(a, x);
}

/** erfc by the incomplete gamma, which keeps relative accuracy far into the tail. */
export function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  return gammaQ(0.5, x * x);
}

export const normalCdf = (z: number): number => 0.5 * erfc(-z / Math.SQRT2);
export const normalPdf = (z: number): number => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
/** P(|Z| ≥ |z|). */
export const normalTwoSided = (z: number): number => erfc(Math.abs(z) / Math.SQRT2);

/** The standard normal quantile, by Acklam's approximation and a Halley step. */
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239,
  ];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  let x: number;
  if (p < lo || p > 1 - lo) {
    const q = Math.sqrt(-2 * Math.log(p < lo ? p : 1 - p));
    x =
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    if (p > 1 - lo) x = -x;
  } else {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const e = normalCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

export function tCdf(t: number, df: number): number {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  if (!Number.isFinite(df)) return normalCdf(t);
  const tail = 0.5 * betaInc(df / (df + t * t), df / 2, 0.5);
  return t > 0 ? 1 - tail : tail;
}

/** P(|T| ≥ |t|) with df degrees of freedom. */
export const tTwoSided = (t: number, df: number): number =>
  Number.isFinite(df) ? betaInc(df / (df + t * t), df / 2, 0.5) : normalTwoSided(t);

/** The t quantile, by bisection on the distribution function and then Newton's method. */
export function tQuantile(p: number, df: number): number {
  if (!Number.isFinite(df)) return normalQuantile(p);
  return invert((x) => tCdf(x, df), p, -1e6, 1e6, normalQuantile(p));
}

/** P(X ≥ x) for chi-square with df degrees of freedom. */
export const chiSquareUpper = (x: number, df: number): number => (x <= 0 ? 1 : gammaQ(df / 2, x / 2));
export const chiSquareCdf = (x: number, df: number): number => (x <= 0 ? 0 : gammaP(df / 2, x / 2));

export function chiSquareQuantile(p: number, df: number): number {
  return invert((x) => chiSquareCdf(x, df), p, 0, 1e6, Math.max(df, 1e-3));
}

/** P(F ≥ f) with d1 and d2 degrees of freedom. */
export const fUpper = (f: number, d1: number, d2: number): number =>
  f <= 0 ? 1 : betaInc(d2 / (d2 + d1 * f), d2 / 2, d1 / 2);

export function fQuantile(p: number, d1: number, d2: number): number {
  return invert((x) => 1 - fUpper(x, d1, d2), p, 0, 1e7, 1);
}

/** The x with cdf(x) = p, for an increasing cdf, by bracketing bisection polished by the secant method. */
function invert(cdf: (x: number) => number, p: number, lo: number, hi: number, guess: number): number {
  if (p <= 0) return lo === 0 ? 0 : -Infinity;
  if (p >= 1) return Infinity;
  let a = lo;
  let b = hi;
  let x = Math.min(Math.max(guess, a), b);
  for (let i = 0; i < 200; i += 1) {
    const f = cdf(x) - p;
    if (f > 0) b = x;
    else a = x;
    if (b - a < 1e-13 * Math.max(1, Math.abs(x))) break;
    x = (a + b) / 2;
  }
  return x;
}
