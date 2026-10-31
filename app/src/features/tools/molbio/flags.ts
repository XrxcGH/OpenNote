// The molecular biology kit's flag: on through Beta while it is new, off in Stable until people have tried it.
import type { FlagDef } from '../../../app/flags';

export type MolBioFlagId = 'kits.molbio';

export const MOLBIO_FLAGS: readonly FlagDef[] = [
  {
    id: 'kits.molbio',
    description:
      'The molecular biology, genetics, evolution and pedigree tools in one window, with worked steps and pictures.',
    issue: `https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A${encodeURIComponent('kits.molbio')}`,
    enabled: { dev: true, nightly: true, beta: true, stable: false },
  },
];
