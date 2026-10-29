// The collections a person saved. They are kept on this device, like saved searches, and a collection holds only
// its rules: the pages are chosen again each time it opens, so it always shows the notebooks as they are.
import { newId } from '../../editor/ids';
import type { PagesClient } from '../../platform/types';
import { fieldNamed, readFields, viewPatch } from '../search';
import type { Field, FieldType } from '../search';
import { emptyCollection, VIEW_KINDS, withValue } from './engine';
import type { CollectionDef, Condition, DateGroup } from './engine';

const KEY = 'opennote.collections';

function clean(raw: unknown): CollectionDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<CollectionDef>;
  if (typeof item.id !== 'string' || typeof item.name !== 'string') return null;
  const base = emptyCollection(item.id, item.name);
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  const conditions = Array.isArray(item.conditions)
    ? item.conditions.filter((c): c is Condition => !!c && typeof c.name === 'string' && typeof c.op === 'string')
    : [];
  return {
    ...base,
    text: text(item.text),
    tag: text(item.tag),
    section: text(item.section),
    conditions,
    view: VIEW_KINDS.includes(item.view as never) ? (item.view as CollectionDef['view']) : 'table',
    groupBy: text(item.groupBy),
    groupDate: (['day', 'week', 'month'] as const).includes(item.groupDate as DateGroup)
      ? (item.groupDate as DateGroup)
      : 'week',
    sortBy: text(item.sortBy),
    sortDir: item.sortDir === 'desc' ? 'desc' : 'asc',
    dateField: text(item.dateField),
  };
}

export function loadCollections(): CollectionDef[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.map(clean).filter((item): item is CollectionDef => item !== null) : [];
  } catch {
    return [];
  }
}

export function saveCollections(list: readonly CollectionDef[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // The collections last for this session only.
  }
}

export const newCollection = (name: string): CollectionDef => emptyCollection(newId(), name);

/** Sets one property of a page, adding it when the page has none by that name. Editing a collection edits the page. */
export async function setProperty(
  pages: PagesClient,
  page: string,
  name: string,
  type: FieldType,
  value: Field['value'],
  label?: string,
): Promise<void> {
  const open = await pages.open(page, { viewport: null });
  try {
    const fields = readFields(open.initial.view);
    const kept = fieldNamed(fields, name)?.type ?? type;
    await open.send({ edits: [{ edit: 'setPage', view: viewPatch(withValue(fields, name, kept, value, label)) }] });
  } finally {
    await open.close();
  }
}
