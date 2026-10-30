// The flag of the Chemistry and materials window: on in dev, nightly, and Beta; off in Stable while the tools are new.
import type { FlagDef } from '../../../app/flags';

export type ChemMatFlagId = 'kits.chemmat';

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';

export const CHEMMAT_FLAGS: readonly FlagDef[] = [
  {
    id: 'kits.chemmat',
    description: 'The Chemistry and materials window: thermochemistry, equilibrium, acids and bases, and more.',
    issue: `${ISSUES}${encodeURIComponent('kits.chemmat')}`,
    enabled: { dev: true, nightly: true, beta: true, stable: false },
  },
];
