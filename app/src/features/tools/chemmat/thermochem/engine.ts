// Thermochemistry: reaction enthalpy, entropy, and Gibbs energy from the standard data of the species, K from the
// Gibbs energy, and how they change with temperature when the enthalpy and entropy are held constant.
import { balance } from '../../chem/calc/balance';
import { parseFormula, splitCharge } from '../../chem/calc/formula';
import { R, T_STD } from '../constants';
import { findSpecies, SOURCE_NAMES } from '../data/species';
import type { Phase, Species } from '../data/species';
import { fail } from '../types';
import type { KitStep, Outcome, PlotData, Row } from '../types';

export interface Term {
  coefficient: number;
  text: string;
  species: Species;
}

export interface ParsedReaction {
  reactants: Term[];
  products: Term[];
}

export type ParseError = { kind: 'format' } | { kind: 'unknown'; text: string } | { kind: 'unbalanced'; hint: string };

const PHASES = new Set(['g', 'l', 's', 'aq']);

/** Splits one side of an equation at " + ", or at a plus sign that begins the next formula ("A+B"), never at a charge. */
export function splitTerms(side: string): string[] {
  const spaced = side.split(/\s+\+\s+/).map((s) => s.trim());
  const out: string[] = [];
  for (const part of spaced) out.push(...part.split(/\+(?=\s*\d*[A-Z])/).map((x) => x.trim()));
  return out.filter(Boolean);
}

function parseTerm(text: string): { coefficient: number; formula: string; phase?: Phase } | null {
  const m = /^(\d+(?:\.\d+)?)?\s*([^\s].*?)(?:\((g|l|s|aq)\))?$/.exec(text.trim());
  if (!m) return null;
  const formula = m[2].replace(/\s+/g, '');
  if (formula === '') return null;
  const phase = m[3] && PHASES.has(m[3]) ? (m[3] as Phase) : undefined;
  return { coefficient: m[1] ? Number(m[1]) : 1, formula, phase };
}

function readSide(side: string): Term[] | ParseError {
  const terms: Term[] = [];
  for (const raw of splitTerms(side)) {
    const parsed = parseTerm(raw);
    if (!parsed) return { kind: 'format' };
    const species = findSpecies(parsed.formula, parsed.phase);
    if (!species) return { kind: 'unknown', text: raw.trim() };
    terms.push({ coefficient: parsed.coefficient, text: parsed.formula, species });
  }
  return terms.length > 0 ? terms : { kind: 'format' };
}

/** Atoms and charge on one side, or null when a formula cannot be read. */
function tally(terms: Term[]): Map<string, number> | null {
  const total = new Map<string, number>();
  for (const t of terms) {
    const counts = parseFormula(t.text);
    if (!counts) return null;
    for (const [el, n] of counts) total.set(el, (total.get(el) ?? 0) + n * t.coefficient);
    const charge = splitCharge(t.text).charge;
    if (charge !== 0) total.set('charge', (total.get('charge') ?? 0) + charge * t.coefficient);
  }
  return total;
}

/** Reads "N2(g) + 3 H2(g) -> 2 NH3(g)" into species with their coefficients, checking atoms and charge balance. */
export function parseReaction(
  equation: string,
): { ok: true; value: ParsedReaction } | { ok: false; error: ParseError } {
  const sides = equation.split(/\s*(?:->|→|=>|⟶|⇌|<=>|=)\s*/);
  if (sides.length !== 2) return { ok: false, error: { kind: 'format' } };
  const left = readSide(sides[0]);
  if (!Array.isArray(left)) return { ok: false, error: left };
  const right = readSide(sides[1]);
  if (!Array.isArray(right)) return { ok: false, error: right };
  const a = tally(left);
  const b = tally(right);
  if (!a || !b) return { ok: false, error: { kind: 'format' } };
  const keys = new Set([...a.keys(), ...b.keys()]);
  if ([...keys].some((k) => Math.abs((a.get(k) ?? 0) - (b.get(k) ?? 0)) > 1e-9)) {
    const bare = (terms: Term[]) => terms.map((t) => t.text).join(' + ');
    const tried = balance(`${bare(left)} -> ${bare(right)}`);
    return { ok: false, error: { kind: 'unbalanced', hint: tried.ok ? tried.balanced.text : '' } };
  }
  return { ok: true, value: { reactants: left, products: right } };
}

const label = (t: Term) => `${t.text}(${t.species.phase})`;
const num = (x: number, d = 6) => String(Number(x.toPrecision(d)));

export interface ThermoResult {
  dH: number; // J/mol
  dS: number; // J/(mol K)
  dG298: number; // J/mol
  K298: number;
  dGT: number;
  KT: number;
  lnKT: number;
  crossover: number | null;
}

