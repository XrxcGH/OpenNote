// Pages that another program changed while they were open, from the shell's folder watcher. A page stays on the
// list until it is reloaded or the person dismisses the notice.

import { shellHost } from '../../platform/shellqol';
import { createStore } from '../../state/store';

export interface ExternalState {
  /** Page IDs with a change from another program, and what kind. */
  readonly changed: Readonly<Record<string, 'changed' | 'conflictCopy'>>;
  /** Bumps when the shell reports a change, so conflict lists refresh. */
  readonly tick: number;
}

export const externalStore = createStore<ExternalState>({ changed: {}, tick: 0 }, 'qolExternal');

export function dismissExternal(pageId: string): void {
  externalStore.set((state) => {
    const { [pageId]: _gone, ...changed } = state.changed;
    return { ...state, changed };
  });
}

/** Listens for the watcher's events. Returns a function that stops. */
export function followExternal(): () => void {
  return shellHost().listen((event) => {
    if (event.kind !== 'external' || typeof event.pageId !== 'string') return;
    const change = event.change === 'conflictCopy' ? 'conflictCopy' : 'changed';
    const pageId = event.pageId;
    externalStore.set((state) => ({ changed: { ...state.changed, [pageId]: change }, tick: state.tick + 1 }));
  });
}
