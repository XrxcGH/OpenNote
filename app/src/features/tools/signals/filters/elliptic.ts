// The elliptic (Cauer) analog lowpass prototype: equiripple in both bands, the sharpest transition for its order.
// It follows Orfanidis's "Lecture notes on elliptic filter design" (2006): Jacobi's sn and cd evaluated by descending
// Landen transformations, the degree equation solved for the selectivity k, and the poles and zeros placed from
// there. The passband edge is 1 rad/s and the stopband starts at 1/k rad/s.
import { cadd, cdiv, cmul, cscale, csqrt, csub, cx, type Complex } from '../shared/num';

const HALF_PI = Math.PI / 2;

/** The descending Landen moduli of k, until they vanish in double precision. */
function landen(k: number): number[] {
  const v: number[] = [];
  let m = k;
  for (let n = 0; n < 40 && m > 1e-16; n += 1) {
    m = (m / (1 + Math.sqrt(Math.max(0, 1 - m * m)))) ** 2;
    v.push(m);
  }
  return v;
}

const csin = (z: Complex): Complex => cx(Math.sin(z.re) * Math.cosh(z.im), Math.cos(z.re) * Math.sinh(z.im));
const ccos = (z: Complex): Complex => cx(Math.cos(z.re) * Math.cosh(z.im), -Math.sin(z.re) * Math.sinh(z.im));
const clog = (z: Complex): Complex => cx(Math.log(Math.hypot(z.re, z.im)), Math.atan2(z.im, z.re));
/** asin z = −i·ln(iz + √(1 − z²)). */
function casin(z: Complex): Complex {
  const iz = cx(-z.im, z.re);
  const l = clog(cadd(iz, csqrt(csub(cx(1), cmul(z, z)))));
  return cx(l.im, -l.re);
}

/** Climbs back up the Landen moduli: w → (1 + vₙ)w/(1 + vₙw²). */
function ascend(w: Complex, v: readonly number[]): Complex {
  let out = w;
  for (let n = v.length - 1; n >= 0; n -= 1) {
    const vn = v[n]!;
    out = cdiv(cscale(out, 1 + vn), cadd(cx(1), cscale(cmul(out, out), vn)));
  }
  return out;
}

/** sn(uK, k), with u measured in quarter periods K. */
const sne = (u: Complex, k: number): Complex => ascend(csin(cscale(u, HALF_PI)), landen(k));
/** cd(uK, k), with u measured in quarter periods K. */
const cde = (u: Complex, k: number): Complex => ascend(ccos(cscale(u, HALF_PI)), landen(k));

/** The inverse of sne: the u (in quarter periods) with sn(uK, k) = w. */
function asne(w: Complex, k: number): Complex {
  const v = landen(k);
  let out = w;
  let previous = k;
  for (const vn of v) {
    const root = csqrt(csub(cx(1), cscale(cmul(out, out), previous * previous)));
    out = cscale(cdiv(out, cadd(cx(1), root)), 2 / (1 + vn));
    previous = vn;
  }
  return cscale(casin(out), 1 / HALF_PI);
}

export interface EllipticPrototype {
  z: Complex[];
  p: Complex[];
  k: number;
  /** The selectivity: passband edge over stopband edge. */
  selectivity: number;
}

/** The selectivity k that an order-N elliptic filter reaches with discrimination k₁ = ε_p/ε_s (the degree equation). */
export function ellipticSelectivity(order: number, rippleDb: number, stopDb: number): number {
  const k1 = Math.sqrt((10 ** (rippleDb / 10) - 1) / (10 ** (stopDb / 10) - 1));
  const k1c = Math.sqrt(1 - k1 * k1);
  let product = 1;
  for (let i = 1; i <= Math.floor(order / 2); i += 1) product *= sne(cx((2 * i - 1) / order), k1c).re;
  const kc = k1c ** order * product ** 4;
  return Math.sqrt(1 - kc * kc);
}

/** The order-N elliptic lowpass prototype with the passband edge at 1 rad/s, its zeros, poles, and gain. */
export function ellipticPrototype(order: number, rippleDb: number, stopDb: number): EllipticPrototype {
  const ep = Math.sqrt(10 ** (rippleDb / 10) - 1);
  const es = Math.sqrt(10 ** (stopDb / 10) - 1);
  const k = ellipticSelectivity(order, rippleDb, stopDb);
  // v0 is real: asne of an imaginary number is imaginary.
  const v0 = asne(cx(0, 1 / ep), ep / es).im / order;
  const z: Complex[] = [];
  const p: Complex[] = [];
  for (let i = 1; i <= Math.floor(order / 2); i += 1) {
    const u = (2 * i - 1) / order;
    const zero = 1 / (k * cde(cx(u), k).re);
    z.push(cx(0, zero), cx(0, -zero));
    const c = cde(cx(u, -v0), k);
    const pole = cx(-c.im, c.re);
    p.push(pole, cx(pole.re, -pole.im));
  }
  if (order % 2 === 1) p.push(cx(-sne(cx(0, v0), k).im));
  // The gain sets the DC response: 1 for an odd order, the bottom of the ripple for an even one.
  const minus = (roots: Complex[]) => roots.reduce((acc, r) => cmul(acc, cscale(r, -1)), cx(1));
  const dc = order % 2 === 1 ? 1 : 1 / Math.sqrt(1 + ep * ep);
  return { z, p, k: dc * cdiv(minus(p), minus(z)).re, selectivity: k };
}
