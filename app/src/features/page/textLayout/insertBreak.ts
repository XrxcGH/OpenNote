// Insert page break and Insert column break (spec 6.12). A break is a block of its own. The text block with the caret
// is split after the paragraph the caret is in, as Insert table does. The text before stays, the break follows, and
// the text after moves to a new text block below it. The edits go to the core as one step, which one undo removes.
import { newId } from '../../../editor/ids';
import { META_REMOTE } from '../../../editor/meta';
import { BREAK_FALLBACK, type BreakKind } from '../../pages';
import type { BlockId, BlockJson, Edit } from '../../../services/pages/types';
import { syncOf } from '../blocks/textBlock';
import { shownLayer } from '../mount';
import { shownPool } from '../pool/shown';
import { acceptRemoteText, shownQueue } from '../sync';
import { splitAtCaret } from '../tables/insert';
import { whenViewReady } from '../tables/lazyView';

/** Whether a break can be inserted now: a page is shown with its sync queue. */
export const canInsertBreak = (): boolean => shownQueue.get() !== null && shownLayer.get() !== null;

/** Inserts a break after the paragraph with the caret, and puts the caret in the text below it. */
export async function insertBreak(kind: BreakKind): Promise<boolean> {
  const queue = shownQueue.get();
  const layer = shownLayer.get();
  const pool = shownPool.get();
  if (!queue || !layer) return false;
  const active = pool?.active() ?? null;
  // A draft text box is not in the page until it is typed in, so the break goes at the end, and the draft stays.
  const draft = active ? (syncOf(active.editor)?.unsaved ?? false) : false;
  const source = active && layer.view(active.block);
  const floating = Boolean(source && source.element.style.left !== '');
  const after: BlockId | undefined = draft || !active ? undefined : active.block;
  const breakId = newId();
  const tailId = newId();
  const edits: Edit[] = [];
  let tail = '';
  if (active && !draft && !floating) {
    const split = splitAtCaret(active.editor);
    tail = split.tail;
    const sync = syncOf(active.editor);
    await sync?.flush('command');
    if (tail !== '') {
      edits.push({ edit: 'setText', block: active.block, markdown: split.head });
      const { state } = active.editor;
      active.editor.view.dispatch(state.tr.delete(split.headEnd, state.doc.content.size).setMeta(META_REMOTE, true));
      if (sync) acceptRemoteText(sync, split.head);
    }
  }
  const data = { kind };
  edits.push(
    { edit: 'insertBlock', block: { id: breakId, type: 'break', data, fallback: { ...BREAK_FALLBACK } }, after },
    { edit: 'insertBlock', block: { id: tailId, type: 'text', data: { markdown: tail } }, after: breakId },
  );
  const ack = await queue.send({ edits });
  const now = new Date().toISOString();
  const made = (id: BlockId, type: string, blockData: Record<string, unknown>): BlockJson => ({
    id,
    type,
    order: ack.orderKeys[id] ?? 'zz',
    created: now,
    modified: now,
    data: blockData,
    ...(type === 'break' ? { fallback: { ...BREAK_FALLBACK } } : {}),
  });
  layer.upsert(made(breakId, 'break', data));
  layer.upsert(made(tailId, 'text', { markdown: tail }));
  const view = layer.view(tailId);
  if (view) await whenViewReady(view.element);
  pool?.mount(tailId, { kind: 'start' }, 'focus')?.commands.focus('start');
  return true;
}
