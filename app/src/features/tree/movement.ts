// Moves without dragging (ARCHITECTURE.md section 13.6): a step up or down among siblings, a page's level, and
// Move to. They announce what happened, with the way back, and leave focus where section 13.9 says: on the moved
// row after a keyboard move, and on the row that took its place after Move to and a drop elsewhere.

import { getLocation, navigate } from '../../app/location';
import { shortcutHint } from '../../commands/keymap';
import type { NodeId, NodeSummary, NotesService, Placement } from '../../services/notes';
import { t } from '../../strings/t';
import { announce, showToast } from '../../ui';
import { blockOf, moveNodes, setLevel, titleOf } from './actions';
import { destinationsFor, loadDestinations } from './destinations';
import type { Drop } from './drop';
import type { Destination } from './destinations';
import { toastError } from './errors';
import { focusTargetAfterRemoval } from './focus';
import { levelAfter, stepOf } from './moves';
import { chooseDestination } from './MoveToDialog';
import { showLocation } from './selection';
import { notebookOf, requestFocus, treeOf, treeStore } from './store';
import { undoEntry, undoStore } from './undo';

/** Ctrl+Shift+Up and Down, and the menu's Move up and Move down. */
export async function moveStep(notes: NotesService, node: NodeSummary, direction: 'up' | 'down'): Promise<void> {
  const title = titleOf(node);
  const step = stepOf(treeStore.get(), node.id, direction);
  if (!step) {
    announce(t(direction === 'up' ? 'tree.moves.alreadyFirst' : 'tree.moves.alreadyLast', { title }));
    return;
  }
  try {
    await moveNodes(notes, [node.id], step.placement);
  } catch (error) {
    toastError(error, title);
    return;
  } finally {
    requestFocus(treeOf(node), node.id);
  }
  announce(
    t(direction === 'up' ? 'tree.moves.up' : 'tree.moves.down', { title, position: step.position, count: step.count }),
  );
}

/** Make subpage (1) and Promote (-1). */
export async function changeLevel(notes: NotesService, node: NodeSummary, change: 1 | -1): Promise<void> {
  const title = titleOf(node);
  const level = levelAfter(treeStore.get(), node.id, change);
  if (level === null) {
    announce(t(change === 1 ? 'tree.moves.cantIndent' : 'tree.moves.alreadyTop', { title }));
    return;
  }
  try {
    await setLevel(notes, node.id, level);
  } catch (error) {
    toastError(error, title);
    return;
  } finally {
    requestFocus('pages', node.id);
  }
  announce(t(change === 1 ? 'tree.moves.indented' : 'tree.moves.promoted', { title }));
}

/** Keeps the open location's notebook right after a move between notebooks. */
function syncNotebook(): void {
  const location = getLocation();
  if (location.view !== 'workspace' || !location.sectionId) return;
  const notebookId = notebookOf(treeStore.get(), location.sectionId);
  if (notebookId && notebookId !== location.notebookId) {
    navigate({ ...location, notebookId }, { replace: true, focus: 'keep' });
  }
}

/** After a move away from the open list, the open page moves to the row that took its place, or closes. */
function leaveOpenPage(id: NodeId, next: NodeId | null): void {
  const location = getLocation();
  if (location.view === 'workspace' && location.pageId === id) showLocation({ ...location, pageId: next });
}

/** A toast that says what moved, with Undo, and the way back by keyboard in its announcement. */
function movedToast(notes: NotesService, message: string): void {
  const entry = undoStore.get().past.at(-1);
  const shortcut = shortcutHint('edit.undo');
  showToast({
    message,
    announce: shortcut ? `${message} ${t('tree.moves.undoHint', { shortcut })}` : message,
    action: { label: t('tree.trash.undo'), run: () => void (entry && undoEntry(notes, entry)) },
  });
}

/** "Moved 1 page to Final." for a page and its subpages, else 'Moved "Labs" to Work.'. */
function movedMessage(node: NodeSummary, pages: number, place: string): string {
  return node.kind === 'page'
    ? t('tree.moves.movedPages', { count: pages, target: place })
    : t('tree.moves.moved', { title: titleOf(node), target: place });
}

/** Moves a node to a place that Move to or a drop chose. Resolves true when it moved. */
export async function moveToPlace(notes: NotesService, node: NodeSummary, placement: Placement, place: string) {
  const before = focusTargetAfterRemoval(treeStore.get(), node);
  const pages = blockOf(treeStore.get(), node.id).length;
  try {
    await moveNodes(notes, [node.id], placement);
  } catch (error) {
    toastError(error, titleOf(node));
    requestFocus(treeOf(node), node.id);
    return false;
  }
  if (node.kind === 'page') leaveOpenPage(node.id, before?.tree === 'pages' ? before.id : null);
  syncNotebook();
  if (before) requestFocus(before.tree, before.id);
  movedToast(notes, movedMessage(node, pages, place));
  return true;
}

/** After a drop: a move to another parent says where it went; a move among siblings just confirms. */
export async function dropNode(notes: NotesService, node: NodeSummary, drop: Drop): Promise<boolean> {
  if (drop.placement.parentId !== node.parentId) {
    return moveToPlace(notes, node, drop.placement, titleOf(drop.target));
  }
  try {
    await moveNodes(notes, [node.id], drop.placement);
  } catch (error) {
    toastError(error, titleOf(node));
    return false;
  } finally {
    requestFocus(treeOf(node), node.id);
  }
  movedToast(notes, t('tree.moves.reordered', { title: titleOf(node) }));
  return true;
}

/** Ctrl+Shift+M: asks where to move, then moves there. */
export async function moveTo(notes: NotesService, node: NodeSummary): Promise<boolean> {
  const places = destinationsFor(treeStore.get(), node, await loadDestinations());
  const place: Destination | null = await chooseDestination(titleOf(node), places);
  if (!place) {
    requestFocus(treeOf(node), node.id);
    return false;
  }
  return moveToPlace(notes, node, { parentId: place.id, beforeId: null }, place.title);
}
