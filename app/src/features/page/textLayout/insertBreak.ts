// Insert page break and Insert column break (spec 6.12). A break is a block of its own. The text block with the caret
// is split at the caret, as Word and Docs do. The text before stays, the break follows, and
// the text after moves to a new text block below it. The edits go to the core as one step, which one undo removes.
import { newId } from '../../../editor/ids';
import { META_REMOTE } from '../../../editor/meta';
import { BREAK_FALLBACK, type BreakKind } from '../../pages';
import type { BlockId, BlockJson, Edit } from '../../../services/pages/types';
import { syncOf } from '../blocks/textBlock';
import { announce } from '../../../ui';
import { t } from '../../../strings/t';
import { readingLock } from '../qol/stores';
import { shownLayer } from '../mount';
import { shownPool } from '../pool/shown';
import { acceptRemoteText, shownQueue } from '../sync';
import { splitAtPosition } from '../tables/insert';
import { whenViewReady } from '../tables/lazyView';

/** Whether a break can be inserted now: a page is shown with its sync queue. */
export const canInsertBreak = (): boolean => shownQueue.get() !== null && shownLayer.get() !== null;

/** Inserts a break at the caret, and puts the caret in the text below it. */
export async function insertBreak(kind: BreakKind): Promise<boolean> {
  const queue = shownQueue.get();
  const layer = shownLayer.get();
  const pool = shownPool.get();
  if (!queue || !layer || readingLock.get()) return false;
  const active = pool?.active() ?? null;
  if (active && layer.block(active.block)?.lock) {
    announce(t('page.object.locked'));
    return false;
  }
  // A draft text box is not in the page until it is typed in, so the break goes at the end, and the draft stays.
  const draft = active ? (syncOf(active.editor)?.unsaved ?? false) : false;
  const source = active && layer.view(active.block);
  const floating = Boolean(source && source.element.style.left !== '');
  const after: BlockId | undefined = draft || !active ? undefined : active.block;
  const breakId = newId();
  const tailId = newId();
  const edits: Edit[] = [];
  let tail = '';
  let cut: { head: string; headEnd: number } | null = null;
  if (active && !draft && !floating) {
    // A range selection is replaced by the break, as in Word.
    if (!active.editor.state.selection.empty) active.editor.view.dispatch(active.editor.state.tr.deleteSelection());
    const split = splitAtPosition(active.editor.state);
    tail = split.tail;
    await syncOf(active.editor)?.flush('command');
    if (tail !== '') {
      edits.push({ edit: 'setText', block: active.block, markdown: split.head });
      cut = split;
    }
  }
  const data = { kind };
  edits.push(
    { edit: 'insertBlock', block: { id: breakId, type: 'break', data, fallback: { ...BREAK_FALLBACK } }, after },
    { edit: 'insertBlock', block: { id: tailId, type: 'text', data: { markdown: tail } }, after: breakId },
  );
  // The editor is cut only after the core accepted the step, so a refused step leaves the text as it was.
  let ack: Awaited<ReturnType<typeof queue.send>>;
  try {
    ack = await queue.send({ edits });
  } catch {
    announce(t('textLayout.announce.breakInsertFailed'));
    return false;
  }
  if (active && cut) {
    const { state } = active.editor;
    active.editor.view.dispatch(state.tr.delete(cut.headEnd, state.doc.content.size).setMeta(META_REMOTE, true));
    const sync = syncOf(active.editor);
    if (sync) acceptRemoteText(sync, cut.head);
  }
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
