// Each tool's spec and words, loaded when its tab first opens, so neither is in the app's start-up code. The words
// are added to kitStatModels.<tool> and kitStatModels.step.<tool>, where only the title and keywords wait before;
// the window's shared words and error messages are added to kitStatModels.ui and .error with the first tool.
import { en } from '../../../strings/en';
import type { ToolSpec } from './kit/spec';

type Words = Readonly<Record<string, unknown>>;

/** Adds a tool's words to the kit's strings, once. */
export function addWords(tool: string, words: Words, steps: Words): void {
  const kit = en.kitStatModels as unknown as Record<string, Record<string, unknown>> & {
    step: Record<string, Record<string, unknown>>;
  };
  Object.assign(kit[tool], words);
  Object.assign(kit.step[tool], steps);
}

/** Adds the window's shared words and error messages, once. */
export function addShared(words: { ui: Words; error: Words }): void {
  const kit = en.kitStatModels as unknown as Record<string, Record<string, unknown>>;
  Object.assign(kit.ui, words.ui);
  Object.assign(kit.error, words.error);
}

const load = async <T>(
  tool: string,
  spec: Promise<T>,
  words: Promise<Record<string, unknown>>,
  pick: (m: T) => ToolSpec,
): Promise<ToolSpec> => {
  const [m, w, shared] = await Promise.all([spec, words, import('../../../strings/en/kitStatModels/shared')]);
  addShared(shared.shared);
  addWords(tool, w[tool] as Words, w[`${tool}Steps`] as Words);
  return pick(m);
};

export const SPECS: Readonly<Record<string, () => Promise<ToolSpec>>> = {
  regression: () =>
    load(
      'regression',
      import('./regression/spec'),
      import('../../../strings/en/kitStatModels/regression'),
      (m) => m.regressionSpec,
    ),
  glm: () => load('glm', import('./glm/spec'), import('../../../strings/en/kitStatModels/glm'), (m) => m.glmSpec),
  survival: () =>
    load(
      'survival',
      import('./survival/spec'),
      import('../../../strings/en/kitStatModels/survival'),
      (m) => m.survivalSpec,
    ),
  causal: () =>
    load('causal', import('./causal/spec'), import('../../../strings/en/kitStatModels/causal'), (m) => m.causalSpec),
  timeseries: () =>
    load(
      'timeseries',
      import('./timeseries/spec'),
      import('../../../strings/en/kitStatModels/timeseries'),
      (m) => m.timeseriesSpec,
    ),
  multivariate: () =>
    load(
      'multivariate',
      import('./multivariate/spec'),
      import('../../../strings/en/kitStatModels/multivariate'),
      (m) => m.multivariateSpec,
    ),
  ml: () => load('ml', import('./ml/spec'), import('../../../strings/en/kitStatModels/ml'), (m) => m.mlSpec),
  spatial: () =>
    load(
      'spatial',
      import('./spatial/spec'),
      import('../../../strings/en/kitStatModels/spatial'),
      (m) => m.spatialSpec,
    ),
};
