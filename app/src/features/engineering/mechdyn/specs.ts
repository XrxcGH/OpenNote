// Each tool's spec, loaded when its tab first opens, so the window's own code stays small.
import type { ToolSpec } from './kit/spec';

export const SPECS: Readonly<Record<string, () => Promise<ToolSpec>>> = {
  cam: () => import('./cam/spec').then((m) => m.camSpec),
  gears: () => import('./gears/spec').then((m) => m.gearsSpec),
  compliant: () => import('./compliant/spec').then((m) => m.compliantSpec),
  sdof: () => import('./sdof/spec').then((m) => m.sdofSpec),
};
