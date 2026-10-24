// Each tool's spec, loaded when its tab first opens, so the window's own code stays small.
import type { ToolSpec } from './kit/spec';

export const SPECS: Readonly<Record<string, () => Promise<ToolSpec>>> = {
  statics: () => import('./statics/spec').then((m) => m.staticsSpec),
  pipes: () => import('./pipes/spec').then((m) => m.pipesSpec),
  dimensional: () => import('./dimensional/spec').then((m) => m.dimensionalSpec),
  external: () => import('./external/spec').then((m) => m.externalSpec),
  viscous: () => import('./viscous/spec').then((m) => m.viscousSpec),
  conduction: () => import('./conduction/spec').then((m) => m.conductionSpec),
};
