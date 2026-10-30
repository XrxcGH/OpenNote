// The combustion tool against the planning pass's validation values, then against independent routes. The
// energy balance is rechecked with the shared NASA functions, and each equilibrium is checked by the law of mass
// action for six reactions. Published flame temperatures, the rocket formulas, and every refusal are covered too.
import { describe, expect, it } from 'vitest';
import { ThermoError, type ThermoResult } from '../common/types';
import { toEngine } from '../common/units';
import { RU, SPECIES, hRT, molarH, sR, type SpeciesId } from '../data/nasa';
import { solveComplete, solveEquilibrium, type CombustionInput } from './engine';
import { equilibrium, solveLinear } from './equilibrium';
import { completeProducts, fuelOf, heatingValues, mixtureAtoms, mixtureOf, reactants } from './reaction';
import { cStar, solveRocket } from './rocket';
import { spec } from './spec';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const row = (r: ThermoResult, key: string, tag?: string) => {
  const found = r.rows.find((x) => x.key === key && (tag === undefined || x.tag === tag));
  if (!found) throw new Error(`no row ${key} ${tag ?? ''}`);
  return found.value;
};
const methaneAir = (over: Partial<CombustionInput> = {}): CombustionInput => ({
  fuel: fuelOf('CH4'),
  oxidizer: 'air',
  phi: 1,
  T: 298.15,
  p: 101.325,
  constantVolume: false,
  ...over,
});
const code = (f: () => unknown) => {
  try {
    f();
  } catch (error) {
    return error instanceof ThermoError ? error.code : String(error);
  }
  return 'none';
};

describe('combustion: validation cases', () => {
  it('balances methane with stoichiometric air and gives AFR = 17.19', () => {
    const mix = mixtureOf(fuelOf('CH4'), 'air', 1);
    expect(mix.a).toBeCloseTo(2, 12);
    const n = completeProducts(mix);
    expect(n.CO2).toBeCloseTo(1, 12);
    expect(n.H2O).toBeCloseTo(2, 12);
    expect(n.N2).toBeCloseTo(7.52, 12);
    expect(n.O2).toBe(0);
    expect(rel(row(solveComplete(methaneAir()), 'afrMass'), 17.19)).toBeLessThan(1e-3);
  });

  it('burns propane at φ = 0.8 with 25 % excess air', () => {
    const r = solveComplete(methaneAir({ fuel: fuelOf('C3H8'), phi: 0.8 }));
    expect(row(r, 'excessAir')).toBeCloseTo(25, 10);
    const n = completeProducts(mixtureOf(fuelOf('C3H8'), 'air', 0.8));
    expect([n.CO2, n.H2O, n.O2, n.N2].map((x) => Number(x?.toFixed(10)))).toEqual([3, 4, 1.25, 23.5]);
    expect(row(r, 'productMoles')).toBeCloseTo(31.75, 10);
    expect(rel(row(r, 'afrMass'), 19.54)).toBeLessThan(1e-3);
    expect(rel(row(r, 'moleFraction', 'H₂O'), 0.12598)).toBeLessThan(1e-3);
  });

  it('gives methane LHV = 802.30 kJ/mol = 50.01 MJ/kg and HHV = 890.31 kJ/mol = 55.50 MJ/kg', () => {
    const r = solveComplete(methaneAir());
    expect(rel(row(r, 'lhvMolar'), 802.3)).toBeLessThan(1e-3);
    expect(rel(row(r, 'lhvMass') / 1000, 50.01)).toBeLessThan(1e-3);
    expect(rel(row(r, 'hhvMolar'), 890.31)).toBeLessThan(1e-3);
    expect(rel(row(r, 'hhvMass') / 1000, 55.5)).toBeLessThan(1e-3);
  });

  it('puts the dew point of stoichiometric methane products at 59.25 °C', () => {
    const r = solveComplete(methaneAir());
    expect(rel(row(r, 'moleFraction', 'H₂O'), 0.19011)).toBeLessThan(1e-4);
    expect(rel(row(r, 'pv'), 19.26)).toBeLessThan(1e-3);
    expect(Math.abs(row(r, 'tdp') - 273.15 - 59.25)).toBeLessThan(0.1);
  });

  it('gives methane-air flame temperatures near 2330 K complete and 2225 K in equilibrium', () => {
    expect(Math.abs(row(solveComplete(methaneAir()), 'flameT') - 2330)).toBeLessThan(15);
    const eq = solveEquilibrium({ ...methaneAir(), productT: null });
    expect(Math.abs(row(eq, 'flameT') - 2225)).toBeLessThan(15);
    expect(row(eq, 'flameTComplete')).toBeGreaterThan(row(eq, 'flameT'));
  });
});

