// Complex numbers for the kits: arithmetic, polar form, and the elementary functions on their principal branches
// (log, sqrt, and powers cut along the negative real axis). Values are plain { re, im } records, the same shape as
// the math solvers' complex numbers, so the two mix freely.

export interface Complex {
  readonly re: number;
  readonly im: number;
}

export const cx = (re: number, im = 0): Complex => ({ re, im });
export const cadd = (a: Complex, b: Complex): Complex => cx(a.re + b.re, a.im + b.im);
export const csub = (a: Complex, b: Complex): Complex => cx(a.re - b.re, a.im - b.im);
export const cmul = (a: Complex, b: Complex): Complex => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const cabs = (a: Complex): number => Math.hypot(a.re, a.im);
/** a/b by Smith's method, which keeps the sum of squares from overflowing. */
export const cdiv = (a: Complex, b: Complex): Complex => cmul(a, cinv(b));

export const ZERO: Complex = cx(0);
export const ONE: Complex = cx(1);
export const I: Complex = cx(0, 1);

export const cneg = (a: Complex): Complex => cx(-a.re, -a.im);
export const conj = (a: Complex): Complex => cx(a.re, -a.im);
export const cscale = (a: Complex, k: number): Complex => cx(a.re * k, a.im * k);
export const carg = (a: Complex): number => Math.atan2(a.im, a.re);
export const fromPolar = (r: number, theta: number): Complex => cx(r * Math.cos(theta), r * Math.sin(theta));

/** 1/a by Smith's method, which keeps the sum of squares from overflowing. */
export function cinv(a: Complex): Complex {
  if (Math.abs(a.re) >= Math.abs(a.im)) {
    const r = a.im / a.re;
    const d = a.re + a.im * r;
    return cx(1 / d, -r / d);
  }
  const r = a.re / a.im;
  const d = a.re * r + a.im;
  return cx(r / d, -1 / d);
}

export const cexp = (a: Complex): Complex => fromPolar(Math.exp(a.re), a.im);

/** The principal logarithm: ln|a| + i arg a, with arg in (-π, π]. */
export const clog = (a: Complex): Complex => cx(Math.log(cabs(a)), carg(a));

/** The principal square root, with its real part never negative. */
export function csqrt(a: Complex): Complex {
  if (a.re === 0 && a.im === 0) return ZERO;
  const r = cabs(a);
  const re = Math.sqrt((r + Math.abs(a.re)) / 2);
  if (a.re >= 0) return cx(re, a.im / (2 * re));
  return cx(Math.abs(a.im) / (2 * re), a.im < 0 ? -re : re);
}

/** a^b = exp(b ln a) on the principal branch; 0^b is 0 when Re b > 0 and 1 when b is 0. */
export function cpow(a: Complex, b: Complex): Complex {
  if (b.re === 0 && b.im === 0) return ONE;
  if (a.re === 0 && a.im === 0) return b.re > 0 ? ZERO : cx(NaN, NaN);
  if (b.im === 0 && Number.isInteger(b.re) && Math.abs(b.re) <= 64) return cpowInt(a, b.re);
  return cexp(cmul(b, clog(a)));
}

/** a^n for a whole n by repeated squaring, exact for small integers. */
export function cpowInt(a: Complex, n: number): Complex {
  let base = n < 0 ? cinv(a) : a;
  let k = Math.abs(n);
  let out = ONE;
  while (k > 0) {
    if (k & 1) out = cmul(out, base);
    base = cmul(base, base);
    k >>= 1;
  }
  return out;
}

export const csin = (a: Complex): Complex => cx(Math.sin(a.re) * Math.cosh(a.im), Math.cos(a.re) * Math.sinh(a.im));
export const ccos = (a: Complex): Complex => cx(Math.cos(a.re) * Math.cosh(a.im), -Math.sin(a.re) * Math.sinh(a.im));
export const ctan = (a: Complex): Complex => cdiv(csin(a), ccos(a));
export const csinh = (a: Complex): Complex => cx(Math.sinh(a.re) * Math.cos(a.im), Math.cosh(a.re) * Math.sin(a.im));
export const ccosh = (a: Complex): Complex => cx(Math.cosh(a.re) * Math.cos(a.im), Math.sinh(a.re) * Math.sin(a.im));
export const ctanh = (a: Complex): Complex => cdiv(csinh(a), ccosh(a));

/** True when the two values differ by at most `tol` in absolute value. */
export const cnear = (a: Complex, b: Complex, tol = 1e-12): boolean => cabs(csub(a, b)) <= tol;

/** The number as text, such as "-0.5 + 1.2i", with `digits` significant digits in each part. */
export function ctext(a: Complex, digits = 6): string {
  const part = (x: number) => Number(x.toPrecision(digits)).toString();
  const scale = Math.max(Math.abs(a.re), Math.abs(a.im));
  const im = Math.abs(a.im) <= 1e-14 * scale ? 0 : a.im;
  const re = Math.abs(a.re) <= 1e-14 * scale ? 0 : a.re;
  if (im === 0) return part(re);
  const imText = `${part(Math.abs(im))}i`;
  if (re === 0) return im < 0 ? `-${imText}` : imText;
  return `${part(re)} ${im < 0 ? '-' : '+'} ${imText}`;
}

export const sumC = (values: readonly Complex[]): Complex => values.reduce(cadd, ZERO);
