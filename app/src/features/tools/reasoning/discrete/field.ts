// Polynomials over Z_p and the finite fields GF(p^n) = Z_p[x] / (f): sums, products, inverses, powers, and the
// powers of x, which show whether x generates the multiplicative group. Also the ring Z_n: units, zero divisors,
// nilpotents, and idempotents.
import { fail } from '../core/util';

/** Coefficients from the constant term up, each in 0..p-1, with no trailing zeros. */
export type Poly = number[];

const trim = (a: Poly): Poly => {
  const out = [...a];
  while (out.length && out[out.length - 1] === 0) out.pop();
  return out;
};
const md = (x: number, p: number) => ((x % p) + p) % p;

/** Reads a polynomial such as x^3 + x + 1 or 2x^2 - 1, reducing coefficients mod p. */
export function parsePoly(text: string, p: number): Poly {
  const src = text.replace(/\s+/g, '').replace(/−/g, '-').replace(/\*/g, '');
  if (!src) return fail('polyEmpty');
  if (!/^[+-]?(\d*x(\^\d+)?|\d+)([+-](\d*x(\^\d+)?|\d+))*$/.test(src)) return fail('polyTerm');
  const out: number[] = [];
  for (const m of src.matchAll(/([+-]?)(\d*)(x(?:\^(\d+))?)?/g)) {
    if (!m[0]) continue;
    const sign = m[1] === '-' ? -1 : 1;
    const coef = m[2] ? Number(m[2]) : 1;
    const deg = m[3] ? (m[4] ? Number(m[4]) : 1) : 0;
    if (!m[3] && !m[2]) continue;
    if (deg > 64) fail('polyDegree', { max: 64 });
    while (out.length <= deg) out.push(0);
    out[deg] = md(out[deg] + sign * coef, p);
  }
  return trim(out);
}

export function polyText(a: Poly): string {
  const t = trim(a);
  if (t.length === 0) return '0';
  const parts: string[] = [];
  for (let d = t.length - 1; d >= 0; d -= 1) {
    const c = t[d];
    if (!c) continue;
    const x = d === 0 ? '' : d === 1 ? 'x' : `x^${d}`;
    parts.push(d === 0 ? String(c) : `${c === 1 ? '' : c}${x}`);
  }
  return parts.join(' + ');
}

export const polyAdd = (a: Poly, b: Poly, p: number): Poly =>
  trim(Array.from({ length: Math.max(a.length, b.length) }, (_, i) => md((a[i] ?? 0) + (b[i] ?? 0), p)));

export function polyMul(a: Poly, b: Poly, p: number): Poly {
  if (!a.length || !b.length) return [];
  const out = Array<number>(a.length + b.length - 1).fill(0);
  a.forEach((x, i) => b.forEach((y, j) => (out[i + j] = md(out[i + j] + x * y, p))));
  return trim(out);
}

const invMod = (a: number, p: number): number => {
  for (let x = 1; x < p; x += 1) if (md(a * x, p) === 1) return x;
  return fail('notPrime', { p });
};

export function polyDivMod(a: Poly, b: Poly, p: number): { q: Poly; r: Poly } {
  const d = trim(b);
  if (!d.length) fail('polyZeroDivide');
  let r = trim(a);
  const q = Array<number>(Math.max(0, r.length - d.length + 1)).fill(0);
  const lead = invMod(d[d.length - 1], p);
  while (r.length >= d.length) {
    const shift = r.length - d.length;
    const c = md(r[r.length - 1] * lead, p);
    q[shift] = c;
    r = trim(r.map((v, i) => (i >= shift && i - shift < d.length ? md(v - c * d[i - shift], p) : v)));
  }
  return { q: trim(q), r };
}

const isPrimeN = (p: number) => {
  if (!Number.isInteger(p) || p < 2) return false;
  for (let d = 2; d * d <= p; d += 1) if (p % d === 0) return false;
  return true;
};

export interface Field {
  p: number;
  f: Poly;
  n: number;
  size: number;
  /** Whether f is irreducible, so the quotient is a field. */
  field: boolean;
}

/** Every polynomial of degree below n, in counting order. */
export const elements = (p: number, n: number): Poly[] =>
  Array.from({ length: p ** n }, (_, k) => trim(Array.from({ length: n }, (_, i) => Math.floor(k / p ** i) % p)));

export function makeField(p: number, fText: string): Field {
  if (!isPrimeN(p)) fail('notPrime', { p });
  const f = parsePoly(fText, p);
  const n = f.length - 1;
  if (n < 1) fail('polyDegreeLow');
  const size = p ** n;
  if (size > 1024) fail('fieldBig', { max: 1024 });
  // f is irreducible exactly when no polynomial of degree 1..n/2 divides it.
  let field = true;
  for (const g of elements(p, Math.floor(n / 2) + 1))
    if (g.length >= 2 && g.length - 1 <= n / 2 && polyDivMod(f, g, p).r.length === 0) {
      field = false;
      break;
    }
  return { p, f, n, size, field };
}

export const fieldMul = (F: Field, a: Poly, b: Poly): Poly => polyDivMod(polyMul(a, b, F.p), F.f, F.p).r;

export function fieldPow(F: Field, a: Poly, k: number): Poly {
  let r: Poly = [1];
  let b = polyDivMod(a, F.f, F.p).r;
  for (let e = k; e > 0; e = Math.floor(e / 2)) {
    if (e % 2) r = fieldMul(F, r, b);
    b = fieldMul(F, b, b);
  }
  return r;
}

export function fieldInverse(F: Field, a: Poly): Poly | null {
  const r = polyDivMod(a, F.f, F.p).r;
  if (!r.length) return null;
  for (const x of elements(F.p, F.n)) if (polyText(fieldMul(F, r, x)) === '1') return x;
  return null;
}

/** The powers x^0, x^1, ... until they repeat 1, and whether x generates every nonzero element. */
export function powersOfX(F: Field): { powers: Poly[]; primitive: boolean } {
  const powers: Poly[] = [[1]];
  for (let k = 1; k < F.size; k += 1) {
    const next = fieldMul(F, powers[k - 1], [0, 1]);
    if (polyText(next) === '1' || next.length === 0) break;
    powers.push(next);
  }
  return { powers, primitive: F.field && powers.length === F.size - 1 };
}

export function ringZn(n: number): {
  units: number[];
  zeroDivisors: number[];
  nilpotent: number[];
  idempotent: number[];
} {
  if (!Number.isInteger(n) || n < 2 || n > 10000) fail('ringN');
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const all = Array.from({ length: n }, (_, k) => k);
  const units = all.filter((k) => g(k, n) === 1);
  const zeroDivisors = all.filter((k) => k !== 0 && g(k, n) !== 1);
  const nilpotent = all.filter((k) => {
    let x = k;
    for (let i = 0; i < 64; i += 1) {
      if (x === 0) return true;
      x = (x * k) % n;
    }
    return false;
  });
  const idempotent = all.filter((k) => (k * k) % n === k);
  return { units, zeroDivisors, nilpotent, idempotent };
}
