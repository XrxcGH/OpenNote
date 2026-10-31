// Special functions the kit's statistics need: the normal and chi-square distributions and the t quantile for
// confidence intervals. Lanczos for log-gamma, series, and continued fractions for the incomplete gamma (Numerical
// Recipes, 3rd edition, sections 6.1 and 6.2, written from the formulas).

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** ln Γ(x) for x > 0. */
export function lnGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
  const z = x - 1;
  let sum = 0.99999999999980993;
  for (let i = 0; i < LANCZOS.length; i += 1) sum += LANCZOS[i] / (z + i + 1);
  const t = z + LANCZOS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum);
}

/** ln C(n, k) for whole n >= k >= 0. */
export function lnChoose(n: number, k: number): number {
  return lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1);
}

/** The regularized lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let term = 1 / a;
    let sum = term;
    for (let n = 1; n < 500; n += 1) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-16) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  // Lentz's continued fraction for Q, then P = 1 - Q.
  let b = x + 1 - a;
  let c = 1e300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

/** P(X <= x) for a chi-square variable with df degrees of freedom. */
export const chiSquareCdf = (x: number, df: number): number => gammaP(df / 2, x / 2);

/** The standard normal distribution function, accurate to about 1e-15 (by the incomplete gamma). */
export function normalCdf(z: number): number {
  const half = 0.5 * gammaP(0.5, (z * z) / 2);
  return z >= 0 ? 0.5 + half : 0.5 - half;
}

/** The standard normal quantile (Acklam's rational approximation, refined by one Halley step). */
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
  const low = 0.02425;
  let x: number;
  if (p < low || p > 1 - low) {
    const q = Math.sqrt(-2 * Math.log(p < low ? p : 1 - p));
    x =
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    if (p > 1 - low) x = -x;
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

/** The regularized incomplete beta I_x(a, b), by Lentz's continued fraction. */
export function betaInc(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x > (a + 1) / (a + b + 2)) return 1 - betaInc(1 - x, b, a);
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < 1e-300) d = 1e-300;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 500; m += 1) {
    const m2 = 2 * m;
    let num = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + num * d;
    d = Math.abs(d) < 1e-300 ? 1e300 : 1 / d;
    c = 1 + num / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    h *= d * c;
    num = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + num * d;
    d = Math.abs(d) < 1e-300 ? 1e300 : 1 / d;
    c = 1 + num / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return (front * h) / a;
}

/** P(T <= t) for Student's t with df degrees of freedom. */
export function tCdf(t: number, df: number): number {
  const tail = 0.5 * betaInc(df / (df + t * t), df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

/** The t quantile, by bisection on tCdf (the kit needs it only for intervals, so speed is not a concern). */
export function tQuantile(p: number, df: number): number {
  if (!Number.isFinite(df)) return normalQuantile(p);
  let low = -1e3;
  let high = 1e3;
  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    if (tCdf(mid, df) < p) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}
