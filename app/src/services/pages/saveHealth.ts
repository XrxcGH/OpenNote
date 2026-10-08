// Whether the core could save each page. The title bar's status came from the notes bridge alone, which knows
// only the tree's own commands: a page whose every save failed still showed "Saved" (beta 4's T2-1). The core says
// `core:save-failed` after each failed try and `core:saved` after a save, and this store keeps the pages whose last
// try failed, for the status to show "Couldn't save" until the page saves.

import { createStore } from '../../state/store';
import type { SaveStatus } from '../notes';

export interface SaveHealth {
  /** The pages whose last save failed, by ID. */
  readonly failing: ReadonlySet<string>;
}

export const saveHealthStore = createStore<SaveHealth>({ failing: new Set() }, 'saveHealth');

/** Whether any page's last save failed. */
export const anySaveFailing = (health: SaveHealth): boolean => health.failing.size > 0;

/** The status to show: the notes bridge's, unless a page's last save failed while nothing is on its way. */
export function combinedStatus(notes: SaveStatus, pageFailing: boolean): SaveStatus {
  return notes === 'saved' && pageFailing ? 'error' : notes;
}

export function pageSaveFailed(page: string): void {
  saveHealthStore.set((state) => {
    if (state.failing.has(page)) return state;
    return { failing: new Set([...state.failing, page]) };
  });
}

export function pageSaved(page: string): void {
  saveHealthStore.set((state) => {
    if (!state.failing.has(page)) return state;
    const failing = new Set(state.failing);
    failing.delete(page);
    return { failing };
  });
}

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
  ];
  return () => stops.forEach((stop) => stop());
}
