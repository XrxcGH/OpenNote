// Whether the core could save each page, and whether it answers at all. The title bar's status came from the
// notes bridge alone, which knows only the tree's own commands: a page whose every save failed still showed
// "Saved" (beta 4's T2-1), and a core that stopped answering showed "Saving" for as long as the app ran (T2-3).
// The core says `core:save-failed` after each failed try and `core:saved` after a save, and this store keeps the
// pages whose last try failed, for the status to show "Couldn't save" until the page saves. The core's watchdog
// says `core:stalled` while one command has held the core for too long, and `core:responsive` once it answers
// again; the status says "Not responding" in between.
//
// A page's batch counts as sending from when its send queue takes it until the core answers. The core answers
// once the edit is in its journal file, or, when the journal thread is slower than the core's wait or the journal
// can't be written, with `written: false`: the page then counts as unwritten until a `core:saved` whose `through`
// covers that edit. So "Saved" never shows over a stroke that only this process's memory holds, which a crash
// would lose.

import { createStore } from '../../state/store';
import type { SaveStatus } from '../notes';

export interface SaveHealth {
  /** The pages whose last save failed, by ID. */
  readonly failing: ReadonlySet<string>;
  /** Whether a command has held the core for too long, so nothing reaches the disk until it returns. */
  readonly stalled: boolean;
  /** How many page batches are on their way to the core. */
  readonly sending: number;
  /** The pages with an edit the core answered as not yet written, by ID, with the latest such edit's sequence number. */
  readonly unwritten: ReadonlyMap<string, number>;
}

export const saveHealthStore = createStore<SaveHealth>(
  { failing: new Set(), stalled: false, sending: 0, unwritten: new Map() },
  'saveHealth',
);

/** Whether any page's last save failed. */
export const anySaveFailing = (health: SaveHealth): boolean => health.failing.size > 0;

/** Whether the core has stopped answering. */
export const coreStalled = (health: SaveHealth): boolean => health.stalled;

/** Whether a page batch is on its way to the core. */
export const pageSending = (health: SaveHealth): boolean => health.sending > 0;

/** Whether an edit isn't safe from a crash yet: on its way to the core, or answered as not yet written. */
export const pageWaiting = (health: SaveHealth): boolean => health.sending > 0 || health.unwritten.size > 0;

/** The core answered an edit of `page` as not yet written (`TxnAck.written`): it is safe once a save holds `seq`. */
export function pageUnwritten(page: string, seq: number): void {
  saveHealthStore.set((state) => {
    if ((state.unwritten.get(page) ?? -1) >= seq) return state;
    return { ...state, unwritten: new Map(state.unwritten).set(page, seq) };
  });
}

/** `page` saved every edit through `through`, so no edit up to it waits any longer. */
export function pageWritten(page: string, through: number): void {
  saveHealthStore.set((state) => {
    const seq = state.unwritten.get(page);
    if (seq === undefined || seq > through) return state;
    const unwritten = new Map(state.unwritten);
    unwritten.delete(page);
    return { ...state, unwritten };
  });
}

/** A page batch is on its way to the core. The returned function says it arrived or failed; a second call does nothing. */
export function sendingPage(): () => void {
  saveHealthStore.set((state) => ({ ...state, sending: state.sending + 1 }));
  let done = false;
  return () => {
    if (done) return;
    done = true;
    saveHealthStore.set((state) => ({ ...state, sending: Math.max(0, state.sending - 1) }));
  };
}

/**
 * The status to show: "Not responding" while the core is stalled, else the notes bridge's, unless a page's last
 * save failed while nothing is on its way, or a page batch is still on its way.
 */
export function combinedStatus(notes: SaveStatus, pageFailing: boolean, stalled = false, sending = false): SaveStatus {
  if (stalled) return 'stalled';
  if (notes !== 'saved') return notes;
  if (pageFailing) return 'error';
  return sending ? 'saving' : 'saved';
}

export function setCoreStalled(stalled: boolean): void {
  saveHealthStore.set((state) => (state.stalled === stalled ? state : { ...state, stalled }));
}

/**
 * A command gave up waiting for the core (the `coreBusy` error): the core is stalled, even before its watchdog's
 * event arrives. `core:responsive` clears it once the holder returns.
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
 * A page closed, so no `core:saved` will come for it: it stops counting as failing or unwritten (closing saves
 * it). A page that still can't save counts again at its next try, which the core reports as before.
 */
export function pageClosed(page: string): void {
  pageSaved(page);
  pageWritten(page, Number.POSITIVE_INFINITY);
}

const pageOf = (payload: unknown): string | null => {
  const page = (payload as { page?: unknown } | null)?.page;
  return typeof page === 'string' ? page : null;
};

const throughOf = (payload: unknown): number | null => {
  const through = (payload as { through?: unknown } | null)?.through;
  return typeof through === 'number' ? through : null;
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
      if (!page) return;
      pageSaved(page);
      const through = throughOf(payload);
      if (through !== null) pageWritten(page, through);
    }),
    client.onEvent('core:stalled', () => setCoreStalled(true)),
    client.onEvent('core:responsive', () => setCoreStalled(false)),
  ];
  return () => stops.forEach((stop) => stop());
}
