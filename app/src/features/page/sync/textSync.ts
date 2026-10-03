// Turning editor transactions into text edits (ARCHITECTURE.md section 10.2; owner after WP0: WP2). WP0's sync
// sends the whole Markdown with setText after every change, with no batching; WP2 adds the 150 and 300 ms
// flushes, splices, automatic-change steps, and composition handling.
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { serializeTextBlock } from '../../../editor/markdown';
import type { MarkdownCache } from '../../../editor/markdown';
import { META_HIGHLIGHT, META_REMOTE } from '../../../editor/meta';
import type { TableData } from '../../../editor/schema/specs';
import type { BlockId, NewBlock } from '../../../services/pages/types';
import { queueInternals } from './queue';
import type { FlushReason, SyncQueue } from './queue';

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

type Serialized = { edit: 'setText'; markdown: string } | { edit: 'patchBlock'; data: Record<string, unknown> };

const accepted = new WeakMap<TextSyncHandle, (markdown: string) => void>();

/** Tells a text sync the core now has `markdown` for its block, after a frame replaced the editor's text. */
export function acceptRemoteText(handle: TextSyncHandle, markdown: string): void {
  accepted.get(handle)?.(markdown);
}

const keyOf = (next: Serialized) => (next.edit === 'setText' ? next.markdown : JSON.stringify(next.data));

function attach(
  editor: Editor,
  block: BlockId,
  queue: SyncQueue,
  serialize: (doc: PMNode) => Serialized,
  initial: string,
  insert: PendingInsert | null,
): TextSyncHandle {
  const { track, sendOwn } = queueInternals(queue);
  const typing = { kind: 'typing' as const, target: block };
  let sent = initial;
  let dirty = false;
  let pending = insert;
  let running: Promise<void> = Promise.resolve();
  const flushNow = async () => {
    if (!dirty) return;
    dirty = false;
    const next = serialize(editor.state.doc);
    if (keyOf(next) === sent && !pending) return;
    sent = keyOf(next);
    if (pending) {
      const data = next.edit === 'setText' ? { markdown: next.markdown } : next.data;
      const edits = [{ edit: 'insertBlock' as const, block: { ...pending.block, data }, after: pending.after }];
      pending = null;
      await sendOwn({ edits });
    } else if (next.edit === 'setText') {
      await sendOwn({ edits: [{ edit: 'setText', block, markdown: next.markdown }], coalesce: typing });
    } else {
      await sendOwn({ edits: [{ edit: 'patchBlock', block, data: next.data }], coalesce: typing });
    }
  };
  const flush = () => (running = running.then(flushNow, flushNow));
  const onTransaction = ({ transaction }: { transaction: { docChanged: boolean; getMeta(key: string): unknown } }) => {
    if (!transaction.docChanged || transaction.getMeta(META_REMOTE) || transaction.getMeta(META_HIGHLIGHT)) return;
    dirty = true;
    void flush();
  };
  editor.on('transaction', onTransaction);
  let untrack = () => {};
  const handle: TextSyncHandle = {
    block,
    get dirty() {
      return dirty;
    },
    flush: () => flush(),
    lastSent: () => sent,
    detach() {
      void flush();
      editor.off('transaction', onTransaction);
      untrack();
    },
  };
  untrack = track(handle);
  accepted.set(handle, (markdown) => {
    sent = markdown;
  });
  return handle;
}

export function attachTextSync(
  editor: Editor,
  block: BlockId,
  queue: SyncQueue,
  cache: MarkdownCache,
  initialMarkdown: string,
  insert: PendingInsert | null = null,
): TextSyncHandle {
  const serialize = (doc: PMNode): Serialized => ({ edit: 'setText', markdown: serializeTextBlock(doc, cache) });
  return attach(editor, block, queue, serialize, initialMarkdown, insert);
}

/** A table block's sync: a patchBlock of data.rows. */
export function attachTableSync(
  editor: Editor,
  block: BlockId,
  queue: SyncQueue,
  toData: (doc: PMNode) => TableData,
): TableSyncHandle {
  const rows = (doc: PMNode): Serialized => ({ edit: 'patchBlock', data: { rows: toData(doc).rows } });
  return attach(editor, block, queue, rows, keyOf(rows(editor.state.doc)), null);
}
