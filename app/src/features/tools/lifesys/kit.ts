// Loads a life-systems tool's forms and engines the first time its tab opens, so the window itself stays small.
import type { LifeSysToolId } from './meta';
import type { ToolSpec } from './types';

export const KIT_LOADERS: Record<LifeSysToolId, () => Promise<ToolSpec>> = {
  pharmacology: () => import('./pharmacology/tool').then((m) => m.tool),
  population: () => import('./population/tool').then((m) => m.tool),
  demography: () => import('./demography/tool').then((m) => m.tool),
  bench: () => import('./bench/tool').then((m) => m.tool),
  diversity: () => import('./diversity/tool').then((m) => m.tool),
};
