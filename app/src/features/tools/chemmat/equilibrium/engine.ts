// Chemical equilibrium: an ICE table solved exactly for the extent of reaction, solubility from Ksp with a common ion,
// and the conversion between Kc and Kp. Concentrations are mol/L (Kc) or partial pressures in bar (Kp); the solver
// does not care which, so the same numbers serve both.
import { latexNumber, latexSpecies, parseNamedValues, plain } from '../chemText';
import { R_LBAR } from '../constants';
import { bracketScan, brent } from '../num';
import { fail } from '../types';
import type { Failed, KitStep, Outcome, Row, Solved } from '../types';

export interface Part {
  name: string;
  /** Negative for a reactant, positive for a product. */
  nu: number;
  /** A pure solid or liquid takes no part in the K expression. */
  pure: boolean;
}

export function parseEquilibrium(text: string): Part[] | null {
  const sides = text.split(/\s*(?:<->|<=>|⇌|⇄|->|→|=)\s*/);
  if (sides.length !== 2) return null;
  const parts: Part[] = [];
  for (const [i, side] of sides.entries()) {
    for (const term of side.split(/\s+\+\s+/).map((s) => s.trim())) {
      const m = /^(\d+(?:\.\d+)?)?\s*(\S.*)$/.exec(term);
      if (!m) return null;
      const name = m[2].replace(/\s+/g, '');
      const coefficient = m[1] ? Number(m[1]) : 1;
      if (!(coefficient > 0)) return null;
      parts.push({ name, nu: i === 0 ? -coefficient : coefficient, pure: /\((?:s|l)\)$/.test(name) });
    }
  }
  return parts;
}

export interface IceInput {
  reaction: string;
  /** Equilibrium constant, dimensionless, from the same basis as the amounts (Kc with mol/L, Kp with bar). */
  K: number;
  /** "name = value" lines; a species left out starts at zero. */
  initial: string;
  /** The unit shown after concentrations. */
  unit: string;
}

const exponent = (n: number) => (Math.abs(n) === 1 ? '' : `^{${Math.abs(n)}}`);

/** The K expression for the species of one side as LaTeX. */
function expression(parts: Part[], side: 'products' | 'reactants'): string {
  const mine = parts.filter((p) => !p.pure && (side === 'products' ? p.nu > 0 : p.nu < 0));
  if (mine.length === 0) return '1';
  return mine.map((p) => `[${latexSpecies(p.name)}]${exponent(p.nu)}`).join('\\,');
}

/** Q = products / reactants for the amounts, or null when the product of the reactants is zero. */
function quotient(parts: Part[], amounts: number[]): number | null {
  let num = 1;
  let den = 1;
  parts.forEach((p, i) => {
    if (p.pure) return;
    if (p.nu > 0) num *= Math.pow(amounts[i], p.nu);
    else den *= Math.pow(amounts[i], -p.nu);
  });
  return den === 0 ? null : num / den;
}

interface Problem {
  parts: Part[];
  c0: number[];
  K: number;
}

function readProblem(input: IceInput): Problem | Failed {
  if (!Number.isFinite(input.K) || input.K <= 0) return fail('kitChemMat.eq.err.K');
  const parts = parseEquilibrium(input.reaction);
  if (!parts) return fail('kitChemMat.eq.err.format');
  const named = parseNamedValues(input.initial);
  if (!named) return fail('kitChemMat.eq.err.initial');
  for (const key of named.keys()) {
    if (!parts.some((p) => p.name === key)) return fail('kitChemMat.eq.err.unknownInitial', { name: key });
  }
  const c0 = parts.map((p) => named.get(p.name) ?? 0);
  if (c0.some((c) => c < 0)) return fail('kitChemMat.eq.err.negative');
  return { parts, c0, K: input.K };
}

