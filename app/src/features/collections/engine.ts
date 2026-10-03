// Collections: saved views of pages chosen by a search, a tag, a section, or property values. This is the part that
// decides: which pages a collection holds, in what order, and in which groups. It reads pages as rows (the index's
// page facts with their properties) and never touches a page.
import { compareValues, displayValue, fieldNamed, readFields } from '../search';
import type { Field } from '../search';
import type { PageFact } from '../../services/search/types';

export type ViewKind = 'table' | 'list' | 'board' | 'calendar' | 'gallery';
export const VIEW_KINDS: readonly ViewKind[] = ['table', 'list', 'board', 'calendar', 'gallery'];

export type Operator = 'is' | 'isNot' | 'contains' | 'empty' | 'notEmpty' | 'before' | 'after' | 'atLeast' | 'atMost';
export const OPERATORS: readonly Operator[] = [
  'is',
  'isNot',
  'contains',
  'empty',
  'notEmpty',
  'before',
  'after',
  'atLeast',
  'atMost',
];

export interface Condition {
  /** The property's name. */
  name: string;
  op: Operator;
  value: string;
}

export type DateGroup = 'day' | 'week' | 'month';

export interface CollectionDef {
  id: string;
  name: string;
  /** Words to search for, or empty for every page. */
  text: string;
  /** A tag, including the tags nested under it, or empty. */
  tag: string;
  /** A section ID, or empty. */
  section: string;
  conditions: Condition[];
  view: ViewKind;
  /** The property to group by, or empty. */
  groupBy: string;
  /** How a date property groups. */
  groupDate: DateGroup;
  /** The property to sort by, or empty for the title. */
  sortBy: string;
  sortDir: 'asc' | 'desc';
  /** The date property a calendar places pages by. */
  dateField: string;
}

export interface Row {
  page: string;
  title: string;
  notebook: string;
  section: string;
  created: number;
  modified: number;
  tags: string[];
  fields: Field[];
}

export const emptyCollection = (id: string, name: string): CollectionDef => ({
  id,
  name,
  text: '',
  tag: '',
  section: '',
  conditions: [],
  view: 'table',
  groupBy: '',
  groupDate: 'week',
  sortBy: '',
  sortDir: 'asc',
  dateField: '',
});

export const toRow = (fact: PageFact): Row => ({
  page: fact.page,
  title: fact.title,
  notebook: fact.notebook,
  section: fact.section,
  created: fact.created,
  modified: fact.modified,
  tags: fact.tags,
  fields: readFields({ properties: fact.properties }),
});

const folded = (text: string) => text.trim().toLowerCase();

/** Whether the field satisfies the condition. A page without the property satisfies only "is empty". */
export function satisfies(field: Field | undefined, condition: Condition): boolean {
  const text = field ? displayValue(field, { yes: 'yes', no: 'no' }) : '';
  const wanted = folded(condition.value);
  switch (condition.op) {
    case 'empty':
      return text === '';
    case 'notEmpty':
      return text !== '';
    case 'is':
      return folded(text) === wanted;
    case 'isNot':
      return folded(text) !== wanted;
    case 'contains':
      return folded(text).includes(wanted);
    case 'before':
      return text !== '' && text < condition.value;
    case 'after':
      return text !== '' && text > condition.value;
    case 'atLeast':
      return field?.type === 'number' && field.value !== null && Number(field.value) >= Number(condition.value);
    case 'atMost':
      return field?.type === 'number' && field.value !== null && Number(field.value) <= Number(condition.value);
  }
}

const hasTag = (tags: readonly string[], wanted: string) =>
  tags.some((tag) => tag === wanted || tag.startsWith(`${wanted}/`));

/** Whether the page belongs in the collection. `found` holds the pages a search found, or null when it has no words. */
export function matches(row: Row, def: CollectionDef, found: ReadonlySet<string> | null): boolean {
  if (found && !found.has(row.page)) return false;
  if (def.tag && !hasTag(row.tags, folded(def.tag))) return false;
  if (def.section && row.section !== def.section) return false;
  return def.conditions.every((condition) => satisfies(fieldNamed(row.fields, condition.name), condition));
}

export function sortRows(rows: readonly Row[], def: Pick<CollectionDef, 'sortBy' | 'sortDir'>): Row[] {
  const sign = def.sortDir === 'desc' ? -1 : 1;
  const byTitle = (a: Row, b: Row) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
  return [...rows].sort((a, b) => {
    if (!def.sortBy) return sign * byTitle(a, b);
    const left = fieldNamed(a.fields, def.sortBy);
    const right = fieldNamed(b.fields, def.sortBy);
    // Empty values stay last in either direction.
    const empty = compareValues(left, right);
    const blank = (field: Field | undefined) => field === undefined || field.value === null || field.value === '';
    const missing = blank(left) || blank(right);
    return (missing ? empty : sign * empty) || byTitle(a, b);
  });
}

/** The property names the rows use, most common first. */
export function propertyNames(rows: readonly Row[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) for (const field of row.fields) counts.set(field.name, (counts.get(field.name) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
}

/** The Monday on or before a day, as `YYYY-MM-DD`. */
function weekStart(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

/** The group a row belongs to: its value for the property, or for a date, its day, week, or month. */
export function groupKey(
  row: Row,
  def: Pick<CollectionDef, 'groupBy' | 'groupDate'>,
  words: { none: string; yes: string; no: string },
) {
  const field = fieldNamed(row.fields, def.groupBy);
  if (!field || field.value === null || field.value === '') return { key: '~', label: words.none };
  if (field.type === 'date' && typeof field.value === 'string') {
    if (def.groupDate === 'month') return { key: field.value.slice(0, 7), label: field.value.slice(0, 7) };
    if (def.groupDate === 'week') {
      const start = weekStart(field.value);
      return { key: start, label: `${start}` };
    }
  }
  const label = displayValue(field, words);
  return { key: folded(label), label };
}

export interface Group {
  key: string;
  label: string;
  rows: Row[];
}

/** The rows in groups, in the order of their keys. No property to group by gives one group with no label. */
export function groupRows(
  rows: readonly Row[],
  def: CollectionDef,
  words: { none: string; yes: string; no: string },
): Group[] {
  if (!def.groupBy) return [{ key: '', label: '', rows: [...rows] }];
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const { key, label } = groupKey(row, def, words);
    const group = groups.get(key) ?? { key, label, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) =>
    a.key === '~' ? 1 : b.key === '~' ? -1 : a.key.localeCompare(b.key, undefined, { numeric: true }),
  );
}

/** The fields with one set by name. A field the page lacks is added with the given type. */
export function withValue(
  fields: readonly Field[],
  name: string,
  type: Field['type'],
  value: Field['value'],
  label?: string,
): Field[] {
  const found = fieldNamed(fields, name);
  if (!found) return [...fields, { id: `${name}-${fields.length}`, name, type, value, ...(label ? { label } : {}) }];
  return fields.map((field) =>
    field === found ? { ...field, value, ...(label === undefined ? {} : { label }) } : field,
  );
}
