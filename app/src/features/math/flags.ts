// Flags of the calculator and graphing lane: the calculator's other modes, 3D graphs, live solving, the Graph button
// on an equation, and the step-by-step views. They are on in development, nightly, and Beta builds, and wait for a
// hand test before Stable. app/flags.ts joins this list to the others.
import type { FlagDef } from '../../app/flags';

export type MathToolsFlagId = 'math.calcModes' | 'math.graph3d' | 'math.liveSolve' | 'math.graphPopup' | 'math.steps' | 'math.solvers'
  | 'math.curves'
  | 'math.vectors'
  | 'math.geometry3d'
  | 'math.solids'
  | 'math.projectile';

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';
const beta = { dev: true, nightly: true, beta: true, stable: false };

const flag = (id: MathToolsFlagId, description: string): FlagDef => ({
  id,
  description,
  issue: `${ISSUES}${encodeURIComponent(id)}`,
  enabled: beta,
});

export const MATH_TOOLS_FLAGS: readonly FlagDef[] = [
  flag('math.calcModes', 'Basic, programmer, statistics, matrix, and 3D graphing modes in the calculator.'),
  flag('math.graph3d', '3D graphs of surfaces and curves, in the calculator and in graph blocks.'),
  flag('math.liveSolve', 'Solutions to equations as you type, on page lines and beside equations.'),
  flag('math.graphPopup', 'A Graph button on a selected equation or on handwriting turned into math.'),
  flag('math.steps', 'Step-by-step derivatives and integrals, and linear systems in Solve.'),
  flag(
    'math.solvers',
    // checks-disable-next-line length: one flag description, kept whole as the flags panel shows it
    'The Math solvers window: double and triple integrals, differential equations, Laplace and Fourier transforms, Taylor series, root finding, error propagation and units, probability and regression, eigenvalues, and projectiles.',
  ),
  flag('math.curves', 'Parametric and polar curves with an animated trace, and vector and slope fields.'),
  flag('math.vectors', 'The Vectors tool: dot and cross products, projections, and 3D vector plots.'),
  flag('math.geometry3d', 'Lines and planes in 3D: distances, intersections, and angles, with a plot.'),
  flag('math.solids', 'Solids of revolution: disk, washer, and shell volumes with steps and a 3D view.'),
  flag('math.projectile', 'The projectile simulator: speed, angle, height, gravity, and drag, with a trajectory.'),
];