/** The range of the extent x in which no amount goes below zero. */
function extentRange(p: Problem): { lo: number; hi: number } | null {
  let lo = -Infinity;
  let hi = Infinity;
  p.parts.forEach((part, i) => {
    if (part.pure) return;
    if (part.nu < 0) hi = Math.min(hi, p.c0[i] / -part.nu);
    else lo = Math.max(lo, -p.c0[i] / part.nu);
  });
  if (!(hi > lo)) return null;
  if (!Number.isFinite(lo)) lo = -hi;
  if (!Number.isFinite(hi)) hi = Math.max(1, p.K, Math.sqrt(p.K), -lo) * 1e3;
  return { lo, hi };
}

const amountsAt = (p: Problem, x: number) =>
  p.parts.map((part, i) => (part.pure ? 0 : Math.max(0, p.c0[i] + part.nu * x)));

/** The root of products - K * reactants over the allowed range. The quotient rises with x, so there is one root. */
function solveExtent(p: Problem, lo: number, hi: number): number | null {
  const f = (x: number) => {
    const c = amountsAt(p, x);
    let prod = 1;
    let reac = 1;
    p.parts.forEach((part, i) => {
      if (part.pure) return;
      if (part.nu > 0) prod *= Math.pow(c[i], part.nu);
      else reac *= Math.pow(c[i], -part.nu);
    });
    return prod - p.K * reac;
  };
  const roots = bracketScan(f, lo, hi, 2000);
  if (roots.length > 0) return roots[0];
  return brent(f, lo, hi);
}

function directionOf(q0: number | null, K: number) {
  if (q0 === null || q0 < K * (1 - 1e-12)) return 'kitChemMat.eq.forward' as const;
  return q0 > K * (1 + 1e-12) ? ('kitChemMat.eq.reverse' as const) : ('kitChemMat.eq.already' as const);
}

/** Whether the small-x shortcut would have held: the most any reactant is used up, as a percent of its start. */
function approximation(p: Problem, x: number): Row {
  const used = p.parts
    .map((part, i) => ({ part, i }))
    .filter(({ part, i }) => part.nu < 0 && !part.pure && p.c0[i] > 0)
    .map(({ part, i }) => Math.abs(((-part.nu * x) / p.c0[i]) * 100));
  const worst = used.length === 0 ? 0 : Math.max(...used);
  const word =
    used.length === 0
      ? ('kitChemMat.eq.approxNA' as const)
      : worst < 5
        ? ('kitChemMat.eq.approxOk' as const)
        : ('kitChemMat.eq.approxBad' as const);
  return { key: 'kitChemMat.eq.row.approx', value: '', word, wordVars: { percent: plain(worst, 3) } };
}

function iceRows(p: Problem, x: number, eq: number[], unit: string): Row[] {
  const live = p.parts.map((part, i) => ({ part, i })).filter(({ part }) => !part.pure);
  const qEq = quotient(p.parts, eq);
  const q0 = quotient(p.parts, p.c0);
  return [
    { key: 'kitChemMat.eq.row.x', value: x, unit, digits: 6 },
    ...live.map(({ part, i }): Row => ({
      key: 'kitChemMat.eq.row.species',
      keyVars: { name: part.name },
      value: eq[i],
      unit,
      digits: 6,
    })),
    { key: 'kitChemMat.eq.row.Qcheck', value: qEq ?? NaN, digits: 6 },
    { key: 'kitChemMat.eq.row.direction', value: '', word: directionOf(q0, p.K) },
    approximation(p, x),
  ];
}

/** The mass-action equation with the equilibrium amounts written in terms of x. */
function substitution(p: Problem): string {
  const term = (part: Part, i: number) => {
    const sign = part.nu > 0 ? '+' : '-';
    const k = Math.abs(part.nu) === 1 ? '' : String(Math.abs(part.nu));
    return `(${plain(p.c0[i])}${sign}${k}x)${exponent(part.nu).replace('^{1}', '')}`;
  };
  const side = (positive: boolean) =>
    p.parts
      .map((part, i) => ({ part, i }))
      .filter(({ part }) => !part.pure && part.nu > 0 === positive)
      .map(({ part, i }) => term(part, i))
      .join('');
  return `\\frac{${side(true)}}{${side(false)}}=${latexNumber(p.K, 5)}`;
}

