// Electrochemistry: standard potentials from Gibbs energies of formation, cells with the Nernst equation (including
// concentration cells), dG = -nFE and K, and Faraday's laws for electrolysis.
import { molarMass, parseFormula } from '../../chem/calc/formula';
import { latexNumber, latexSpecies, parseNamedValues, plain } from '../chemText';
import { F, R } from '../constants';
import { HALF_REACTIONS, PRODUCTS } from '../data/halfReactions';
import type { HalfReaction, HalfTerm } from '../data/halfReactions';
import { findSpecies, gibbsOfFormation } from '../data/species';
import { fail } from '../types';
import type { KitStep, Outcome, Row } from '../types';

export const halfById = (id: string): HalfReaction | undefined => HALF_REACTIONS.find((h) => h.id === id);

function gf(term: HalfTerm): number | null {
  const sp = findSpecies(term.formula, term.phase);
  const counts = parseFormula(term.formula);
  if (!sp || !counts) return null;
  return gibbsOfFormation(sp, counts);
}

/** Standard reduction potential (V) of a half-reaction and its Gibbs energy (J/mol), from formation Gibbs energies. */
export function standardPotential(half: HalfReaction): { E: number; dG: number } {
  let dG = 0;
  for (const p of half.prod) dG += p.coefficient * (gf(p) ?? NaN);
  for (const r of half.react) dG -= r.coefficient * (gf(r) ?? NaN);
  dG *= 1000;
  return { E: -dG / (half.n * F), dG };
}

const coef = (n: number) => (n === 1 ? '' : String(n));

export const halfText = (half: HalfReaction): string => {
  const side = (terms: HalfTerm[]) => terms.map((x) => `${coef(x.coefficient)}${x.formula}(${x.phase})`).join(' + ');
  return `${side(half.react)} + ${half.n} e- -> ${side(half.prod)}`;
};

const termLatex = (x: HalfTerm) => `${coef(x.coefficient)}${latexSpecies(x.formula)}\\mathrm{(${x.phase})}`;

const halfLatex = (half: HalfReaction): string => {
  const side = (terms: HalfTerm[]) => terms.map((x) => termLatex(x)).join('+');
  return `${side(half.react)}+${half.n}\\,e^-\\rightarrow ${side(half.prod)}`;
};

/** The activity of a species: concentration (mol/L) for ions, pressure (bar) for gases, one for solids and liquids. */
function activity(term: HalfTerm, given: Map<string, number>): number {
  if (term.phase === 's' || term.phase === 'l') return 1;
  return given.get(term.formula) ?? 1;
}