/** The reaction quantities from sums over the species, at temperature T (K) with constant dH and dS. */
export function reactionQuantities(reaction: ParsedReaction, T: number): ThermoResult {
  const sum = (pick: (s: Species) => number) =>
    reaction.products.reduce((a, t) => a + t.coefficient * pick(t.species), 0) -
    reaction.reactants.reduce((a, t) => a + t.coefficient * pick(t.species), 0);
  const dH = sum((s) => s.hf) * 1000;
  const dS = sum((s) => s.s);
  const dG298 = dH - T_STD * dS;
  const dGT = dH - T * dS;
  const lnKT = -dGT / (R * T);
  const crossover = dS !== 0 && dH / dS > 0 ? dH / dS : null;
  return { dH, dS, dG298, K298: Math.exp(-dG298 / (R * T_STD)), dGT, KT: Math.exp(lnKT), lnKT, crossover };
}

export interface ThermoInput {
  equation: string;
  /** Temperature, K. */
  T: number;
}

const SOURCE_KEY = { codata: 'CODATA', nbs: 'NBS', nist: 'NIST' } as const;

function reactionText(r: ParsedReaction): string {
  const side = (terms: Term[]) =>
    terms.map((t) => `${t.coefficient === 1 ? '' : t.coefficient + ' '}${label(t)}`).join(' + ');
  return `${side(r.reactants)} -> ${side(r.products)}`;
}

function parseFailure(error: ParseError): Outcome {
  if (error.kind === 'unknown') return fail('kitChemMat.thermo.err.unknown', { species: error.text });
  if (error.kind === 'unbalanced') {
    const key = error.hint ? 'kitChemMat.thermo.err.unbalancedHint' : 'kitChemMat.thermo.err.unbalanced';
    return fail(key, { hint: error.hint });
  }
  return fail('kitChemMat.thermo.err.format');
}

function spontaneity(dG: number) {
  if (dG < 0) return 'kitChemMat.thermo.spontaneous' as const;
  return dG > 0 ? ('kitChemMat.thermo.notSpontaneous' as const) : ('kitChemMat.thermo.atEquilibrium' as const);
}

function thermoRows(q: ThermoResult, T: number): Row[] {
  const rows: Row[] = [
    { key: 'kitChemMat.thermo.row.dH', value: q.dH, dim: 'energyMol' },
    { key: 'kitChemMat.thermo.row.dS', value: q.dS, dim: 'entropyMol' },
    { key: 'kitChemMat.thermo.row.dG298', value: q.dG298, dim: 'energyMol' },
    { key: 'kitChemMat.thermo.row.spont298', value: '', word: spontaneity(q.dG298) },
    { key: 'kitChemMat.thermo.row.K298', value: q.K298, digits: 4 },
  ];
  if (Math.abs(T - T_STD) > 1e-9) {
    rows.push(
      { key: 'kitChemMat.thermo.row.dGT', value: q.dGT, dim: 'energyMol' },
      { key: 'kitChemMat.thermo.row.KT', value: q.KT, digits: 4 },
    );
  }
  rows.push(
    q.crossover === null
      ? { key: 'kitChemMat.thermo.row.crossover', value: '', word: 'kitChemMat.thermo.noCrossover' }
      : { key: 'kitChemMat.thermo.row.crossover', value: q.crossover, dim: 'temperature' },
  );
  return rows;
}

/** The main steps: the three sums, the Gibbs energy, and K at 298.15 K. */
function standardSteps(q: ThermoResult, reaction: ParsedReaction): KitStep[] {
  const kJ = (x: number) => num(x / 1000);
  return [
    { key: 'kitChemMat.thermo.step.reaction', vars: { reaction: reactionText(reaction) } },
    {
      key: 'kitChemMat.thermo.step.dH',
      math: [
        '\\Delta H^\\circ=\\sum\\nu\\,\\Delta_f H^\\circ(\\text{products})',
        '-\\sum\\nu\\,\\Delta_f H^\\circ(\\text{reactants})',
        `=${kJ(q.dH)}\\ \\mathrm{kJ}`,
      ].join(''),
    },
    {
      key: 'kitChemMat.thermo.step.dS',
      math: [
        '\\Delta S^\\circ=\\sum\\nu\\,S^\\circ(\\text{products})',
        '-\\sum\\nu\\,S^\\circ(\\text{reactants})',
        `=${num(q.dS)}\\ \\mathrm{J\\,K^{-1}}`,
      ].join(''),
    },
    {
      key: 'kitChemMat.thermo.step.dG',
      math: [
        '\\Delta G^\\circ=\\Delta H^\\circ-T\\,\\Delta S^\\circ',
        `=${kJ(q.dH)}-(${num(T_STD)})(${kJ(q.dS)})=${kJ(q.dG298)}\\ \\mathrm{kJ}`,
      ].join(''),
    },
    {
      key: 'kitChemMat.thermo.step.K',
      math: [
        'K=\\exp\\!\\left(\\frac{-\\Delta G^\\circ}{RT}\\right)',
        `=\\exp\\!\\left(\\frac{${num(-q.dG298)}}{(${num(R)})(${num(T_STD)})}\\right)=${num(q.K298, 4)}`,
      ].join(''),
    },
  ];
}

