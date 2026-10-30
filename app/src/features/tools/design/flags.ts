// The flag of the design kit window. It is on through Beta while the tools are new, and off in Stable.
import type { FlagDef } from '../../../app/flags';

export type DesignKitFlagId = 'kits.design';

export const DESIGN_KIT_FLAGS: readonly FlagDef[] = [
  {
    id: 'kits.design',
    description:
      'The design kit: drafting sheets and views, tolerances and fits, machining, forming and casting, micro and nano ' +
      'fabrication, number representations, the memory and pointer tracer, and programming references.',
    issue: 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3Akits.design',
    enabled: { dev: true, nightly: true, beta: true, stable: false },
  },
];