function reductionQuotient(half: HalfReaction, given: Map<string, number>): number {
  let q = 1;
  for (const p of half.prod) q *= Math.pow(activity(p, given), p.coefficient);
  for (const r of half.react) q /= Math.pow(activity(r, given), r.coefficient);
  return q;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const lcm = (a: number, b: number) => (a * b) / gcd(a, b);

export interface CellInput {
  /** Ids of the two half-reactions; the one with the higher potential is the cathode. */
  a: string;
  b: string;
  /** "name = amount" lists for each half-cell, in mol/L or bar; unlisted species are one. */
  concA: string;
  concB: string;
  /** Temperature, K. */
  T: number;
}

/** One half-cell worked out: its reaction, standard potential, amounts, and potential at those amounts. */
interface HalfCell {
  half: HalfReaction;
  E0: number;
  given: Map<string, number>;
  E: number;
}

function workHalf(half: HalfReaction, given: Map<string, number>, T: number): HalfCell {
  const E0 = standardPotential(half).E;
  const E = E0 - ((R * T) / (half.n * F)) * Math.log(reductionQuotient(half, given));
  return { half, E0, given, E };
}

/** The cell in the notation students write: anode | ion || ion | cathode. */
function notation(c: HalfCell): string {
  const all = c.half.react.concat(c.half.prod);
  const ion = all.find((x) => x.phase === 'aq');
  const solid = all.find((x) => x.phase !== 'aq');
  const conc = ion ? (c.given.get(ion.formula) ?? 1) : 1;
  return `${solid ? `${solid.formula}(${solid.phase})` : ''} | ${ion ? ion.formula : ''}(${plain(conc, 3)})`.trim();
}

/** The overall reaction as LaTeX: cathode times kc, anode reversed times ka, with species on both sides canceled. */
function overallReaction(cath: HalfReaction, anod: HalfReaction, kc: number, ka: number): string {
  const net = new Map<string, { term: HalfTerm; c: number }>();
  const add = (terms: HalfTerm[], scale: number) => {
    for (const x of terms) {
      const key = `${x.formula}(${x.phase})`;
      const cur = net.get(key) ?? { term: x, c: 0 };
      cur.c += x.coefficient * scale;
      net.set(key, cur);
    }
  };
  add(cath.prod, kc);
  add(cath.react, -kc);
  add(anod.react, ka);
  add(anod.prod, -ka);
  const side = (sign: number) =>
    [...net.values()]
      .filter((v) => Math.sign(v.c) === sign && Math.abs(v.c) > 1e-12)
      .map((v) => termLatex({ ...v.term, coefficient: Math.abs(v.c) }))
      .join('+');
  return `${side(-1)}\\rightarrow ${side(1)}`;
}

interface CellResult {
  cath: HalfCell;
  anod: HalfCell;
  E: number;
  E0: number;
  n: number;
  kc: number;
  ka: number;
  Q: number;
  dG0: number;
  dG: number;
  lnK: number;
}

function solveCell(a: HalfCell, b: HalfCell, T: number): CellResult {
  const [cath, anod] = a.E >= b.E ? [a, b] : [b, a];
  const E = cath.E - anod.E;
  const E0 = cath.E0 - anod.E0;
  const n = lcm(cath.half.n, anod.half.n);
  const kc = n / cath.half.n;
  const ka = n / anod.half.n;
  const qc = Math.pow(reductionQuotient(cath.half, cath.given), kc);
  const qa = Math.pow(reductionQuotient(anod.half, anod.given), ka);
  return { cath, anod, E, E0, n, kc, ka, Q: qc / qa, dG0: -n * F * E0, dG: -n * F * E, lnK: (n * F * E0) / (R * T) };
}

function cellRows(r: CellResult): Row[] {
  const word = r.E > 0 ? 'kitChemMat.ec.galvanic' : r.E < 0 ? 'kitChemMat.ec.electrolytic' : 'kitChemMat.ec.zero';
  return [
    { key: 'kitChemMat.ec.row.cathode', value: halfText(r.cath.half) },
    { key: 'kitChemMat.ec.row.anode', value: halfText(r.anod.half) },
    { key: 'kitChemMat.ec.row.E0', value: r.E0, unit: 'V', digits: 5 },
    { key: 'kitChemMat.ec.row.E', value: r.E, unit: 'V', digits: 5 },
    { key: 'kitChemMat.ec.row.n', value: r.n, digits: 3 },
    { key: 'kitChemMat.ec.row.Q', value: r.Q, digits: 4 },
    { key: 'kitChemMat.ec.row.dG0', value: r.dG0, dim: 'energyMol' },
    { key: 'kitChemMat.ec.row.dG', value: r.dG, dim: 'energyMol' },
    { key: 'kitChemMat.ec.row.K', value: r.lnK > 700 ? Infinity : Math.exp(r.lnK), digits: 4 },
    { key: 'kitChemMat.ec.row.lnK', value: r.lnK, digits: 5 },
    { key: 'kitChemMat.ec.row.spont', value: '', word },
    { key: 'kitChemMat.ec.row.notation', value: `${notation(r.anod)} || ${notation(r.cath)}` },
  ];
}

function cellSteps(r: CellResult, T: number): KitStep[] {
  const v = (x: number) => plain(x, 5);
  const times = (k: number) => (k === 1 ? '' : `${k}\\times\\ `);
  return [
    {
      key: 'kitChemMat.ec.step.cathode',
      vars: { id: r.cath.half.id },
      math: `${halfLatex(r.cath.half)},\\quad E^\\circ=${v(r.cath.E0)}\\ \\mathrm{V}`,
    },
    {
      key: 'kitChemMat.ec.step.anode',
      vars: { id: r.anod.half.id },
      math: `${halfLatex(r.anod.half)},\\quad E^\\circ=${v(r.anod.E0)}\\ \\mathrm{V}`,
    },
    {
      key: 'kitChemMat.ec.step.balance',
      math: [
        `${times(r.kc)}(\\text{cathode})+${times(r.ka)}(\\text{reversed anode}):\\quad `,
        overallReaction(r.cath.half, r.anod.half, r.kc, r.ka),
      ].join(''),
    },
    {
      key: 'kitChemMat.ec.step.E0',
      math: [
        'E^\\circ_{\\mathrm{cell}}=E^\\circ_{\\mathrm{cathode}}-E^\\circ_{\\mathrm{anode}}',
        `=${v(r.cath.E0)}-(${v(r.anod.E0)})=${v(r.E0)}\\ \\mathrm{V}`,
      ].join(''),
    },
    {
      key: 'kitChemMat.ec.step.nernst',
      math: [
        `E=E^\\circ-\\frac{RT}{nF}\\ln Q=${v(r.E0)}`,
        `-\\frac{(${plain(R, 6)})(${plain(T, 5)})}{(${r.n})(${plain(F, 7)})}\\ln(${latexNumber(r.Q, 4)})`,
        `=${v(r.E)}\\ \\mathrm{V}`,
      ].join(''),
    },
    {
      key: 'kitChemMat.ec.step.dG',
      math: [
        `\\Delta G^\\circ=-nFE^\\circ=-(${r.n})(${plain(F, 7)})(${v(r.E0)})=${plain(r.dG0 / 1000, 5)}\\ \\mathrm{kJ}`,
        `,\\quad K=e^{nFE^\\circ/RT}=${latexNumber(Math.exp(Math.min(r.lnK, 700)), 4)}`,
      ].join(''),
    },
  ];
}

export function cell(input: CellInput): Outcome {
  const ha = halfById(input.a);
  const hb = halfById(input.b);
  if (!ha || !hb) return fail('kitChemMat.ec.err.half');
  if (!Number.isFinite(input.T) || input.T <= 0) return fail('kitChemMat.err.temperature');
  const ga = parseNamedValues(input.concA);
  const gb = parseNamedValues(input.concB);
  if (!ga || !gb) return fail('kitChemMat.ec.err.conc');
  for (const m of [ga, gb]) for (const x of m.values()) if (!(x > 0)) return fail('kitChemMat.ec.err.concPositive');
  const a = workHalf(ha, ga, input.T);
  const b = workHalf(hb, gb, input.T);
  if (!Number.isFinite(a.E0) || !Number.isFinite(b.E0)) return fail('kitChemMat.ec.err.half');
  const r = solveCell(a, b, input.T);
  return {
    ok: true,
    rows: cellRows(r),
    steps: cellSteps(r, input.T),
    notes: [
      { key: 'kitChemMat.ec.note.source' },
      { key: 'kitChemMat.ec.note.activity' },
      ...(ha.id === hb.id ? [{ key: 'kitChemMat.ec.note.concentration' as const }] : []),
    ],
    equation: 'E=E^\\circ-\\frac{RT}{nF}\\ln Q,\\qquad \\Delta G^\\circ=-nFE^\\circ',
    sources: [
      'CODATA Key Values for Thermodynamics (Cox, Wagman, Medvedev, 1989)',
      'NBS Tables of Chemical Thermodynamic Properties (Wagman et al., 1982)',
    ],
  };
}

export interface ElectrolysisInput {
  product: string;
  /** What to find: 'mass' from current and time, or 'time' from current and mass. */
  find: string;
  /** Current, A. */
  I: number;
  /** Time, s. */
  t: number;
  /** Mass, g (for 'time'). */
  m: number;
  /** Current efficiency, percent. */
  efficiency: number;
}

function faradaySteps(input: ElectrolysisInput, n: number, M: number, answer: { t: number; m: number }): KitStep[] {
  const eta = input.efficiency / 100;
  const math =
    input.find === 'time'
      ? [
          `t=\\frac{m\\,n\\,F}{\\eta\\,I\\,M}=\\frac{(${plain(input.m)})(${n})(${plain(F, 7)})}`,
          `{(${plain(eta)})(${plain(input.I)})(${plain(M, 6)})}=${plain(answer.t, 5)}\\ \\mathrm{s}`,
        ]
      : [
          `m=\\frac{(${plain(eta)})(${plain(input.I)})(${plain(input.t)})(${plain(M, 6)})}`,
          `{(${n})(${plain(F, 7)})}=${plain(answer.m, 5)}\\ \\mathrm{g}`,
        ];
  return [
    { key: 'kitChemMat.ec.step.faraday', math: 'm=\\frac{\\eta\\,I\\,t\\,M}{n\\,F}' },
    { key: 'kitChemMat.ec.step.faradayNumbers', math: math.join('') },
  ];
}

export function electrolysis(input: ElectrolysisInput): Outcome {
  const prod = PRODUCTS.find((p) => p.id === input.product);
  const M = prod ? molarMass(prod.formula) : null;
  if (!prod || M === null) return fail('kitChemMat.ec.err.product');
  const { I, efficiency } = input;
  if (!(I > 0) || !Number.isFinite(I)) return fail('kitChemMat.ec.err.current');
  if (!(efficiency > 0) || efficiency > 100) return fail('kitChemMat.ec.err.efficiency');
  const eta = efficiency / 100;
  const perCharge = (eta * M) / (prod.n * F); // grams per coulomb
  const findTime = input.find === 'time';
  if (findTime && (!(input.m > 0) || !Number.isFinite(input.m))) return fail('kitChemMat.ec.err.mass');
  if (!findTime && (!(input.t >= 0) || !Number.isFinite(input.t))) return fail('kitChemMat.ec.err.time');
  const Q = findTime ? input.m / perCharge : I * input.t;
  const t = Q / I;
  const m = Q * perCharge;
  const rows: Row[] = [
    { key: 'kitChemMat.ec.row.charge', value: Q, unit: 'C', digits: 5 },
    findTime
      ? { key: 'kitChemMat.ec.row.time', value: t, dim: 'time', digits: 5 }
      : { key: 'kitChemMat.ec.row.mass', value: m, dim: 'mass', digits: 5 },
    { key: 'kitChemMat.ec.row.moles', value: (Q * eta) / (prod.n * F), unit: 'mol', digits: 5 },
  ];
  return {
    ok: true,
    rows,
    steps: faradaySteps(input, prod.n, M, { t, m }),
    notes: [{ key: 'kitChemMat.ec.note.faraday' }],
    equation: 'm=\\frac{\\eta\\,I\\,t\\,M}{n\\,F}',
  };
}
