// The flag of the dynamics and control kit window. It is on through Beta while the tools are new, and off in Stable.
import type { FlagDef } from '../../../app/flags';

export type ControlKitFlagId = 'kits.control';

export const CONTROL_KIT_FLAGS: readonly FlagDef[] = [
  {
    id: 'kits.control',
    description:
      'The dynamics and control kit: system models and responses, root locus, frequency response, compensators, ' +
      'state space, digital control, random processes, Markov chains, probability, and reliability.',
    issue: 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3Akits.control',
    enabled: { dev: true, nightly: true, beta: true, stable: false },
  },
];
