// The real-gas tool: one state from a cubic equation of state (van der Waals, Redlich-Kwong, Soave, or
// Peng-Robinson) with its departures from an ideal gas, and an ideal-gas mixture by mass or by moles with Dalton's
// and Amagat's laws and Kay's pseudo-critical point. Engine units: K, kPa, m³/kg, kJ/kg, kJ/(kg K); the cubic works
// per mole in Pa and m³/mol.
import { fmt, tex } from '../common/format';
import {
  ThermoError,
  positive,
  type KitStep,
  type PlotSeries,
  type ResultRow,
  type ThermoResult,
} from '../common/types';
import { NASA_SOURCE, RU } from '../data/nasa';
import { gasOf, type GasId } from '../idealgas/gas';
import { CRITICAL, CRITICAL_SOURCE } from './critical';
import {
  cubicInZ,
  eosParams,
  eosPressure,
  residual,
  solveZ,
  type EosId,
  type EosParams,
  type Residual,
  type RootChoice,
} from './cubic';

export interface EosInput {
  eos: EosId;
  /** K, kPa, acentric factor, g/mol. */
  Tc: number;
  pc: number;
  omega: number;
  M: number;
  given: 'Tp' | 'Tv';
  T: number;
  /** kPa, when given is Tp. */
  p?: number;
  /** m³/kg, when given is Tv. */
  v?: number;
  root: RootChoice;
}

const SUB: Record<string, string> = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
/** A formula with subscript digits, such as CO₂. */
export const formulaText = (formula: string): string => formula.replace(/\d/g, (d) => SUB[d]);

function checkConstants(input: Pick<EosInput, 'Tc' | 'pc' | 'omega' | 'M'>): void {
  positive(input.Tc, 'Tc');
  positive(input.pc, 'pc');
  positive(input.M, 'M');
  if (!Number.isFinite(input.omega)) throw new ThermoError('missing', { name: 'omega' });
  if (input.omega <= -1 || input.omega >= 2) throw new ThermoError('omegaRange');
}

function constantsStep(e: EosParams): KitStep {
  const vars: Record<string, string> = { a: fmt(e.a, 5), b: fmt(e.b, 5) };
  if (e.kappa !== null) {
    vars.kappa = fmt(e.kappa, 5);
    vars.alpha = fmt(e.alpha, 5);
  }
  const denominator = e.eos === 'vdw' ? 'v^2' : e.eos === 'pr' ? 'v^2+2bv-b^2' : 'v(v+b)';
  return { key: `eos.constants.${e.eos}`, vars, math: `p=\\frac{RT}{v-b}-\\frac{a}{${denominator}}` };
}

function cubicLatex(c: readonly number[]): string {
  const term = (value: number, power: string) => `${value < 0 ? '-' : '+'}${tex(Math.abs(value), 5)}${power}`;
  return `Z^3${term(c[0], 'Z^2')}${term(c[1], 'Z')}${term(c[2], '')}=0`;
}

/** The stable Z along the isotherm, split where the stable root jumps from the gas-like to the liquid-like one. */
function isotherm(e: EosParams, T: number, pMax: number): PlotSeries[] {
  const runs: { word: 'gasRoot' | 'liquidRoot'; points: [number, number][] }[] = [];
  let branch: 'gasRoot' | 'liquidRoot' = 'gasRoot';
  for (let i = 1; i <= 120; i++) {
    const p = (pMax * i) / 120;
    let pick;
    try {
      pick = solveZ(e, T, p * 1000, 'stable');
    } catch {
      continue;
    }
    if (pick.why === 'stableGas') branch = 'gasRoot';
    if (pick.why === 'stableLiquid') branch = 'liquidRoot';
    const last = runs[runs.length - 1];
    if (!last || last.word !== branch) runs.push({ word: branch, points: [[p, pick.Z]] });
    else last.points.push([p, pick.Z]);
  }
  return [
    ...runs.map((run) => ({ name: '', word: run.word, points: run.points })),
    {
      name: '',
      word: 'idealGasLine',
      dashed: true,
      points: [
        [pMax / 120, 1],
        [pMax, 1],
      ],
    },
  ];
}

/** One state from a cubic equation of state. */
interface EosState {
  pPa: number;
  vm: number;
  Z: number;
}

