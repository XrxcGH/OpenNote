// A rocket combustion chamber: fuel burned with gaseous oxygen at a mass ratio O/F and chamber pressure p_c, the
// products in equilibrium at the adiabatic flame temperature. Reports the chamber temperature, the products' mean
// molar mass, the frozen ratio of specific heats, and the characteristic velocity c*.
import { fmt, tex } from '../common/format';
import { linspace } from '../common/num';
import { ThermoError, positive, type KitStep, type PlotSeries, type ThermoResult } from '../common/types';
import { RU, SPECIES } from '../data/nasa';
import { flameSteps, fractionRows, present, reactionTex, setupOf } from './engine';
import { equilibriumFlame } from './flame';
import { FUEL_SOURCE, completeProducts, mixtureAtoms, stoichO2, type Fuel, type Mixture } from './reaction';
import { PRODUCTS, cpMol, extrapolated, type Amounts } from './species';

export interface RocketInput {
  fuel: Fuel;
  /** Oxidizer-fuel mass ratio. */
  of: number;
  /** Chamber pressure, kPa, and propellant temperature, K. */
  pc: number;
  T: number;
}

/** The mixture for an O/F mass ratio. */
export function rocketMixture(fuel: Fuel, of: number): Mixture {
  if (!(of > 0) || !Number.isFinite(of)) throw new ThermoError('ofRange');
  const aStoich = stoichO2(fuel.atoms);
  const a = (of * fuel.M) / SPECIES.O2.M;
  return { fuel, oxidizer: 'O2', a, aStoich, phi: aStoich / a };
}

/** The chamber state: equilibrium at constant pressure. */
function chamber(input: RocketInput, mix: Mixture) {
  const setup = setupOf(
    { fuel: input.fuel, oxidizer: 'O2', phi: mix.phi, T: input.T, p: input.pc, constantVolume: false },
    mix,
  );
  let start: Amounts;
  try {
    start = completeProducts(mix);
  } catch {
    const { C = 0, H = 0 } = mix.fuel.atoms;
    start = { CO: C, H2: H / 2 };
  }
  return { setup, flame: equilibriumFlame(setup, start, mixtureAtoms(mix)) };
}

/** Frozen properties of a product mixture at T: mean molar mass (g/mol), molar cp, and γ. */
export function frozenProps(n: Amounts, T: number): { M: number; cp: number; gamma: number } {
  let moles = 0;
  let mass = 0;
  let cp = 0;
  for (const id of PRODUCTS) {
    const amount = n[id] ?? 0;
    moles += amount;
    mass += amount * SPECIES[id].M;
    cp += amount * cpMol(SPECIES[id], T);
  }
  const cpMolar = cp / moles;
  return { M: mass / moles, cp: cpMolar, gamma: cpMolar / (cpMolar - RU) };
}

/** Characteristic velocity, m/s, of an ideal rocket: √(γ R T) / (γ (2/(γ+1))^((γ+1)/(2(γ−1)))). */
export function cStar(gamma: number, M: number, T: number): number {
  const R = RU / (M / 1000);
  return Math.sqrt(gamma * R * T) / (gamma * (2 / (gamma + 1)) ** ((gamma + 1) / (2 * (gamma - 1))));
}

function ofSweep(input: RocketInput, ofStoich: number): PlotSeries {
  const points: [number, number][] = [];
  for (const of of linspace(0.3 * ofStoich, 1.3 * ofStoich, 21)) {
    try {
      points.push([of, chamber({ ...input, of }, rocketMixture(input.fuel, of)).flame.T]);
    } catch {
      // A ratio past the data's range or without enough oxygen for CO is left out.
    }
  }
  return { name: 'equilibrium', word: 'equilibriumProducts', points };
}

function rocketNotes(fuel: Fuel, n: Amounts, moles: number, T: number): ThermoResult['notes'] {
  return [
    'rocketModel',
    'frozenGamma',
    'equilibriumSpecies',
    ...(fuel.nasa ? [] : (['fuelAt298'] as const)),
    ...(extrapolated(present(n, 1e-6 * moles), T) ? (['extrapolatedFit'] as const) : []),
  ];
}

export function solveRocket(input: RocketInput): ThermoResult {
  positive(input.pc, 'p_c');
  const mix = rocketMixture(input.fuel, input.of);
  const ofStoich = (mix.aStoich * SPECIES.O2.M) / input.fuel.M;
  const steps: KitStep[] = [];
  steps.push({
    key: 'comb.rocketOF',
    vars: { of: fmt(input.of, 5), a: fmt(mix.a, 5), ofSt: fmt(ofStoich, 5), phi: fmt(mix.phi, 5) },
    math: `a=\\frac{(O/F)\\,M_{fuel}}{M_{O_2}}=${tex(mix.a, 5)}`,
  });
  const { setup, flame } = chamber(input, mix);
  flameSteps(setup, flame.tries, steps);
  steps.push({ key: 'comb.eqIntro', vars: { iterations: String(flame.iterations) } });
  const props = frozenProps(flame.n, flame.T);
  const c = cStar(props.gamma, props.M, flame.T);
  steps.push({
    key: 'comb.rocketGamma',
    vars: { T: fmt(flame.T, 5), M: fmt(props.M, 5), cp: fmt(props.cp, 5), gamma: fmt(props.gamma, 5) },
  });
  steps.push({ key: 'comb.cstar', vars: { c: fmt(c, 5) } });
  steps.push({ key: 'comb.eqReaction', math: reactionTex(mix, flame.n, 1e-4 * flame.moles) });
  return {
    rows: [
      { key: 'chamberT', symbol: 'T_c', value: flame.T, qty: 'T' },
      { key: 'meanM', symbol: '\\bar M', value: props.M, qty: 'molarM' },
      { key: 'gammaFrozen', symbol: '\\gamma_f', value: props.gamma, qty: 'none' },
      { key: 'cpMolar', symbol: '\\bar c_p', value: props.cp, qty: 'molarS' },
      { key: 'cStar', symbol: 'c^*', value: c, qty: 'speed' },
      { key: 'ofStoich', symbol: '(O/F)_{st}', value: ofStoich, qty: 'none' },
      { key: 'equivalenceRatio', symbol: '\\phi', value: mix.phi, qty: 'none' },
      { key: 'productMoles', symbol: 'n_P', value: flame.moles, qty: 'none' },
      ...fractionRows(flame.n, 1e-6),
    ],
    steps,
    latex: `T_c=${tex(flame.T, 5)}\\ \\mathrm{K},\\quad c^*=${tex(c, 5)}\\ \\mathrm{m/s}`,
    notes: rocketNotes(input.fuel, flame.n, flame.moles, flame.T),
    plots: [
      {
        title: 'chamberOF',
        x: { label: 'O/F', qty: 'none' },
        y: { label: 'T_c', qty: 'T' },
        series: [ofSweep(input, ofStoich)],
        marks: [{ x: input.of, y: flame.T, label: '1' }],
      },
    ],
    source: `${FUEL_SOURCE}; equilibrium by the method of NASA RP-1311`,
  };
}
