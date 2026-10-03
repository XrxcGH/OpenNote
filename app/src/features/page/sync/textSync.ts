// Turning editor transactions into text edits (ARCHITECTURE.md sections 10.2 to 10.4; owner after WP0: WP2).
//
// Typing waits. It goes 150 ms after its last change, and at least every 300 ms while it continues, in a task of
// its own. Typing is any change without a paste, drop, or cut event, a command, or an automatic change.
//
// Anything else sends the pending typing first, as it was, and then itself, so the core keeps two undo steps. An
// automatic change, such as an input rule, sends the text as typed and then the change. While an input method
// composes, nothing goes; the committed text goes as one batch after compositionend.
//
// Each batch is built when its turn in the queue's chain comes, from the document as it was at the change. So
// batches from every editor and object edit reach the core in the order the person made them.
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Selection, Transaction } from '@tiptap/pm/state';
import { Transform } from '@tiptap/pm/transform';
import { diffMarkdown, serializeTextBlock, utf8Offset } from '../../../editor/markdown';
import type { MarkdownCache } from '../../../editor/markdown';
import { META_AUTO_CHANGE, META_COMMAND, META_HIGHLIGHT, META_REMOTE } from '../../../editor/meta';
import type { AutoChangeMeta } from '../../../editor/meta';
import type { TableData } from '../../../editor/schema/specs';
import { PageServiceError } from '../../../services/pages/types';
import type { BlockId, Edit, EditBatch, NewBlock, UiSelection } from '../../../services/pages/types';
import { hasResyncListener, queueInternals, reportSendError } from './queue';
import type { FlushReason, QueueInternals, SyncQueue } from './queue';

export interface TextSyncHandle {
  readonly block: BlockId;
  readonly dirty: boolean;
  flush(reason: FlushReason): Promise<void>;
  /** The Markdown the core has. */
  lastSent(): string;
  /** Flushes first. */
  detach(): void;
}
export type TableSyncHandle = TextSyncHandle;

/** A block that isn't in page.json yet: its first flush inserts it, after `after` or at the end. */
export interface PendingInsert {
  block: Omit<NewBlock, 'data'>;
  after?: BlockId;
}

/** Typing waits this long after its last change. */
export const TYPING_IDLE = 150;
/** Typing that continues goes at least this often. */
export const TYPING_CEILING = 300;

/** Reasons that send even while an input method composes: the text would otherwise be lost. */
const FINAL: ReadonlySet<FlushReason> = new Set(['unmount', 'pageSwitch', 'hidden', 'exit']);

/** What a sync sends for its block: Markdown, or a table's data. */
type Content = { kind: 'text'; markdown: string } | { kind: 'data'; data: Record<string, unknown> };

interface Source {
  kind: Content['kind'];
  serialize(doc: PMNode): Content;
  /** The coalesce target of typing with this selection. */
  target(doc: PMNode, selection: Selection): string;
  /** Whether a change is more than typing, such as a table's new row. */
  structural(before: PMNode, after: PMNode): boolean;
}

interface Pending {
  before: UiSelection;
  range: { from: number; to: number };
  target: string;
}

const keyOf = (content: Content) => (content.kind === 'text' ? content.markdown : JSON.stringify(content.data));
const isEmpty = (content: Content) => content.kind === 'text' && content.markdown.trim() === '';

const accepted = new WeakMap<TextSyncHandle, (markdown: string) => void>();

/** Tells a text sync the core now has `markdown` for its block, after a frame replaced the editor's text. */
export function acceptRemoteText(handle: TextSyncHandle, markdown: string): void {
  accepted.get(handle)?.(markdown);
}

type PostTask = (callback: () => void, options: { priority: 'user-visible' }) => Promise<unknown>;

/** Runs `work` in a task of its own at user-visible priority, where the browser has `scheduler.postTask`. */
function inTask(work: () => void): void {
  const scheduler = (globalThis as { scheduler?: { postTask?: PostTask } }).scheduler;
  if (scheduler?.postTask) void scheduler.postTask(work, { priority: 'user-visible' });
  else work();
}

