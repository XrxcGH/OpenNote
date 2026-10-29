// Term symbols by enumerating microstates and extracting terms with the Slater table method, Hund's ground term,
// Landé g factors, Zeeman patterns, and the electric-dipole selection rules. Angular momenta are doubled (2J) where a
// half-whole value can occur.
import type { Calc, Item, Step } from '../shared/calc';
import { C } from '../shared/constants';
import { fixed } from '../shared/calc';
import { fail, positive } from '../shared/errors';
import { fmt, tex } from '../shared/format';
import { halfText } from '../spin/cg';
import type { AtomKey } from './hydrogen';

const LETTERS = 'SPDFGHIKLMNOQRTUV';
const SHELL = 'spdfg';
export const MAX_MICROSTATES = 20000;

export interface Subshell {
  n: number | null;
  l: number;
  count: number;
}

/** Reads a configuration such as p2, 2p4, d3, sp, 3d1 4s1. */
export function parseConfiguration(text: string): Subshell[] {
  const tokens = text
    .trim()
    .toLowerCase()
    .split(/[\s,.]+/)
    .filter(Boolean);
  if (tokens.length === 0) fail('badConfiguration');
  const out: Subshell[] = [];
  let rest = '';
  while (tokens.length > 0 || rest.length > 0) {
    if (rest.length === 0) rest = tokens.shift()!;
    const m = /^(\d+)?([spdfg])(\d+)?/.exec(rest);
    if (!m) fail('badConfiguration');
    const l = SHELL.indexOf(m[2]!);
    // A number before the letter is n and one after it is the count: 2p4 is n = 2 with four electrons.
    const count = m[3] === undefined ? 1 : Number(m[3]);
    const n = m[1] === undefined ? null : Number(m[1]);
    if (count < 1 || count > 2 * (2 * l + 1) || (n !== null && (n <= l || n > 10))) fail('badConfiguration');
    out.push({ n, l, count });
    rest = rest.slice(m[0].length);
  }
  if (out.length > 3) fail('badConfiguration');
  for (let i = 0; i < out.length; i += 1)
    for (let j = i + 1; j < out.length; j += 1)
      if (out[i]!.l === out[j]!.l && (out[i]!.n === out[j]!.n || out[i]!.n === null || out[j]!.n === null))
        fail('badConfiguration');
  return out;
}

const subshellText = (s: Subshell) => `${s.n ?? ''}${SHELL[s.l]}${s.count === 1 ? '' : s.count}`;

/** Every (2·ML, 2·MS) pair of one subshell's Pauli-allowed microstates. */
function shellStates(l: number, count: number): [number, number][] {
  const orbitals: [number, number][] = [];
  for (let ml = l; ml >= -l; ml -= 1) for (const ms of [1, -1]) orbitals.push([ml, ms]);
  const out: [number, number][] = [];
  const pick = (start: number, left: number, ml: number, ms: number) => {
    if (left === 0) {
      out.push([2 * ml, ms]);
      return;
    }
    for (let k = start; k <= orbitals.length - left; k += 1)
      pick(k + 1, left - 1, ml + orbitals[k]![0], ms + orbitals[k]![1]);
  };
  pick(0, count, 0, 0);
  return out;
}

export interface Term {
  /** Doubled L and S. */
  l2: number;
  s2: number;
}

export const termText = (t: Term, j2?: number) =>
  `${t.s2 + 1}${LETTERS[t.l2 / 2] ?? '?'}${j2 === undefined ? '' : halfText(j2)}`;

/** The terms of a configuration, the microstate count table, and the extraction order. */
export function terms(config: readonly Subshell[]): { terms: Term[]; table: Map<string, number>; total: number } {
  let states: [number, number][] = [[0, 0]];
  let total = 1;
  for (const shell of config) {
    const one = shellStates(shell.l, shell.count);
    total *= one.length;
    if (total > MAX_MICROSTATES) fail('tooManyMicrostates');
    const next: [number, number][] = [];
    for (const [a, b] of states) for (const [c, d] of one) next.push([a + c, b + d]);
    states = next;
  }
  const table = new Map<string, number>();
  for (const [ml, ms] of states) table.set(`${ml} ${ms}`, (table.get(`${ml} ${ms}`) ?? 0) + 1);
  const left = new Map(table);
  const found: Term[] = [];
  for (;;) {
    let best: [number, number] | null = null;
    for (const [key, count] of left) {
      if (count <= 0) continue;
      const [ml, ms] = key.split(' ').map(Number) as [number, number];
      if (!best || ml > best[0] || (ml === best[0] && ms > best[1])) best = [ml, ms];
    }
    if (!best) break;
    const [l2, s2] = best;
    found.push({ l2, s2 });
    for (let ml = -l2; ml <= l2; ml += 2)
      for (let ms = -s2; ms <= s2; ms += 2) left.set(`${ml} ${ms}`, (left.get(`${ml} ${ms}`) ?? 0) - 1);
  }
  return { terms: found, table, total };
}

