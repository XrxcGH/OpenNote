// The combustion tool. It balances the reaction and finds the air-fuel ratio, the products' dew point, the heating
// values, and the adiabatic flame temperature. The products burn completely or reach chemical equilibrium. Engine
// units are K and kPa, with J/mol inside; results are in kJ/mol and kJ/kg.
import { fmt, tex } from '../common/format';
import { linspace } from '../common/num';
import { ThermoError, type KitStep, type PlotSeries, type ResultRow, type ThermoResult } from '../common/types';
import { RU } from '../data/nasa';
import { equilibriumFlame, frozenFlame, productsAt, type FlameSetup, type FlameTry } from './flame';
import {
  FUEL_SOURCE,
  N2_PER_O2,
  airFuel,
  completeProducts,
  dewPoint,
  heatingValues,
  mixtureAtoms,
  mixtureOf,
  reactants,
  type Fuel,
  type Mixture,
  type Oxidizer,
} from './reaction';
import { PRODUCTS, extrapolated, productTex, type Amounts, type ProductId } from './species';

export interface CombustionInput {
  fuel: Fuel;
  oxidizer: Oxidizer;
  phi: number;
  /** Reactant temperature, K, and pressure, kPa. */
  T: number;
  p: number;
  constantVolume: boolean;
}

const SUB: Record<string, string> = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
/** A formula with subscript digits, such as CO₂. */
export const pretty = (formula: string): string => formula.replace(/\d/g, (d) => SUB[d]);

const coef = (x: number): string => (Math.abs(x - 1) < 1e-12 ? '' : fmt(x, 5));

/** The fuel's formula in LaTeX from its atoms, such as C_{3}H_{8}. */
export function fuelTex(fuel: Fuel): string {
  return (['C', 'H', 'O', 'N'] as const)
    .filter((e) => (fuel.atoms[e] ?? 0) > 0)
    .map((e) => (fuel.atoms[e] === 1 ? e : `${e}_{${fmt(fuel.atoms[e] ?? 0, 5)}}`))
    .join('');
}

/** The products with any amount, in reading order: CO₂, CO, H₂O, H₂, O₂, N₂, then the radicals. */
export const present = (n: Amounts, floor = 0): ProductId[] =>
  (['CO2', 'CO', 'H2O', 'H2', 'O2', 'N2', 'OH', 'H', 'O', 'NO'] as const).filter((id) => (n[id] ?? 0) > floor);

/** The balanced reaction in LaTeX. */
export function reactionTex(mix: Mixture, n: Amounts, floor = 0): string {
  const oxidizer = mix.oxidizer === 'air' ? `(O_{2}+${N2_PER_O2}N_{2})` : 'O_{2}';
  const right = present(n, floor)
    .map((id) => `${coef(n[id] ?? 0)}${productTex(id)}`)
    .join('+');
  return `${fuelTex(mix.fuel)}+${coef(mix.a)}${oxidizer}\\to ${right}`;
}

/** Steps and rows shared by every mode: the fuel, the oxygen it needs, and the oxygen supplied. */
function mixtureSteps(mix: Mixture, steps: KitStep[]): ResultRow[] {
  const { C = 0, H = 0, O = 0 } = mix.fuel.atoms;
  steps.push({ key: 'comb.fuel', vars: { formula: pretty(mix.fuel.formula), M: fmt(mix.fuel.M, 6) } });
  steps.push({
    key: 'comb.stoich',
    vars: { a: fmt(mix.aStoich, 5) },
    math: `a_{st}=x+\\frac{y}{4}-\\frac{z}{2}=${fmt(C, 4)}+\\frac{${fmt(H, 4)}}{4}-\\frac{${fmt(O, 4)}}{2}=${tex(mix.aStoich, 5)}`,
  });
  const excess = (1 / mix.phi - 1) * 100;
  steps.push({
    key: mix.oxidizer === 'air' ? 'comb.suppliedAir' : 'comb.suppliedO2',
    vars: { phi: fmt(mix.phi, 5), a: fmt(mix.a, 5), excess: fmt(excess, 4) },
    math: `a=\\frac{a_{st}}{\\phi}=${tex(mix.a, 5)}`,
  });
  return [
    { key: 'molarMassRow', symbol: 'M_{fuel}', value: mix.fuel.M, qty: 'molarM' },
    { key: 'aStoich', symbol: 'a_{st}', value: mix.aStoich, qty: 'none' },
    { key: 'aSupplied', symbol: 'a', value: mix.a, qty: 'none' },
    { key: 'equivalenceRatio', symbol: '\\phi', value: mix.phi, qty: 'none' },
    { key: mix.oxidizer === 'air' ? 'excessAir' : 'excessO2', symbol: 'e', value: excess, qty: 'percent' },
  ];
}

