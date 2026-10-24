// The flag of the fluid and heat transfer kit window. It is on through Beta while the tools are new, and off in Stable.
import type { FlagDef } from '../../../app/flags';

export type FluidHeatKitFlagId = 'kits.fluidheat';

export const FLUIDHEAT_KIT_FLAGS: readonly FlagDef[] = [
  {
    id: 'kits.fluidheat',
    description:
      'The fluid and heat transfer kit: sections, stress, members, beam deflection, columns, vessels, thin-walled structures, ' +
      'laminates, finite elements, fatigue and machine elements, and biomechanics.',
    issue: 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3Akits.fluidheat',
    enabled: { dev: true, nightly: true, beta: true, stable: false },
  },
];
