// The kit foundation's flags: on through Beta while the kits are new, off in Stable. Each subject kit keeps its own
// window flag in its own folder; this one turns on the live calculation block that every kit can insert.
import type { FlagDef } from '../../../app/flags';

export type KitFlagId = 'kits.calc';

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const betaBuilds = { dev: true, nightly: true, beta: true, stable: false };

export const KIT_FLAGS: readonly FlagDef[] = [
  {
    id: 'kits.calc',
    description: 'Live calculation blocks: a kit result on the page that reopens its tool with the same inputs.',
    issue: `${ISSUES}${encodeURIComponent('kits.calc')}`,
    enabled: betaBuilds,
  },
];