/** The state from T and v: the pressure comes straight from the equation. */
function stateFromTv(input: EosInput, e: EosParams, T: number, steps: KitStep[]): EosState {
  const kgPerMol = input.M / 1000;
  const vm = positive(input.v, 'v') * kgPerMol;
  if (vm <= e.b) throw new ThermoError('eosCovolume', { b: fmt(e.b / kgPerMol, 5) });
  const pPa = eosPressure(e, T, vm);
  if (!(pPa > 0)) throw new ThermoError('eosNegativePressure', { p: fmt(pPa / 1000, 5) });
  const Z = (pPa * vm) / (RU * T);
  steps.push({ key: 'eos.reducedTv', vars: { Tr: fmt(T / input.Tc, 5), vm: fmt(vm, 5) } });
  steps.push(constantsStep(e));
  steps.push({
    key: 'eos.pressure',
    vars: { p: fmt(pPa / 1000, 6), Z: fmt(Z, 5), pi: fmt((RU * T) / vm / 1000, 6) },
    math: `p=\\frac{RT}{v-b}-\\frac{a}{(v+\\delta_1 b)(v+\\delta_2 b)}=${tex(pPa / 1000, 6)}\\ \\mathrm{kPa}`,
  });
  return { pPa, vm, Z };
}

/** The state from T and p: the cubic in Z, its roots, and the one chosen and why. */
function stateFromTp(input: EosInput, e: EosParams, T: number, steps: KitStep[]): EosState {
  const p = positive(input.p, 'p');
  const pPa = p * 1000;
  const A = (e.a * pPa) / (RU * T) ** 2;
  const B = (e.b * pPa) / (RU * T);
  const found = solveZ(e, T, pPa, input.root);
  const Z = found.Z;
  const stable = found.roots.length > 1 ? solveZ(e, T, pPa, 'stable').Z : Z;
  steps.push({ key: 'eos.reduced', vars: { Tr: fmt(T / input.Tc, 5), pr: fmt(p / input.pc, 5) } });
  steps.push(constantsStep(e));
  steps.push({
    key: 'eos.dimensionless',
    vars: { A: fmt(A, 5), B: fmt(B, 5) },
    math: 'A=\\frac{ap}{(RT)^2},\\quad B=\\frac{bp}{RT}',
  });
  steps.push({ key: 'eos.cubic', math: cubicLatex(cubicInZ(e, A, B)) });
  const roots = found.roots.map((one) => fmt(one, 5)).join(', ');
  steps.push({ key: found.roots.length > 1 ? 'eos.roots3' : 'eos.roots1', vars: { roots } });
  steps.push({
    key: `eos.why.${found.why}`,
    vars: {
      gas: fmt(found.lnPhiGas ?? 0, 4),
      liquid: fmt(found.lnPhiLiquid ?? 0, 4),
      Z: fmt(Z, 5),
      stable: fmt(stable, 5),
    },
  });
  return { pPa, vm: (Z * RU * T) / pPa, Z };
}

/** The result table for one state. */
function eosRows(input: EosInput, e: EosParams, T: number, s: EosState, res: Residual): ResultRow[] {
  const { pPa, vm, Z } = s;
  const p = pPa / 1000;
  const v = vm / (input.M / 1000);
  const phi = Math.exp(res.lnPhi);
  return [
    ...(input.given === 'Tv' ? [{ key: 'pressure', symbol: 'p', value: p, qty: 'p' } as const] : []),
    { key: 'zFactor', symbol: 'Z', value: Z, qty: 'none' },
    { key: 'v', symbol: 'v', value: v, qty: 'v' },
    { key: 'rho', symbol: '\\rho', value: 1 / v, qty: 'rho' },
    { key: 'vMolar', symbol: '\\bar v', value: vm, qty: 'molarV' },
    input.given === 'Tv'
      ? { key: 'pIdeal', symbol: 'p_{ideal}', value: (RU * T) / vm / 1000, qty: 'p' }
      : { key: 'vIdeal', symbol: 'v_{ideal}', value: (RU * T) / pPa / (input.M / 1000), qty: 'v' },
    { key: 'idealError', symbol: '1/Z-1', value: (1 / Z - 1) * 100, qty: 'percent' },
    { key: 'reducedT', symbol: 'T_r', value: T / input.Tc, qty: 'none' },
    { key: 'reducedP', symbol: 'p_r', value: p / input.pc, qty: 'none' },
    { key: 'pseudoReducedV', symbol: 'v_R', value: (vm * input.pc * 1000) / (RU * input.Tc), qty: 'none' },
    { key: 'hDeparture', symbol: 'h-h^*', value: res.h / input.M, qty: 'e' },
    { key: 'sDeparture', symbol: 's-s^*', value: res.s / input.M, qty: 's' },
    { key: 'zH', symbol: 'Z_h', value: -res.h / (RU * input.Tc), qty: 'none' },
    { key: 'zS', symbol: 'Z_s', value: -res.s / RU, qty: 'none' },
    { key: 'fugacityCoeff', symbol: '\\phi', value: phi, qty: 'none' },
    { key: 'fugacity', symbol: 'f', value: phi * p, qty: 'p' },
    { key: 'eosA', symbol: 'a', value: e.a, qty: 'eosA' },
    { key: 'eosB', symbol: 'b', value: e.b, qty: 'molarV' },
  ];
}

