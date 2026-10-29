// The subject kits' shared library in one import (subjects/README.md). It holds data sets and their parsers, the
// distributions, rank helpers, plot data, least squares, maximum likelihood, the seeded generator, and the worker
// runner. It also holds the tree layout, the graph layouts, the input fields, the plots, the coefficient table, and
// figures. A kit's tools import from here; a kit's own lazy window loads it with them.
export * from './errors';
export * from './data/model';
export * from './data/parse';
export * from './data/longWide';
export * from './data/page';
export * from './stats/dist';
export * from './stats/rank';
export * from './stats/plots';
export * from './num/lm';
export { bfgs, maximizeLikelihood, nelderMead, numericHessian, profileInterval } from './num/mle';
export type { LogLikelihood, MleFit, ProfileInterval } from './num/mle';
export * from './num/rng';
export * from './num/worker';
export * from './layout/tree';
export * from './layout/graph';
export * from './layout/layered';
export * from './layout/force';
export * from './layout/svg';
export * from './figure/model';
export { mountKitFigure } from './figure/block';
export * from './ui/input';
export * from './ui/statPlots';
export * from './ui/words';
export * from './ui/insertFigure';
export * from './ui/fields';
export * from './ui/output';
