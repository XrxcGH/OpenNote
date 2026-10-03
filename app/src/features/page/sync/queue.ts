// The send queue (ARCHITECTURE.md sections 10.2 and 10.5; owner after WP0: WP2). Every batch of a page goes
// through one chain, so the core sees edits in the order the person made them. An object edit first flushes every
// dirty editor. Each flush builds its batch only when its turn comes.
//
// Undo and redo flush, wait for the chain to drain, and apply the core's frame. When the step changed something
// outside the focused text box, they say what it was.
import type { MarkdownCache } from '../../../editor/markdown';
import type { BeforeExitAnswer } from '../../../registries/types';
import { PageServiceError } from '../../../services/pages/types';
import type { AppliedFrame, BlockId, Edit, EditBatch, OpenPage, TxnAck } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { showToast } from '../../../ui/toast';
import { describeStep } from './describe';
import { applyFrame } from './frames';
import type { FrameContext } from './frames';
import { createMirror } from './mirror';
import type { Mirror } from './mirror';

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
  /** Whether a change hasn't reached the core yet, such as one it refused: the next flush sends it again. */
  hasUnsent(): boolean;
}

export interface SyncHost {
  readonly page: OpenPage;
  readonly cache: MarkdownCache;
  frames: FrameContext;
  announce(text: string, politeness?: 'polite' | 'assertive'): void;
}

/** What the queue flushes before every other edit: a text or table sync. */
export interface Flushable {
  readonly block: BlockId;
  /** Whether it holds typing that hasn't gone yet. */
  pending(): boolean;
  /** Puts the pending change in the chain, unless the reason waits for a composition to end. */
  flush(reason: FlushReason): Promise<void>;
  /** Whether an input method is composing in the block, so frames for it wait. */
  composing(): boolean;
  /** Resolves when no composition is running in the block. */
  compositionDone(): Promise<void>;
}

/** Builds a batch when its turn in the chain comes, or returns null to send nothing. */
export type BatchBuilder = () => EditBatch | null;

export interface QueueInternals {
  readonly host: SyncHost;
  /** The block types and frames the core has, as far as this view knows. */
  readonly mirror: Mirror;
  track(handle: Flushable): () => void;
  /**
   * Puts a batch in the chain. The edits waiting for `block`, such as followers, join it when it's built. `failed`
   * hears a refusal before the promise rejects, so a text sync can take its text back.
   */
  enqueue(build: BatchBuilder, block: BlockId | null, failed?: (error: unknown) => void): Promise<TxnAck | null>;
  /** Called after a send fails with `resync`: the page view reopens the page. */
  resync(error: PageServiceError): void;
}

type UndoState = { canUndo: boolean; canRedo: boolean };
type MoveEdit = Extract<Edit, { edit: 'moveBlock' }>;

/** How long a follower move waits for its block's text before it goes on its own. */
const FOLLOWER_WAIT = 150;

const internals = new WeakMap<SyncQueue, QueueInternals>();
const resyncListeners = new WeakMap<SyncQueue, Set<(error: PageServiceError) => void>>();

export function queueInternals(queue: SyncQueue): QueueInternals {
  const found = internals.get(queue);
  if (!found) throw new Error('This sync queue was not made by createSyncQueue.');
  return found;
}

/**
 * Hears a send the core refused because the page is out of date (`resync`), so the page view can reopen the page
 * and remount its editors. Without a listener, a refused text change is sent again as the whole text.
 */
export function onResync(queue: SyncQueue, listener: (error: PageServiceError) => void): () => void {
  let set = resyncListeners.get(queue);
  if (!set) resyncListeners.set(queue, (set = new Set()));
  set.add(listener);
  return () => void set.delete(listener);
}

export function hasResyncListener(queue: SyncQueue): boolean {
  return (resyncListeners.get(queue)?.size ?? 0) > 0;
}

function notKept(error: unknown): string {
  const code = (error as Partial<PageServiceError>).code;
  if (code === 'readOnly') return t('pageSync.notKept.readOnly');
  if (code === 'locked') return t('pageSync.notKept.locked');
  return t('pageSync.notKept.other');
}

/** Reports a failed flush: a resync goes to the page view, and anything else is a toast. */
export function reportSendError(queue: SyncQueue, error: unknown): void {
  if (error instanceof PageServiceError && error.resync) {
    queueInternals(queue).resync(error);
    return;
  }
  showToast({ id: 'page-sync-not-kept', message: notKept(error), tone: 'danger' });
}

/**
 * Whether the edits riding along with a refused batch wait for the next one. Not after a refusal that names a block
 * the core doesn't have, which they would only meet again, or one that reopens the page.
 */
