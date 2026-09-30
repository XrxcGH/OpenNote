// Where the person is: a typed Location with back and forward history, instead of a router
// (ARCHITECTURE.md section 5.3). Tabs and windows later turn the single location into a list, and call sites
// keep using navigate().

import type { SettingsSectionId, SetupStepId } from '../registries/types';
import type { NodeId } from '../services/notes/types';
import { sessionStore } from '../state/session';
import { useStore } from '../state/store';

export type Location =
  | { view: 'workspace'; notebookId: NodeId | null; sectionId: NodeId | null; pageId: NodeId | null }
  | { view: 'settings'; section: SettingsSectionId }
  | { view: 'setup'; step: SetupStepId }
  | { view: 'trash' };

export interface NavigateOptions {
  /** Replace the current entry instead of pushing one. */
  replace?: boolean;
  /** 'target' (the default): the new view focuses its heading or selected row. */
  focus?: 'target' | 'keep';
}

/** Each history stack keeps at most this many entries. */
export const HISTORY_LIMIT = 50;

const same = (a: Location, b: Location) => JSON.stringify(a) === JSON.stringify(b);

export function navigate(to: Location, options: NavigateOptions = {}): void {
  sessionStore.set((state) => {
    if (same(state.location, to)) return state;
    if (options.replace) return { ...state, location: to };
    const back = [...state.back, state.location].slice(-HISTORY_LIMIT);
    return { ...state, location: to, back, forward: [] };
  });
}

/** False when there is nothing to go back to. */
export function goBack(): boolean {
  const { back } = sessionStore.get();
  if (back.length === 0) return false;
  sessionStore.set((state) => ({
    ...state,
    location: back[back.length - 1],
    back: back.slice(0, -1),
    forward: [state.location, ...state.forward].slice(0, HISTORY_LIMIT),
  }));
  return true;
}

export function goForward(): boolean {
  const { forward } = sessionStore.get();
  if (forward.length === 0) return false;
  sessionStore.set((state) => ({
    ...state,
    location: forward[0],
    back: [...state.back, state.location].slice(-HISTORY_LIMIT),
    forward: forward.slice(1),
  }));
  return true;
}

export function useLocation(): Location {
  return useStore(sessionStore, (state) => state.location);
}

export function getLocation(): Location {
  return sessionStore.get().location;
}
