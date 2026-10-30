// Classical and toy public-key cryptography for study, never for real secrets: Caesar, affine, Vigenère,
// substitution with letter counts, the Hill cipher mod 26, RSA, Diffie-Hellman, ElGamal, and LFSR sequences.
// Letters A to Z are enciphered; other characters pass through unchanged.
import { fail } from '../core/util';
import { gcd, isPrime, mod, modInverse, powMod } from './numbers';

const A = 'A'.charCodeAt(0);
const letter = (ch: string) => /[A-Za-z]/.test(ch);
const shiftChar = (ch: string, f: (x: number) => number) => {
  if (!letter(ch)) return ch;
  const upper = ch === ch.toUpperCase();
  const x = ch.toUpperCase().charCodeAt(0) - A;
  const out = String.fromCharCode(A + (((f(x) % 26) + 26) % 26));
  return upper ? out : out.toLowerCase();
};

export const caesar = (text: string, k: number, decrypt = false): string =>
  [...text].map((ch) => shiftChar(ch, (x) => x + (decrypt ? -k : k))).join('');

export function affine(text: string, a: number, b: number, decrypt = false): string {
  if (gcd(BigInt(a), 26n) !== 1n) fail('affineKey', { a });
  const inv = Number(modInverse(BigInt(a), 26n));
  return [...text].map((ch) => shiftChar(ch, (x) => (decrypt ? inv * (x - b) : a * x + b))).join('');
}

export function vigenere(text: string, key: string, decrypt = false): string {
  const shifts = [...key.toUpperCase()].filter(letter).map((c) => c.charCodeAt(0) - A);
  if (shifts.length === 0) fail('vigenereKey');
  let k = 0;
  return [...text]
    .map((ch) => {
      if (!letter(ch)) return ch;
      const s = shifts[k++ % shifts.length];
      return shiftChar(ch, (x) => x + (decrypt ? -s : s));
    })
    .join('');
}

/** A substitution: the key lists the cipher letter for A, B, C, and so on. */
export function substitution(text: string, key: string, decrypt = false): string {
  const k = key.toUpperCase().replace(/[^A-Z]/g, '');
  if (k.length !== 26 || new Set(k).size !== 26) fail('substitutionKey');
  return [...text]
    .map((ch) => {
      if (!letter(ch)) return ch;
      const upper = ch === ch.toUpperCase();
      const x = ch.toUpperCase();
      const out = decrypt ? String.fromCharCode(A + k.indexOf(x)) : k[x.charCodeAt(0) - A];
      return upper ? out : out.toLowerCase();
    })
    .join('');
}

/** How often each letter appears, most common first, with its share of all letters. */
export function letterCounts(text: string): { letter: string; count: number; share: number }[] {
  const counts = new Map<string, number>();
  let total = 0;
  for (const ch of text.toUpperCase())
    if (ch >= 'A' && ch <= 'Z') {
      counts.set(ch, (counts.get(ch) ?? 0) + 1);
      total += 1;
    }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([l, c]) => ({ letter: l, count: c, share: total ? c / total : 0 }));
}

/** The Hill cipher with an n by n key matrix mod 26, padding with X to a whole block. */
export function hill(text: string, key: number[][], decrypt = false): string {
  const n = key.length;
  if (n < 1 || n > 4 || key.some((r) => r.length !== n)) fail('hillSquare');
  const det = (m: number[][]): number =>
    m.length === 1
      ? m[0][0]
      : m[0].reduce((s, v, j) => s + (j % 2 ? -1 : 1) * v * det(m.slice(1).map((r) => r.filter((_, c) => c !== j))), 0);
  const d = mod(BigInt(det(key)), 26n);
  if (gcd(d, 26n) !== 1n) fail('hillKey', { det: String(d) });
  let m = key.map((r) => r.map((v) => Number(mod(BigInt(v), 26n))));
  if (decrypt) {
    const dInv = Number(modInverse(d, 26n));
    // The inverse is dInv times the adjugate, mod 26.
    m = key.map((_, i) =>
      key.map((__, j) => {
        const minor = key.filter((_r, r) => r !== j).map((r) => r.filter((_c, c) => c !== i));
        const cof = ((i + j) % 2 ? -1 : 1) * (n === 1 ? 1 : det(minor));
        return Number(mod(BigInt(dInv * cof), 26n));
      }),
    );
  }
  const letters = [...text.toUpperCase()].filter((c) => c >= 'A' && c <= 'Z').map((c) => c.charCodeAt(0) - A);
  if (letters.length === 0) fail('noLetters');
  while (letters.length % n) letters.push(23);
  let out = '';
  for (let b = 0; b < letters.length; b += n) {
    const block = letters.slice(b, b + n);
    for (let i = 0; i < n; i += 1)
      out += String.fromCharCode(A + (((m[i].reduce((s, v, j) => s + v * block[j], 0) % 26) + 26) % 26));
  }
  return out;
}

