// The text sync's public face (PLAN.md section 3.6). WP0 fixed this API; WP2 owns what is behind it.

export type { FlushReason, SyncHost, SyncQueue } from './queue';
export { createSyncQueue, exitHook, onResync } from './queue';
export type { PendingInsert, TableSyncHandle, TextSyncHandle } from './textSync';
export { acceptRemoteText, attachTableSync, attachTextSync, TYPING_CEILING, TYPING_IDLE } from './textSync';
export type { FrameContext } from './frames';
export { applyFrame, minimalReplacement } from './frames';

export { appendToNextBatch, setFlushGate, shownQueue } from './shown';
