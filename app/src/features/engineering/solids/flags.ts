// The flag of the solid mechanics kit window. It is on through Beta while the tools are new, and off in Stable.
import type { FlagDef } from '../../../app/flags';

export type SolidsKitFlagId = 'kits.solids';

export const SOLIDS_KIT_FLAGS: readonly FlagDef[] = [
  {
    id: 'kits.solids',
    description:
      'The solid mechanics kit: sections, stress, members, beam deflection, columns, vessels, thin-walled structures, ' +
      'laminates, finite elements, fatigue and machine elements, and biomechanics.',
    issue: 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3Akits.solids',
    enabled: { dev: true, nightly: true, beta: true, stable: false },
  },
];
