// Each tool's spec, loaded when its tab first opens, so the window's own code stays small.
import type { ToolSpec } from './kit/spec';

export const SPECS: Readonly<Record<string, () => Promise<ToolSpec>>> = {
  columns: () => import('./columns/spec').then((m) => m.columnsSpec),
  stress: () => import('./stress/spec').then((m) => m.stressSpec),
  sections: () => import('./sections/spec').then((m) => m.sectionsSpec),
  members: () => import('./members/spec').then((m) => m.membersSpec),
  deflection: () => import('./deflection/spec').then((m) => m.deflectionSpec),
  vessels: () => import('./vessels/spec').then((m) => m.vesselsSpec),
};
