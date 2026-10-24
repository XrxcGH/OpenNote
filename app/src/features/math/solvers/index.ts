// The math solvers (beta 5): engines with no DOM and no React, each with worked steps whose words live in the
// strings (solvers.step), and the window that shows them (ui/). Every answer an engine works by hand is also found
// numerically, and the hand answer is shown only when the two agree.
export { solveIntegral, regionLimits, REGION_PARAMS, REGION_SYSTEMS, SYSTEM_VARIABLES } from './multiple';
export type { CoordinateSystem, IntegralInput, IntegralResult, Limit, RegionKind } from './multiple';
export { solveOde } from './ode';
export type { OdeInput, OdeKind, OdeResult } from './ode';
export {
  FOURIER_PAIRS,
  FOURIER_PROPERTIES,
  LAPLACE_PAIRS,
  LAPLACE_PROPERTIES,
  fourier,
  inverseFourier,
  inverseLaplace,
  laplace,
  searchTable,
} from './transforms';
export type { Pair, TransformResult } from './transforms';
export { taylor } from './series';
export type { SeriesInput, SeriesResult } from './series';
export { findRoot } from './roots';
export type { RootInput, RootMethod, RootOutcome, RootResult } from './roots';
export { propagate, roundedPair } from './uncertainty';
export type { Measured, PropagationResult } from './uncertainty';
export { checkUnits, dimsText, unitDims } from './dimensions';
export type { UnitCheck, UnitProblem } from './dimensions';
export { probability, quantile, regression } from './probability';
export type { Distribution, ProbabilityResult, Region, RegressionResult } from './probability';
export { eigen } from './eigen';
export type { EigenResult } from './eigen';
export { dragFactor, simulate, vacuumFlight } from './projectile';
export type { ProjectileInput, ProjectileResult } from './projectile';
export { SolverError } from './expr';
export type { Step, StepKey, XY } from './steps';
