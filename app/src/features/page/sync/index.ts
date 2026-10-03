// The text sync's public face (PLAN.md section 3.6). WP0 fixed this API; WP2 owns what is behind it.

export type { FlushReason, SyncHost, SyncQueue } from './queue';
export { createSyncQueue } from './queue';
export type { PendingInsert, TableSyncHandle, TextSyncHandle } from './textSync';
export { acceptRemoteText, attachTableSync, attachTextSync } from './textSync';
export type { FrameContext } from './frames';
export { applyFrame } from './frames';

export { appendToNextBatch, setFlushGate, shownQueue } from './shown';
