// Restoring parts of an older version (ARCHITECTURE.md section 21). A paragraph whose block still exists replaces its
// aligned paragraph, or goes in after its aligned predecessor, with one text edit: one undo step. Whole blocks, such
// as tables, images, or a deleted text block, come back through history_restore_blocks, one transaction in the core.
// The whole version comes back through history_restore, in place or as a copy.
import type { Node as PMNode } from '@tiptap/pm/model';
import type { ParagraphChange } from '../../../editor/diff/pageDiff';
import { parseTextBlock } from '../../../editor/markdown';
import { META_COMMAND } from '../../../editor/meta';
import type { BlockId, OpenPage } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { shownPool } from '../pool/shown';
import { shownQueue } from '../sync/shown';

/** Where the top-level node `index` starts and ends in `doc`, or the end of the doc for one past the last. */
function childRange(doc: PMNode, index: number): { from: number; to: number } | null {
  if (index > doc.childCount) return null;
  let from = 0;
  for (let i = 0; i < index; i += 1) from += doc.child(i).nodeSize;
  return { from, to: index < doc.childCount ? from + doc.child(index).nodeSize : from };
}

/** The current index the older paragraph goes in at: its pair's, or right after its nearest earlier kept paragraph. */
function targetIndex(change: ParagraphChange, all: readonly ParagraphChange[]): { index: number; replace: boolean } {
  if (change.after) return { index: change.after.index, replace: true };
  const at = all.indexOf(change);
  const earlier = all
    .slice(0, at)
    .reverse()
    .find((item) => item.after);
  return { index: earlier?.after ? earlier.after.index + 1 : 0, replace: false };
}

/** Puts an older paragraph back into its text block with one edit. Resolves false when the page changed meanwhile. */
export async function restoreParagraph(
  block: BlockId,
  change: ParagraphChange,
  all: readonly ParagraphChange[],
): Promise<boolean> {
  const pool = shownPool.get();
  const editor = pool && (pool.editor(block) ?? pool.mount(block, null, 'target'));
  if (!editor || !change.before) return false;
  const { index, replace } = targetIndex(change, all);
  const { doc } = editor.state;
  const range = childRange(doc, index);
  const stale = replace && (index >= doc.childCount || doc.child(index).textContent !== change.after?.node.textContent);
  if (!range || stale) {
    announce(t('history.restore.gone'));
    return false;
  }
  const older = editor.schema.nodeFromJSON(parseTextBlock(change.before.markdown).toJSON());
  const tr = editor.state.tr.replaceWith(range.from, replace ? range.to : range.from, older.content);
  editor.view.dispatch(tr.setMeta(META_COMMAND, true));
  await shownQueue.get()?.flushAll('command');
  announce(t('history.restore.done'));
  return true;
}

/** Brings blocks back from `revision` as they were, in one transaction. */
export async function restoreBlocks(page: OpenPage, revision: string, blocks: readonly BlockId[]): Promise<boolean> {
  try {
    await shownQueue.get()?.flushAll('command');
    await page.history.restoreBlocks(revision, blocks);
    announce(t('history.restore.done'));
    return true;
  } catch {
    announce(t('history.restore.failed'), 'assertive');
    return false;
  }
}

/** Restores the whole version, in place or as a new page. */
export async function restoreVersion(page: OpenPage, revision: string, asCopy: boolean): Promise<boolean> {
  try {
    await shownQueue.get()?.flushAll('command');
    await page.history.restore(revision, asCopy);
    announce(t(asCopy ? 'history.restore.copyDone' : 'history.restore.done'));
    return true;
  } catch {
    announce(t('history.restore.failed'), 'assertive');
    return false;
  }
}
