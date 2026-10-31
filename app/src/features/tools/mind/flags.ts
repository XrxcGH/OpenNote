// The flag of the psychology and behavior kit window. It is on through Beta while the tools are new, and off in
// Stable.
import type { FlagDef } from '../../../app/flags';

export type MindFlagId = 'kits.mind';

export const MIND_FLAGS: readonly FlagDef[] = [
  {
    id: 'kits.mind',
    description:
      'The psychology and behavior kit: signal detection, psychophysics, learning and choice models, response ' +
      'times, behavior observation, inter-rater agreement, scales and psychometrics, and qualitative coding.',
    issue: 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3Akits.mind',
    enabled: { dev: true, nightly: true, beta: true, stable: false },
  },
];
