// Deleting from Trash for good (A2-4, A4-3), behind trash.purge: Empty Trash, Delete forever for one item, and
// Delete folder for a notebook in Trash. Each asks first, with the least destructive answer focused. A purge removes
// the page's history with its folder, and the shell forgets its search entries and transcripts. A notebook's folder
// is never deleted outright: Delete folder moves it to the Recycle Bin, where File Explorer can still bring it back.

import type { NodeId, NotesService, TrashedItem } from '../../services/notes';
import { shellCall } from '../../platform/shellqol';
import { t } from '../../strings/t';
import { announce, confirm, showToast } from '../../ui';
import { titleOf } from '../tree';
import { trashChanged } from './restore';

/** A notes service that can delete Trash items for good: the core's service and the in-memory one. */
export type PurgingNotes = NotesService & { purgeFromTrash(ids: readonly NodeId[]): Promise<void> };

export function canPurge(notes: NotesService): notes is PurgingNotes {
  return typeof (notes as Partial<PurgingNotes>).purgeFromTrash === 'function';
}

const isNotebook = (item: TrashedItem) => item.node.kind === 'notebook';

async function purge(notes: NotesService, ids: readonly NodeId[]): Promise<boolean> {
  if (!canPurge(notes) || ids.length === 0) return false;
  try {
    await notes.purgeFromTrash(ids);
    return true;
  } catch {
    showToast({ message: t('tree.trash.purgeFailed'), tone: 'danger' });
    return false;
  } finally {
    trashChanged();
  }
}

/** Deletes one item for good, after asking. A notebook goes through Delete folder instead. */
export async function deleteForever(notes: NotesService, item: TrashedItem): Promise<boolean> {
  if (isNotebook(item)) return deleteNotebookFolder(item);
  const title = titleOf(item.node);
  const sure = await confirm({
    title: t('tree.trash.deleteForeverTitle', { title }),
    body: t('tree.trash.deleteForeverBody'),
    confirmLabel: t('tree.trash.deleteForever'),
    danger: true,
  });
  if (!sure || !(await purge(notes, [item.node.id]))) return false;
  announce(t('tree.trash.deletedForever', { title }));
  return true;
}

/** Deletes everything in Trash for good, after asking. Notebooks stay until Delete folder. */
export async function emptyTrash(notes: NotesService, items: readonly TrashedItem[]): Promise<boolean> {
  const ids = items.filter((item) => !isNotebook(item)).map((item) => item.node.id);
  if (ids.length === 0) return false;
  const notebooks = items.some(isNotebook);
  const sure = await confirm({
    title: t('tree.trash.emptyTitle'),
    body: t(notebooks ? 'tree.trash.emptyBodyNotebooks' : 'tree.trash.emptyBody', { count: ids.length }),
    confirmLabel: t('tree.trash.emptyTrash'),
    danger: true,
  });
  if (!sure || !(await purge(notes, ids))) return false;
  announce(t('tree.trash.emptied'));
  return true;
}

/** Moves a trashed notebook's folder to the Recycle Bin, after asking, and takes it off the Trash list. */
export async function deleteNotebookFolder(item: TrashedItem): Promise<boolean> {
  const title = titleOf(item.node);
  const sure = await confirm({
    title: t('tree.trash.deleteFolderTitle', { title }),
    body: t('tree.trash.deleteFolderBody'),
    confirmLabel: t('tree.trash.deleteFolder'),
    danger: true,
  });
  if (!sure) return false;
  try {
    const answer = await shellCall<{ ok?: boolean } | null>('trash.deleteFolder', { id: item.node.id });
    if (!answer?.ok) throw new Error('not deleted');
    announce(t('tree.trash.folderDeleted', { title }));
    return true;
  } catch {
    showToast({ message: t('tree.trash.folderFailed'), tone: 'danger' });
    return false;
  } finally {
    trashChanged();
  }
}
