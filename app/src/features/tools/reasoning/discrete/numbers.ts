// Number theory in BigInt. Euclid's algorithm comes with its table, and fast powers with their bits. Also here:
// inverses, the Chinese remainder theorem, primes (deterministic Miller-Rabin below 3.3e24), and factors (trial
// division, then Pollard's rho with Brent's cycle finding). Then Euler's phi, Carmichael's lambda, primitive roots,
// discrete logarithms by baby step, giant step, Jacobi symbols, continued fractions, Diophantine equations, and bases.
import { fail } from '../core/util';

export const abs = (a: bigint): bigint => (a < 0n ? -a : a);
/** The least residue of a mod m, in 0..m-1. */
export const mod = (a: bigint, m: bigint): bigint => ((a % m) + m) % m;

/** Reads a whole number, with optional sign and digit separators. */
export function big(text: string, field = 'n'): bigint {
  const t = text
    .trim()
    .replace(/[_\s,]/g, '')
    .replace(/^\+/, '')
    .replace('−', '-');
  if (!/^-?\d+$/.test(t)) return fail('whole', { field });
  if (t.length > 80) return fail('tooLong', { digits: 80 });
  return BigInt(t);
}

export interface EuclidRow {
  q: bigint | null;
  r: bigint;
  s: bigint;
  t: bigint;
}

/** The extended Euclidean algorithm as its table: each remainder r = s a + t b. */
export function extendedEuclid(a: bigint, b: bigint): { rows: EuclidRow[]; g: bigint; x: bigint; y: bigint } {
  if (a === 0n && b === 0n) fail('bothZero');
  const rows: EuclidRow[] = [
    { q: null, r: a, s: 1n, t: 0n },
    { q: null, r: b, s: 0n, t: 1n },
  ];
  while (rows[rows.length - 1].r !== 0n) {
    const [p, c] = [rows[rows.length - 2], rows[rows.length - 1]];
    const q = p.r / c.r;
    rows.push({ q, r: p.r - q * c.r, s: p.s - q * c.s, t: p.t - q * c.t });
  }
  const last = rows[rows.length - 2];
  const sign = last.r < 0n ? -1n : 1n;
  return { rows, g: last.r * sign, x: last.s * sign, y: last.t * sign };
}

export const gcd = (a: bigint, b: bigint): bigint => {
  let [x, y] = [abs(a), abs(b)];
  while (y) [x, y] = [y, x % y];
  return x;
};

export function modInverse(a: bigint, m: bigint): bigint {
  if (m <= 1n) fail('modulus');
  const { g, x } = extendedEuclid(mod(a, m), m);
  if (g !== 1n) fail('noInverse', { a: String(a), m: String(m), g: String(g) });
  return mod(x, m);
}

export interface PowStep {
  bit: 0 | 1;
  /** The running result after this bit. */
  result: bigint;
  /** The square of the base for the next bit. */
  square: bigint;
}

/** a^e mod m by reading the bits of e from the lowest: multiply in each square whose bit is 1. */
export function modPow(a: bigint, e: bigint, m: bigint): { value: bigint; steps: PowStep[] } {
  if (m <= 0n) fail('modulus');
  if (e < 0n) return modPow(modInverse(a, m), -e, m);
  const steps: PowStep[] = [];
  let result = 1n % m;
  let square = mod(a, m);
  for (let k = e; k > 0n; k >>= 1n) {
    const bit = (k & 1n) === 1n ? 1 : 0;
    if (bit) result = (result * square) % m;
    steps.push({ bit, result, square });
    square = (square * square) % m;
  }
  return { value: result, steps };
}

export const powMod = (a: bigint, e: bigint, m: bigint): bigint => {
  let r = 1n % m;
  let b = mod(a, m);
  for (let k = e; k > 0n; k >>= 1n) {
    if (k & 1n) r = (r * b) % m;
    b = (b * b) % m;
  }
  return r;
};

/** Joins x = r_i (mod m_i) one congruence at a time; moduli need not be coprime if the residues agree. */
export function crt(res: bigint[], mods: bigint[]): { x: bigint; m: bigint; steps: { x: bigint; m: bigint }[] } {
  if (res.length === 0 || res.length !== mods.length) fail('crtCount');
  if (mods.some((m) => m <= 0n)) fail('modulus');
  let x = mod(res[0], mods[0]);
  let m = mods[0];
  const steps = [{ x, m }];
  for (let i = 1; i < res.length; i += 1) {
    const [r, n] = [mod(res[i], mods[i]), mods[i]];
    const { g, x: p } = extendedEuclid(m, n);
    if ((r - x) % g !== 0n) fail('crtNone', { i: i + 1 });
    const l = (m / g) * n;
    x = mod(x + m * (((r - x) / g) * p), l);
    m = l;
    steps.push({ x, m });
  }
  return { x, m, steps };
}

