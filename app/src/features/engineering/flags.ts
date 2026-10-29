// Flags for the engineering tools: on through Beta while they are new, off in Stable until people have tried them.
import type { FlagDef } from '../../app/flags';
import { FLUIDHEAT_KIT_FLAGS, type FluidHeatKitFlagId } from './fluidheat/flags';
import { SOLIDS_KIT_FLAGS, type SolidsKitFlagId } from './solids/flags';

// The kits' tool lists are plain data the command palette reads at start-up, so they are public here.
export { FLUIDHEAT_TOOLS } from './fluidheat/meta';
export { SOLIDS_TOOLS } from './solids/meta';
export { CALC_EVENT, type KitCalcRequest } from './solids/open';

export type EngineeringFlagId =
  | 'engineering.fbd'
  | 'engineering.structures'
  | 'engineering.circuit'
  | 'tables.units'
  | 'kits.electrical'
  | FluidHeatKitFlagId
  | 'kits.aero'
  | SolidsKitFlagId
  | 'kits.thermo';

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const betaBuilds = { dev: true, nightly: true, beta: true, stable: false };

const flag = (id: EngineeringFlagId, description: string): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled: betaBuilds,
});

export const ENGINEERING_FLAGS: readonly FlagDef[] = [
  ...FLUIDHEAT_KIT_FLAGS,
  flag(
    'engineering.fbd',
    'The free-body diagram kit: forces, moments, and supports that snap together, with live sums.',
  ),
  flag(
    'engineering.structures',
    'The beam and truss solvers: reactions, shear and moment diagrams, and member forces.',
  ),
  flag('engineering.circuit', 'Circuit symbols and the DC circuit solver: node voltages and branch currents.'),
  flag(
    'kits.electrical',
    'The circuits, electronics, power, instrument, data-fitting, and energy tools in one window, with worked steps.',
  ),
  flag(
    'kits.aero',
    'The aerospace tools in one window: atmosphere, gas dynamics, aerodynamics, performance and propulsion.',
  ),
  flag('tables.units', 'Units and engineering notation in smart table columns, with totals that convert units.'),
  ...SOLIDS_KIT_FLAGS,
  flag(
    'kits.thermo',
    'The thermodynamics kit: steam, refrigerant, and gas properties, devices, cycles, psychrometrics, and combustion.',
  ),
];
