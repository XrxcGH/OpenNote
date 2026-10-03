// Move to, Copy to, Color, and Delete on a selection of several pages or sections. Each is one call to the notes
// service where the service takes a list, and one step on the undo stack, so a single Ctrl+Z reverses the whole
// action (docs/FEATURES.md, "Select several pages").

import { getLocation, navigate } from '../../app/location';
import { shortcutHint } from '../../commands/keymap';
import { shellCall } from '../../platform/shellqol';
import type { ChipColor, NodeId, NodeSummary, NotesService } from '../../services/notes';
import { t } from '../../strings/t';
import { announce, showToast } from '../../ui';
import { colorNode, moveNodes, titleOf, trashNodes } from './actions';
import { destinationsFor, loadDestinations } from './destinations';
import type { Destination } from './destinations';
import { toastError } from './errors';
import { relist } from './load';
import { clearMulti } from './multi';
import { chooseDestination } from './MoveToDialog';
import { showLocation } from './selection';
import { ancestors, getNode, requestFocus, treeOf, treeStore } from './store';
import { recordUndo, undoEntry, undoStore } from './undo';

/** "3 pages" or "2 sections", for the dialogs and the toasts. */
export function describeSelection(nodes: readonly NodeSummary[]): string {
  return t(nodes[0].kind === 'page' ? 'qol.multi.pages' : 'qol.multi.sections', { count: nodes.length });
}

function undoToast(notes: NotesService, message: string): void {
  const entry = undoStore.get().past.at(-1);
  const shortcut = shortcutHint('edit.undo');
  showToast({
    message,
    announce: shortcut ? `${message} ${t('tree.moves.undoHint', { shortcut })}` : message,
    action: { label: t('tree.trash.undo'), run: () => void (entry && undoEntry(notes, entry)) },
  });
}

/** The places every one of the nodes can move to. */
export function commonDestinations(nodes: readonly NodeSummary[], all: readonly Destination[]): Destination[] {
  const state = treeStore.get();
  return all.filter((place) => nodes.every((node) => destinationsFor(state, node, [place]).length === 1));
}

/** True when the open page or section is one of the nodes, or under one. */
function opensAny(nodes: readonly NodeSummary[]): boolean {
  const location = getLocation();
  if (location.view !== 'workspace') return false;
  const state = treeStore.get();
  const shown = [location.sectionId, location.pageId].filter((id): id is NodeId => id !== null);
  return nodes.some(
    (node) => shown.includes(node.id) || shown.some((id) => ancestors(state, id).some((above) => above.id === node.id)),
  );
}

/** Moves the selection to Trash as one action. */
export async function trashSelection(notes: NotesService, nodes: readonly NodeSummary[]): Promise<boolean> {
  const label = describeSelection(nodes);
  const closes = opensAny(nodes);
  try {
    await trashNodes(
      notes,
      nodes.map((node) => node.id),
    );
  } catch (error) {
    toastError(error, label);
    return false;
  }
  clearMulti();
  if (closes) {
    const location = getLocation();
    if (location.view === 'workspace') {
      const pagesOnly = nodes.every((node) => node.kind === 'page');
      if (pagesOnly) showLocation({ ...location, pageId: null });
      else navigate({ ...location, sectionId: null, pageId: null }, { replace: true, focus: 'keep' });
    }
  }
  undoToast(notes, t('qol.multi.trashed', { count: nodes.length }));
  return true;
}

/** Asks where to move the selection, then moves it there in one step. */
export async function moveSelection(notes: NotesService, nodes: readonly NodeSummary[]): Promise<boolean> {
  const places = commonDestinations(nodes, await loadDestinations());
  const place = await chooseDestination(describeSelection(nodes), places);
  if (!place) return false;
  try {
    await moveNodes(
      notes,
      nodes.map((node) => node.id),
      { parentId: place.id, beforeId: null },
    );
  } catch (error) {
    toastError(error, describeSelection(nodes));
    return false;
  }
  clearMulti();
  undoToast(notes, t('qol.multi.moved', { count: nodes.length, target: place.title }));
  return true;
}

/** Gives every section of the selection one color, as one undo step. */
export async function colorSelection(
  notes: NotesService,
  nodes: readonly NodeSummary[],
  color: ChipColor | null,
): Promise<void> {
  const targets = nodes.filter((node) => node.kind !== 'page');
  const before = targets.map((node) => [node.id, node.color] as const);
  try {
    for (const node of targets) await colorNode(notes, node.id, color, { record: false });
  } catch (error) {
    toastError(error, describeSelection(nodes));
    return;
  }
  const label = describeSelection(nodes);
  recordUndo({
    undone: t('qol.multi.undoColor', { items: label }),
    redone: t('qol.multi.redoColor', { items: label }),
    undo: async (service) => {
      for (const [id, previous] of before) await colorNode(service, id, previous, { record: false });
    },
    redo: async (service) => {
      for (const [id] of before) await colorNode(service, id, color, { record: false });
    },
  });
  announce(t('qol.multi.colored', { count: targets.length }));
}

/** The pages or sections a Copy to made, as the shell reports them. */
export async function copyNodes(ids: readonly NodeId[], parentId: NodeId): Promise<NodeSummary[]> {
  const made = await shellCall<NodeSummary[]>('notes.copyTo', { ids, parentId });
  await relist(parentId);
  return made ?? [];
}

/** Copy to for one node or a selection: asks for a place, copies, and can take the copies back. */
export async function copyTo(notes: NotesService, nodes: readonly NodeSummary[]): Promise<boolean> {
  const state = treeStore.get();
  const kind = nodes[0].kind;
  const all = await loadDestinations();
  const places = all.filter((place) =>
    kind === 'page' ? place.kind === 'section' : place.kind === 'notebook' || place.kind === 'sectionGroup',
  );
  const place = await chooseDestination(
    nodes.length === 1 ? titleOf(nodes[0]) : describeSelection(nodes),
    places.filter((candidate) => nodes.every((node) => node.id !== candidate.id)),
  );
  if (!place) {
    requestFocus(treeOf(nodes[0]), nodes[0].id);
    return false;
  }
  let made: NodeSummary[];
  try {
    made = await copyNodes(
      nodes.map((node) => node.id),
      place.id,
    );
  } catch (error) {
    toastError(error, nodes.length === 1 ? titleOf(nodes[0]) : describeSelection(nodes));
    return false;
  }
  const copies = made.filter((node) => !state.nodes[node.id]).map((node) => node.id);
  let receipt = null as Awaited<ReturnType<typeof trashNodes>>;
  recordUndo({
    undone: t('qol.copy.undone', { target: place.title }),
    redone: t('qol.copy.redone', { target: place.title }),
    undo: async (service) => {
      receipt = await trashNodes(service, copies, { record: false });
    },
    redo: async (service) => {
      if (receipt) await service.restore(receipt.id);
      await relist(place.id);
    },
  });
  clearMulti();
  undoToast(notes, t('qol.copy.done', { count: made.length, target: place.title }));
  const first = made[0] && getNode(made[0].id);
  if (first) requestFocus(treeOf(first), first.id);
  return true;
}
