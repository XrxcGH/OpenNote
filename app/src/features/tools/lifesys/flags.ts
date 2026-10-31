// The life-systems kit's flag: physiology, neurons, pharmacology, binding curves, bench calculations, populations,
// demography, network models, and biodiversity in one tool window. On through Beta while it is new.
import type { FlagDef } from '../../../app/flags';

export type LifeSysFlagId = 'kits.lifesys';

export const LIFESYS_FLAGS: readonly FlagDef[] = [
  {
    id: 'kits.lifesys',
    description:
      'Life science study tools: physiology, neurons, drug levels, binding curves, lab math, populations, and ecology.',
    issue: `https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A${encodeURIComponent('kits.lifesys')}`,
    enabled: { dev: true, nightly: true, beta: true, stable: false },
  },
];
