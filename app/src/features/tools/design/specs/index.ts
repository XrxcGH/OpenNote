// The calculating tools' specs, each loaded the first time its tab opens.
import type { ToolSpec } from '../kit/spec';

export const SPECS: Record<string, () => Promise<ToolSpec>> = {
  tolerances: () => import('./tolerances').then((m) => m.tolerancesSpec),
};
