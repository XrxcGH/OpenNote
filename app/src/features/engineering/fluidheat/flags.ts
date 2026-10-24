// The flag of the fluid and heat transfer kit window. It is on through Beta while the tools are new, and off in Stable.
import type { FlagDef } from '../../../app/flags';

export type FluidHeatKitFlagId = 'kits.fluidheat';

export const FLUIDHEAT_KIT_FLAGS: readonly FlagDef[] = [
  {
    id: 'kits.fluidheat',
    description:
      'The fluid and heat transfer kit: fluid statics and Bernoulli, pipe flow and pumps, dimensional analysis, ' +
      'external flow and drag, viscous and biological flows, conduction, fins, transient conduction and diffusion, ' +
      'convection correlations, heat exchangers, and radiation.',
    issue: 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3Akits.fluidheat',
    enabled: { dev: true, nightly: true, beta: true, stable: false },
  },
];
