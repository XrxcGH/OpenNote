// Insert table (ARCHITECTURE.md sections 10.3 and 13; owner: WP6): a 3 by 3 table with a header row, after the
// paragraph with the caret. Text after that paragraph moves into a new text block below the table, so the page
// reads in the same order. The text edit and both new blocks go to the core as one step, which one undo removes.
import type { Editor } from '@tiptap/core';
import { newId } from '../../../editor/ids';
import { createMarkdownCache, serializeTextBlock } from '../../../editor/markdown';
import { META_REMOTE } from '../../../editor/meta';
import type { TableData } from '../../../editor/schema/specs';
import { newTableData, tableOf } from '../../../editor/table/mapping';
import type { BlockId, BlockJson, Edit, Frame } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { syncOf } from '../blocks/textBlock';
import { shownLayer } from '../mount';
import { shownPool } from '../pool/shown';
import { acceptRemoteText, shownQueue } from '../sync';
import { whenViewReady } from './lazyView';

/** Splits a text block's document after the top-level block with the caret. An empty paragraph there goes. */
function splitAtCaret(editor: Editor): { head: string; tail: string; headEnd: number } {
  const { doc, selection } = editor.state;
  const cache = createMarkdownCache();
  const $from = selection.$from;
  const index = $from.depth === 0 ? Math.min($from.index(0), doc.childCount - 1) : $from.index(0);
  const start = $from.depth === 0 ? $from.pos : $from.before(1);
  const node = doc.child(index);
  const end = start + node.nodeSize;
  const emptyParagraph = node.type.name === 'paragraph' && node.content.size === 0 && doc.childCount > 1;
  const headEnd = emptyParagraph ? start : end;
  return {
    head: serializeTextBlock(doc.cut(0, headEnd), cache),
    tail: serializeTextBlock(doc.cut(end), cache),
    headEnd,
  };
}

export async function insertTable(data: TableData = newTableData(3, 3, true)): Promise<boolean> {
  const queue = shownQueue.get();
  const layer = shownLayer.get();
  const pool = shownPool.get();
  if (!queue || !layer) return false;
  const active = pool?.active() ?? null;
  const id: BlockId = newId();
  const edits: Edit[] = [];
  let after: BlockId | undefined = active?.block;
  let frame: Frame | undefined;
  let tail: { id: BlockId; markdown: string } | null = null;
  const source = active && layer.view(active.block);
  const floating = Boolean(source && source.element.style.left !== '');
  if (active && source && floating) {
    const rect = source.measure();
    frame = { x: rect.x, y: rect.y + rect.h + 16 };
  }
  if (active && !tableOf(active.editor.state.doc) && !floating) {
    const split = splitAtCaret(active.editor);
    if (split.tail !== '') {
      const sync = syncOf(active.editor);
      await sync?.flush('command');
      edits.push({ edit: 'setText', block: active.block, markdown: split.head });
      const { state } = active.editor;
      active.editor.view.dispatch(state.tr.delete(split.headEnd, state.doc.content.size).setMeta(META_REMOTE, true));
      if (sync) acceptRemoteText(sync, split.head);
      tail = { id: newId(), markdown: split.tail };
    }
  } else if (!active) {
    after = undefined;
  }
  edits.push({
    edit: 'insertBlock',
    block: { id, type: 'table', data: { ...data }, ...(frame ? { frame } : {}) },
    after,
  });
  if (tail)
    edits.push({
      edit: 'insertBlock',
      block: { id: tail.id, type: 'text', data: { markdown: tail.markdown } },
      after: id,
    });
  const ack = await queue.send({ edits });
  const now = new Date().toISOString();
  const made = (blockId: BlockId, type: string, blockData: Record<string, unknown>, at?: Frame): BlockJson => ({
    id: blockId,
    type,
    order: ack.orderKeys[blockId] ?? 'zz',
    created: now,
    modified: now,
    data: blockData,
    ...(at ? { frame: at } : {}),
  });
  layer.upsert(made(id, 'table', { ...data }, frame));
  if (tail) layer.upsert(made(tail.id, 'text', { markdown: tail.markdown }));
  announce(t('tables.announce.inserted'));
  const view = layer.view(id);
  if (view) await whenViewReady(view.element);
  const editor = pool?.mount(id, { kind: 'start' }, 'focus');
  editor?.commands.focus('start');
  return true;
}
