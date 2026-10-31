// The flag of the history, places, languages, and texts kit: on in development, nightly and beta builds while the
// tools are new, and off in stable builds.
import type { FlagDef } from '../../../app/flags';

export type HumanitiesFlagId = 'kits.humanities';

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';

export const HUMANITIES_FLAGS: readonly FlagDef[] = [
  {
    id: 'kits.humanities',
    description: 'Timelines, calendars, maps, coordinates, scripts, linguistics, text analysis, keys and note frames.',
    issue: `${ISSUES}${encodeURIComponent('kits.humanities')}`,
    enabled: { dev: true, nightly: true, beta: true, stable: false },
  },
];
