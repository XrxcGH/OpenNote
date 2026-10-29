// Each tool's spec, loaded the first time its tab opens, so the window's own code stays small.
import type { ToolSpec } from './kit/spec';

export const SPECS: Readonly<Record<string, () => Promise<ToolSpec>>> = {
  sdt: () => import('./sdt/spec').then((m) => m.spec),
  scales: () => import('./scales/spec').then((m) => m.spec),
  agreement: () => import('./agreement/spec').then((m) => m.spec),
  coding: () => import('./coding/spec').then((m) => m.spec),
  observe: () => import('./observe/spec').then((m) => m.spec),
  choice: () => import('./choice/spec').then((m) => m.spec),
  rt: () => import('./rt/spec').then((m) => m.spec),
  psychophysics: () => import('./psychophysics/spec').then((m) => m.spec),
  learning: () => import('./learning/spec').then((m) => m.spec),
};