export interface Rsa {
  n: bigint;
  phi: bigint;
  d: bigint;
  c: bigint;
  back: bigint;
  signature: bigint;
  verified: boolean;
}

export function rsa(p: bigint, q: bigint, e: bigint, message: bigint): Rsa {
  if (!isPrime(p) || !isPrime(q)) fail('rsaPrimes');
  if (p === q) fail('rsaSame');
  const n = p * q;
  const phi = (p - 1n) * (q - 1n);
  if (e <= 1n || e >= phi || gcd(e, phi) !== 1n) fail('rsaE', { phi: String(phi) });
  if (message < 0n || message >= n) fail('rsaMessage', { n: String(n) });
  const d = modInverse(e, phi);
  const c = powMod(message, e, n);
  const signature = powMod(message, d, n);
  return { n, phi, d, c, back: powMod(c, d, n), signature, verified: powMod(signature, e, n) === message };
}

export function diffieHellman(p: bigint, g: bigint, a: bigint, b: bigint): { A: bigint; B: bigint; key: bigint } {
  if (p < 3n || !isPrime(p)) fail('dhPrime');
  const A2 = powMod(g, a, p);
  const B2 = powMod(g, b, p);
  const key = powMod(B2, a, p);
  return { A: A2, B: B2, key };
}

export function elGamal(
  p: bigint,
  g: bigint,
  x: bigint,
  k: bigint,
  m: bigint,
): { h: bigint; c1: bigint; c2: bigint; back: bigint } {
  if (p < 3n || !isPrime(p)) fail('dhPrime');
  if (m <= 0n || m >= p) fail('rsaMessage', { n: String(p) });
  if (gcd(k, p - 1n) !== 1n && k % (p - 1n) === 0n) fail('elgamalK');
  const h = powMod(g, x, p);
  const c1 = powMod(g, k, p);
  const s = powMod(h, k, p);
  const c2 = (m * s) % p;
  const back = (c2 * modInverse(powMod(c1, x, p), p)) % p;
  return { h, c1, c2, back };
}

/**
 * A Fibonacci LFSR: each step outputs the last bit and shifts in the XOR of the tapped bits. Taps count from 1 at
 * the left. Returns the output and the period of the state.
 */
export function lfsr(seed: string, taps: number[], count: number): { bits: string; period: number | null } {
  const state: number[] = [...seed.replace(/\s/g, '')].map((c) => (c === '1' ? 1 : c === '0' ? 0 : -1));
  if (state.length === 0 || state.length > 32 || state.includes(-1)) fail('lfsrSeed');
  if (taps.length === 0 || taps.some((t) => !Number.isInteger(t) || t < 1 || t > state.length))
    fail('lfsrTaps', { n: state.length });
  const n = Math.min(Math.max(1, count), 4096);
  const start = state.join('');
  let s = [...state];
  let out = '';
  let period: number | null = null;
  for (let i = 0; i < Math.max(n, 1 << Math.min(state.length, 16)); i += 1) {
    if (i < n) out += String(s[s.length - 1]);
    const fb = taps.reduce((acc, t) => acc ^ s[t - 1], 0);
    s = [fb, ...s.slice(0, -1)];
    if (period === null && s.join('') === start) period = i + 1;
    if (i >= n && period !== null) break;
  }
  return { bits: out, period };
}
