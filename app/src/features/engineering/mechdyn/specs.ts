// Each tool's spec, loaded when its tab first opens, so the window's own code stays small.
import type { ToolSpec } from './kit/spec';
import { loadSymbolic } from './symbolic';

export const SPECS: Readonly<Record<string, () => Promise<ToolSpec>>> = {
  cam: () => import('./cam/spec').then((m) => m.camSpec),
  gears: () => import('./gears/spec').then((m) => m.gearsSpec),
  compliant: () => import('./compliant/spec').then((m) => m.compliantSpec),
  kinetics: () => Promise.all([import('./kinetics/spec'), loadSymbolic()]).then(([m]) => m.kineticsSpec),
  sdof: () => import('./sdof/spec').then((m) => m.sdofSpec),
  mdof: () => import('./mdof/spec').then((m) => m.mdofSpec),
  robotkin: () => import('./robotkin/spec').then((m) => m.robotKinSpec),
  robotdyn: () => import('./robotdyn/spec').then((m) => m.robotDynSpec),
};
