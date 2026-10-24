// Each tool's spec, loaded the first time its tab opens, so the window's own code stays small.
import type { ToolSpec } from './ui/spec';

export const SPECS: Readonly<Record<string, () => Promise<ToolSpec>>> = {
  distributions: () => import('./distributions/spec').then((m) => m.spec),
  markov: () => import('./markov/spec').then((m) => m.spec),
};