function keepsRiders(error: unknown): boolean {
  if (!(error instanceof PageServiceError)) return true;
  return !error.resync && error.code !== 'notFound';
}

/** How long "Close anyway" lets a close through after a page's change couldn't be sent. */
const CLOSE_ANYWAY_MS = 10_000;

/**
 * The page's part of the exit handshake: flush, and keep the window open while a change the core refused is still
 * unsent, with "Close anyway" to close within a few seconds without it.
 */
export function exitHook(queue: SyncQueue): () => Promise<BeforeExitAnswer> {
  let closeAnywayUntil = 0;
  return async () => {
    const allowed = Date.now() < closeAnywayUntil;
    closeAnywayUntil = 0;
    await queue.flushAll('exit');
    if (!queue.hasUnsent() || allowed) return { ok: true };
    return {
      ok: false,
      reason: 'pageSync.exitUnsaved',
      closeAnyway: () => void (closeAnywayUntil = Date.now() + CLOSE_ANYWAY_MS),
    };
  };
}

function joinMoves(before: MoveEdit, edit: MoveEdit): MoveEdit {
  const frame = edit.frame === null || before.frame === null ? edit.frame : { ...before.frame, ...edit.frame };
  const place = edit.after !== undefined || edit.before !== undefined ? edit : before;
  const joined: MoveEdit = { edit: 'moveBlock', block: edit.block };
  if (frame !== undefined) joined.frame = frame;
  if (place.after !== undefined) joined.after = place.after;
  if (place.before !== undefined) joined.before = place.before;
  return joined;
}

/** Joins moves of the same block, later fields winning, so a batch moves each block once. */
export function joinEdits(edits: readonly Edit[]): Edit[] {
  const out: Edit[] = [];
  const moves = new Map<BlockId, number>();
  for (const edit of edits) {
    const at = edit.edit === 'moveBlock' ? moves.get(edit.block) : undefined;
    if (edit.edit === 'moveBlock' && at !== undefined) {
      out[at] = joinMoves(out[at] as MoveEdit, edit);
      continue;
    }
    if (edit.edit === 'moveBlock') moves.set(edit.block, out.length);
    out.push(edit);
  }
  return out;
}

class Queue implements SyncQueue, QueueInternals {
  readonly mirror: Mirror;
  private readonly handles = new Set<Flushable>();
  private readonly listeners = new Set<(state: UndoState) => void>();
  private readonly waiting = new Map<BlockId, Edit[]>();
  private gate: (() => Promise<void>) | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private followerTimer: ReturnType<typeof setTimeout> | null = null;
  private state: UndoState = { canUndo: false, canRedo: false };

  constructor(readonly host: SyncHost) {
    this.mirror = createMirror(host.page.initial);
    host.page.onFrame((frame) => this.remote(frame));
  }

  async send(batch: EditBatch): Promise<TxnAck> {
    await this.flushAll('command');
    const ack = await this.enqueue(() => batch, null);
    if (!ack) throw new PageServiceError('invalid', 'The batch was empty.', false);
    return ack;
  }

  async flushAll(reason: FlushReason): Promise<void> {
    if (this.gate) await this.gate();
    if (this.followerTimer) clearTimeout(this.followerTimer);
    this.followerTimer = null;
    const flushes = [...this.handles].map((handle) => handle.flush(reason));
    if (this.waiting.size > 0) flushes.push(this.enqueue(() => null, null).then(() => undefined));
    await Promise.all(flushes);
  }

  undo(): Promise<void> {
    return this.step('undo');
  }

  redo(): Promise<void> {
    return this.step('redo');
  }

  canUndo(): boolean {
    return this.state.canUndo;
  }

  canRedo(): boolean {
    return this.state.canRedo;
  }