const SMALL = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];

/** Miller-Rabin with the first 12 prime bases: no composite below 3.3e24 passes them all. */
export function isPrime(n: bigint): boolean {
  if (n < 2n) return false;
  for (const p of SMALL) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  let d = n - 1n;
  let s = 0;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s += 1;
  }
  outer: for (const a of SMALL) {
    let x = powMod(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    for (let r = 1; r < s; r += 1) {
      x = (x * x) % n;
      if (x === n - 1n) continue outer;
    }
    return false;
  }
  return true;
}

/** True when the Miller-Rabin answer is proven: below 3.3e24 with these bases. */
export const primeProven = (n: bigint): boolean => n < 3317044064679887385961981n;

function rho(n: bigint, seed: bigint): bigint | null {
  // Brent's variant: x walks by x^2 + c, and the gcd is taken over batches of products.
  const c = seed;
  const f = (x: bigint) => (x * x + c) % n;
  let y = 2n;
  let r = 1;
  let q = 1n;
  let g = 1n;
  let x = y;
  let ys = y;
  for (let rounds = 0; g === 1n && rounds < 40; rounds += 1) {
    x = y;
    for (let i = 0; i < r; i += 1) y = f(y);
    let k = 0;
    while (k < r && g === 1n) {
      ys = y;
      const m = Math.min(128, r - k);
      for (let i = 0; i < m; i += 1) {
        y = f(y);
        q = (q * abs(x - y)) % n;
      }
      g = gcd(q, n);
      k += m;
    }
    r *= 2;
  }
  if (g === n) {
    do {
      ys = f(ys);
      g = gcd(abs(x - ys), n);
    } while (g === 1n);
  }
  return g === n || g === 1n ? null : g;
}

/** Prime factors with their powers, from least to greatest. */
export function factor(nIn: bigint): { p: bigint; k: number }[] {
  if (nIn === 0n) fail('zero');
  let n = abs(nIn);
  const found = new Map<bigint, number>();
  const add = (p: bigint) => found.set(p, (found.get(p) ?? 0) + 1);
  for (let p = 2n; p < 10000n && p * p <= n; p += p === 2n ? 1n : 2n)
    while (n % p === 0n) {
      add(p);
      n /= p;
    }
  const stack = n > 1n ? [n] : [];
  while (stack.length) {
    const m = stack.pop()!;
    if (isPrime(m)) {
      add(m);
      continue;
    }
    let d: bigint | null = null;
    for (let c = 1n; d === null && c < 40n; c += 1n) d = rho(m, c);
    if (d === null) fail('factorHard');
    stack.push(d!, m / d!);
  }
  return [...found.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([p, k]) => ({ p, k }));
}

export function phi(n: bigint): bigint {
  if (n <= 0n) fail('positive');
  return factor(n).reduce((acc, { p, k }) => acc * (p - 1n) * p ** BigInt(k - 1), 1n);
}

/** Carmichael's lambda: the least e with a^e = 1 (mod n) for every a coprime to n. */
export function carmichael(n: bigint): bigint {
  if (n <= 0n) fail('positive');
  const lcm = (a: bigint, b: bigint) => (a / gcd(a, b)) * b;
  return factor(n).reduce((acc, { p, k }) => {
    let l = (p - 1n) * p ** BigInt(k - 1);
    if (p === 2n && k >= 3) l /= 2n;
    return lcm(acc, l);
  }, 1n);
}

/** The least primitive root mod n, or null when n has none (n is not 1, 2, 4, p^k, or 2p^k). */
export function primitiveRoot(n: bigint): bigint | null {
  if (n === 1n) return 0n;
  if (n === 2n) return 1n;
  if (n === 4n) return 3n;
  const fs = factor(n);
  const odd = fs.filter((f) => f.p !== 2n);
  const two = fs.find((f) => f.p === 2n);
  if (odd.length !== 1 || (two && two.k > 1)) return null;
  const t = phi(n);
  const ps = factor(t).map((f) => f.p);
  for (let g = 2n; g < n && g < 100000n; g += 1n) {
    if (gcd(g, n) !== 1n) continue;
    if (ps.every((p) => powMod(g, t / p, n) !== 1n)) return g;
  }
  return null;
}