/** The mole-fraction rows of a set of products, the trace ones left out. */
export function fractionRows(n: Amounts, floor: number): ResultRow[] {
  const total = PRODUCTS.reduce((sum, id) => sum + (n[id] ?? 0), 0);
  return present(n, floor * total).map((id) => ({
    key: 'moleFraction',
    symbol: `y_{${productTex(id)}}`,
    value: (n[id] ?? 0) / total,
    qty: 'none',
    tag: pretty(id),
  }));
}

/** The air-fuel ratio, dew point, and heating values of complete combustion. */
function completeFacts(input: CombustionInput, mix: Mixture, n: Amounts, steps: KitStep[]): ResultRow[] {
  const air = airFuel(mix);
  const airKey = mix.oxidizer === 'air' ? 'comb.afr' : 'comb.ofr';
  steps.push({ key: 'comb.reaction', math: reactionTex(mix, n) });
  steps.push({ key: airKey, vars: { mass: fmt(air.mass, 5), mole: fmt(air.mole, 5), M: fmt(mix.fuel.M, 6) } });
  const total = PRODUCTS.reduce((sum, id) => sum + (n[id] ?? 0), 0);
  const yWater = (n.H2O ?? 0) / total;
  const pv = yWater * input.p;
  const Tdp = dewPoint(pv);
  steps.push({ key: 'comb.products', vars: { n: fmt(total, 5) } });
  steps.push({
    key: Tdp === null ? 'comb.dewNone' : 'comb.dew',
    vars: { y: fmt(yWater, 5), pv: fmt(pv, 5), Tdp: Tdp === null ? '' : fmt(Tdp - 273.15, 4) },
  });
  const hv = heatingValues(mix.fuel);
  const water = (mix.fuel.atoms.H ?? 0) / 2;
  steps.push({
    key: 'comb.heating',
    vars: {
      lhv: fmt(hv.lhv / 1000, 6),
      lhvKg: fmt(hv.lhv / mix.fuel.M / 1000, 5),
      nw: fmt(water, 4),
      hhv: fmt(hv.hhv / 1000, 6),
      hhvKg: fmt(hv.hhv / mix.fuel.M / 1000, 5),
    },
  });
  const air2 = mix.oxidizer === 'air';
  return [
    { key: air2 ? 'afrMass' : 'ofrMass', symbol: air2 ? 'AF' : 'OF', value: air.mass, qty: 'none' },
    { key: air2 ? 'afrMole' : 'ofrMole', symbol: air2 ? '\\bar{AF}' : '\\bar{OF}', value: air.mole, qty: 'none' },
    { key: 'productMoles', symbol: 'n_P', value: total, qty: 'none' },
    ...fractionRows(n, 0),
    { key: 'pv', symbol: 'p_{H_2O}', value: pv, qty: 'p' },
    Tdp === null
      ? { key: 'tdp', symbol: 'T_{dp}', value: 0, qty: 'T', word: 'noDew' }
      : { key: 'tdp', symbol: 'T_{dp}', value: Tdp, qty: 'T', unit: { SI: '°C', US: '°F' } },
    { key: 'lhvMolar', symbol: 'LHV', value: hv.lhv / 1000, qty: 'molarE' },
    { key: 'lhvMass', symbol: 'LHV', value: hv.lhv / mix.fuel.M, qty: 'e', unit: { SI: 'MJ/kg' } },
    { key: 'hhvMolar', symbol: 'HHV', value: hv.hhv / 1000, qty: 'molarE' },
    { key: 'hhvMass', symbol: 'HHV', value: hv.hhv / mix.fuel.M, qty: 'e', unit: { SI: 'MJ/kg' } },
  ];
}

