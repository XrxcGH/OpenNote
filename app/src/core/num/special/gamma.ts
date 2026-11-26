// The gamma family and the error function for the kits, written from Abramowitz and Stegun (a US Government
// publication). erf uses its all-positive series (7.1.6) and erfc its continued fraction (7.1.14). ln Γ uses
// Stirling's series (6.1.40) after shifting x up past 10, and Γ the reflection formula. Also here: B(a, b), the
// inverse error function, and the regularized incomplete gamma (6.5.29, 6.5.31) and beta (26.5.8) functions.
import { NumError } from '../errors';

const EPS = 2 ** -52;
const TINY = 1e-300;
const FACTORIALS: readonly number[] = Array.from({ length: 171 }, (_, n) => n).map((n) => {
  let f = 1;
  for (let k = 2; k <= n; k += 1) f *= k;
  return f;
});

/** erf x = (2/√π) e^(-x²) Σ 2ⁿ x^(2n+1) / (1·3·…·(2n+1)), whose terms are all positive. */
function erfSeries(x: number): number {
  let term = x;
  let sum = x;
  for (let n = 1; n < 200; n += 1) {
    term *= (2 * x * x) / (2 * n + 1);
    sum += term;
    if (term < EPS * sum) break;
  }
  return (2 / Math.sqrt(Math.PI)) * Math.exp(-x * x) * sum;
}

/** erfc x = e^(-x²)/√π · 1/(x + ½/(x + 1/(x + (3/2)/(x + …)))) for x > 0, by the modified Lentz method. */
function erfcFraction(x: number): number {
  let f = x;
  let c = x;
  let d = 0;
  for (let n = 1; n < 500; n += 1) {
    const a = n / 2;
    d = x + a * d;
    d = 1 / (Math.abs(d) < TINY ? TINY : d);
    c = x + a / c;
    if (Math.abs(c) < TINY) c = TINY;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < EPS) break;
  }
  return Math.exp(-x * x) / (Math.sqrt(Math.PI) * f);
}

export function erf(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const ax = Math.abs(x);
  const value = ax < 2.5 ? erfSeries(ax) : 1 - erfcFraction(ax);
  return x < 0 ? -value : value;
}

export function erfc(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x < 0) return 2 - erfc(-x);
  return x < 2.5 ? 1 - erfSeries(x) : erfcFraction(x);
}

const STIRLING = [1 / 12, -1 / 360, 1 / 1260, -1 / 1680, 1 / 1188, -691 / 360360, 1 / 156, -3617 / 122400];

/** ln Γ(x) for x > 0: shifted up to x ≥ 10 by Γ(x+1) = xΓ(x), then Stirling's series. */
function lnGammaPositive(x: number): number {
  let shift = 0;
  let z = x;
  while (z < 10) {
    shift += Math.log(z);
    z += 1;
  }
  const inv = 1 / z;
  const inv2 = inv * inv;
  let series = 0;
  let power = inv;
  for (const c of STIRLING) {
    series += c * power;
    power *= inv2;
  }
  return (z - 0.5) * Math.log(z) - z + 0.5 * Math.log(2 * Math.PI) + series - shift;
}

const lnGamma = lnGammaPositive;
const lnBeta = (a: number, b: number) => lnGamma(a) + lnGamma(b) - lnGamma(a + b);

/** The regularized incomplete beta I_x(a, b), by the continued fraction of A&S 26.5.8 (modified Lentz). */
export function betaInc(x: number, a: number, b: number): number {
  if (!(a > 0 && b > 0) || Number.isNaN(x)) throw new NumError('domain', 'I_x(a, b) needs a, b > 0');
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x > (a + 1) / (a + b + 2)) return 1 - betaInc(1 - x, b, a);
  const front = Math.exp(a * Math.log(x) + b * Math.log1p(-x) - lnBeta(a, b)) / a;
  let f = 1;
  let c = 1;
  let d = 0;
  for (let i = 0; i <= 600; i += 1) {
    const m = Math.floor(i / 2);
    let numerator: number;
    if (i === 0) numerator = 1;
    else if (i % 2 === 0) numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    else numerator = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + numerator * d;
    d = 1 / (Math.abs(d) < TINY ? TINY : d);
    c = 1 + numerator / c;
    if (Math.abs(c) < TINY) c = TINY;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < EPS) return front * (f - 1);
  }
  throw new NumError('noConvergence', 'incomplete beta');
}