const gRT = (id: SpeciesId, T: number) => hRT(SPECIES[id], T) - sR(SPECIES[id], T);

describe('combustion: independent checks', () => {
  it('solves a small linear system', () => {
    const x = solveLinear(
      [
        [2, 1, -1],
        [-3, -1, 2],
        [-2, 1, 2],
      ],
      [8, -11, -3],
    );
    expect(x.map((v) => Number(v.toFixed(10)))).toEqual([2, 3, -1]);
  });

  it('holds the reactants’ enthalpy in the complete-combustion products at T_ad', () => {
    const input = methaneAir({ fuel: fuelOf('C3H8'), phi: 0.8, T: 400 });
    const T = row(solveComplete(input), 'flameT');
    const mix = mixtureOf(input.fuel, 'air', 0.8);
    const n = completeProducts(mix);
    const HP = Object.entries(n).reduce((s, [id, x]) => s + (x ?? 0) * molarH(SPECIES[id as SpeciesId], T), 0);
    const HR = molarH(SPECIES.C3H8, 400) + mix.a * (molarH(SPECIES.O2, 400) + 3.76 * molarH(SPECIES.N2, 400));
    expect(Math.abs(HP - HR)).toBeLessThan(1e-3);
  });

  it.each([
    [2000, 101.325, 1],
    [2600, 1000, 0.8],
    [1500, 5000, 1.3],
  ])('meets the law of mass action at %s K and %s kPa, φ = %s', (T, p, phi) => {
    const mix = mixtureOf(fuelOf('CH4'), 'air', phi);
    const atoms = mixtureAtoms(mix);
    const eq = equilibrium(atoms, T, p);
    const total = eq.moles;
    const y = (id: SpeciesId) => (eq.n[id as keyof typeof eq.n] ?? 0) / total;
    const P = p / 100;
    // ln K = −ΔG°/RT for each reaction, against the mole fractions and pressure it implies.
    const check = (products: [SpeciesId, number][], reactantsOf: [SpeciesId, number][]) => {
      const lnK =
        -products.reduce((s, [id, nu]) => s + nu * gRT(id, T), 0) +
        reactantsOf.reduce((s, [id, nu]) => s + nu * gRT(id, T), 0);
      const dn = products.reduce((s, [, nu]) => s + nu, 0) - reactantsOf.reduce((s, [, nu]) => s + nu, 0);
      const lnQ =
        products.reduce((s, [id, nu]) => s + nu * Math.log(y(id)), 0) -
        reactantsOf.reduce((s, [id, nu]) => s + nu * Math.log(y(id)), 0) +
        dn * Math.log(P);
      expect(Math.abs(lnQ - lnK)).toBeLessThan(1e-6);
    };
    check(
      [
        ['CO', 1],
        ['O2', 0.5],
      ],
      [['CO2', 1]],
    );
    check(
      [
        ['H2', 1],
        ['O2', 0.5],
      ],
      [['H2O', 1]],
    );
    check(
      [
        ['OH', 1],
        ['H2', 0.5],
      ],
      [['H2O', 1]],
    );
    check(
      [['NO', 1]],
      [
        ['N2', 0.5],
        ['O2', 0.5],
      ],
    );
    check([['H', 2]], [['H2', 1]]);
    check([['O', 2]], [['O2', 1]]);
    const C = (eq.n.CO2 ?? 0) + (eq.n.CO ?? 0);
    const N = 2 * (eq.n.N2 ?? 0) + (eq.n.NO ?? 0);
    expect(C).toBeCloseTo(atoms.C, 9);
    expect(N).toBeCloseTo(atoms.N, 9);
  });

  it('settles to complete combustion when cool and lean', () => {
    const eq = equilibrium(mixtureAtoms(mixtureOf(fuelOf('CH4'), 'air', 0.8)), 800, 101.325);
    expect(eq.n.CO2).toBeCloseTo(1, 6);
    expect(eq.n.H2O).toBeCloseTo(2, 6);
    expect(eq.n.O2).toBeCloseTo(0.5, 4); // a few ppm of NO take the rest
  });
});