/** Landé g_J = 1 + (J(J+1) + S(S+1) − L(L+1)) / (2J(J+1)), with doubled arguments; 0 when J = 0. */
export function landeG(l2: number, s2: number, j2: number): number {
  if (j2 === 0) return 0;
  const [L, S, J] = [l2 / 2, s2 / 2, j2 / 2];
  return 1 + (J * (J + 1) + S * (S + 1) - L * (L + 1)) / (2 * J * (J + 1));
}

/** Hund's ground term of one open subshell lⁿ: highest S, then highest L, then J by the shell's filling. */
export function hundGround(found: readonly Term[], shell: Subshell): { term: Term; j2: number } {
  const term = [...found].sort((a, b) => b.s2 - a.s2 || b.l2 - a.l2)[0]!;
  const half = 2 * shell.l + 1;
  const j2 = shell.count > half ? term.l2 + term.s2 : Math.abs(term.l2 - term.s2);
  return { term, j2 };
}

/** The terms of a configuration with each term's levels, Hund's ground level, and the microstate table. */
export function termCalc(config: readonly Subshell[]): Calc<AtomKey> {
  const { terms: found, table, total } = terms(config);
  const open = config.filter((s) => s.count < 2 * (2 * s.l + 1));
  const sorted = [...found].sort((a, b) => b.s2 - a.s2 || b.l2 - a.l2);
  const levels = (t: Term) => {
    const out: number[] = [];
    for (let j2 = Math.abs(t.l2 - t.s2); j2 <= t.l2 + t.s2; j2 += 2) out.push(j2);
    return out;
  };
  const items: Item<AtomKey>[] = [
    { key: 'terms', value: found.length, unit: '', text: sorted.map((t) => termText(t)).join(', ') },
  ];
  if (open.length <= 1) {
    const shell = open[0] ?? config[0]!;
    const ground = open.length === 0 ? { term: { l2: 0, s2: 0 }, j2: 0 } : hundGround(found, shell);
    items.push({ key: 'ground', value: ground.j2 / 2, unit: '', text: termText(ground.term, ground.j2) });
    items.push(fixed('landeG', landeG(ground.term.l2, ground.term.s2, ground.j2), '', 6));
  }
  for (const t of sorted)
    items.push({
      key: 'level',
      value: t.l2,
      unit: '',
      text: `${termText(t)}: ${levels(t)
        .map((j2) => `${termText(t, j2)} (g = ${fmt(landeG(t.l2, t.s2, j2), 4)})`)
        .join(', ')}`,
    });
  items.push(fixed('microstates', total, '', 6));
  const keys = [...table.keys()].map((key) => key.split(' ').map(Number) as [number, number]);
  const mls = [...new Set(keys.map(([ml]) => ml))].filter((ml) => ml >= 0).sort((a, b) => b - a);
  const steps: Step<AtomKey>[] = [
    {
      key: 'table',
      text:
        `${config.map(subshellText).join(' ')}: ${total} microstates. Count by (M_L, M_S) with M_L ≥ 0: ` +
        mls
          .map(
            (ml) =>
              `M_L = ${ml / 2}: ` +
              keys
                .filter(([a]) => a === ml)
                .sort((a, b) => b[1] - a[1])
                .map(([, ms]) => `${halfText(ms)}×${table.get(`${ml} ${ms}`)}`)
                .join(' '),
          )
          .join('; '),
    },
    {
      key: 'extract',
      text: `Take the largest M_L, then the largest M_S, as a term's L and S, strike its (2L+1)(2S+1) states, and repeat: ${found
        .map((t) => termText(t))
        .join(' → ')}`,
    },
  ];
  if (open.length <= 1)
    steps.push({
      key: 'ground',
      text: 'Hund: the highest S, then the highest L; J = |L − S| for a shell less than half full and L + S for more.',
    });
  return { items, steps };
}

export interface Level {
  l2: number;
  s2: number;
  j2: number;
  odd: boolean;
}

