// Whole-number functions of the math family: factorials, counting, divisors, Roman numerals, and number bases.
// Written from the documented behavior.

import { err, finish, isError, isNumber, toNumber, toNumbers, type Value } from '../../values';
import { numbersIn, type FnSpec2 } from './types';
import { number, optional, scalar } from './mathKit';

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const MAX_DOUBLE_FACTORIAL = 300;

/** n choose k, built from a running product so it stays exact while the result is below 2^53. */
function choose(n: number, k: number): number {
  const m = Math.min(k, n - k);
  let r = 1;
  // C(n, i) grows with i up to n/2, so the product passes the largest double after a few hundred steps at most.
  // Stopping there keeps a huge call from running for seconds; the caller turns Infinity into #NUM!.
  for (let i = 1; i <= m; i++) {
    r = (r * (n - m + i)) / i;
    if (!Number.isFinite(r)) return Infinity;
  }
  return Math.round(r);
}

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

const gcd2 = (a: number, b: number): number => (b === 0 ? a : gcd2(b, a % b));

/** The whole numbers a GCD or LCM call names, or the error. Negative numbers are #NUM!. */
function wholes(args: Value[]): number[] | Value {
  const nums = numbersIn(args);
  if (!Array.isArray(nums)) return nums;
  const out = nums.map(Math.trunc);
  return out.some((n) => n < 0 || n > MAX_SAFE) ? err('NUM') : out;
}

type Pair = readonly [number, string];

// Roman numerals. Form 0 is the classic one. Forms 1 to 4 are more concise: each allows subtractive pairs where the
// subtracted symbol is further below the one it precedes. The tables follow the published examples for 499.
const CLASSIC: readonly Pair[] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];
const EXTRA: readonly (readonly Pair[])[] = [
  [],
  [
    [450, 'LD'],
    [950, 'LM'],
    [45, 'VL'],
    [95, 'VC'],
  ],
  [
    [490, 'XD'],
    [990, 'XM'],
    [49, 'IL'],
    [99, 'IC'],
  ],
  [
    [495, 'VD'],
    [995, 'VM'],
  ],
  [
    [499, 'ID'],
    [999, 'IM'],
  ],
];

function roman(n: number, form: number): string {
  const table = [...CLASSIC, ...EXTRA.slice(0, form + 1).flat()].sort((a, b) => b[0] - a[0]);
  let rest = n;
  let out = '';
  for (const [value, symbol] of table) {
    while (rest >= value) {
      out += symbol;
      rest -= value;
    }
  }
  return out;
}

const SYMBOLS: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

function arabic(text: string): number | null {
  const s = text.trim().toUpperCase();
  const negative = s.startsWith('-');
  const body = negative ? s.slice(1) : s;
  let total = 0;
  let prior = 0;
  for (let i = body.length - 1; i >= 0; i--) {
    const v = SYMBOLS[body[i]];
    if (v === undefined) return null;
    total += v < prior ? -v : v;
    prior = Math.max(prior, v);
  }
  return negative ? -total : total;
}

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const NUMBERS = [{ repeat: [{ name: 'number', kind: 'range' as const }], min: 1 }];

