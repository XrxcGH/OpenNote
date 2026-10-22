// Which solver the window shows. A command from the palette or the ribbon picks one before it opens the window, and
// the choice is kept on this device, so a window of its own opens on it too.
import { loadSaved, saveSaved } from './storage';

export const SOLVER_TABS = [
  'integrals',
  'equations',
  'transforms',
  'series',
  'roots',
  'errors',
  'probability',
  'matrices',
  'projectile',
] as const;

export type SolverTab = (typeof SOLVER_TABS)[number];

const KEY = 'tab';
const listeners = new Set<(tab: SolverTab) => void>();

export function storedTab(): SolverTab {
  const saved = loadSaved<string>(KEY, 'integrals');
  return (SOLVER_TABS as readonly string[]).includes(saved) ? (saved as SolverTab) : 'integrals';
}

export function chooseTab(tab: SolverTab): void {
  saveSaved(KEY, tab);
  for (const listener of listeners) listener(tab);
}

export function onTab(listener: (tab: SolverTab) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
