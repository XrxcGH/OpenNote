// Each tool's spec, loaded when its tab first opens, so the window's own code stays small.
import type { ToolSpec } from './kit/spec';

export const SPECS: Readonly<Record<string, () => Promise<ToolSpec>>> = {
  regression: () => import('./regression/spec').then((m) => m.regressionSpec),
  glm: () => import('./glm/spec').then((m) => m.glmSpec),
  survival: () => import('./survival/spec').then((m) => m.survivalSpec),
  spatial: () => import('./spatial/spec').then((m) => m.spatialSpec),
  causal: () => import('./causal/spec').then((m) => m.causalSpec),
  timeseries: () => import('./timeseries/spec').then((m) => m.timeseriesSpec),
  multivariate: () => import('./multivariate/spec').then((m) => m.multivariateSpec),
};
