// Each tool's spec, loaded when its tab first opens, so the window's own code stays small.
import type { ToolSpec } from './kit/spec';

export const SPECS: Readonly<Record<string, () => Promise<ToolSpec>>> = {
  sdof: () => import('./sdof/spec').then((m) => m.sdofSpec),
};
