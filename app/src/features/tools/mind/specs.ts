// Each tool's spec, loaded the first time its tab opens, so the window's own code stays small.
import type { ToolSpec } from './kit/spec';

export const SPECS: Readonly<Record<string, () => Promise<ToolSpec>>> = {
  sdt: () => import('./sdt/spec').then((m) => m.spec),
};
