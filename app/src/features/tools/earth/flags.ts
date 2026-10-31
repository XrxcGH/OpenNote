// The earth sciences kit's flag: on through Beta while the kit is new, off in Stable until people have tried it.
import type { FlagDef } from '../../../app/flags';

export type EarthFlagId = 'kits.earth';

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';

export const EARTH_FLAGS: readonly FlagDef[] = [
  {
    id: 'kits.earth',
    description:
      'The earth sciences kit: structural geology, geophysics, dating, stratigraphy, weather, climate, and ocean tools.',
    issue: `${ISSUES}${encodeURIComponent('kits.earth')}`,
    enabled: { dev: true, nightly: true, beta: true, stable: false },
  },
];