describe('combustion: published flames, constant volume, and rockets', () => {
  it.each([
    ['propane-air', 'C3H8', 'air', 2267],
    ['methane-oxygen', 'CH4', 'O2', 3054],
    ['hydrogen-oxygen', 'H2', 'O2', 3079],
  ] as const)('matches the published equilibrium flame temperature of %s', (_, fuel, oxidizer, T) => {
    const r = solveEquilibrium({ ...methaneAir({ fuel: fuelOf(fuel), oxidizer }), productT: null });
    expect(Math.abs(row(r, 'flameT') - T)).toBeLessThan(25);
  });

  it('balances internal energy at constant volume, hotter and at a higher pressure', () => {
    const input = methaneAir({ constantVolume: true });
    const r = solveComplete(input);
    const T = row(r, 'flameT');
    const n = completeProducts(mixtureOf(input.fuel, 'air', 1));
    const moles = Object.values(n).reduce((s, x) => s + (x ?? 0), 0);
    const UP =
      Object.entries(n).reduce((s, [id, x]) => s + (x ?? 0) * molarH(SPECIES[id as SpeciesId], T), 0) - moles * RU * T;
    const re = reactants(mixtureOf(input.fuel, 'air', 1), 298.15);
    expect(Math.abs(UP - (re.H - re.gasMoles * RU * 298.15))).toBeLessThan(1e-3);
    expect(T).toBeGreaterThan(row(solveComplete(methaneAir()), 'flameT'));
    expect(row(r, 'flameP')).toBeCloseTo((101.325 * moles * T) / (re.gasMoles * 298.15), 6);
    const eq = solveEquilibrium({ ...input, productT: null });
    expect(row(eq, 'flameT')).toBeLessThan(T);
    expect(row(eq, 'flameT')).toBeGreaterThan(row(solveEquilibrium({ ...methaneAir(), productT: null }), 'flameT'));
  });

  it('gives the heating values of octane and hydrogen', () => {
    const octane = heatingValues(fuelOf('C8H18'));
    expect(rel(octane.lhv / 114.232 / 1000, 44.43)).toBeLessThan(2e-3);
    const h2 = heatingValues(fuelOf('H2'));
    expect(rel(h2.lhv / 1000, 241.826)).toBeLessThan(1e-4);
    expect(rel(h2.hhv / 1000, 285.83)).toBeLessThan(1e-4);
  });

  it('heats the products with the reactants and finds a rich equilibrium past the soot rule', () => {
    const cold = row(solveComplete(methaneAir()), 'flameT');
    expect(row(solveComplete(methaneAir({ T: 600 })), 'flameT')).toBeGreaterThan(cold);
    const rich = solveEquilibrium({ ...methaneAir({ phi: 1.8 }), productT: null });
    expect(row(rich, 'moleFraction', 'CO')).toBeGreaterThan(0.05);
  });

  it('works out a rocket chamber and its characteristic velocity', () => {
    const r = solveRocket({ fuel: fuelOf('H2'), of: 6, pc: 7000, T: 298.15 });
    const T = row(r, 'chamberT');
    expect(T).toBeGreaterThan(3300);
    expect(T).toBeLessThan(3800);
    const gamma = row(r, 'gammaFrozen');
    const M = row(r, 'meanM');
    const R = RU / (M / 1000);
    const byHand = Math.sqrt(R * T) / Math.sqrt(gamma * (2 / (gamma + 1)) ** ((gamma + 1) / (gamma - 1)));
    expect(row(r, 'cStar')).toBeCloseTo(byHand, 6);
    expect(cStar(1.2, 20, 3000)).toBeCloseTo(1721.99, 1);
    const same = solveEquilibrium({
      ...methaneAir({ fuel: fuelOf('H2'), oxidizer: 'O2', phi: row(r, 'equivalenceRatio'), p: 7000 }),
      productT: null,
    });
    expect(row(same, 'flameT')).toBeCloseTo(T, 3);
  });
});