/** Reads a level such as 2P3/2, 3P2, or 2Po3/2 (o or ° marks odd parity). */
export function parseLevel(text: string): Level {
  const m = /^(\d+)([A-Z])\s*([o°])?\s*(\d+)(?:\/(2))?$/.exec(text.trim().replace(/\s+/g, ''));
  if (!m) fail('badLevel');
  const s2 = Number(m[1]) - 1;
  const l2 = 2 * LETTERS.indexOf(m[2]!);
  const j2 = m[5] ? Number(m[4]) : 2 * Number(m[4]);
  if (s2 < 0 || l2 < 0 || j2 < Math.abs(l2 - s2) || j2 > l2 + s2 || (j2 - l2 - s2) % 2 !== 0) fail('badLevel');
  return { l2, s2, j2, odd: m[3] !== undefined };
}

const levelText = (v: Level) => `${v.s2 + 1}${LETTERS[v.l2 / 2]}${v.odd ? '°' : ''}${halfText(v.j2)}`;

/** The Zeeman pattern of a line between two levels in a weak field B (T): shifts μB·B (g_u M_u − g_l M_l). */
export function zeeman(upper: Level, lower: Level, b: number): Calc<AtomKey> {
  positive(b, 'field');
  const gu = landeG(upper.l2, upper.s2, upper.j2);
  const gl = landeG(lower.l2, lower.s2, lower.j2);
  const unit = (C.muB * b) / C.e;
  const lines: { shift: number; dm: number; text: string }[] = [];
  for (let mu = -upper.j2; mu <= upper.j2; mu += 2)
    for (let ml = -lower.j2; ml <= lower.j2; ml += 2) {
      const dm = (mu - ml) / 2;
      if (Math.abs(dm) > 1) continue;
      const shift = unit * ((gu * mu) / 2 - (gl * ml) / 2);
      lines.push({ shift, dm, text: `${halfText(mu)} → ${halfText(ml)}` });
    }
  const distinct = [...new Map(lines.map((one) => [`${one.dm} ${one.shift.toPrecision(9)}`, one])).values()].sort(
    (a, b) => a.shift - b.shift,
  );
  const items: Item<AtomKey>[] = [
    fixed('gUpper', gu, '', 6),
    fixed('gLower', gl, '', 6),
    ...distinct.map((one) => ({
      key: 'line' as const,
      value: one.shift,
      unit: 'eV',
      text: `${one.dm === 0 ? 'π' : 'σ'} ${one.text}: ${fmt(one.shift, 5)} eV (${fmt(one.shift / unit, 4)} μB·B)`,
    })),
  ];
  return {
    items,
    steps: [
      {
        key: 'gUpper',
        text:
          `g_J = 1 + (J(J+1) + S(S+1) − L(L+1)) / (2J(J+1)): g(${levelText(upper)}) = ${fmt(gu, 6)}, ` +
          `g(${levelText(lower)}) = ${fmt(gl, 6)}`,
        tex: `g_J = 1 + \\frac{J(J+1) + S(S+1) - L(L+1)}{2J(J+1)}`,
      },
      {
        key: 'line',
        text: `ΔE = μB·B (g_u M_u − g_l M_l) with ΔM = 0 (π) or ±1 (σ); μB·B = ${fmt(unit, 6)} eV; ${distinct.length} lines`,
        tex: `\\Delta E = \\mu_B B\\,(g_u M_u - g_l M_l) = ${tex(unit, 6)}\\ \\mathrm{eV} \\times (g_u M_u - g_l M_l)`,
      },
    ],
    plot: {
      title: 'zeemanPlot',
      xLabel: 'shiftAxis',
      yLabel: 'strengthAxis',
      series: [
        {
          points: distinct.filter((d) => d.dm === 0).map((d) => [d.shift / unit, 1]),
          kind: 'sticks',
          tone: 0,
          label: 'π',
        },
        {
          points: distinct.filter((d) => d.dm !== 0).map((d) => [d.shift / unit, 0.7]),
          kind: 'sticks',
          tone: 1,
          label: 'σ',
        },
      ],
      y: [0, 1.2],
    },
  };
}

export type Rule = 'parity' | 'deltaJ' | 'zeroJ' | 'deltaS' | 'deltaL' | 'zeroL';

/** The electric-dipole rules between two levels in LS coupling: which hold and which are broken. */
export function selection(a: Level, b: Level): { allowed: boolean; broken: Rule[] } {
  const broken: Rule[] = [];
  if (a.odd === b.odd) broken.push('parity');
  if (Math.abs(a.j2 - b.j2) > 2) broken.push('deltaJ');
  if (a.j2 === 0 && b.j2 === 0) broken.push('zeroJ');
  if (a.s2 !== b.s2) broken.push('deltaS');
  if (Math.abs(a.l2 - b.l2) > 2) broken.push('deltaL');
  if (a.l2 === 0 && b.l2 === 0) broken.push('zeroL');
  return { allowed: broken.length === 0, broken };
}

export { levelText };
