// The send queue (ARCHITECTURE.md section 10.2; owner after WP0: WP2). Every page edit first flushes every dirty
// editor, so the core sees edits in the order the person made them. WP0's queue keeps that order and nothing more.
import type { MarkdownCache } from '../../../editor/markdown';
import type { BlockId, Edit, EditBatch, OpenPage, TxnAck } from '../../../services/pages/types';
import { applyFrame } from './frames';
import type { FrameContext } from './frames';

export type FlushReason =
  'timer' | 'command' | 'caretJump' | 'blur' | 'undo' | 'save' | 'unmount' | 'pageSwitch' | 'hidden' | 'exit';

export interface SyncQueue {
  /** Flushes every dirty editor first, in clientSeq order. */
  send(batch: EditBatch): Promise<TxnAck>;
  flushAll(reason: FlushReason): Promise<void>;
  /** Flush, page_undo, apply the frame, restore the selection, and announce. */
  undo(): Promise<void>;
  redo(): Promise<void>;
  canUndo(): boolean;
  canRedo(): boolean;
  onUndoState(listener: (state: { canUndo: boolean; canRedo: boolean }) => void): () => void;
  /** Phase 5: flushes wait while a pen is down. */
  setFlushGate(gate: (() => Promise<void>) | null): void;
  appendToNextBatch(block: BlockId, edits: readonly Edit[]): void;
  /** Keep-below moves, from WP3. */
  addFollowerMoves(block: BlockId, moves: readonly Edit[]): void;
}

export interface SyncHost {
  readonly page: OpenPage;
  readonly cache: MarkdownCache;
  frames: FrameContext;
  announce(text: string, politeness?: 'polite' | 'assertive'): void;
}

/** What the queue flushes before every other edit. */
export interface Flushable {
  flush(reason: FlushReason): Promise<void>;
}
interface QueueInternals {
  track(handle: Flushable): () => void;
  /** Sends without flushing first, for a text sync's own batch. */
  sendOwn(batch: EditBatch): Promise<TxnAck>;
}
const internals = new WeakMap<SyncQueue, QueueInternals>();

export function queueInternals(queue: SyncQueue): QueueInternals {
  const found = internals.get(queue);
  if (!found) throw new Error('This sync queue was not made by createSyncQueue.');
  return found;
}

export function createSyncQueue(host: SyncHost): SyncQueue {
  const handles = new Set<Flushable>();
  const listeners = new Set<(state: { canUndo: boolean; canRedo: boolean }) => void>();
  const extra: Edit[] = [];
  let gate: (() => Promise<void>) | null = null;
  let state = { canUndo: false, canRedo: false };
  const setState = (next: { canUndo: boolean; canRedo: boolean }) => {
    state = { canUndo: next.canUndo, canRedo: next.canRedo };
    listeners.forEach((listener) => listener(state));
  };
  const sendOwn = async (batch: EditBatch) => {
    const edits = [...batch.edits, ...extra.splice(0)];
    const ack = await host.page.send({ ...batch, edits });
    setState(ack);
    return ack;
  };
  const flushAll = async (reason: FlushReason) => {
    if (gate) await gate();
    for (const handle of [...handles]) await handle.flush(reason);
  };
  const step = async (direction: 'undo' | 'redo') => {
    await flushAll('undo');
    const frame = await (direction === 'undo' ? host.page.undo() : host.page.redo());
    if (!frame) return;
    await applyFrame(frame, host.frames, host.cache, direction);
    setState(frame);
  };
  const queue: SyncQueue = {
    async send(batch) {
      await flushAll('command');
      return sendOwn(batch);
    },
    flushAll,
    undo: () => step('undo'),
    redo: () => step('redo'),
    canUndo: () => state.canUndo,
    canRedo: () => state.canRedo,
    onUndoState(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    setFlushGate(next) {
      gate = next;
    },
    appendToNextBatch: (_block, edits) => void extra.push(...edits),
    addFollowerMoves: (_block, moves) => void extra.push(...moves),
  };
  internals.set(queue, {
    track(handle) {
      handles.add(handle);
      return () => void handles.delete(handle);
    },
    sendOwn,
  });
  return queue;
}
