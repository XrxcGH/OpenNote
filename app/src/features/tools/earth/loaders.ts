// Where each earth kit tool's calculations load from. The window and the tests both read this list, and each
// entry is a dynamic import, so a tool's code loads only when its topic is first picked.
import './text';
import type { Mode } from './ui/form';
import type { EarthToolId } from './meta';

export const MODE_LOADERS: Record<EarthToolId, () => Promise<readonly Mode[]>> = {
  moist: () => import('./moist/modes').then((m) => m.MOIST_MODES),
  dating: () => import('./dating/modes').then((m) => m.DATING_MODES),
  stereonet: () => import('./stereonet/modes').then((m) => m.STEREONET_MODES),
  geodiagrams: () => import('./geodiagrams/modes').then((m) => m.GEODIAGRAMS_MODES),
  air: () => import('./air/modes').then((m) => m.AIR_MODES),
  seismic: () => import('./seismic/modes').then((m) => m.SEISMIC_MODES),
  geophysics: () => import('./geophysics/modes').then((m) => m.GEOPHYSICS_MODES),
  ocean: () => import('./ocean/modes').then((m) => m.OCEAN_MODES),
};
