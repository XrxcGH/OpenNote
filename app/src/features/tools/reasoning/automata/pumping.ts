// The pumping-lemma game on a few classic languages. The student picks the pumping length p and a string s in the
// language; the tool then plays every legal split as the opponent and, for each, looks for a number of repetitions
// that leaves the language. If every split loses, s wins the round; if one split survives, s was a poor choice.
import { fail } from '../core/util';

export const LANGUAGES = ['anbn', 'anbncn', 'ww', 'palindrome', 'squares', 'primes', 'balanced', 'morea'] as const;
export type LanguageId = (typeof LANGUAGES)[number];

const count = (s: string, c: string) => [...s].filter((x) => x === c).length;
const isPrime = (n: number) => {
  if (n < 2) return false;
  for (let d = 2; d * d <= n; d += 1) if (n % d === 0) return false;
  return true;
};

export const MEMBER: Record<LanguageId, { alphabet: string; test: (s: string) => boolean }> = {
  anbn: { alphabet: 'ab', test: (s) => /^a*b*$/.test(s) && count(s, 'a') === count(s, 'b') },
  anbncn: {
    alphabet: 'abc',
    test: (s) => /^a*b*c*$/.test(s) && count(s, 'a') === count(s, 'b') && count(s, 'b') === count(s, 'c'),
  },
  ww: { alphabet: 'ab', test: (s) => s.length % 2 === 0 && s.slice(0, s.length / 2) === s.slice(s.length / 2) },
  palindrome: { alphabet: 'ab', test: (s) => s === [...s].reverse().join('') },
  squares: { alphabet: 'a', test: (s) => /^a*$/.test(s) && Number.isInteger(Math.sqrt(s.length)) },
  primes: { alphabet: 'a', test: (s) => /^a*$/.test(s) && isPrime(s.length) },
  balanced: {
    alphabet: '()',
    test: (s) => {
      let depth = 0;
      for (const c of s) {
        depth += c === '(' ? 1 : c === ')' ? -1 : NaN;
        if (!(depth >= 0)) return false;
      }
      return depth === 0;
    },
  },
  morea: { alphabet: 'ab', test: (s) => /^a*b*$/.test(s) && count(s, 'a') > count(s, 'b') },
};

export interface SplitResult {
  /** The pieces: x, y, z for regular languages; u, v, x, y, z for context-free ones. */
  parts: string[];
  /** The first repetition count that leaves the language, or null when none up to the limit does. */
  pumpOut: number | null;
}

export interface Game {
  splits: SplitResult[];
  survivor: SplitResult | null;
}

const REPEATS = [0, 2, 3, 4];
export const MAX_GAME = 60;
export const MAX_CFL_P = 12;

export function playPumping(lang: LanguageId, kind: 'regular' | 'cfl', p: number, s: string): Game {
  const { test, alphabet } = MEMBER[lang];
  if (!Number.isInteger(p) || p < 1) fail('pumpLength');
  if ([...s].some((c) => !alphabet.includes(c))) fail('pumpAlphabet', { alphabet: [...alphabet].join(', ') });
  if (!test(s)) fail('pumpNotIn');
  if (s.length < p) fail('pumpShort', { p });
  if (s.length > MAX_GAME) fail('inputLong', { max: MAX_GAME });
  if (kind === 'cfl' && p > MAX_CFL_P) fail('pumpBig', { max: MAX_CFL_P });
  const splits: SplitResult[] = [];
  if (kind === 'regular') {
    for (let xy = 1; xy <= p; xy += 1)
      for (let x = 0; x < xy; x += 1) {
        const parts = [s.slice(0, x), s.slice(x, xy), s.slice(xy)];
        const out = REPEATS.find((i) => !test(parts[0] + parts[1].repeat(i) + parts[2]));
        splits.push({ parts, pumpOut: out ?? null });
      }
  } else {
    const n = s.length;
    for (let a = 0; a < n; a += 1)
      for (let len = 1; len <= p && a + len <= n; len += 1)
        for (let v = 0; v <= len; v += 1)
          for (let y = 0; v + y <= len; y += 1) {
            if (v + y === 0) continue;
            const x = len - v - y;
            const parts = [
              s.slice(0, a),
              s.slice(a, a + v),
              s.slice(a + v, a + v + x),
              s.slice(a + v + x, a + len),
              s.slice(a + len),
            ];
            const out = REPEATS.find(
              (i) => !test(parts[0] + parts[1].repeat(i) + parts[2] + parts[3].repeat(i) + parts[4]),
            );
            splits.push({ parts, pumpOut: out ?? null });
          }
  }
  return { splits, survivor: splits.find((r) => r.pumpOut === null) ?? null };
}
