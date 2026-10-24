// Each tool's spec, loaded the first time its tab is shown, so the window itself stays small.
import type { AeroToolId } from './meta';
import type { ToolSpec } from './ui/spec';

export const LOADERS: Record<AeroToolId, () => Promise<{ spec: ToolSpec }>> = {
  atmosphere: () => import('./atmosphere/tool'),
};
