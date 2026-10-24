// Loads a life-systems tool's forms and engines the first time its tab opens, so the window itself stays small.
import type { LifeSysToolId } from './meta';
import type { ToolSpec } from './types';

export const KIT_LOADERS: Record<LifeSysToolId, () => Promise<ToolSpec>> = {
  diversity: () => import('./diversity/tool').then((m) => m.tool),
};