/** The order of a mod n: the least k > 0 with a^k = 1. */
export function orderMod(a: bigint, n: bigint): bigint {
  if (gcd(a, n) !== 1n) fail('notCoprime', { a: String(a), n: String(n) });
  const l = carmichael(n);
  let k = l;
  for (const { p } of factor(l)) while (k % p === 0n && powMod(a, k / p, n) === 1n) k /= p;
  return k;
}

/** Baby step, giant step: the least x >= 0 with g^x = h (mod n), or null. */
export function discreteLog(g: bigint, h: bigint, n: bigint): { x: bigint | null; m: bigint } {
  if (n <= 1n) fail('modulus');
  if (n > 10n ** 12n) fail('dlogBig', { limit: '10^12' });
  let m = 1n;
  while (m * m < n) m += 1n;
  const table = new Map<bigint, bigint>();
  let e = 1n % n;
  for (let j = 0n; j < m; j += 1n) {
    if (!table.has(e)) table.set(e, j);
    e = (e * mod(g, n)) % n;
  }
  if (gcd(g, n) !== 1n) {
    // Without an inverse, try every power up to n directly (n is small here).
    let p = 1n % n;
    for (let x = 0n; x < n && x < 2000000n; x += 1n) {
      if (p === mod(h, n)) return { x, m };
      p = (p * g) % n;
    }
    return { x: null, m };
  }
  const factorStep = modInverse(powMod(g, m, n), n);
  let y = mod(h, n);
  for (let i = 0n; i < m; i += 1n) {
    const j = table.get(y);
    if (j !== undefined) return { x: i * m + j, m };
    y = (y * factorStep) % n;
  }
  return { x: null, m };
}

/** The Jacobi symbol (a / n) for odd n > 0; the Legendre symbol when n is prime. */
export function jacobi(aIn: bigint, nIn: bigint): number {
  if (nIn <= 0n || nIn % 2n === 0n) fail('jacobiOdd');
  let a = mod(aIn, nIn);
  let n = nIn;
  let t = 1;
  while (a !== 0n) {
    while (a % 2n === 0n) {
      a /= 2n;
      const r = n % 8n;
      if (r === 3n || r === 5n) t = -t;
    }
    [a, n] = [n, a];
    if (a % 4n === 3n && n % 4n === 3n) t = -t;
    a %= n;
  }
  return n === 1n ? t : 0;
}

/** The continued fraction of p / q, and its convergents h / k. */
export function continuedFraction(p: bigint, q: bigint): { terms: bigint[]; convergents: [bigint, bigint][] } {
  if (q === 0n) fail('zeroDenominator');
  let [a, b] = q < 0n ? [-p, -q] : [p, q];
  const terms: bigint[] = [];
  while (b !== 0n && terms.length < 200) {
    let t = a / b;
    if (a < 0n && t * b !== a) t -= 1n;
    terms.push(t);
    [a, b] = [b, a - t * b];
  }
  const convergents: [bigint, bigint][] = [];
  let [h1, h2, k1, k2] = [1n, 0n, 0n, 1n];
  for (const t of terms) {
    [h1, h2] = [t * h1 + h2, h1];
    [k1, k2] = [t * k1 + k2, k1];
    convergents.push([h1, k1]);
  }
  return { terms, convergents };
}

/** All solutions of ax + by = c: a particular one and the step, or null when gcd(a, b) does not divide c. */
export function diophantine(
  a: bigint,
  b: bigint,
  c: bigint,
): { x: bigint; y: bigint; dx: bigint; dy: bigint; g: bigint } | null {
  const { g, x, y } = extendedEuclid(a, b);
  if (c % g !== 0n) return null;
  const f = c / g;
  return { x: x * f, y: y * f, dx: b / g, dy: -a / g, g };
}

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

export function parseBase(text: string, base: number): bigint {
  const t = text.trim().toLowerCase().replace(/[_\s]/g, '');
  const neg = t.startsWith('-');
  const body = neg ? t.slice(1) : t;
  if (!body) return fail('digits', { base });
  let v = 0n;
  for (const ch of body) {
    const d = DIGITS.indexOf(ch);
    if (d < 0 || d >= base) return fail('digits', { base });
    v = v * BigInt(base) + BigInt(d);
  }
  return neg ? -v : v;
}

export function toBase(n: bigint, base: number): string {
  if (n === 0n) return '0';
  let v = abs(n);
  let out = '';
  while (v > 0n) {
    out = DIGITS[Number(v % BigInt(base))] + out;
    v /= BigInt(base);
  }
  return (n < 0n ? '-' : '') + out;
}
