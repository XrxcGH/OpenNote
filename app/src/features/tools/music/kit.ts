// The tools of the kit, loaded one at a time when their tab is first shown so the window itself stays small.
import type { ComponentType } from 'react';
import type { ToolSpec } from './spec';
import type { MusicToolId } from './meta';

/** A tool is a list of fields with an engine, or a panel of its own when it needs more than a form. */
export interface LoadedTool {
  spec?: ToolSpec;
  Panel?: ComponentType;
}

export const LOADERS: Record<MusicToolId, () => Promise<LoadedTool>> = {
  theory: () => import('./theory/tool'),
  camera: () => import('./camera/tool'),
  studio: () => import('./studio/tool'),
  rhythm: () => import('./rhythm/tool'),
};
