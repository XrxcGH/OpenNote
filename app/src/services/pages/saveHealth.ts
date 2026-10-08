// Whether the core could save each page, and whether it answers at all. The title bar's status came from the
// notes bridge alone, which knows only the tree's own commands: a page whose every save failed still showed
// "Saved" (beta 4's T2-1), and a core that stopped answering showed "Saving" for as long as the app ran (T2-3).
// The core says `core:save-failed` after each failed try and `core:saved` after a save, and this store keeps the
// pages whose last try failed, for the status to show "Couldn't save" until the page saves. The core's watchdog
// says `core:stalled` while one command has held the core for too long, and `core:responsive` once it answers
// again; the status says "Not responding" in between.

import { createStore } from '../../state/store';
import type { SaveStatus } from '../notes';

export interface SaveHealth {
  /** The pages whose last save failed, by ID. */
  readonly failing: ReadonlySet<string>;
  /** Whether a command has held the core for too long, so nothing reaches the disk until it returns. */
  readonly stalled: boolean;
}

export const saveHealthStore = createStore<SaveHealth>({ failing: new Set(), stalled: false }, 'saveHealth');

/** Whether any page's last save failed. */
export const anySaveFailing = (health: SaveHealth): boolean => health.failing.size > 0;

/** Whether the core has stopped answering. */
export const coreStalled = (health: SaveHealth): boolean => health.stalled;

/**
 * The status to show: "Not responding" while the core is stalled, else the notes bridge's, unless a page's last
 * save failed while nothing is on its way.
 */
export function combinedStatus(notes: SaveStatus, pageFailing: boolean, stalled = false): SaveStatus {
  if (stalled) return 'stalled';
  return notes === 'saved' && pageFailing ? 'error' : notes;
}

export function setCoreStalled(stalled: boolean): void {
  saveHealthStore.set((state) => (state.stalled === stalled ? state : { ...state, stalled }));
}

/**
 * A command gave up waiting for the core (the `coreBusy` error): the core is stalled, whether or not its
 * watchdog's event has arrived yet. `core:responsive` clears it once the holder returns.
 */
export function coreBusy(): void {
  setCoreStalled(true);
}

export function pageSaveFailed(page: string): void {
  saveHealthStore.set((state) => {
    if (state.failing.has(page)) return state;
    return { ...state, failing: new Set([...state.failing, page]) };
  });
}

export function pageSaved(page: string): void {
  saveHealthStore.set((state) => {
    if (!state.failing.has(page)) return state;
    const failing = new Set(state.failing);
    failing.delete(page);
    return { ...state, failing };
  });
}

/**
 * A page closed, so no `core:saved` will come for it: it stops counting as failing. A page that still can't
 * save counts again at its next try, which the core reports as before.
 */
export const pageClosed = pageSaved;

const pageOf = (payload: unknown): string | null => {
  const page = (payload as { page?: unknown } | null)?.page;
  return typeof page === 'string' ? page : null;
};

/** Keeps the store in step with the core's save events. The returned function stops listening. */
export function watchSaveHealth(client: {
  onEvent(event: string, handler: (payload: unknown) => void): () => void;
}): () => void {
  const stops = [
    client.onEvent('core:save-failed', (payload) => {
      const page = pageOf(payload);
      if (page) pageSaveFailed(page);
    }),
    client.onEvent('core:saved', (payload) => {
      const page = pageOf(payload);
      if (page) pageSaved(page);
    }),
    client.onEvent('core:stalled', () => setCoreStalled(true)),
    client.onEvent('core:responsive', () => setCoreStalled(false)),
  ];
  return () => stops.forEach((stop) => stop());
}