/** The steps for another temperature, and for the crossover temperature when there is one. */
function temperatureSteps(q: ThermoResult, T: number): KitStep[] {
  const kJ = (x: number) => num(x / 1000);
  const steps: KitStep[] = [];
  if (Math.abs(T - T_STD) > 1e-9) {
    steps.push(
      {
        key: 'kitChemMat.thermo.step.atT',
        vars: { T: num(T, 6) },
        math: [
          `\\Delta G_T=${kJ(q.dH)}-(${num(T)})(${kJ(q.dS)})=${kJ(q.dGT)}\\ \\mathrm{kJ}`,
          `,\\qquad K_T=${num(q.KT, 4)}`,
        ].join(''),
      },
      {
        key: 'kitChemMat.thermo.step.vanthoff',
        math: '\\ln\\frac{K_T}{K_{298}}=-\\frac{\\Delta H^\\circ}{R}\\left(\\frac{1}{T}-\\frac{1}{298.15}\\right)',
      },
    );
  }
  if (q.crossover !== null) {
    steps.push({
      key: 'kitChemMat.thermo.step.crossover',
      math: [
        'T_{\\mathrm{c}}=\\frac{\\Delta H^\\circ}{\\Delta S^\\circ}',
        `=\\frac{${kJ(q.dH)}}{${kJ(q.dS)}}=${num(q.crossover, 5)}\\ \\mathrm{K}`,
      ].join(''),
    });
  }
  return steps;
}

function speciesTable(reaction: ParsedReaction) {
  const termRows = (terms: Term[], sign: number) =>
    terms.map((t) => [
      label(t),
      String(sign * t.coefficient),
      num(t.species.hf, 6),
      num(t.species.s, 6),
      SOURCE_KEY[t.species.src],
    ]);
  return {
    title: 'kitChemMat.thermo.table.title' as const,
    header: [
      'kitChemMat.thermo.table.species',
      'kitChemMat.thermo.table.nu',
      'kitChemMat.thermo.table.hf',
      'kitChemMat.thermo.table.s',
      'kitChemMat.thermo.table.source',
    ],
    rows: [...termRows(reaction.reactants, -1), ...termRows(reaction.products, 1)],
  };
}

/** Delta G against temperature from 200 to 1500 K, in kJ, with the enthalpy and entropy held constant. */
function gibbsPlot(q: ThermoResult): PlotData {
  const points: [number, number][] = [];
  for (let k = 0; k <= 60; k++) {
    const temp = 200 + (k * 1300) / 60;
    points.push([temp, (q.dH - temp * q.dS) / 1000]);
  }
  return {
    xLabel: 'kitChemMat.thermo.plot.x',
    yLabel: 'kitChemMat.thermo.plot.y',
    series: [{ label: 'kitChemMat.thermo.plot.series', points }],
    alt: 'kitChemMat.thermo.plot.alt',
  };
}

export function thermochem(input: ThermoInput): Outcome {
  const { T } = input;
  if (!Number.isFinite(T) || T <= 0) return fail('kitChemMat.err.temperature');
  const parsed = parseReaction(input.equation);
  if (!parsed.ok) return parseFailure(parsed.error);
  const reaction = parsed.value;
  const q = reactionQuantities(reaction, T);
  const sources = [...new Set([...reaction.reactants, ...reaction.products].map((t) => SOURCE_NAMES[t.species.src]))];
  return {
    ok: true,
    rows: thermoRows(q, T),
    steps: [...standardSteps(q, reaction), ...temperatureSteps(q, T)],
    notes: [{ key: 'kitChemMat.thermo.note.constant' }, { key: 'kitChemMat.thermo.note.standard' }],
    equation: '\\Delta G^\\circ = \\Delta H^\\circ - T\\,\\Delta S^\\circ,\\qquad K=e^{-\\Delta G^\\circ/RT}',
    plot: gibbsPlot(q),
    tables: [speciesTable(reaction)],
    sources,
  };
}