/** The reactants' energy step and the Newton tries, at most eight, then the answer. */
export function flameSteps(setup: FlameSetup, tries: readonly FlameTry[], steps: KitStep[]): void {
  steps.push({
    key: setup.constantVolume ? 'comb.reactantU' : 'comb.reactantH',
    vars: {
      T: fmt(setup.T, 5),
      H: fmt(setup.H / 1000, 6),
      U: fmt((setup.H - setup.gasMoles * RU * setup.T) / 1000, 6),
      n: fmt(setup.gasMoles, 5),
    },
  });
  tries.slice(0, 8).forEach((one) =>
    steps.push({
      key: 'comb.try',
      vars: {
        T: fmt(one.T, 6),
        gap: fmt(one.gap / 1000, 4),
        slope: fmt(one.slope / 1000, 4),
        next: fmt(one.T - one.gap / one.slope, 6),
      },
    }),
  );
}

export function setupOf(input: CombustionInput, mix: Mixture): FlameSetup {
  if (!(input.p > 0)) throw new ThermoError('notPositive', { name: 'p' });
  if (!(input.T >= 200 && input.T <= 2000)) throw new ThermoError('reactantRange');
  const r = reactants(mix, input.T);
  return { H: r.H, gasMoles: r.gasMoles, T: input.T, p: input.p, constantVolume: input.constantVolume };
}

/** Flame temperature against φ, for complete combustion and, when asked, equilibrium; failed points are left out. */
export function phiSweep(input: CombustionInput, withEquilibrium: boolean): PlotSeries[] {
  const complete: [number, number][] = [];
  const eq: [number, number][] = [];
  for (const phi of linspace(0.5, 1.8, 27)) {
    try {
      const mix = mixtureOf(input.fuel, input.oxidizer, phi);
      const n = completeProducts(mix);
      const setup = setupOf(input, mix);
      complete.push([phi, frozenFlame(setup, n).T]);
      if (withEquilibrium) eq.push([phi, equilibriumFlame(setup, n, mixtureAtoms(mix)).T]);
    } catch {
      // A point past the soot limit or the data's range is left out of the line.
    }
  }
  return [
    { name: 'complete', word: 'completeCombustion', points: complete, dashed: withEquilibrium },
    ...(withEquilibrium ? [{ name: 'equilibrium', word: 'equilibriumProducts', points: eq } as PlotSeries] : []),
  ];
}

const flameRow = (T: number, constantVolume: boolean, key: 'flameT' | 'flameTComplete' = 'flameT'): ResultRow => ({
  key,
  symbol: constantVolume ? 'T_{ad,v}' : 'T_{ad,p}',
  value: T,
  qty: 'T',
});

export function solveComplete(input: CombustionInput): ThermoResult {
  const mix = mixtureOf(input.fuel, input.oxidizer, input.phi);
  const steps: KitStep[] = [];
  const rows = mixtureSteps(mix, steps);
  const n = completeProducts(mix);
  rows.push(...completeFacts(input, mix, n, steps));
  const setup = setupOf(input, mix);
  const flame = frozenFlame(setup, n);
  flameSteps(setup, flame.tries, steps);
  steps.push({
    key: input.constantVolume ? 'comb.flameV' : 'comb.flame',
    vars: { T: fmt(flame.T, 5), p: fmt(flame.p, 5) },
  });
  rows.push(flameRow(flame.T, input.constantVolume));
  if (input.constantVolume) rows.push({ key: 'flameP', symbol: 'p_2', value: flame.p, qty: 'p' });
  return {
    rows,
    steps,
    latex: `${reactionTex(mix, n)},\\quad T_{ad}=${tex(flame.T, 5)}\\ \\mathrm{K}`,
    notes: notesFor(input, ['completeRule'], extrapolated(present(n), flame.T)),
    plots: [plotOf(input, false, flame.T)],
    source: FUEL_SOURCE,
  };
}

function notesFor(input: CombustionInput, extra: CombustionNote[], beyondFit: boolean): CombustionNote[] {
  return [
    'combustionIdeal',
    ...(input.oxidizer === 'air' ? (['airModel'] as const) : []),
    ...(input.fuel.nasa ? [] : (['fuelAt298'] as const)),
    ...extra,
    'heatingRef',
    ...(beyondFit ? (['extrapolatedFit'] as const) : []),
  ];
}

