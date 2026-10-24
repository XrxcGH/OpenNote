// The modern physics and astronomy tools' flag: on through Beta while the tools are new, off in Stable.
import type { FlagDef } from '../../../app/flags';

export type ModPhysFlagId = 'kits.modphys';

export const MODPHYS_FLAGS: readonly FlagDef[] = [
  {
    id: 'kits.modphys',
    description: 'Quantum, atomic, molecular, solid-state, plasma, and astronomy tools in one window.',
    issue: 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3Akits.modphys',
    enabled: { dev: true, nightly: true, beta: true, stable: false },
  },
];
