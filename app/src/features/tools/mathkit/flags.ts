// The flag of the engineering mathematics kit window. It is on in Beta while the tools are new and off in Stable.
import type { FlagDef } from '../../../app/flags';

export const MATH_KIT_FLAGS: readonly FlagDef[] = [
  {
    id: 'kits.math',
    description:
      'The engineering mathematics kit: linear algebra, calculus, series, Fourier, complex, ODEs, and numerics.',
    issue: 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3Akits.math',
    enabled: { dev: true, nightly: true, beta: true, stable: false },
  },
];
