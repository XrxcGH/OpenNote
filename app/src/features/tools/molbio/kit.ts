// The tools of the kit, loaded one at a time when their tab is first shown so the window itself stays small.
import type { MolToolId } from './meta';
import type { ToolSpec } from './spec';

export const LOADERS: Record<MolToolId, () => Promise<{ spec: ToolSpec }>> = {
  sequence: () => import('./sequence/tool'),
  cloning: () => import('./cloning/tool'),
  protein: () => import('./protein/tool'),
  align: () => import('./align/tool'),
  crosses: () => import('./crosses/tool'),
};
