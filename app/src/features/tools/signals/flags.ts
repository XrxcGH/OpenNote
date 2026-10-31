// The signals and sound kit's flag: on through Beta while it is new, off in Stable until people have tried it.
import type { FlagDef } from '../../../app/flags';

export type SignalsFlagId = 'kits.signals';

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';

export const SIGNALS_FLAGS: readonly FlagDef[] = [
  {
    id: 'kits.signals',
    description: 'The signals and sound kit: spectra, filters, systems, images, sound, communications, and RF.',
    issue: `${ISSUES}${encodeURIComponent('kits.signals')}`,
    enabled: { dev: true, nightly: true, beta: true, stable: false },
  },
];
