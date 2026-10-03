// The shown page's sync queue, in a module light enough for start-up: the page commands and Phase 5's seams reach
// the queue through it without loading the editor.
import type { BlockId, Edit } from '../../../services/pages/types';
import { createStore } from '../../../state/store';
import type { SyncQueue } from './queue';

/** The queue of the page that is shown. */
export const shownQueue = createStore<SyncQueue | null>(null, 'page sync queue');

/** Phase 5: edits that ride in the block's next transaction, such as anchored ink moving with its text. */
export function appendToNextBatch(block: BlockId, edits: readonly Edit[]): void {
  shownQueue.get()?.appendToNextBatch(block, edits);
}

/** Phase 5: flushes wait for the gate, such as a pen being down. */
export function setFlushGate(gate: (() => Promise<void>) | null): void {
  shownQueue.get()?.setFlushGate(gate);
}