/** The range a transaction changed, in the positions of the document after it. */
function changedRange(tr: Transaction): { from: number; to: number } {
  let from = Infinity;
  let to = -Infinity;
  for (const step of tr.steps) {
    const map = step.getMap();
    if (from <= to) [from, to] = [map.map(from, -1), map.map(to, 1)];
    map.forEach((_oldStart, _oldEnd, start, end) => {
      from = Math.min(from, start);
      to = Math.max(to, end);
    });
  }
  return from <= to ? { from, to } : { from: tr.selection.from, to: tr.selection.from };
}

/** The document as typed, before the automatic change replaced the typed text (section 10.3). */
function typedAs(doc: PMNode, auto: AutoChangeMeta): PMNode {
  const transform = new Transform(doc);
  if (!auto.text) return transform.delete(auto.from, auto.to).doc;
  const marks = doc.resolve(auto.from).marks();
  return transform.replaceWith(auto.from, auto.to, doc.type.schema.text(auto.text, marks)).doc;
}

class Sync implements TextSyncHandle {
  private readonly internals: QueueInternals;
  private sent: string;
  private insert: PendingInsert | null;
  /** Whether batches carry the whole text instead of a splice. */
  private whole: boolean;
  private pending: Pending | null = null;
  private lastSelection: Selection;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private ceiling: ReturnType<typeof setTimeout> | null = null;
  private detached = false;
  private composeWaiters: (() => void)[] = [];
  private readonly untrack: () => void;

  constructor(
    private readonly editor: Editor,
    readonly block: BlockId,
    private readonly queue: SyncQueue,
    private readonly source: Source,
    initial: { sent: string; insert: PendingInsert | null },
  ) {
    this.internals = queueInternals(queue);
    this.sent = initial.sent;
    this.insert = initial.insert;
    this.whole = !this.internals.host.page.supportsSplice;
    this.lastSelection = editor.state.selection;
    editor.on('transaction', this.onTransaction);
    editor.on('blur', this.onBlur);
    editor.view.dom.addEventListener('compositionend', this.onCompositionEnd);
    this.untrack = this.internals.track({
      block,
      pending: () => this.pending !== null,
      flush: (reason) => this.flush(reason),
      composing: () => this.composing(),
      compositionDone: () => this.compositionDone(),
    });
    accepted.set(this, (markdown) => (this.sent = markdown));
  }

  get dirty(): boolean {
    return this.pending !== null;
  }

  lastSent(): string {
    return this.sent;
  }

  flush(reason: FlushReason): Promise<void> {
    if (!this.pending) return Promise.resolve();
    if (this.editor.view.composing && !FINAL.has(reason)) return Promise.resolve();
    return this.cut(this.editor.state.doc, this.editor.state.selection);
  }

  detach(): void {
    if (this.detached) return;
    void this.flush('unmount');
    this.detached = true;
    this.clearTimers();
    this.editor.off('transaction', this.onTransaction);
    this.editor.off('blur', this.onBlur);
    this.editor.view.dom.removeEventListener('compositionend', this.onCompositionEnd);
    this.onCompositionEnd();
    this.untrack();
  }

  private composing(): boolean {
    return !this.detached && this.editor.view.composing;
  }

  private compositionDone(): Promise<void> {
    if (!this.composing()) return Promise.resolve();
    return new Promise((resolve) => this.composeWaiters.push(resolve));
  }

  private ui(selection: Selection): UiSelection {
    return { kind: 'text', block: this.block, anchor: selection.anchor, head: selection.head };
  }

  private clearTimers(): void {
    if (this.idle) clearTimeout(this.idle);
    if (this.ceiling) clearTimeout(this.ceiling);
    this.idle = this.ceiling = null;
  }

  private schedule(): void {
    const fire = () => {
      this.clearTimers();
      inTask(() => void this.flush('timer'));
    };
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(fire, TYPING_IDLE);
    this.ceiling ??= setTimeout(fire, TYPING_CEILING);
  }

  private editsFor(content: Content): Edit[] {
    if (this.insert) {
      const data = content.kind === 'text' ? { markdown: content.markdown } : content.data;
      return [{ edit: 'insertBlock', block: { ...this.insert.block, data }, after: this.insert.after }];
    }
    if (content.kind === 'data') return [{ edit: 'patchBlock', block: this.block, data: content.data }];
    const splice = this.whole ? null : diffMarkdown(this.sent, content.markdown);
    if (!splice) return [{ edit: 'setText', block: this.block, markdown: content.markdown }];
    const at = utf8Offset(this.sent, splice.at);
    return [{ edit: 'spliceText', block: this.block, at, del: splice.del, ins: splice.ins }];
  }

