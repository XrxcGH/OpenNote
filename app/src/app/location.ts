// Where the person is: a typed Location with back and forward history, instead of a router
// (ARCHITECTURE.md section 5.3). Tabs and windows later turn the single location into a list, and call sites
// keep using navigate().
//
// Opening something by click, Enter, or the palette pushes an entry. Selection that follows arrow-key focus
// passes `replace`, so history doesn't fill with every page passed on the way. The layout listens with
// onNavigate, to close the drawer or overlay, or to change the compact screen, after a deliberate choice.

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

/** A change of location, as the layout and the window title see it. */
export interface Navigation {
  from: Location;
  to: Location;
  kind: 'push' | 'replace' | 'back' | 'forward';
  focus: 'target' | 'keep';
}

/** Each history stack keeps at most this many entries. */
export const HISTORY_LIMIT = 50;

const listeners = new Set<(navigation: Navigation) => void>();

const same = (a: Location, b: Location) => JSON.stringify(a) === JSON.stringify(b);

function announceChange(navigation: Navigation) {
  [...listeners].forEach((listener) => listener(navigation));
}

/** Calls the listener after every change of location. Returns a function that stops listening. */
export function onNavigate(listener: (navigation: Navigation) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function navigate(to: Location, options: NavigateOptions = {}): void {
  const from = sessionStore.get().location;
  if (same(from, to)) return;
  sessionStore.set((state) => {
    if (options.replace) return { ...state, location: to };
    const back = [...state.back, state.location].slice(-HISTORY_LIMIT);
    return { ...state, location: to, back, forward: [] };
  });
  announceChange({ from, to, kind: options.replace ? 'replace' : 'push', focus: options.focus ?? 'target' });
}

/** False when there is nothing to go back to. */
export function goBack(): boolean {
  const { back, location: from } = sessionStore.get();
  if (back.length === 0) return false;
  const to = back[back.length - 1];
  sessionStore.set((state) => ({
    ...state,
    location: to,
    back: back.slice(0, -1),
    forward: [state.location, ...state.forward].slice(0, HISTORY_LIMIT),
  }));
  announceChange({ from, to, kind: 'back', focus: 'target' });
  return true;
}

export function goForward(): boolean {
  const { forward, location: from } = sessionStore.get();
  if (forward.length === 0) return false;
  const to = forward[0];
  sessionStore.set((state) => ({
    ...state,
    location: to,
    back: [...state.back, state.location].slice(-HISTORY_LIMIT),
    forward: forward.slice(1),
  }));
  announceChange({ from, to, kind: 'forward', focus: 'target' });
  return true;
}

export function canGoBack(): boolean {
  return sessionStore.get().back.length > 0;
}

export function canGoForward(): boolean {
  return sessionStore.get().forward.length > 0;
}

/** Whether there is history each way, for the toolbar arrows. */
export function useHistoryDepth(): { back: boolean; forward: boolean } {
  const back = useStore(sessionStore, (state) => state.back.length > 0);
  const forward = useStore(sessionStore, (state) => state.forward.length > 0);
  return { back, forward };
}

export function useLocation(): Location {
  return useStore(sessionStore, (state) => state.location);
}

export function getLocation(): Location {
  return sessionStore.get().location;
}
