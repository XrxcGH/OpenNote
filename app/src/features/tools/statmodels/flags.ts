// The flag of the statistical models kit window. It is on through Beta while the tools are new, and off in Stable.
import type { FlagDef } from '../../../app/flags';

export type StatModelsFlagId = 'kits.statmodels';

export const STATMODELS_FLAGS: readonly FlagDef[] = [
  {
    id: 'kits.statmodels',
    description:
      'The statistical models kit: logistic and Poisson regression, survival analysis, linear regression, time ' +
      'series, multivariate methods, econometrics and causal inference, machine learning, and spatial statistics.',
    issue: 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3Akits.statmodels',
    enabled: { dev: true, nightly: true, beta: true, stable: false },
  },
];
