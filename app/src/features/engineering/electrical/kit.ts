// The tools of the kit, loaded one at a time when their tab is first shown so the window itself stays small.
import type { ToolSpec } from './spec';
import type { ElectricalToolId } from './meta';

export const LOADERS: Record<ElectricalToolId, () => Promise<{ spec: ToolSpec }>> = {
  netlist: () => import('./netlist/tool'),
  transients: () => import('./transients/tool'),
  instruments: () => import('./instruments/tool'),
  acpower: () => import('./acpower/tool'),
  opamps: () => import('./opamps/tool'),
  semis: () => import('./semis/tool'),
  powerflow: () => import('./powerflow/tool'),
  labfit: () => import('./labfit/tool'),
  energy: () => import('./energy/tool'),
};