/** The volume and departure steps that follow either state. */
function propertySteps(input: EosInput, T: number, s: EosState, res: Residual): KitStep[] {
  const { pPa, vm, Z } = s;
  const v = vm / (input.M / 1000);
  const steps: KitStep[] = [];
  if (input.given === 'Tp') {
    const vi = (RU * T) / pPa / (input.M / 1000);
    steps.push({
      key: 'eos.volume',
      vars: { vm: fmt(vm, 5), v: fmt(v, 5), M: fmt(input.M, 5), vi: fmt(vi, 5), err: fmt((1 / Z - 1) * 100, 3) },
      math: `v=\\frac{ZRT}{pM}=${tex(v, 5)}\\ \\mathrm{m^3/kg}`,
    });
  }
  steps.push({
    key: 'eos.departure',
    vars: {
      h: fmt(res.h / input.M, 5),
      s: fmt(res.s / input.M, 5),
      zh: fmt(-res.h / (RU * input.Tc), 4),
      zs: fmt(-res.s / RU, 4),
    },
    math: 'h-h^*=RT(Z-1)+\\frac{T\\,da/dT-a}{b(\\delta_1-\\delta_2)}\\ln\\frac{v+\\delta_1 b}{v+\\delta_2 b}',
  });
  const phi = Math.exp(res.lnPhi);
  steps.push({ key: 'eos.fugacity', vars: { phi: fmt(phi, 5), f: fmt((phi * pPa) / 1000, 5) } });
  return steps;
}

export function solveEos(input: EosInput): ThermoResult {
  checkConstants(input);
  const T = positive(input.T, 'T');
  const e = eosParams(input.eos, T, input.Tc, input.pc * 1000, input.omega);
  const steps: KitStep[] = [];
  const state = input.given === 'Tv' ? stateFromTv(input, e, T, steps) : stateFromTp(input, e, T, steps);
  const res = residual(e, T, state.vm, state.Z);
  steps.push(...propertySteps(input, T, state, res));
  const p = state.pPa / 1000;
  const v = state.vm / (input.M / 1000);
  return {
    rows: eosRows(input, e, T, state, res),
    steps,
    latex: `Z=${tex(state.Z, 5)},\\quad v=${tex(v, 5)}\\ \\mathrm{m^3/kg}`,
    notes: ['cubicEos', 'departureRef'],
    plots: [
      {
        title: 'zIsotherm',
        x: { label: 'p', qty: 'p' },
        y: { label: 'Z', qty: 'none' },
        series: isotherm(e, T, Math.max(2 * p, 1.5 * input.pc)),
        marks: [{ x: p, y: state.Z, label: '1' }],
      },
    ],
    source: CRITICAL_SOURCE,
  };
}

/** The gases a mixture can hold: each has NASA polynomials and critical constants. */
export const MIX_GASES = ['N2', 'O2', 'CO2', 'H2O', 'CO', 'H2', 'Ar', 'He', 'CH4', 'C3H8'] as const;
export type MixGas = (typeof MIX_GASES)[number];

export interface MixInput {
  basis: 'mass' | 'mole';
  parts: readonly { gas: MixGas; amount: number }[];
  T: number;
  p: number;
}

