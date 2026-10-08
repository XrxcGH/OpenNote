// Saved views of a smart table: a name for a set of filters and a sort, so a table can be looked at one way and then
// another without redoing either. Each table keeps its own, in its `smart` data. Applying a view sets the table's
// filters and stores its rows in the view's sort order, as one undo step.
import { newId } from '../../../editor/ids';
import { t } from '../../../strings/t';
import { MAX_SAVED_VIEWS, MAX_VIEW_NAME } from './data';
import type { SavedViewSmart, SmartData } from './data';
import { sortRows } from './ops';
import type { SmartInstance } from './ops';
import { askText } from './prompt';

export const savedViewsOf = (smart: SmartData): readonly SavedViewSmart[] => smart.saved ?? [];

/** The problem with a name for a view in words, or null when it is fine. Names are unique, without regard to case. */
export function viewNameProblem(smart: SmartData, name: string, except?: string): string | null {
  const clean = name.trim();
  if (clean === '') return t('smart.saved.empty');
  if (clean.length > MAX_VIEW_NAME) return t('smart.saved.tooLong', { max: MAX_VIEW_NAME });
  const taken = savedViewsOf(smart).some((one) => one.id !== except && one.name.toLowerCase() === clean.toLowerCase());
  return taken ? t('smart.saved.taken', { name: clean }) : null;
}

/** Whether the table's filters and sort are what the saved view holds. */
export function matchesView(smart: SmartData, view: SavedViewSmart): boolean {
  return (
    JSON.stringify(smart.filters) === JSON.stringify(view.filters) &&
    JSON.stringify(smart.sort ?? null) === JSON.stringify(view.sort ?? null)
  );
}

/** Saves the table's filters and sort under a name and makes it the view in use. */
export async function saveView(inst: SmartInstance, name: string): Promise<boolean> {
  const smart = inst.smart();
  if (viewNameProblem(smart, name) !== null || savedViewsOf(smart).length >= MAX_SAVED_VIEWS) return false;
  const view: SavedViewSmart = {
    id: newId(),
    name: name.trim(),
    filters: smart.filters.map((filter) => ({ ...filter })),
    ...(smart.sort ? { sort: { ...smart.sort } } : {}),
  };
  await inst.commit({ ...smart, saved: [...savedViewsOf(smart), view], savedActive: view.id });
  inst.host.announce(t('smart.saved.saved', { name: view.name }));
  return true;
}

/** Asks for a name, then saves. */
export async function saveViewAsking(inst: SmartInstance): Promise<boolean> {
  if (savedViewsOf(inst.smart()).length >= MAX_SAVED_VIEWS) {
    inst.host.announce(t('smart.saved.full', { max: MAX_SAVED_VIEWS }));
    return false;
  }
  const name = await askText({
    title: t('smart.saved.title'),
    description: t('smart.saved.description'),
    label: t('smart.saved.label'),
    confirmLabel: t('smart.saved.confirm'),
    check: (typed) => viewNameProblem(inst.smart(), typed),
  });
  return name === null ? false : saveView(inst, name);
}

/** Shows the table the way a saved view holds it, or with null shows every row again (the sort stays). */
export async function applyView(inst: SmartInstance, id: string | null): Promise<boolean> {
  const smart = inst.smart();
  const { savedActive: _active, ...rest } = smart;
  if (id === null) {
    if (smart.filters.length === 0 && smart.savedActive === undefined) return false;
    await inst.commit({ ...rest, filters: [] });
    inst.host.announce(t('smart.saved.all'));
    return true;
  }
  const view = savedViewsOf(smart).find((one) => one.id === id);
  if (!view) return false;
  const next: SmartData = { ...rest, filters: view.filters.map((filter) => ({ ...filter })), savedActive: view.id };
  if (view.sort) next.sort = { ...view.sort };
  else delete next.sort;
  const change = view.sort ? sortRows(inst.model(), inst.locale, view.sort) : null;
  await inst.commit(next, change ?? undefined);
  inst.host.announce(t('smart.saved.applied', { name: view.name }));
  return true;
}

/** Replaces what a saved view holds with the table's filters and sort now. */
export async function updateView(inst: SmartInstance, id: string): Promise<boolean> {
  const smart = inst.smart();
  const view = savedViewsOf(smart).find((one) => one.id === id);
  if (!view) return false;
  const { sort: _old, ...kept } = view;
  const next: SavedViewSmart = {
    ...kept,
    filters: smart.filters.map((filter) => ({ ...filter })),
    ...(smart.sort ? { sort: { ...smart.sort } } : {}),
  };
  await inst.commit({
    ...smart,
    saved: savedViewsOf(smart).map((one) => (one.id === id ? next : one)),
    savedActive: id,
  });
  inst.host.announce(t('smart.saved.updated', { name: view.name }));
  return true;
}

export async function renameView(inst: SmartInstance, id: string, name: string): Promise<boolean> {
  const smart = inst.smart();
  if (viewNameProblem(smart, name, id) !== null) return false;
  await inst.commit({
    ...smart,
    saved: savedViewsOf(smart).map((one) => (one.id === id ? { ...one, name: name.trim() } : one)),
  });
  return true;
}

export async function renameViewAsking(inst: SmartInstance, id: string): Promise<boolean> {
  const view = savedViewsOf(inst.smart()).find((one) => one.id === id);
  if (!view) return false;
  const name = await askText({
    title: t('smart.saved.renameTitle'),
    label: t('smart.saved.label'),
    initial: view.name,
    confirmLabel: t('smart.saved.renameConfirm'),
    check: (typed) => viewNameProblem(inst.smart(), typed, id),
  });
  return name === null ? false : renameView(inst, id, name);
}

export async function deleteView(inst: SmartInstance, id: string): Promise<boolean> {
  const smart = inst.smart();
  const view = savedViewsOf(smart).find((one) => one.id === id);
  if (!view) return false;
  const { saved: _saved, savedActive: _active, ...rest } = smart;
  const left = savedViewsOf(smart).filter((one) => one.id !== id);
  await inst.commit({
    ...rest,
    ...(left.length > 0 ? { saved: left } : {}),
    ...(smart.savedActive && smart.savedActive !== id ? { savedActive: smart.savedActive } : {}),
  });
  inst.host.announce(t('smart.saved.deleted', { name: view.name }));
  return true;
}
