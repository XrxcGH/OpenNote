// The small stores the quality-of-life commands and the page's panes share. This module stays light, because the
// start-up registrations read it before the page's code loads.
import { createStore } from '../../../state/store';

/**
 * Reading mode: the shown page is locked against edits and ink. The text editors, images, tables, and objects
 * read it, and so does the ink view (it is the same switch for every kind of change). A page opens unlocked.
 */
export const readingLock = createStore<boolean>(false, 'page reading lock');

export interface FindRequest {
  open: boolean;
  /** Whether the Replace row shows. */
  replace: boolean;
  /** Counts requests, so asking again while the bar is open moves focus into it. */
  nonce: number;
}

/** Whether the Find bar is open on the shown page, and what asked for it. */
export const findRequest = createStore<FindRequest>({ open: false, replace: false, nonce: 0 }, 'page find request');

export function openFind(replace: boolean): void {
  findRequest.set((current) => ({
    open: true,
    replace: replace || (current.open && current.replace),
    nonce: current.nonce + 1,
  }));
}

export function closeFind(): void {
  findRequest.set((current) => ({ ...current, open: false }));
}
