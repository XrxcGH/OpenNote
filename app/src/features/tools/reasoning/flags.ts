// The reasoning kit's flag: on in development, Nightly, and Beta while the tools are new; off in Stable.
import type { FlagDef } from '../../../app/flags';

export type ReasoningFlagId = 'kits.reasoning';

export const REASONING_FLAGS: readonly FlagDef[] = [
  {
    id: 'kits.reasoning',
    description:
      'The reasoning kit: logic, automata, discrete math, digital logic, computer systems, algorithms, optimization, and games and voting.',
    issue: `https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A${encodeURIComponent('kits.reasoning')}`,
    enabled: { dev: true, nightly: true, beta: true, stable: false },
  },
];
