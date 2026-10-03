// Delete to Trash and Undo (ARCHITECTURE.md section 13.9). The row leaves at once, focus goes to its neighbor,
// and a toast with Undo stays until dismissed. A notebook asks first, with focus on Cancel. The toast's Undo and
// Ctrl+Z both go through the undo stack, so Ctrl+Z still works after the toast is gone.

import { getLocation, navigate } from '../../app/location';
import type { Location } from '../../app/location';
import { shortcutHint } from '../../commands/keymap';
import type { NodeId, NodeSummary, NotesService } from '../../services/notes';
import { t } from '../../strings/t';
import { confirm, showToast } from '../../ui';
import { blockOf, titleOf, trashNodes } from './actions';
import { toastError } from './errors';
import { focusTargetAfterRemoval } from './focus';
import type { FocusTarget } from './focus';
import { ensureChildren } from './load';
import { revealNode } from './navigation';
import { showLocation } from './selection';
import { ancestors, getNode, requestFocus, treeOf, treeStore } from './store';
import { undoEntry, undoStore } from './undo';

/** The pages under a container, counting subpages, from what the service lists. */
export async function countPages(id: NodeId): Promise<number> {
  await ensureChildren(id);
  const state = treeStore.get();
  const node = state.nodes[id];
  if (!node) return 0;
  if (node.kind === 'section') return node.childCount;
  const counts = await Promise.all((state.children[id] ?? []).map((child) => countPages(child)));
  return counts.reduce((sum, count) => sum + count, 0);
}

type Workspace = Extract<Location, { view: 'workspace' }>;

/** The workspace location when it shows the node, or something under it. */
function locationInside(node: NodeSummary): Workspace | null {
  const location = getLocation();
  if (location.view !== 'workspace') return null;
  const state = treeStore.get();
  const shown = [location.sectionId, location.pageId].filter((id): id is NodeId => id !== null);
  const holds = (id: NodeId) =>
    id === node.id ||
    ancestors(state, id).some((above) => above.id === node.id) ||
    blockOf(state, node.id).includes(id);
  return shown.some(holds) ? location : null;
}

/** After the row has gone, the open page moves to its neighbor, and an open section closes. */
function moveOpenLocation(node: NodeSummary, location: Workspace, target: FocusTarget | null): void {
  if (node.kind === 'page') {
    const next = target?.tree === 'pages' ? target.id : null;
    showLocation({ ...location, pageId: next });
    return;
  }
  navigate({ ...location, sectionId: null, pageId: null }, { replace: true, focus: 'keep' });
}

function trashedToast(notes: NotesService, title: string): void {
  const entry = undoStore.get().past.at(-1);
  const shortcut = shortcutHint('edit.undo');
  showToast({
    message: t('tree.trash.moved', { title }),
    announce: shortcut
      ? t('tree.trash.movedAnnounce', { title, shortcut })
      : t('tree.trash.movedAnnounceNoShortcut', { title }),
    action: { label: t('tree.trash.undo'), run: () => void (entry && undoEntry(notes, entry)) },
  });
}

async function confirmNotebook(node: NodeSummary): Promise<boolean> {
  const count = await countPages(node.id);
  return confirm({
    title: t('tree.trash.confirmTitle', { title: titleOf(node) }),
    body: count ? t('tree.trash.confirmBody', { count }) : t('tree.trash.confirmBodyEmpty'),
    confirmLabel: t('tree.trash.confirm'),
    danger: true,
  });
}

/** Puts back what an undo restored: its row in view and focused, and the open page or section shown again. */
function showRestored(restored: readonly NodeSummary[], before: Workspace | null): void {
  const first = restored[0];
  if (!first) return;
  revealNode(first.id);
  if (before) showLocation(before);
  const open = getLocation();
  const visible = first.kind !== 'page' || (open.view === 'workspace' && open.sectionId === first.parentId);
  if (visible) requestFocus(treeOf(first), first.id);
}

/** Moves a node to Trash. Resolves true when it moved. */
export async function deleteNode(notes: NotesService, id: NodeId): Promise<boolean> {
  const node = getNode(id);
  if (!node) return false;
  const tree = treeOf(node);
  if (node.kind === 'notebook' && !(await confirmNotebook(node))) {
    requestFocus(tree, id);
    return false;
  }
  const target = focusTargetAfterRemoval(treeStore.get(), node);
  const open = locationInside(node);
  if (target) requestFocus(target.tree, target.id);
  try {
    await trashNodes(notes, [id], { onRestored: (restored) => showRestored(restored, open) });
  } catch (error) {
    toastError(error, titleOf(node));
    requestFocus(tree, id);
    return false;
  }
  if (open) moveOpenLocation(node, open, target);
  trashedToast(notes, titleOf(node));
  return true;
}
