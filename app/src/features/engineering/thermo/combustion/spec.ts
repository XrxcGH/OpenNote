// The combustion tool's form: complete combustion with heating values and the flame temperature, the same with the
// products in chemical equilibrium, and a rocket chamber. A fuel from the list, or one typed by its atoms.
import { ThermoError } from '../common/types';
import { choice, num, pick, q, type FieldSpec, type ToolSpec, type Values } from '../common/spec';
import { solveComplete, solveEquilibrium, type CombustionInput } from './engine';
import { fuelOf, type Fuel, type FuelId, type Oxidizer } from './reaction';
import { solveRocket } from './rocket';

const FUEL_FIELD = (initial: FuelId): FieldSpec =>
  pick(
    'fuel',
    'fuel',
    [
      ['CH4', 'CH4'],
      ['C3H8', 'C3H8'],
      ['C8H18', 'C8H18'],
      ['H2', 'H2'],
      ['C12H23', 'C12H23'],
      ['custom', 'customFuel'],
    ],
    initial,
  );

function fuelFields(values: Values, initial: FuelId): FieldSpec[] {
  if (choice<FuelId>(values, 'fuel', initial) !== 'custom') return [FUEL_FIELD(initial)];
  return [
    FUEL_FIELD(initial),
    q('xC', 'carbonAtoms', 'none', 1),
    q('yH', 'hydrogenAtoms', 'none', 4),
    q('zO', 'oxygenAtoms', 'none', 0),
    q('wN', 'nitrogenAtoms', 'none', 0),
    q('hf', 'fuelHf', 'molarE', -74.6),
    pick('phase', 'fuelPhase', [
      ['gas', 'gasFuel'],
      ['liquid', 'liquidFuel'],
    ]),
  ];
}

function readFuel(values: Values, initial: FuelId): Fuel {
  const id = choice<FuelId>(values, 'fuel', initial);
  if (id !== 'custom') return fuelOf(id);
  const counts = (['xC', 'yH', 'zO', 'wN'] as const).map((key) => {
    const value = num(values, key);
    if (value < 0) throw new ThermoError('notNegative', { name: key[0] });
    return value;
  });
  const formula = ['C', 'H', 'O', 'N'].map((e, i) => (counts[i] > 0 ? `${e}${counts[i]}` : '')).join('');
  return fuelOf('custom', {
    formula,
    hf: num(values, 'hf'),
    liquid: choice<string>(values, 'phase', 'gas') === 'liquid',
  });
}

function mixtureFields(values: Values): FieldSpec[] {
  const byExcess = choice<string>(values, 'mixBy', 'phi') === 'excess';
  return [
    pick('oxidizer', 'oxidizer', [
      ['air', 'air'],
      ['O2', 'O2'],
    ]),
    pick('mixBy', 'mixBy', [
      ['phi', 'byPhi'],
      ['excess', 'byExcess'],
    ]),
    byExcess ? q('excess', 'excessAir', 'percent', 0) : q('phi', 'phi', 'none', 1),
    q('T', 'reactantT', 'T', 298.15),
    { ...q('p', 'pressure', 'p', 101.325), unit: { SI: 'kPa' } },
    pick('process', 'flameProcess', [
      ['p', 'isobaric'],
      ['v', 'isochoric'],
    ]),
  ];
}

function readMixture(values: Values): CombustionInput {
  let phi: number;
  if (choice<string>(values, 'mixBy', 'phi') === 'excess') {
    const excess = num(values, 'excess');
    if (!(excess > -100)) throw new ThermoError('phiRange');
    phi = 1 / (1 + excess / 100);
  } else phi = num(values, 'phi');
  return {
    fuel: readFuel(values, 'CH4'),
    oxidizer: choice<Oxidizer>(values, 'oxidizer', 'air'),
    phi,
    T: num(values, 'T'),
    p: num(values, 'p'),
    constantVolume: choice<string>(values, 'process', 'p') === 'v',
  };
}

export const spec: ToolSpec = {
  modes: [
    {
      id: 'complete',
      label: 'completeCombustion',
      fields: (values) => [...fuelFields(values, 'CH4'), ...mixtureFields(values)],
    },
    {
      id: 'equilibrium',
      label: 'equilibriumCombustion',
      fields: (values) => [
        ...fuelFields(values, 'CH4'),
        ...mixtureFields(values),
        pick('eqT', 'eqTemperature', [
          ['adiabatic', 'adiabaticFlame'],
          ['given', 'givenProductT'],
        ]),
        ...(choice<string>(values, 'eqT', 'adiabatic') === 'given' ? [q('Tp', 'productT', 'T', 2000)] : []),
      ],
    },
    {
      id: 'rocket',
      label: 'rocketChamber',
      fields: (values) => [
        ...fuelFields(values, 'H2'),
        q('of', 'ofRatio', 'none', 6),
        { ...q('pc', 'chamberP', 'p', 7000), unit: { SI: 'MPa' } },
        q('T', 'reactantT', 'T', 298.15),
      ],
    },
  ],
  solve(mode, values) {
    if (mode === 'rocket')
      return solveRocket({
        fuel: readFuel(values, 'H2'),
        of: num(values, 'of'),
        pc: num(values, 'pc'),
        T: num(values, 'T'),
      });
    const input = readMixture(values);
    if (mode === 'equilibrium')
      return solveEquilibrium({
        ...input,
        productT: choice<string>(values, 'eqT', 'adiabatic') === 'given' ? num(values, 'Tp') : null,
      });
    return solveComplete(input);
  },
};
