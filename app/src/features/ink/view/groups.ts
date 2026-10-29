// Object groups (ADR 0036): ink, text boxes, and images kept together, so selecting one selects them all and the lasso
// frame moves, resizes, and deletes them as one. The groups live in the page's view under `groups`, a map from a group
// ID to the IDs of its blocks and strokes; every change to it is a `setPage` patch in the batch with the moves, so
// grouping, ungrouping, and deleting are each one undo step. Grouping never touches the blocks' reading order.
import { newId } from '../../../editor/ids';
import type { Edit, OpenPage } from '../../../services/pages/types';
import { createStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { say } from './say';
import { followView } from './host';
import type { InkHost, InkQueue, InkSelection } from './host';
import type { InkSurface } from './surface';

export interface ObjectGroup {
  readonly blocks: readonly string[];
  readonly strokes: readonly string[];
}

export type Groups = ReadonlyMap<string, ObjectGroup>;

const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];

/** The groups a page view holds. Anything that is not a group is skipped. */
export function groupsOf(view: unknown): Map<string, ObjectGroup> {
  const held = (view as { groups?: unknown } | null | undefined)?.groups;
  const groups = new Map<string, ObjectGroup>();
  if (!held || typeof held !== 'object' || Array.isArray(held)) return groups;
  for (const [id, value] of Object.entries(held as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const group = { blocks: ids((value as ObjectGroup).blocks), strokes: ids((value as ObjectGroup).strokes) };
    if (group.blocks.length + group.strokes.length > 0) groups.set(id, group);
  }
  return groups;
}

/** The groups that hold any of these blocks or strokes. */
export function groupsTouched(groups: Groups, selection: Pick<InkSelection, 'blocks' | 'strokes'>): string[] {
  const blocks = new Set(selection.blocks);
  const strokes = new Set(selection.strokes);
  return [...groups]
    .filter(([, group]) => group.blocks.some((id) => blocks.has(id)) || group.strokes.some((id) => strokes.has(id)))
    .map(([id]) => id);
}

/** What still exists on the page, so a group's stale IDs are left out. */
export interface Live {
  block(id: string): boolean;
  stroke(id: string): boolean;
}

/**
 * The selection with every member of each group it touches. Null when it already holds them all, so a caller can
 * tell whether to select again.
 */
export function expandSelection(
  groups: Groups,
  selection: Pick<InkSelection, 'blocks' | 'strokes'>,
  live: Live,
): { blocks: string[]; strokes: string[] } | null {
  const blocks = new Set(selection.blocks);
  const strokes = new Set(selection.strokes);
  let grew = false;
  for (const id of groupsTouched(groups, selection)) {
    const group = groups.get(id)!;
    for (const block of group.blocks) {
      if (!blocks.has(block) && live.block(block)) {
        blocks.add(block);
        grew = true;
      }
    }
    for (const stroke of group.strokes) {
      if (!strokes.has(stroke) && live.stroke(stroke)) {
        strokes.add(stroke);
        grew = true;
      }
    }
  }
  return grew ? { blocks: [...blocks], strokes: [...strokes] } : null;
}

/** The view patch that sets groups, or removes them with null. */
export function groupsEdit(changes: Readonly<Record<string, ObjectGroup | null>>): Edit {
  const groups: Record<string, unknown> = {};
  for (const [id, group] of Object.entries(changes)) {
    groups[id] = group ? { blocks: [...group.blocks], strokes: [...group.strokes] } : null;
  }
  return { edit: 'setPage', view: { groups } };
}

/** The groups after a change made with `groupsEdit`. */
export function applyGroups(
  groups: Groups,
  changes: Readonly<Record<string, ObjectGroup | null>>,
): Map<string, ObjectGroup> {
  const next = new Map(groups);
  for (const [id, group] of Object.entries(changes)) {
    if (group) next.set(id, group);
    else next.delete(id);
  }
  return next;
}

/**
 * The change that groups a selection: one new group of everything selected, replacing the groups it touched, whose
 * members are all in the selection once it was expanded. Null when there is less than two things to group.
 */
export function groupChange(
  groups: Groups,
  selection: Pick<InkSelection, 'blocks' | 'strokes'>,
  id: string = newId(),
): Record<string, ObjectGroup | null> | null {
  if (selection.blocks.length + selection.strokes.length < 2) return null;
  const changes: Record<string, ObjectGroup | null> = {};
  for (const old of groupsTouched(groups, selection)) changes[old] = null;
  changes[id] = { blocks: [...selection.blocks], strokes: [...selection.strokes] };
  return changes;
}

/** The change that ungroups the groups a selection touches. Null when it touches none. */
export function ungroupChange(
  groups: Groups,
  selection: Pick<InkSelection, 'blocks' | 'strokes'>,
): Record<string, ObjectGroup | null> | null {
  const touched = groupsTouched(groups, selection);
  return touched.length > 0 ? Object.fromEntries(touched.map((id) => [id, null])) : null;
}

// ---- the shown page's groups ----

/** The shown page's groups, following its own changes such as an undo. */
export const objectGroups = createStore<Groups>(new Map(), 'ink object groups');

let adopted: { page: string; stop: () => void } | null = null;

function adopt(page: OpenPage | null, queue: InkQueue | null): void {
  if (adopted && adopted.page === page?.id) return;
  adopted?.stop();
  adopted = null;
  objectGroups.set(new Map());
  if (!page) return;
  objectGroups.set(groupsOf(page.initial.view));
  // A frame's page part holds the whole view, so the groups it holds are all the page has.
  const stop = followView(page, queue, (view) => objectGroups.set(groupsOf(view)));
  adopted = { page: page.id, stop };
}

/**
 * Follows the shown page's groups, and widens a selection that grows to take in part of a group to the whole group.
 * A selection that shrinks is left alone, so letting go of a group never selects it again.
 */
export function installGroups(host: InkHost, surfaceOf: () => InkSurface | null): () => void {
  adopt(host.page.get(), host.queue.get());
  const stopPage = host.page.subscribe(() => adopt(host.page.get(), host.queue.get()));
  let before = host.selection.get();
  const stopSelection = host.selection.subscribe(() => {
    const now = host.selection.get();
    const previous = before;
    before = now;
    const had = new Set([...previous.blocks, ...previous.strokes]);
    if (![...now.blocks, ...now.strokes].some((id) => !had.has(id))) return;
    const surface = surfaceOf();
    const layer = host.layer.get();
    const live: Live = {
      block: (id) => layer?.block(id) != null,
      stroke: (id) => (surface ? surface.strokes([id]).length > 0 : false),
    };
    const wider = expandSelection(objectGroups.get(), now, live);
    if (wider) queueMicrotask(() => host.select({ ...wider, ...(now.lasso ? { lasso: now.lasso } : {}) }));
  });
  return () => {
    stopPage();
    stopSelection();
    adopted?.stop();
    adopted = null;
  };
}

/** Sends a change to the groups, and takes it into the store once the page has it. */
async function sendGroups(surface: InkSurface, changes: Record<string, ObjectGroup | null>): Promise<boolean> {
  const ok = await surface.send({ edits: [groupsEdit(changes)] }, () => undefined);
  if (ok) objectGroups.set((groups) => applyGroups(groups, changes));
  return ok;
}

/** Group (Ctrl+G): everything selected becomes one group. */
export async function groupSelection(host: InkHost, surface: InkSurface): Promise<void> {
  const selection = host.selection.get();
  const changes = groupChange(objectGroups.get(), selection);
  if (!changes) return say(t('ink.groups.tooFew'));
  if (await sendGroups(surface, changes)) {
    say(t('ink.groups.grouped', { count: selection.blocks.length + selection.strokes.length }));
  }
}

/** Ungroup (Ctrl+Shift+G): the groups the selection touches come apart; everything stays selected. */
export async function ungroupSelection(host: InkHost, surface: InkSurface): Promise<void> {
  const changes = ungroupChange(objectGroups.get(), host.selection.get());
  if (!changes) return say(t('ink.groups.none'));
  if (await sendGroups(surface, changes)) say(t('ink.groups.ungrouped'));
}

/** Whether the selection touches a group, for Ungroup's enabled state. */
export const selectionGrouped = (host: InkHost): boolean =>
  groupsTouched(objectGroups.get(), host.selection.get()).length > 0;

/** The view patch that drops deleted members' groups, for a delete that takes whole groups with it. */
export function groupsDeleteEdit(selection: Pick<InkSelection, 'blocks' | 'strokes'>): Edit | null {
  const changes = ungroupChange(objectGroups.get(), selection);
  return changes ? groupsEdit(changes) : null;
}

/** After a delete that carried `groupsDeleteEdit`, the store forgets those groups. */
export function forgetGroups(selection: Pick<InkSelection, 'blocks' | 'strokes'>): void {
  const changes = ungroupChange(objectGroups.get(), selection);
  if (changes) objectGroups.set((groups) => applyGroups(groups, changes));
}