  onUndoState(listener: (state: UndoState) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  setFlushGate(gate: (() => Promise<void>) | null): void {
    this.gate = gate;
  }

  appendToNextBatch(block: BlockId, edits: readonly Edit[]): void {
    this.wait(block, edits);
  }

  addFollowerMoves(block: BlockId, moves: readonly Edit[]): void {
    this.wait(block, moves);
  }

  hasUnsent(): boolean {
    return this.waiting.size > 0 || [...this.handles].some((handle) => handle.pending());
  }

  track(handle: Flushable): () => void {
    this.handles.add(handle);
    return () => void this.handles.delete(handle);
  }

  enqueue(build: BatchBuilder, block: BlockId | null, failed?: (error: unknown) => void): Promise<TxnAck | null> {
    const run = () => this.run(build, block, failed);
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  resync(error: PageServiceError): void {
    resyncListeners.get(this)?.forEach((listener) => listener(error));
  }

  private async run(build: BatchBuilder, block: BlockId | null, failed?: (error: unknown) => void) {
    const built = build();
    const taken = this.takeWaiting(block);
    const extra = taken.flatMap(([, edits]) => edits);
    if (!built && extra.length === 0) return null;
    const batch: EditBatch = built
      ? { ...built, edits: joinEdits([...built.edits, ...extra]) }
      : { edits: joinEdits(extra) };
    try {
      const ack = await this.host.page.send(batch);
      this.mirror.sent(batch, ack);
      this.setState(ack);
      return ack;
    } catch (error) {
      if (keepsRiders(error)) this.putBack(taken);
      failed?.(error);
      throw error;
    }
  }

  private takeWaiting(block: BlockId | null): [BlockId, Edit[]][] {
    const found = block === null ? undefined : this.waiting.get(block);
    const taken: [BlockId, Edit[]][] = block === null ? [...this.waiting] : found ? [[block, found]] : [];
    taken.forEach(([id]) => this.waiting.delete(id));
    return taken;
  }

  /** Edits that rode along with a refused batch wait for the next one, ahead of any that came since. */
  private putBack(taken: readonly [BlockId, Edit[]][]): void {
    for (const [id, edits] of taken) this.waiting.set(id, [...edits, ...(this.waiting.get(id) ?? [])]);
  }

  private wait(block: BlockId, edits: readonly Edit[]): void {
    if (edits.length === 0) return;
    this.waiting.set(block, [...(this.waiting.get(block) ?? []), ...edits]);
    if (this.followerTimer) clearTimeout(this.followerTimer);
    this.followerTimer = setTimeout(() => this.sendLoneFollowers(), FOLLOWER_WAIT);
  }

  /** A block with no pending text sends its followers on their own; one with pending text takes them along. */
  private sendLoneFollowers(): void {
    this.followerTimer = null;
    const busy = new Set([...this.handles].filter((handle) => handle.pending()).map((handle) => handle.block));
    for (const id of [...this.waiting.keys()].filter((block) => !busy.has(block))) {
      this.enqueue(() => null, id).catch((error: unknown) => reportSendError(this, error));
    }
  }

  private setState(next: UndoState): void {
    if (next.canUndo === this.state.canUndo && next.canRedo === this.state.canRedo) return;
    this.state = { canUndo: next.canUndo, canRedo: next.canRedo };
    this.listeners.forEach((listener) => listener(this.state));
  }

  private async drain(): Promise<void> {
    for (let last: unknown = null; last !== this.chain;) {
      last = this.chain;
      await this.chain;
    }
  }

  private async step(direction: 'undo' | 'redo'): Promise<void> {
    await this.flushAll('undo');
    await this.drain();
    let frame: AppliedFrame | null;
    try {
      frame = await (direction === 'undo' ? this.host.page.undo() : this.host.page.redo());
    } catch (error) {
      this.stepFailed(direction, error);
      return;
    }
    if (!frame) {
      this.host.announce(t(direction === 'undo' ? 'pageSync.nothingToUndo' : 'pageSync.nothingToRedo'));
      this.setState(direction === 'undo' ? { ...this.state, canUndo: false } : { ...this.state, canRedo: false });
      return;
    }
    const said = describeStep(frame, this.mirror, direction);
    const { outsideFocus } = await applyFrame(frame, this.host.frames, this.host.cache, direction);
    this.mirror.applied(frame);
    this.setState(frame);
    if (outsideFocus && said) this.host.announce(said);
  }

  private stepFailed(direction: 'undo' | 'redo', error: unknown): void {
    const code = (error as Partial<PageServiceError>).code;
    const changed = t(direction === 'undo' ? 'pageSync.undoFailed' : 'pageSync.redoFailed');
    showToast({ id: 'page-undo-failed', message: code === 'precondition' ? changed : notKept(error), tone: 'danger' });
  }

  /** Another window's change applies like an undo frame, without moving the selection (section 10.7). */
  private remote(frame: AppliedFrame): void {
    const apply = async () => {
      await this.compositions(frame);
      await applyFrame(frame, this.host.frames, this.host.cache, 'remote');
      this.mirror.applied(frame);
      this.setState(frame);
    };
    this.chain = this.chain.then(apply, apply).catch(() => undefined);
  }

  /** Frames for a block wait while an input method composes in it (section 10.4). */
  private async compositions(frame: AppliedFrame): Promise<void> {
    const ids = new Set([...frame.blocks.map((block) => block.id), ...frame.removed]);
    const busy = [...this.handles].filter((handle) => ids.has(handle.block) && handle.composing());
    await Promise.all(busy.map((handle) => handle.compositionDone()));
  }
}

export function createSyncQueue(host: SyncHost): SyncQueue {
  const queue = new Queue(host);
  internals.set(queue, queue);
  return queue;
}