function iceSteps(p: Problem, x: number, qEq: number | null, range: { lo: number; hi: number }): KitStep[] {
  const expr = `K=\\frac{${expression(p.parts, 'products')}}{${expression(p.parts, 'reactants')}}`;
  return [
    { key: 'kitChemMat.eq.step.expression', math: `${expr}=${latexNumber(p.K, 5)}` },
    { key: 'kitChemMat.eq.step.ice' },
    { key: 'kitChemMat.eq.step.substitute', math: substitution(p) },
    {
      key: 'kitChemMat.eq.step.root',
      vars: { x: plain(x, 6), lo: plain(range.lo, 4), hi: plain(range.hi, 4) },
    },
    {
      key: 'kitChemMat.eq.step.check',
      math: `Q=${latexNumber(qEq ?? NaN, 6)}\\approx K=${latexNumber(p.K, 6)}`,
    },
  ];
}

function iceTableData(p: Problem, eq: number[]): NonNullable<Solved['tables']>[number] {
  const live = p.parts.map((part, i) => ({ part, i })).filter(({ part }) => !part.pure);
  const change = ({ part }: { part: Part }) =>
    `${part.nu > 0 ? '+' : '−'}${Math.abs(part.nu) === 1 ? '' : Math.abs(part.nu)}x`;
  return {
    title: 'kitChemMat.eq.table.title',
    header: ['', ...live.map(({ part }) => part.name)],
    rows: [
      ['kitChemMat.eq.table.initial', ...live.map(({ i }) => plain(p.c0[i], 5))],
      ['kitChemMat.eq.table.change', ...live.map(change)],
      ['kitChemMat.eq.table.equilibrium', ...live.map(({ i }) => plain(eq[i], 5))],
    ],
  };
}

export function iceTable(input: IceInput): Outcome {
  const p = readProblem(input);
  if ('ok' in p) return p;
  const range = extentRange(p);
  if (!range) return fail('kitChemMat.eq.err.noRoom');
  const x = solveExtent(p, range.lo, range.hi);
  if (x === null) return fail('kitChemMat.eq.err.noRoot');
  const eq = amountsAt(p, x);
  const qEq = quotient(p.parts, eq);
  return {
    ok: true,
    rows: iceRows(p, x, eq, input.unit),
    steps: iceSteps(p, x, qEq, range),
    notes: [{ key: 'kitChemMat.eq.note.ideal' }, { key: 'kitChemMat.eq.note.pure' }],
    equation: `K=\\frac{${expression(p.parts, 'products')}}{${expression(p.parts, 'reactants')}}`,
    tables: [iceTableData(p, eq)],
  };
}

export interface KspInput {
  Ksp: number;
  /** Cations per formula unit. */
  a: number;
  /** Anions per formula unit. */
  b: number;
  /** Concentration of the cation already in solution, mol/L. */
  cA: number;
  /** Concentration of the anion already in solution, mol/L. */
  cB: number;
}

function saturated(): Outcome {
  return {
    ok: true,
    rows: [
      { key: 'kitChemMat.eq.row.solubility', value: 0, unit: 'mol/L' },
      { key: 'kitChemMat.eq.row.precip', value: '', word: 'kitChemMat.eq.precipYes' },
    ],
    steps: [{ key: 'kitChemMat.eq.step.alreadySaturated' }],
    notes: [{ key: 'kitChemMat.eq.note.ideal' }],
  };
}

