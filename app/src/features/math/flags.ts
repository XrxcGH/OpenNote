// Flags of the math feature's own windows: the math solvers (beta 5, calc-solvers lane). app/flags.ts joins them to
// its list, so they load at start-up. On in development, nightly, and Beta builds, and off in Stable until done.
import type { FlagDef } from '../../app/flags';

export type SolverFlagId =
  /** The Math solvers window: integrals, equations, transforms, series, roots, errors, probability, matrices. */
  'math.solvers';

const building = { dev: true, nightly: true, beta: true, stable: false };

export const SOLVER_FLAGS: readonly FlagDef[] = [
  {
    id: 'math.solvers',
    description:
      // checks-disable-next-line length: one flag description, kept whole as the flags panel shows it
      'The Math solvers window: double and triple integrals, differential equations, Laplace and Fourier transforms, Taylor series, root finding, error propagation and units, probability and regression, eigenvalues, and projectiles.',
    issue: 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3Amath.solvers',
    enabled: building,
  },
];
