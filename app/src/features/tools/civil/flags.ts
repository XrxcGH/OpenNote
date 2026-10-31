// The civil, environmental, and chemical engineering kit's flag: on through Beta while the tools are new.
import type { FlagDef } from '../../../app/flags';

export type CivilFlagId = 'kits.civil';

export const CIVIL_FLAGS: readonly FlagDef[] = [
  {
    id: 'kits.civil',
    description:
      'Civil, environmental, and chemical engineering tools: groundwater, water treatment, soils, foundations, ' +
      'hydraulics, structures, transportation, process balances, and reactors.',
    issue: `https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A${encodeURIComponent('kits.civil')}`,
    enabled: { dev: true, nightly: true, beta: true, stable: false },
  },
];
