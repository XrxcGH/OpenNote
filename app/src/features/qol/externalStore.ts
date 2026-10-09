// Pages that another program changed while they were open, from the shell's folder watcher. A page stays on the
// list until it is reloaded or the person dismisses the notice.

import { shellHost } from '../../platform/shellqol';
import { createStore } from '../../state/store';

/** A changed page.json, a sync tool's copy, or an edited page.md whose text can come in. */
export type ExternalChange = 'changed' | 'conflictCopy' | 'readable';

export interface ExternalState {
  /** Page IDs with a change from another program, and what kind. */
  readonly changed: Readonly<Record<string, ExternalChange>>;
  /** Bumps when the shell reports a change, so conflict lists refresh. */
  readonly tick: number;
}

export const externalStore = createStore<ExternalState>({ changed: {}, tick: 0 }, 'qolExternal');

/** Pages whose offer to bring in page.md text was turned down; the offer returns when the watcher sees a new edit. */
const turnedDown = new Set<string>();

/** Turns the offer down for now, so opening the page again doesn't repeat it. */
export function dismissReadable(pageId: string): void {
  turnedDown.add(pageId);
  dismissExternal(pageId);
}

/** Marks a page whose page.md has text to bring in, as found when the page opens. */
export function markReadable(pageId: string): void {
  if (turnedDown.has(pageId)) return;
  externalStore.set((state) => ({ ...state, changed: { ...state.changed, [pageId]: 'readable' } }));
}

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
    const change: ExternalChange =
      event.change === 'conflictCopy' || event.change === 'readable' ? event.change : 'changed';
    const pageId = event.pageId;
    if (change === 'readable') turnedDown.delete(pageId);
    externalStore.set((state) => ({ changed: { ...state.changed, [pageId]: change }, tick: state.tick + 1 }));
  });
}
