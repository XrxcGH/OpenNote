// The rules a collection block carries. They are read from the block's data with every field checked, because the data
// is a page's own and may come from another version of the app.
import { emptyCollection, VIEW_KINDS } from '../engine';
import type { CollectionDef, Condition, DateGroup } from '../engine';

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** The collection a block shows: its own rules, the rules of the saved collection it names, or an empty one. */
export function readDef(data: Record<string, unknown>, saved: readonly CollectionDef[]): CollectionDef {
  const raw = data.def && typeof data.def === 'object' ? (data.def as Partial<CollectionDef>) : null;
  const base = raw ?? saved.find((one) => one.id === data.collection) ?? null;
  if (!base) return emptyCollection(text(data.collection), text(data.name));
  const conditions = Array.isArray(base.conditions)
    ? base.conditions.filter(
        (c): c is Condition => !!c && typeof c.name === 'string' && typeof c.op === 'string' && typeof c.value === 'string',
      )
    : [];
  return {
    ...emptyCollection(text(base.id), text(base.name)),
    text: text(base.text),
    tag: text(base.tag),
    section: text(base.section),
    conditions,
    view: VIEW_KINDS.includes(base.view as never) ? (base.view as CollectionDef['view']) : 'list',
    groupBy: text(base.groupBy),
    groupDate: (['day', 'week', 'month'] as const).includes(base.groupDate as DateGroup)
      ? (base.groupDate as DateGroup)
      : 'week',
    sortBy: text(base.sortBy),
    sortDir: base.sortDir === 'desc' ? 'desc' : 'asc',
    dateField: text(base.dateField),
  };
}
