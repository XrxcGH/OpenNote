// Where each earth kit tool's calculations load from. The window and the tests both read this list, and each
// entry is a dynamic import, so a tool's code loads only when its topic is first picked.
import type { Mode } from './ui/form';
import type { EarthToolId } from './meta';

export const MODE_LOADERS: Record<EarthToolId, () => Promise<readonly Mode[]>> = {
  geophysics: () => import('./geophysics/modes').then((m) => m.GEOPHYSICS_MODES),
};