  /** Builds the batch for `doc` when its turn comes; `target` makes it typing. */
  private build(doc: PMNode, selections: EditBatch['ui'], target: string | null): EditBatch | null {
    const content = this.source.serialize(doc);
    const key = keyOf(content);
    if (this.insert ? isEmpty(content) : key === this.sent) return null;
    const edits = this.editsFor(content);
    const typing = target !== null && !this.insert;
    this.sent = key;
    this.insert = null;
    const batch: EditBatch = { edits };
    if (typing) batch.coalesce = { kind: 'typing', target };
    if (selections) batch.ui = selections;
    return batch;
  }

  /** Puts the document in the chain as one batch. A refused batch leaves the text to send again. */
  private enqueue(doc: PMNode, selections: EditBatch['ui'], target: string | null): Promise<void> {
    let before = { sent: this.sent, insert: this.insert };
    const build = () => {
      before = { sent: this.sent, insert: this.insert };
      return this.build(doc, selections, target);
    };
    const failed = (error: unknown) => {
      this.sent = before.sent;
      this.insert = before.insert;
      const resync = error instanceof PageServiceError && error.resync;
      // The page view reopens the page.
      if (resync && hasResyncListener(this.queue)) return;
      if (resync && !this.whole) {
        // Nobody reopens the page, so the whole text goes instead, and nothing typed is lost.
        this.whole = true;
        void this.enqueue(this.editor.state.doc, undefined, null);
        return;
      }
      this.keepUnsent();
    };
    return this.internals.enqueue(build, this.block, failed).then(
      () => undefined,
      (error: unknown) => reportSendError(this.queue, error),
    );
  }

  /** Marks the text as not sent, so the next change, blur, page switch, or exit sends it again. */
  private keepUnsent(): void {
    if (this.pending || this.detached) return;
    const { doc, selection } = this.editor.state;
    const target = this.source.target(doc, selection);
    this.pending = { before: this.ui(selection), range: { from: 0, to: doc.content.size }, target };
  }

  /** Sends the pending typing, as it was in `doc`, with the selection `after` it. */
  private cut(doc: PMNode, after: Selection): Promise<void> {
    const typed = this.pending;
    this.pending = null;
    this.clearTimers();
    if (!typed) return Promise.resolve();
    return this.enqueue(doc, { before: typed.before, after: this.ui(after) }, typed.target);
  }

  private readonly onTransaction = ({ transaction: tr }: { transaction: Transaction }) => {
    const previous = this.lastSelection;
    this.lastSelection = this.editor.state.selection;
    if (!tr.docChanged || tr.getMeta(META_HIGHLIGHT)) return;
    if (tr.getMeta(META_REMOTE)) {
      const range = this.pending?.range;
      if (range) this.pending!.range = { from: tr.mapping.map(range.from, -1), to: tr.mapping.map(range.to, 1) };
      return;
    }
    const auto = tr.getMeta(META_AUTO_CHANGE) as AutoChangeMeta | undefined;
    if (auto) this.automatic(tr, auto, previous);
    else if (tr.getMeta('uiEvent') || tr.getMeta(META_COMMAND) || this.source.structural(tr.before, tr.doc)) {
      void this.cut(tr.before, previous);
      void this.enqueue(tr.doc, { before: this.ui(previous), after: this.ui(this.lastSelection) }, null);
    } else this.typed(tr, previous);
  };

  private typed(tr: Transaction, previous: Selection): void {
    const range = changedRange(tr);
    const target = this.source.target(tr.doc, this.lastSelection);
    const pending = this.pending;
    if (pending) {
      const from = tr.mapping.map(pending.range.from, -1);
      const to = tr.mapping.map(pending.range.to, 1);
      // Typing away from the pending range means the caret jumped: what was typed goes first, as it was.
      if (pending.target !== target || range.from > to || range.to < from) void this.cut(tr.before, previous);
      else pending.range = { from: Math.min(from, range.from), to: Math.max(to, range.to) };
    }
    this.pending ??= { before: this.ui(previous), range, target };
    this.schedule();
  }

