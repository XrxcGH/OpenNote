// The text sync's public face (PLAN.md section 3.6). WP0 fixed this API; WP2 owns what is behind it.
import type { BlockId, Edit } from '../../../services/pages/types';
import { createStore } from '../../../state/store';
import type { SyncQueue } from './queue';

export type { FlushReason, SyncHost, SyncQueue } from './queue';
export { createSyncQueue } from './queue';
export type { PendingInsert, TableSyncHandle, TextSyncHandle } from './textSync';
export { acceptRemoteText, attachTableSync, attachTextSync } from './textSync';
export type { FrameContext } from './frames';
export { applyFrame } from './frames';

/** The queue of the page that is shown, for Phase 5's seams. */
export const shownQueue = createStore<SyncQueue | null>(null, 'page sync queue');

/** Phase 5: edits that ride in the block's next transaction, such as anchored ink moving with its text. */
export function appendToNextBatch(block: BlockId, edits: readonly Edit[]): void {
  shownQueue.get()?.appendToNextBatch(block, edits);
}

/** Phase 5: flushes wait for the gate, such as a pen being down. */
export function setFlushGate(gate: (() => Promise<void>) | null): void {
  shownQueue.get()?.setFlushGate(gate);
}
