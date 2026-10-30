// The adiabatic flame temperature: the T where the products hold the reactants' enthalpy (constant pressure) or
// internal energy (constant volume). Newton's method on that energy balance, kept inside a bracket so it cannot
// run off, with every try logged for the worked steps.
import { ThermoError } from '../common/types';
import { RU } from '../data/nasa';
import { equilibrium } from './equilibrium';
import { T_LIMIT, productH, type Amounts, type Element } from './species';

export interface FlameTry {
  T: number;
  /** Products' energy minus the reactants', J per mole of fuel. */
  gap: number;
  /** d(gap)/dT, J/K. */
  slope: number;
}

/** A root of an increasing gap(T) between lo and hi by bracketed Newton, with each try. */
export function newtonBracket(
  gap: (T: number) => { gap: number; slope: number },
  lo: number,
  hi: number,
  start: number,
): { T: number; tries: FlameTry[] } {
  const tries: FlameTry[] = [];
  let a = lo;
  let b = hi;
  let T = Math.min(Math.max(start, lo + 1), hi - 1);
  for (let i = 0; i < 80; i++) {
    const g = gap(T);
    tries.push({ T, gap: g.gap, slope: g.slope });
    if (g.gap < 0) a = T;
    else b = T;
    let next = T - g.gap / g.slope;
    if (!(next > a && next < b)) next = (a + b) / 2;
    if (Math.abs(next - T) < 1e-5 || b - a < 1e-5) return { T: next, tries };
    T = next;
  }
  throw new ThermoError('flameFailed');
}

export interface FlameSetup {
  /** The reactants' enthalpy, J per mole of fuel. */
  H: number;
  /** Moles of reactant gas per mole of fuel, and their temperature (K) and pressure (kPa). */
  gasMoles: number;
  T: number;
  p: number;
  constantVolume: boolean;
}

/** The energy the balance compares: H at constant pressure, U = H − n R T at constant volume (ideal gases). */
const reactantEnergy = (s: FlameSetup): number => (s.constantVolume ? s.H - s.gasMoles * RU * s.T : s.H);

function bracket(s: FlameSetup, gap: (T: number) => number): void {
  if (!(gap(Math.max(s.T, 200)) < 0)) throw new ThermoError('flameNoHeat');
  if (gap(T_LIMIT) < 0) throw new ThermoError('flameHigh', { max: String(T_LIMIT) });
}

/** The flame temperature of products that keep a fixed composition, such as complete combustion. */
export function frozenFlame(s: FlameSetup, n: Amounts): { T: number; tries: FlameTry[]; p: number } {
  const target = reactantEnergy(s);
  const gapAt = (T: number) => {
    const { H, Cp, moles } = productH(n, T);
    return s.constantVolume
      ? { gap: H - moles * RU * T - target, slope: Cp - moles * RU }
      : { gap: H - target, slope: Cp };
  };
  bracket(s, (T) => gapAt(T).gap);
  const { T, tries } = newtonBracket(gapAt, Math.max(s.T, 200), T_LIMIT, 2000);
  const moles = productH(n, T).moles;
  return { T, tries, p: s.constantVolume ? (s.p * moles * T) / (s.gasMoles * s.T) : s.p };
}

/** Equilibrium products at T: at the given pressure, or at constant volume the pressure the products reach. */
export function productsAt(s: FlameSetup, atoms: Record<Element, number>, T: number, start?: Amounts) {
  let p = s.p;
  let eq = equilibrium(atoms, T, p, start);
  if (!s.constantVolume) return { ...eq, p };
  for (let i = 0; i < 50; i++) {
    const next = (s.p * eq.moles * T) / (s.gasMoles * s.T);
    if (Math.abs(next - p) < 1e-10 * p) break;
    p = next;
    eq = equilibrium(atoms, T, p, eq.n);
  }
  return { ...eq, p };
}

/** The flame temperature with the products in chemical equilibrium at every trial temperature. */
export function equilibriumFlame(s: FlameSetup, start: Amounts, atoms: Record<Element, number>) {
  const target = reactantEnergy(s);
  let guess = start;
  const energy = (T: number) => {
    const eq = productsAt(s, atoms, T, guess);
    guess = eq.n;
    const { H, moles } = productH(eq.n, T);
    return s.constantVolume ? H - moles * RU * T - target : H - target;
  };
  bracket(s, energy);
  const gapAt = (T: number) => {
    const g = energy(T);
    return { gap: g, slope: (energy(T + 0.5) - energy(T - 0.5)) / 1 };
  };
  const { T, tries } = newtonBracket(gapAt, Math.max(s.T, 200) + 1, T_LIMIT - 1, 2200);
  const eq = productsAt(s, atoms, T, guess);
  return { T, tries, ...eq };
}
