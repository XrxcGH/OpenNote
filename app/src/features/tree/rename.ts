// Inline rename (ARCHITECTURE.md section 13.5). F2, a double-click on the title, or the context menu starts it.
// Enter or leaving the field commits, and Escape cancels; a new item keeps its default name on Escape. A refused
// name keeps the field open with the message under it, which is also announced, because some screen readers
// don't read a description that changes on a focused field.

import type { NodeId, NotesService } from '../../services/notes';
import { announce } from '../../ui';
import { renameNode } from './actions';
import { realId } from './create';
import { checkName, nameError, toastError } from './errors';
import { treeStore } from './store';

export function startRename(id: NodeId): void {
  const node = treeStore.get().nodes[id];
  if (!node || node.readOnly) return;
  treeStore.set((state) => ({ ...state, renaming: { id, draft: node.title, error: null, isNew: false } }));
}

export function setDraft(draft: string): void {
  treeStore.set((state) => (state.renaming ? { ...state, renaming: { ...state.renaming, draft } } : state));
}

/** Changes the open field, if it is still for one of these ids (a new item's id changes once it is created). */
function update(ids: readonly (NodeId | null)[], error: string | null | undefined): void {
  treeStore.set((state) => {
    const renaming = state.renaming;
    if (!renaming || !ids.includes(renaming.id)) return state;
    return { ...state, renaming: error === undefined ? null : { ...renaming, error } };
  });
  if (error) announce(error);
}

/**
 * Commits the draft. `leaving` is true when focus left the field: a refused name can't keep focus there, so the
 * old name stays instead. Resolves true when the field closed.
 */
export async function commitRename(notes: NotesService, leaving = false): Promise<boolean> {
  const renaming = treeStore.get().renaming;
  if (!renaming) return true;
  const problem = checkName(renaming.draft);
  if (problem && !leaving) update([renaming.id], problem);
  if (problem) {
    if (leaving) update([renaming.id], undefined);
    return leaving;
  }
  const id = await realId(renaming.id);
  const ids = [renaming.id, id];
  try {
    if (id) await renameNode(notes, id, renaming.draft);
    update(ids, undefined);
    return true;
  } catch (error) {
    const message = nameError(error);
    if (message && !leaving) {
      update(ids, message);
      return false;
    }
    update(ids, undefined);
    toastError(error, renaming.draft.trim());
    return true;
  }
}

/** Escape: the old name stays, and a new item keeps its default name. */
export function cancelRename(): void {
  const renaming = treeStore.get().renaming;
  if (renaming) update([renaming.id], undefined);
}
