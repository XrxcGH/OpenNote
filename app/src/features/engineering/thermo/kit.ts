// Where each thermodynamics tool's form and engine live. Each loads the first time its tab opens, so the kit
// window itself stays small.
import type { ToolSpec } from './common/spec';
import type { ThermoToolId } from './meta';

export const THERMO_LOADERS: Record<ThermoToolId, () => Promise<{ spec: ToolSpec }>> = {
  steam: () => import('./steam/spec'),
  r134a: () => import('./r134a/spec'),
  idealgas: () => import('./idealgas/spec'),
  devices: () => import('./devices/spec'),
  cycles: () => import('./cycles/spec'),
  psychro: () => import('./psychro/spec'),
  statthermo: () => import('./statthermo/spec'),
};
