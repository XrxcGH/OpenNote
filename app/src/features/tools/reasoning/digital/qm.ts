// Two-level minimization by Quine-McCluskey: combine cubes that differ in one variable until none combine (the prime
// implicants), take the essential ones, then cover what is left exactly with Petrick's method, which lists every
// cover with the fewest terms and then the fewest literals. Minimal POS comes from the complement the same way.
import { step } from '../core/step';
import type { Step } from '../core/step';
import { fail, popcount } from '../core/util';

/** A product term: the variables in `care` take the bits in `value`; the others are free (a dash). */
export interface Cube {
  value: number;
  care: number;
}

export interface Minimized {
  primes: Cube[];
  essential: Cube[];
  /** Every minimal cover, each a list of primes. */
  covers: Cube[][];
  /** For each prime, the minterms (not don't cares) it covers. */
  chart: number[][];
  steps: Step[];
}

export const MAX_VARS = 6;

export const literals = (c: Cube, n: number): number => popcount(c.care & ((1 << n) - 1));

export const covers = (c: Cube, m: number): boolean => (m & c.care) === (c.value & c.care);

/** The cube as a pattern such as 1-0-, the first variable first. */
export function pattern(c: Cube, n: number): string {
  let s = '';
  for (let i = n - 1; i >= 0; i -= 1) s += (c.care >> i) & 1 ? String((c.value >> i) & 1) : '-';
  return s;
}

/** The cube as a product such as A'BD; an empty product is 1. */
export function termText(c: Cube, vars: readonly string[]): string {
  const n = vars.length;
  const joiner = vars.some((v) => v.length > 1) ? '·' : '';
  const parts: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const bit = n - 1 - i;
    if ((c.care >> bit) & 1) parts.push(`${vars[i]}${(c.value >> bit) & 1 ? '' : "'"}`);
  }
  return parts.length ? parts.join(joiner) : '1';
}

/** The cube as a sum for POS: each cared variable complemented, such as (A + B' + C). */
export function sumText(c: Cube, vars: readonly string[]): string {
  const n = vars.length;
  const parts: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const bit = n - 1 - i;
    if ((c.care >> bit) & 1) parts.push(`${vars[i]}${(c.value >> bit) & 1 ? "'" : ''}`);
  }
  return parts.length ? (parts.length === 1 ? parts[0] : `(${parts.join(' + ')})`) : '0';
}

export function termLatex(c: Cube, vars: readonly string[]): string {
  const n = vars.length;
  const parts: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const bit = n - 1 - i;
    if ((c.care >> bit) & 1) parts.push((c.value >> bit) & 1 ? vars[i] : `\\overline{${vars[i]}}`);
  }
  return parts.length ? parts.join('') : '1';
}

function primeImplicants(n: number, ons: readonly number[], steps: Step[]): Cube[] {
  const full = (1 << n) - 1;
  let current = new Map<string, Cube>(ons.map((m) => [`${m}/${full}`, { value: m, care: full }]));
  const primes: Cube[] = [];
  for (let size = 0; current.size > 0; size += 1) {
    const list = [...current.values()];
    const used = new Set<string>();
    const next = new Map<string, Cube>();
    for (let i = 0; i < list.length; i += 1)
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        const diff = (a.value ^ b.value) & a.care;
        if (a.care !== b.care || popcount(diff) !== 1) continue;
        const cube = { value: a.value & ~diff & full, care: a.care & ~diff };
        next.set(`${cube.value & cube.care}/${cube.care}`, { value: cube.value & cube.care, care: cube.care });
        used.add(`${a.value}/${a.care}`);
        used.add(`${b.value}/${b.care}`);
      }
    const kept = list.filter((c) => !used.has(`${c.value}/${c.care}`));
    primes.push(...kept);
    steps.push(step('combine', { size: 1 << size, count: list.length, primes: kept.length }));
    current = next;
  }
  return primes.sort((a, b) => literals(a, n) - literals(b, n) || b.care - a.care || a.value - b.value);
}

/** Petrick's method: the product of (sum of primes covering m) over minterms m, then multiplied out with absorption. */
function petrick(left: readonly number[], options: readonly Cube[], n: number): Cube[][] {
  let products: bigint[] = [0n];
  for (const m of left) {
    const choices = options.map((c, i) => (covers(c, m) ? 1n << BigInt(i) : 0n)).filter((b) => b !== 0n);
    const grown = new Set<bigint>();
    for (const p of products) for (const c of choices) grown.add(p | c);
    const sorted = [...grown].sort((a, b) => bits(a) - bits(b));
    products = sorted.filter((p, i) => !sorted.slice(0, i).some((q) => (q & p) === q));
    if (products.length > 4000) fail('tooHard');
  }
  const pick = (mask: bigint) => options.filter((_, i) => (mask >> BigInt(i)) & 1n);
  const score = (mask: bigint) => {
    const chosen = pick(mask);
    return [chosen.length, chosen.reduce((s, c) => s + literals(c, n), 0)];
  };
  const scored = products.map((p) => ({ p, s: score(p) }));
  const best = scored.reduce((b, x) => (x.s[0] < b[0] || (x.s[0] === b[0] && x.s[1] < b[1]) ? x.s : b), scored[0].s);
  return scored.filter((x) => x.s[0] === best[0] && x.s[1] === best[1]).map((x) => pick(x.p));
}

const bits = (b: bigint): number => {
  let c = 0;
  for (let v = b; v; v &= v - 1n) c += 1;
  return c;
};

export function checkTerms(n: number, ons: readonly number[], dcs: readonly number[]): void {
  if (n < 1 || n > MAX_VARS) fail('varCount', { max: MAX_VARS });
  for (const m of [...ons, ...dcs])
    if (!Number.isInteger(m) || m < 0 || m >= 1 << n) fail('termRange', { term: m, max: (1 << n) - 1 });
  const on = new Set(ons);
  for (const d of dcs) if (on.has(d)) fail('termTwice', { term: d });
}

/** Minimal sum-of-products covers of the function with these minterms and don't cares over n variables. */
export function minimize(n: number, ons: readonly number[], dcs: readonly number[] = []): Minimized {
  checkTerms(n, ons, dcs);
  const steps: Step[] = [];
  const onSet = [...new Set(ons)].sort((a, b) => a - b);
  if (onSet.length === 0) return { primes: [], essential: [], covers: [[]], chart: [], steps: [step('zero')] };
  const primes = primeImplicants(n, [...new Set([...onSet, ...dcs])], steps);
  const chart = primes.map((p) => onSet.filter((m) => covers(p, m)));
  const essential = primes.filter((_, i) => chart[i].some((m) => primes.filter((q) => covers(q, m)).length === 1));
  steps.push(step('essential', { count: essential.length }));
  const left = onSet.filter((m) => !essential.some((e) => covers(e, m)));
  const rest = primes.filter((p) => !essential.includes(p));
  const extra = left.length ? petrick(left, rest, n) : [[]];
  if (left.length) steps.push(step('petrick', { left: left.length, covers: extra.length }));
  const all = extra.map((more) => [...essential, ...more]);
  return { primes, essential, covers: all, chart, steps };
}

/** The complement's minterms, which give the maxterms for POS. */
export function maxterms(n: number, ons: readonly number[], dcs: readonly number[]): number[] {
  const skip = new Set([...ons, ...dcs]);
  return Array.from({ length: 1 << n }, (_, i) => i).filter((m) => !skip.has(m));
}
