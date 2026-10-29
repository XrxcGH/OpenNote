// The subject kits' distributions in one import: central and noncentral continuous distributions, the discrete
// ones, the studentized range, exact intervals, and the exact null distributions of the rank statistics.
export * from './distributions/continuous';
export * from './distributions/discrete';
export * from './distributions/noncentral';
export * from './distributions/range';
export * from './distributions/intervals';
export * from './distributions/exact';
export { continuousQuantile, discreteQuantile } from './distributions/quantile';
