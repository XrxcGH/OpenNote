// Each tool's spec, loaded the first time its tab is shown, so the window itself stays small.
import type { AeroToolId } from './meta';
import type { ToolSpec } from './ui/spec';

export const LOADERS: Record<AeroToolId, () => Promise<{ spec: ToolSpec }>> = {
  atmosphere: () => import('./atmosphere/tool'),
  compressible: () => import('./compressible/tool'),
  nozzle: () => import('./nozzle/tool'),
  rocket: () => import('./rocket/tool'),
  wing: () => import('./wing/tool'),
  performance: () => import('./performance/tool'),
  potential: () => import('./potential/tool'),
  flightmodes: () => import('./flightmodes/tool'),
  jetengine: () => import('./jetengine/tool'),
};