export const functions: readonly FnSpec2[] = [
  scalar(
    'FACT',
    [number()],
    ([n]) => {
      // A negative number is refused before it is truncated, so -0.5 is not read as zero.
      const k = Math.trunc(n);
      return n < 0 || k > 170 ? err('NUM') : finish(factorial(k));
    },
    '=FACT(5) gives 120',
  ),
  scalar(
    'FACTDOUBLE',
    [number()],
    ([n]) => {
      const k = Math.trunc(n);
      // The result passes the largest double a little above 300, so a larger number is refused before any looping.
      if (k < -1 || k > MAX_DOUBLE_FACTORIAL) return err('NUM');
      let r = 1;
      for (let i = k; i > 1; i -= 2) r *= i;
      return finish(r);
    },
    '=FACTDOUBLE(7) gives 105',
  ),
  scalar(
    'COMBIN',
    [number(), number('chosen')],
    ([n0, k0]) => {
      const n = Math.trunc(n0);
      const k = Math.trunc(k0);
      return n < 0 || k < 0 || k > n ? err('NUM') : finish(choose(n, k));
    },
    '=COMBIN(5, 2) gives 10',
  ),
  scalar(
    'COMBINA',
    [number(), number('chosen')],
    ([n0, k0]) => {
      const n = Math.trunc(n0);
      const k = Math.trunc(k0);
      if (n < 0 || k < 0 || (n === 0 && k > 0)) return err('NUM');
      return k === 0 ? 1 : finish(choose(n + k - 1, k));
    },
    '=COMBINA(4, 3) gives 20',
  ),
  {
    name: 'MULTINOMIAL',
    family: 'math',
    params: NUMBERS,
    run: (args) => {
      const ns = wholes(args);
      if (!Array.isArray(ns)) return ns;
      // A product of binomials, (n1+n2 choose n2), then (n1+n2+n3 choose n3), and on: no huge factorials.
      let sum = 0;
      let r = 1;
      for (const n of ns) {
        sum += n;
        r *= choose(sum, n);
        if (!Number.isFinite(r)) return err('NUM');
      }
      return finish(r);
    },
    meta: { signature: 'MULTINOMIAL(number, ...)', example: '=MULTINOMIAL(2, 3, 4) gives 1260' },
  },
  {
    name: 'GCD',
    family: 'math',
    params: NUMBERS,
    run: (args) => {
      const ns = wholes(args);
      return Array.isArray(ns) ? ns.reduce(gcd2, 0) : ns;
    },
    meta: { signature: 'GCD(number, ...)', example: '=GCD(24, 36) gives 12' },
  },
  {
    name: 'LCM',
    family: 'math',
    params: NUMBERS,
    run: (args) => {
      const ns = wholes(args);
      if (!Array.isArray(ns)) return ns;
      let r = 1;
      for (const n of ns) {
        if (n === 0) return 0;
        r = (r / gcd2(r, n)) * n;
        if (r > MAX_SAFE) return err('NUM');
      }
      return r;
    },
    meta: { signature: 'LCM(number, ...)', example: '=LCM(4, 6) gives 12' },
  },
  {
    name: 'ROMAN',
    family: 'math',
    params: [number(), { name: 'form', kind: 'value', optional: true, default: 0 }],
    run: ([n0, form0]) => {
      if (isError(n0)) return n0;
      const n = toNumbers([n0]);
      if (!Array.isArray(n)) return n;
      const k = Math.trunc(n[0]);
      // TRUE asks for the classic form and FALSE for the most concise, as the documentation says.
      const form = typeof form0 === 'boolean' ? (form0 ? 0 : 4) : isNumber(form0) ? Math.trunc(form0) : 0;
      if (k < 0 || k > 3999 || form < 0 || form > 4) return err('VALUE');
      return roman(k, form);
    },
    handlesErrors: true,
    meta: { signature: 'ROMAN(number, [form])', example: '=ROMAN(499) gives CDXCIX' },
  },
  {
    name: 'ARABIC',
    family: 'math',
    params: [{ name: 'text', kind: 'text' }],
    run: ([text]) => {
      const v = arabic(String(text ?? ''));
      return v === null ? err('VALUE') : v;
    },
    meta: { signature: 'ARABIC(text)', example: '=ARABIC("MCMXCIX") gives 1999' },
  },
  scalar(
    'BASE',
    [number(), number('radix'), optional('minLength', 0)],
    ([n0, radix0, min0 = 0]) => {
      const n = Math.trunc(n0);
      const radix = Math.trunc(radix0);
      const min = Math.trunc(min0);
      if (n < 0 || n > MAX_SAFE || radix < 2 || radix > 36 || min < 0 || min > 255) return err('NUM');
      return n.toString(radix).toUpperCase().padStart(min, '0');
    },
    '=BASE(7, 2) gives 111',
  ),
  {
    name: 'DECIMAL',
    family: 'math',
    params: [{ name: 'text', kind: 'text' }, number('radix')],
    run: ([text, radix0]) => {
      const r = toNumber(radix0);
      if (typeof r !== 'number') return r;
      const radix = Math.trunc(r);
      const s = String(text ?? '')
        .trim()
        .toUpperCase();
      if (radix < 2 || radix > 36 || s.length > 255) return err('NUM');
      let total = 0;
      for (const ch of s) {
        const d = DIGITS.indexOf(ch);
        if (d < 0 || d >= radix) return err('NUM');
        total = total * radix + d;
      }
      return total > MAX_SAFE ? err('NUM') : total;
    },
    meta: { signature: 'DECIMAL(text, radix)', example: '=DECIMAL("FF", 16) gives 255' },
  },
];