type CombustionNote = ThermoResult['notes'][number];

function plotOf(input: CombustionInput, withEquilibrium: boolean, T: number) {
  return {
    title: 'flamePhi' as const,
    x: { label: 'φ', qty: 'none' as const },
    y: { label: 'T_ad', qty: 'T' as const },
    series: phiSweep(input, withEquilibrium),
    marks: [{ x: input.phi, y: T, label: '1' }],
  };
}

export interface EquilibriumInput extends CombustionInput {
  /** A fixed products temperature, K, or null for the adiabatic flame. */
  productT: number | null;
}

/** Equilibrium products: at the adiabatic flame temperature, or at a temperature the student gives. */
export function solveEquilibrium(input: EquilibriumInput): ThermoResult {
  const mix = mixtureOf(input.fuel, input.oxidizer, input.phi);
  const steps: KitStep[] = [];
  const rows = mixtureSteps(mix, steps);
  const start = startingProducts(mix);
  const setup = setupOf(input, mix);
  let T: number;
  let eq: { n: Amounts; moles: number; iterations: number; p: number };
  if (input.productT !== null) {
    T = input.productT;
    eq = productsAt(setup, mixtureAtoms(mix), T, start);
    steps.push({ key: 'comb.eqAtT', vars: { T: fmt(T, 5), p: fmt(eq.p, 5), n: fmt(eq.moles, 5) } });
  } else {
    const flame = equilibriumFlame(setup, start, mixtureAtoms(mix));
    T = flame.T;
    eq = flame;
    flameSteps(setup, flame.tries, steps);
    steps.push({ key: 'comb.eqIntro', vars: { iterations: String(flame.iterations) } });
    steps.push({ key: input.constantVolume ? 'comb.flameV' : 'comb.flame', vars: { T: fmt(T, 5), p: fmt(eq.p, 5) } });
    rows.push(flameRow(T, input.constantVolume));
    compareComplete(setup, mix, T, steps, rows);
  }
  steps.push({ key: 'comb.eqReaction', math: reactionTex(mix, eq.n, 1e-4 * eq.moles) });
  rows.push({ key: 'productMoles', symbol: 'n_P', value: eq.moles, qty: 'none' });
  if (input.constantVolume) rows.push({ key: 'flameP', symbol: 'p_2', value: eq.p, qty: 'p' });
  rows.push(...fractionRows(eq.n, 1e-6));
  return {
    rows,
    steps,
    latex: `T=${tex(T, 5)}\\ \\mathrm{K},\\quad ${reactionTex(mix, eq.n, 1e-4 * eq.moles)}`,
    notes: notesFor(input, ['equilibriumSpecies'], extrapolated(present(eq.n, 1e-6 * eq.moles), T)),
    plots: input.productT === null ? [plotOf(input, true, T)] : [],
    source: `${FUEL_SOURCE}; equilibrium by the method of NASA RP-1311`,
  };
}

/** Complete-combustion products to start from; past the soot limit, a start that keeps every element present. */
function startingProducts(mix: Mixture): Amounts {
  try {
    return completeProducts(mix);
  } catch (error) {
    if (!(error instanceof ThermoError) || error.code !== 'tooRich') throw error;
    const { C = 0, H = 0, O = 0, N = 0 } = mix.fuel.atoms;
    const oxygen = O + 2 * mix.a;
    if (oxygen < C) throw new ThermoError('tooRichEquilibrium');
    const nitrogen = (N + (mix.oxidizer === 'air' ? 2 * N2_PER_O2 * mix.a : 0)) / 2;
    return { CO: C, H2O: Math.max(0, oxygen - C), H2: Math.max(1e-6, H / 2 - Math.max(0, oxygen - C)), N2: nitrogen };
  }
}

function compareComplete(setup: FlameSetup, mix: Mixture, T: number, steps: KitStep[], rows: ResultRow[]): void {
  try {
    const complete = frozenFlame(setup, completeProducts(mix)).T;
    steps.push({ key: 'comb.eqCompare', vars: { Tc: fmt(complete, 5), dT: fmt(complete - T, 4) } });
    rows.push(flameRow(complete, setup.constantVolume, 'flameTComplete'));
  } catch {
    // Complete combustion may be past the soot limit or hotter than the data; the equilibrium answer stands alone.
  }
}
