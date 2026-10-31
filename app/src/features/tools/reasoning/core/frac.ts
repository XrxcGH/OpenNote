// Exact fractions on BigInt, for simplex tableaux, mixed equilibria, and other answers a student checks by hand.
// Every value is kept in lowest terms with a positive denominator.

export interface Frac {
  readonly n: bigint;
  readonly d: bigint;
}

const abs = (x: bigint): bigint => (x < 0n ? -x : x);

export function gcdBig(a: bigint, b: bigint): bigint {
  let x = abs(a);
  let y = abs(b);
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

export function frac(n: bigint | number, d: bigint | number = 1n): Frac {
  let num = typeof n === 'bigint' ? n : BigInt(n);
  let den = typeof d === 'bigint' ? d : BigInt(d);
  if (den === 0n) throw new RangeError('A fraction cannot have a zero denominator.');
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const g = gcdBig(num, den) || 1n;
  return { n: num / g, d: den / g };
}

export const ZERO = frac(0);
export const ONE = frac(1);

export const add = (a: Frac, b: Frac): Frac => frac(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Frac, b: Frac): Frac => frac(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Frac, b: Frac): Frac => frac(a.n * b.n, a.d * b.d);
export const div = (a: Frac, b: Frac): Frac => frac(a.n * b.d, a.d * b.n);
export const neg = (a: Frac): Frac => frac(-a.n, a.d);
export const cmp = (a: Frac, b: Frac): number => {
  const diff = a.n * b.d - b.n * a.d;
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
};
export const isZero = (a: Frac): boolean => a.n === 0n;
export const sign = (a: Frac): number => (a.n < 0n ? -1 : a.n > 0n ? 1 : 0);
export const toNumber = (a: Frac): number => Number(a.n) / Number(a.d);
export const fracText = (a: Frac): string => (a.d === 1n ? `${a.n}` : `${a.n}/${a.d}`);
export const fracLatex = (a: Frac): string =>
  a.d === 1n ? `${a.n}` : `${a.n < 0n ? '-' : ''}\\frac{${abs(a.n)}}{${a.d}}`;

/** A fraction from text such as 3, -2.5, 1e-3, or 3/7; null when the text is not a number. */
export function parseFrac(text: string): Frac | null {
  const s = text.trim();
  const slash = /^([+-]?\d+)\s*\/\s*(\d+)$/.exec(s);
  if (slash) return BigInt(slash[2]) === 0n ? null : frac(BigInt(slash[1]), BigInt(slash[2]));
  const dec = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(s);
  if (!dec || (dec[2] === '' && (dec[3] ?? '') === '')) return null;
  const digits = BigInt(`${dec[2] || '0'}${dec[3] ?? ''}`);
  const exp = Number(dec[4] ?? 0) - (dec[3] ?? '').length;
  if (Math.abs(exp) > 400) return null;
  const value = exp >= 0 ? frac(digits * 10n ** BigInt(exp)) : frac(digits, 10n ** BigInt(-exp));
  return dec[1] === '-' ? neg(value) : value;
}

/** The nearest fraction to a number with a denominator up to `limit`, by continued fractions. */
export function fromNumber(x: number, limit = 1_000_000): Frac {
  if (!Number.isFinite(x)) throw new RangeError('Not a finite number.');
  if (Number.isInteger(x)) return frac(BigInt(x));
  let [h0, h1, k0, k1] = [0n, 1n, 1n, 0n];
  let rest = x;
  for (let i = 0; i < 40; i += 1) {
    const a = Math.floor(rest);
    const big = BigInt(a);
    [h0, h1] = [h1, big * h1 + h0];
    [k0, k1] = [k1, big * k1 + k0];
    if (k1 > BigInt(limit)) return frac(h0, k0);
    const left = rest - a;
    if (Math.abs(Number(h1) / Number(k1) - x) < 1e-15 || left < 1e-15) break;
    rest = 1 / left;
  }
  return frac(h1, k1);
}
