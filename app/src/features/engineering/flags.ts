// Flags for the engineering tools: on through Beta while they are new, off in Stable until people have tried them.
import type { FlagDef } from '../../app/flags';

export type EngineeringFlagId = 'engineering.fbd';

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
];