  /** The text as typed goes as typing, then the automatic change as a step of its own (section 10.3). */
  private automatic(tr: Transaction, auto: AutoChangeMeta, previous: Selection): void {
    const typedDoc = typedAs(tr.before, auto);
    const at = Math.min(auto.from + auto.text.length, typedDoc.content.size);
    const typedSelection: UiSelection = { kind: 'text', block: this.block, anchor: at, head: at };
    const target = this.source.target(tr.before, previous);
    const before = this.pending?.before ?? this.ui(previous);
    const typingTarget = this.pending?.target ?? target;
    this.pending = null;
    this.clearTimers();
    void this.enqueue(typedDoc, { before, after: typedSelection }, typingTarget);
    void this.enqueue(tr.doc, { before: typedSelection, after: this.ui(this.lastSelection) }, null);
  }

  private readonly onBlur = () => {
    void this.flush('blur').then(() => this.dropIfEmpty());
  };

  /** An empty floating text box goes away when focus leaves it; one never typed in was never in the page. */
  private dropIfEmpty(): void {
    if (this.detached || this.pending || this.source.kind !== 'text') return;
    const frame = this.insert?.block.frame;
    const floating = this.insert
      ? frame?.x !== undefined && frame.y !== undefined
      : this.internals.mirror.floating(this.block);
    if (!floating || !isEmpty(this.source.serialize(this.editor.state.doc))) return;
    const { frames } = this.internals.host;
    if (this.insert) {
      frames.removeBlock(this.block);
      return;
    }
    const remove = () => ({ edits: [{ edit: 'deleteBlocks' as const, blocks: [this.block] }] });
    this.internals.enqueue(remove, this.block).then(
      () => frames.removeBlock(this.block),
      (error: unknown) => reportSendError(this.queue, error),
    );
  }

  private readonly onCompositionEnd = () => {
    const waiters = this.composeWaiters;
    this.composeWaiters = [];
    waiters.forEach((resolve) => resolve());
    if (this.pending && !this.detached) this.schedule();
  };
}

export function attachTextSync(
  editor: Editor,
  block: BlockId,
  queue: SyncQueue,
  cache: MarkdownCache,
  initialMarkdown: string,
  insert: PendingInsert | null = null,
): TextSyncHandle {
  const source: Source = {
    kind: 'text',
    serialize: (doc) => ({ kind: 'text', markdown: serializeTextBlock(doc, cache) }),
    target: () => block,
    structural: () => false,
  };
  return new Sync(editor, block, queue, source, { sent: initialMarkdown, insert });
}

/** The row and column of the cell at `pos`, or null outside every cell. */
function cellAt(doc: PMNode, pos: number): { row: number; column: number } | null {
  const $pos = doc.resolve(Math.min(pos, doc.content.size));
  for (let depth = $pos.depth; depth > 1; depth--) {
    const role = $pos.node(depth).type.spec.tableRole as string | undefined;
    if (role === 'cell' || role === 'header_cell') return { row: $pos.index(depth - 2), column: $pos.index(depth - 1) };
  }
  return null;
}

/** A table's shape: everything but the cells' text. */
const shapeOf = (data: TableData) =>
  JSON.stringify([data.header, data.columns, data.rows.map((row) => [row.id, Object.keys(row.cells)])]);

/**
 * A table block's sync: a patchBlock of `data.rows` for typing, coalesced by cell as `<block>/<row>/<column>`
 * (P3-4). A change to the table's shape sends the whole data.
 */
export function attachTableSync(
  editor: Editor,
  block: BlockId,
  queue: SyncQueue,
  toData: (doc: PMNode) => TableData,
): TableSyncHandle {
  let shape = shapeOf(toData(editor.state.doc));
  const source: Source = {
    kind: 'data',
    serialize(doc) {
      const data = toData(doc);
      const next = shapeOf(data);
      const same = next === shape;
      shape = next;
      return { kind: 'data', data: same ? { rows: data.rows } : { ...data } };
    },
    target(doc, selection) {
      const cell = cellAt(doc, selection.head);
      if (!cell) return block;
      const data = toData(doc);
      return `${block}/${data.rows[cell.row]?.id ?? cell.row}/${data.columns[cell.column]?.id ?? cell.column}`;
    },
    structural: (before, after) => shapeOf(toData(before)) !== shapeOf(toData(after)),
  };
  const initial = JSON.stringify({ rows: toData(editor.state.doc).rows });
  return new Sync(editor, block, queue, source, { sent: initial, insert: null });
}