describe('combustion: units, limits, and errors', () => {
  it('solves the default form and reads the units it is given', () => {
    const r = spec.solve('complete', {
      fuel: 'CH4',
      oxidizer: 'air',
      mixBy: 'excess',
      excess: 0,
      T: 298.15,
      p: 101.325,
    });
    const atm = spec.solve('complete', {
      fuel: 'CH4',
      oxidizer: 'air',
      mixBy: 'phi',
      phi: 1,
      T: toEngine(77, 'T', '°F'),
      p: toEngine(1, 'p', 'atm'),
    });
    expect(row(r, 'flameT')).toBeCloseTo(row(atm, 'flameT'), 1);
    expect(row(r, 'tdp')).toBeCloseTo(row(atm, 'tdp'), 6);
    const custom = spec.solve('complete', {
      fuel: 'custom',
      xC: 1,
      yH: 4,
      zO: 0,
      wN: 0,
      hf: -74.6,
      phase: 'gas',
      oxidizer: 'air',
      mixBy: 'phi',
      phi: 1,
      T: 298.15,
      p: 101.325,
    });
    expect(rel(row(custom, 'lhvMolar'), row(r, 'lhvMolar'))).toBeLessThan(1e-4);
    expect(spec.solve('rocket', { fuel: 'CH4', of: 3.4, pc: 10000, T: 298.15 }).rows.length).toBeGreaterThan(5);
    const given = spec.solve('equilibrium', {
      fuel: 'C3H8',
      oxidizer: 'air',
      mixBy: 'phi',
      phi: 1,
      T: 298.15,
      p: 101.325,
      eqT: 'given',
      Tp: 2000,
    });
    expect(row(given, 'moleFraction', 'CO₂')).toBeGreaterThan(0.1);
  });

  it('burns very lean mixtures a little above the reactant temperature', () => {
    const T = row(solveComplete(methaneAir({ phi: 0.05 })), 'flameT');
    expect(T).toBeGreaterThan(298.15);
    expect(T).toBeLessThan(500);
  });

  it('says what is wrong with impossible input', () => {
    expect(code(() => solveComplete(methaneAir({ phi: 0 })))).toBe('phiRange');
    expect(code(() => solveComplete(methaneAir({ phi: -1 })))).toBe('phiRange');
    expect(code(() => solveComplete(methaneAir({ phi: 2 })))).toBe('tooRich');
    expect(code(() => solveComplete(methaneAir({ oxidizer: 'O2' })))).toBe('flameHigh');
    expect(code(() => solveComplete(methaneAir({ p: 0 })))).toBe('notPositive');
    expect(code(() => solveComplete(methaneAir({ p: Number.NaN })))).toBe('notPositive');
    expect(code(() => solveEquilibrium({ ...methaneAir({ phi: 5 }), productT: null }))).toBe('tooRichEquilibrium');
    expect(code(() => solveRocket({ fuel: fuelOf('H2'), of: 0, pc: 7000, T: 298.15 }))).toBe('ofRange');
    expect(code(() => solveRocket({ fuel: fuelOf('H2'), of: 6, pc: -1, T: 298.15 }))).toBe('notPositive');
    expect(code(() => fuelOf('custom', { formula: 'CO2', hf: -393.5, liquid: false }))).toBe('none');
    expect(code(() => mixtureOf(fuelOf('custom', { formula: 'CO2', hf: -393.5, liquid: false }), 'air', 1))).toBe(
      'fuelNeedsNoOxygen',
    );
    expect(code(() => fuelOf('custom', { formula: '', hf: 0, liquid: false }))).toBe('fuelFormula');
    expect(code(() => fuelOf('custom', { formula: 'CH3Cl', hf: 0, liquid: false }))).toBe('unknownElement');
    expect(
      code(() =>
        spec.solve('complete', { fuel: 'CH4', oxidizer: 'air', mixBy: 'excess', excess: -100, T: 298, p: 100 }),
      ),
    ).toBe('phiRange');
    expect(
      code(() =>
        spec.solve('complete', {
          fuel: 'custom',
          xC: -1,
          yH: 4,
          zO: 0,
          wN: 0,
          hf: 0,
          phase: 'gas',
          oxidizer: 'air',
          mixBy: 'phi',
          phi: 1,
          T: 298,
          p: 100,
        }),
      ),
    ).toBe('notNegative');
    expect(code(() => solveComplete(methaneAir({ T: 1e9 })))).toBe('reactantRange');
    expect(code(() => solveComplete(methaneAir({ T: 100 })))).toBe('reactantRange');
  });
});
