// Flags for the engineering tools: on through Beta while they are new, off in Stable until people have tried them.
import type { FlagDef } from '../../app/flags';
import { SOLIDS_KIT_FLAGS, type SolidsKitFlagId } from './solids/flags';

// The solid mechanics kit's tool list is plain data the command palette reads at start-up, so it is public here.
export { SOLIDS_TOOLS } from './solids/meta';

export type EngineeringFlagId =
  'engineering.fbd' | 'engineering.structures' | 'engineering.circuit' | 'tables.units' | SolidsKitFlagId;

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const betaBuilds = { dev: true, nightly: true, beta: true, stable: false };

const flag = (id: EngineeringFlagId, description: string): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled: betaBuilds,
});

export const ENGINEERING_FLAGS: readonly FlagDef[] = [
  flag(
    'engineering.fbd',
    'The free-body diagram kit: forces, moments, and supports that snap together, with live sums.',
  ),
  flag(
    'engineering.structures',
    'The beam and truss solvers: reactions, shear and moment diagrams, and member forces.',
  ),
  flag('engineering.circuit', 'Circuit symbols and the DC circuit solver: node voltages and branch currents.'),
  flag('tables.units', 'Units and engineering notation in smart table columns, with totals that convert units.'),
  ...SOLIDS_KIT_FLAGS,
];
