// Each tool's spec, loaded when its tab first opens, so the window's own code stays small.
import type { ToolSpec } from './kit/spec';

export const SPECS: Readonly<Record<string, () => Promise<ToolSpec>>> = {
  glm: () => import('./glm/spec').then((m) => m.glmSpec),
  survival: () => import('./survival/spec').then((m) => m.survivalSpec),
};
