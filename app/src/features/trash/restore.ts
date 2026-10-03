// Restoring an item from the Trash view (ARCHITECTURE.md section 13.9): the tree lists the place it returned to,
// and the list reloads. The item's Restore button, its context menu, and the palette all come here.

import type { NodeId, NotesService } from '../../services/notes';
import { createStore } from '../../state/store';
import { t } from '../../strings/t';
import { announce, showToast } from '../../ui';
import { listRestored, titleOf } from '../tree';

/** Changes whenever the Trash list may have changed, so the view lists it again. */
export const trashStore = createStore<{ readonly version: number }>({ version: 0 }, 'trash');

export function trashChanged(): void {
  trashStore.set((state) => ({ version: state.version + 1 }));
}

/** Restores one item. Resolves true when it came back. */
export async function restoreTrashItem(notes: NotesService, id: NodeId): Promise<boolean> {
  try {
    const restored = await notes.restoreFromTrash([id]);
    await listRestored(restored);
    const title = restored[0] ? titleOf(restored[0]) : '';
    announce(t('tree.trash.restored', { title }));
    return restored.length > 0;
  } catch {
    showToast({ message: t('tree.trash.restoreFailed'), tone: 'danger' });
    return false;
  } finally {
    trashChanged();
  }
}
