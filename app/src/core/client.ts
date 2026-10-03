// The interface's client for Phase 3's page commands (core plan 11.1 and 11.4). Phase 3 planned this file with the
// app bridge; WP0 of Phase 4 adds the part pages need. It takes `invoke` from platform/tauri (P3-8), so only that
// folder imports @tauri-apps/api, and it keeps one request in flight per page, so edits reach the core in order.
import { decodeEnvelope, decodeFrame } from './wire';
import type { DecodedEnvelope, FrameInfo } from './wire';

export type { DecodedEnvelope, FrameInfo, SessionInfo } from './wire';

/** Calls a Tauri command. Binary answers arrive as an ArrayBuffer. */
export type CoreInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
/** Hears a `core:*` event. The returned function stops listening. */
export type CoreListen = (event: string, handler: (payload: unknown) => void) => () => void;

/** What restoring a version did (crates/core/src/session/page.rs, RestoreResult). */
export type CoreRestoreResult = { kind: 'restored' } | { kind: 'copied'; page: string };

export interface CoreRestoreBlocksRequest {
  page: string;
  client: string;
  clientSeq: number;
  revision: string;
  blocks: readonly string[];
}

export interface CoreTxnAck {
  seq: number;
  orderKeys: Record<string, string>;
  canUndo: boolean;
  canRedo: boolean;
}

/** page_apply's request, as core plan 11.4 names its fields. `edits` use the core's `Edit` shape. */
export interface CoreTxnRequest {
  page: string;
  client: string;
  clientSeq: number;
  coalesce?: { kind: string; target: string } | null;
  ui?: unknown;
  edits: readonly unknown[];
}

export interface CoreClient {
  pageOpen(
    page: string,
    client: string,
    viewport: { x: number; y: number; w: number; h: number } | null,
  ): Promise<DecodedEnvelope>;
  pageApply(request: CoreTxnRequest): Promise<CoreTxnAck>;
  /** The frame of the undone step, or null when there is nothing to undo. */
  pageUndo(page: string, client: string): Promise<FrameInfo | null>;
  pageRedo(page: string, client: string): Promise<FrameInfo | null>;
  pageSaveNow(page: string): Promise<void>;
  pageClose(page: string, client: string): Promise<void>;
  /** The page's saved versions, newest first, as the core lists them. */
  historyList(page: string, client: string): Promise<Record<string, unknown>[]>;
  historyOpen(page: string, client: string, revision: string): Promise<DecodedEnvelope>;
  historyRestore(page: string, client: string, revision: string, asCopy: boolean): Promise<CoreRestoreResult>;
  /** One transaction of the client, so it takes the client's next sequence number. */
  historyRestoreBlocks(request: CoreRestoreBlocksRequest): Promise<CoreTxnAck>;
  historyName(page: string, client: string, revision: string, name: string | null, keep: boolean): Promise<void>;
  /** Hears a `core:*` event, or nothing where the client has no `listen`. */
  onEvent(event: string, handler: (payload: unknown) => void): () => void;
}

function bytesOf(answer: unknown): ArrayBuffer {
  if (answer instanceof ArrayBuffer) return answer;
  if (ArrayBuffer.isView(answer))
    return new Uint8Array(answer.buffer, answer.byteOffset, answer.byteLength).slice().buffer;
  if (Array.isArray(answer)) return new Uint8Array(answer as number[]).buffer;
  throw new Error('The core answered with something other than bytes.');
}

export function createCoreClient(deps: { invoke: CoreInvoke; listen?: CoreListen }): CoreClient {
  const queues = new Map<string, Promise<unknown>>();
  /** Runs `call` after every earlier call for the same page has settled. */
  const ordered = <T>(page: string, call: () => Promise<T>): Promise<T> => {
    const before = queues.get(page) ?? Promise.resolve();
    const next = before.then(call, call);
    const settled = next.catch(() => undefined);
    queues.set(page, settled);
    void settled.then(() => queues.get(page) === settled && queues.delete(page));
    return next;
  };
  const frame = async (command: string, page: string, client: string) => {
    const bytes = bytesOf(await deps.invoke(command, { page, client }));
    return bytes.byteLength === 0 ? null : decodeFrame(bytes);
  };
  return {
    pageOpen: (page, client, viewport) =>
      ordered(page, async () => decodeEnvelope(bytesOf(await deps.invoke('page_open', { page, client, viewport })))),
    pageApply: (request) =>
      ordered(request.page, () => deps.invoke('page_apply', { ...request }) as Promise<CoreTxnAck>),
    pageUndo: (page, client) => ordered(page, () => frame('page_undo', page, client)),
    pageRedo: (page, client) => ordered(page, () => frame('page_redo', page, client)),
    pageSaveNow: (page) => ordered(page, async () => void (await deps.invoke('page_save_now', { page }))),
    pageClose: (page, client) => ordered(page, async () => void (await deps.invoke('page_close', { page, client }))),
    historyList: (page, client) =>
      ordered(page, () => deps.invoke('history_list', { page, client }) as Promise<Record<string, unknown>[]>),
    historyOpen: (page, client, revision) =>
      ordered(page, async () => decodeEnvelope(bytesOf(await deps.invoke('history_open', { page, client, revision })))),
    historyRestore: (page, client, revision, asCopy) =>
      ordered(
        page,
        () => deps.invoke('history_restore', { page, client, revision, asCopy }) as Promise<CoreRestoreResult>,
      ),
    historyRestoreBlocks: (request) =>
      ordered(request.page, () => deps.invoke('history_restore_blocks', { ...request }) as Promise<CoreTxnAck>),
    historyName: (page, client, revision, name, keep) =>
      ordered(page, async () => void (await deps.invoke('history_name', { page, client, revision, name, keep }))),
    onEvent: (event, handler) => deps.listen?.(event, handler) ?? (() => undefined),
  };
}
