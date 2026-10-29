// The subject kits' shared library in one import (subjects/README.md): data sets and their parsers, distributions,
// rank helpers, plot data, least squares, maximum likelihood, the seeded generator, the worker runner, tree and graph
// layouts, and the input fields, plots, coefficient table, and figures. A subject kit's tools import from here;
// code outside the tools feature reaches it with loadSubjects() from features/tools/index.ts.
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