/** An ideal-gas mixture: apparent molar mass, R, specific heats, Dalton and Amagat, and Kay's rule. */
export function solveMixture(input: MixInput): ThermoResult {
  const T = positive(input.T, 'T');
  const p = positive(input.p, 'p');
  const merged = new Map<MixGas, number>();
  for (const part of input.parts) {
    if (!Number.isFinite(part.amount)) throw new ThermoError('missing', { name: part.gas });
    if (part.amount < 0) throw new ThermoError('notNegative', { name: formulaText(part.gas) });
    merged.set(part.gas, (merged.get(part.gas) ?? 0) + part.amount);
  }
  const parts = [...merged].filter(([, amount]) => amount > 0);
  if (!parts.length) throw new ThermoError('mixEmpty');
  const gases = parts.map(([id, amount]) => ({ id, amount, gas: gasOf(id as GasId, 'variable'), crit: CRITICAL[id] }));
  // Moles of each per unit of the basis: mass parts divide by M, mole parts are moles already.
  const moles = gases.map((one) => (input.basis === 'mass' ? one.amount / one.gas.M : one.amount));
  const masses = gases.map((one) => (input.basis === 'mass' ? one.amount : one.amount * one.gas.M));
  const nTotal = moles.reduce((a, b) => a + b, 0);
  const mTotal = masses.reduce((a, b) => a + b, 0);
  const y = moles.map((n) => n / nTotal);
  const mf = masses.map((m) => m / mTotal);
  const M = y.reduce((sum, yi, i) => sum + yi * gases[i].gas.M, 0);
  const R = RU / M;
  const cp = mf.reduce((sum, w, i) => sum + w * gases[i].gas.cp(T), 0);
  const cv = cp - R;
  const k = cp / cv;
  const v = (R * T) / p;
  const dsMix = -R * y.reduce((sum, yi) => sum + yi * Math.log(yi), 0);
  const Tc = y.reduce((sum, yi, i) => sum + yi * gases[i].crit.Tc, 0);
  const pc = y.reduce((sum, yi, i) => sum + yi * gases[i].crit.pc, 0);
  const omega = y.reduce((sum, yi, i) => sum + yi * gases[i].crit.omega, 0);
  const real = solveEos({ eos: 'pr', Tc, pc, omega, M, given: 'Tp', T, p, root: 'stable' });
  const Z = real.rows.find((row) => row.key === 'zFactor')!.value;
  const vReal = real.rows.find((row) => row.key === 'v')!.value;
  const names = gases.map((one) => formulaText(one.id));
  const listOf = (values: number[], sig: number, unit = '') =>
    values.map((value, i) => `${names[i]} ${fmt(value, sig)}${unit}`).join(', ');
  const steps: KitStep[] = [
    input.basis === 'mass'
      ? { key: 'mix.moles', vars: { list: listOf(y, 5) }, math: 'N_i=\\frac{m_i}{M_i},\\quad y_i=\\frac{N_i}{\\sum N}' }
      : { key: 'mix.masses', vars: { list: listOf(mf, 5) }, math: 'm_i=N_iM_i,\\quad mf_i=\\frac{m_i}{\\sum m}' },
    {
      key: 'mix.M',
      vars: { M: fmt(M, 6), R: fmt(R, 5) },
      math: `M=\\sum y_iM_i=${tex(M, 6)},\\quad R=\\frac{R_u}{M}=${tex(R, 5)}`,
    },
    {
      key: 'mix.cp',
      vars: { T: fmt(T, 5), cp: fmt(cp, 5), cv: fmt(cv, 5), k: fmt(k, 5) },
      math: 'c_p=\\sum mf_i\\,c_{p,i}(T)',
    },
    {
      key: 'mix.dalton',
      vars: {
        list: listOf(
          y.map((yi) => yi * p),
          5,
          ' kPa',
        ),
      },
      math: 'p_i=y_ip',
    },
    { key: 'mix.amagat', vars: { v: fmt(v, 5) }, math: 'V_i=y_iV' },
    { key: 'mix.entropy', vars: { ds: fmt(dsMix, 5) }, math: '\\Delta s=-R\\sum y_i\\ln y_i' },
    { key: 'mix.kay', vars: { Tc: fmt(Tc, 5), pc: fmt(pc, 5), omega: fmt(omega, 4) }, math: "T_c'=\\sum y_iT_{c,i}" },
    { key: 'mix.real', vars: { Z: fmt(Z, 5), v: fmt(vReal, 5), err: fmt((1 / Z - 1) * 100, 3) } },
  ];
  const rows: ResultRow[] = [
    { key: 'molarMassRow', symbol: 'M', value: M, qty: 'molarM' },
    { key: 'gasR', symbol: 'R', value: R, qty: 's' },
    { key: 'cp', symbol: 'c_p', value: cp, qty: 's' },
    { key: 'cv', symbol: 'c_v', value: cv, qty: 's' },
    { key: 'kRatio', symbol: 'k', value: k, qty: 'none' },
    { key: 'v', symbol: 'v', value: v, qty: 'v' },
    { key: 'mixEntropy', symbol: '\\Delta s_{mix}', value: dsMix, qty: 's' },
    ...gases.flatMap((_, i): ResultRow[] => [
      { key: 'moleFraction', symbol: 'y', value: y[i], qty: 'none', tag: names[i] },
      { key: 'massFraction', symbol: 'mf', value: mf[i], qty: 'none', tag: names[i] },
      { key: 'partialPressure', symbol: 'p_i', value: y[i] * p, qty: 'p', tag: names[i] },
    ]),
    { key: 'pseudoTc', symbol: "T_c'", value: Tc, qty: 'T' },
    { key: 'pseudoPc', symbol: "p_c'", value: pc, qty: 'p' },
    { key: 'pseudoOmega', symbol: "\\omega'", value: omega, qty: 'none' },
    { key: 'zFactor', symbol: 'Z', value: Z, qty: 'none' },
    { key: 'vKay', symbol: 'v', value: vReal, qty: 'v' },
  ];
  return {
    rows,
    steps,
    latex: `M=${tex(M, 6)}\\ \\mathrm{g/mol},\\quad R=${tex(R, 5)}\\ \\mathrm{kJ/(kg\\,K)}`,
    notes: ['idealMixture', 'mixParts', 'kayRule'],
    source: `${NASA_SOURCE}; ${CRITICAL_SOURCE}`,
  };
}