/** ln Γ(x) for x > 0. */
export function lgamma(x: number): number {
  if (!(x > 0)) throw new NumError('domain', 'ln Γ needs x > 0');
  return lnGamma(x);
}

/** Γ(x) for any real x that is not 0 or a negative whole number. */
export function gamma(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (Number.isInteger(x)) {
    if (x <= 0) throw new NumError('domain', 'Γ has poles at 0 and the negative whole numbers');
    return x <= 171 ? FACTORIALS[x - 1] : Infinity;
  }
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  if (x > 171.7) return Infinity;
  return Math.exp(lnGamma(x));
}

/** B(a, b) = Γ(a) Γ(b) / Γ(a + b), for a, b > 0. */
export function beta(a: number, b: number): number {
  if (!(a > 0 && b > 0)) throw new NumError('domain', 'B needs a, b > 0');
  return Math.exp(lnGamma(a) + lnGamma(b) - lnGamma(a + b));
}

/** The inverse error function on (-1, 1): a starting guess refined by Halley's method on erf or erfc. */
export function erfinv(y: number): number {
  if (Number.isNaN(y) || y < -1 || y > 1) throw new NumError('domain', 'erfinv needs -1 ≤ y ≤ 1');
  if (y === 1) return Infinity;
  if (y === -1) return -Infinity;
  if (y === 0) return 0;
  if (y < 0) return -erfinv(-y);
  // Winitzki's starting guess from ln(1 - y²), then Halley steps on erf(x) - y, written as (1 - y) - erfc(x) near
  // 1 so the residual keeps its digits.
  const w = -Math.log((1 - y) * (1 + y));
  const t = 2 / (Math.PI * 0.147) - w / 2;
  let x = Math.sqrt(Math.max(0, Math.sqrt(t * t + w / 0.147) - t));
  for (let i = 0; i < 6; i += 1) {
    const residual = y > 0.5 ? 1 - y - erfc(x) : erf(x) - y;
    const dfdx = (2 / Math.sqrt(Math.PI)) * Math.exp(-x * x);
    const newton = residual / dfdx;
    const step = newton / (1 + x * newton);
    x -= step;
    if (Math.abs(step) <= 4 * EPS * Math.abs(x)) break;
  }
  return x;
}

/** The regularized lower incomplete gamma P(a, x) = γ(a, x)/Γ(a), for a > 0 and x ≥ 0. */
export function gammaP(a: number, x: number): number {
  if (!(a > 0) || !(x >= 0)) throw new NumError('domain', 'P(a, x) needs a > 0 and x ≥ 0');
  if (x === 0) return 0;
  return x < a + 1 ? gammaSeries(a, x) : 1 - gammaFraction(a, x);
}

/** The regularized upper incomplete gamma Q(a, x) = 1 - P(a, x). */
export function gammaQ(a: number, x: number): number {
  if (!(a > 0) || !(x >= 0)) throw new NumError('domain', 'Q(a, x) needs a > 0 and x ≥ 0');
  if (x === 0) return 1;
  return x < a + 1 ? 1 - gammaSeries(a, x) : gammaFraction(a, x);
}

/** P(a, x) = e^-x · x^a / Γ(a+1) · Σ x^n / ((a+1)…(a+n)). */
function gammaSeries(a: number, x: number): number {
  let term = 1 / a;
  let sum = term;
  for (let n = 1; n < 1000; n += 1) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}

/** Q(a, x) by its continued fraction, evaluated by the modified Lentz method. */
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
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}