export function solubility(input: KspInput): Outcome {
  const { Ksp, a, b, cA, cB } = input;
  if (!Number.isFinite(Ksp) || Ksp <= 0) return fail('kitChemMat.eq.err.K');
  if (!(a >= 1) || !(b >= 1) || !Number.isInteger(a) || !Number.isInteger(b)) return fail('kitChemMat.eq.err.ions');
  if (cA < 0 || cB < 0 || !Number.isFinite(cA) || !Number.isFinite(cB)) return fail('kitChemMat.eq.err.negative');
  const f = (s: number) => Math.pow(a * s + cA, a) * Math.pow(b * s + cB, b) - Ksp;
  if (f(0) >= 0) return saturated();
  let hi = 1e-12;
  while (f(hi) < 0 && hi < 1e12) hi *= 2;
  const s = brent(f, 0, hi);
  if (s === null) return fail('kitChemMat.eq.err.noRoot');
  const ca = a * s + cA;
  const cb = b * s + cB;
  const power = (n: number) => (n === 1 ? '' : `^{${n}}`);
  return {
    ok: true,
    rows: [
      { key: 'kitChemMat.eq.row.solubility', value: s, unit: 'mol/L', digits: 5 },
      { key: 'kitChemMat.eq.row.cation', value: ca, unit: 'mol/L', digits: 5 },
      { key: 'kitChemMat.eq.row.anion', value: cb, unit: 'mol/L', digits: 5 },
      { key: 'kitChemMat.eq.row.Qcheck', value: Math.pow(ca, a) * Math.pow(cb, b), digits: 6 },
    ],
    steps: [
      {
        key: 'kitChemMat.eq.step.ksp',
        math: [
          `K_{\\mathrm{sp}}=[\\mathrm{A}]${power(a)}[\\mathrm{B}]${power(b)}`,
          `=(${a}s+${plain(cA)})${power(a)}(${b}s+${plain(cB)})${power(b)}=${latexNumber(Ksp, 4)}`,
        ].join(''),
      },
      { key: 'kitChemMat.eq.step.kspRoot', math: `s=${latexNumber(s, 5)}\\ \\mathrm{mol/L}` },
    ],
    notes: [{ key: 'kitChemMat.eq.note.ideal' }, { key: 'kitChemMat.eq.note.noComplex' }],
    equation: 'K_{\\mathrm{sp}}=[\\mathrm{A}]^{a}[\\mathrm{B}]^{b}',
  };
}

export interface ConvertInput {
  K: number;
  /** Moles of gas produced minus consumed. */
  dn: number;
  /** Temperature, K. */
  T: number;
  /** 'toKp' converts a Kc in mol/L to a Kp in bar; 'toKc' the reverse. */
  direction: string;
}

export function kcKp(input: ConvertInput): Outcome {
  const { K, dn, T } = input;
  if (!Number.isFinite(K) || K <= 0) return fail('kitChemMat.eq.err.K');
  if (!Number.isFinite(T) || T <= 0) return fail('kitChemMat.err.temperature');
  if (!Number.isFinite(dn)) return fail('kitChemMat.eq.err.dn');
  const factor = Math.pow(R_LBAR * T, dn);
  const toKp = input.direction !== 'toKc';
  const out = toKp ? K * factor : K / factor;
  return {
    ok: true,
    rows: [
      { key: toKp ? 'kitChemMat.eq.row.Kp' : 'kitChemMat.eq.row.Kc', value: out, digits: 5 },
      { key: 'kitChemMat.eq.row.factor', value: factor, digits: 5 },
    ],
    steps: [
      {
        key: 'kitChemMat.eq.step.kcp',
        math: 'K_p=K_c\\,(RT)^{\\Delta n},\\quad R=0.0831446\\ \\mathrm{L\\,bar\\,mol^{-1}\\,K^{-1}}',
      },
      {
        key: 'kitChemMat.eq.step.kcpNumbers',
        math: `(RT)^{\\Delta n}=(${plain(R_LBAR, 6)}\\times${plain(T)})^{${plain(dn)}}=${latexNumber(factor, 5)}`,
      },
    ],
    notes: [{ key: 'kitChemMat.eq.note.ideal' }, { key: 'kitChemMat.eq.note.kcpUnits' }],
    equation: 'K_p=K_c\\,(RT)^{\\Delta n}',
  };
}
