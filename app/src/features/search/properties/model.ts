// Page properties: typed fields kept in the page's `view.properties`, the part of page.json that older and other
// writers carry along untouched, so the format version does not change. Search reads the same fields (the index adds
// them to the page as `Name: value` lines), and collections list and sort pages by them.

export const FIELD_TYPES = ['text', 'number', 'date', 'checkbox', 'choice', 'page'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface Field {
  id: string;
  name: string;
  type: FieldType;
  /** Text and choice: a string. Number: a number. Date: `YYYY-MM-DD`. Checkbox: a boolean. Page: a page ID. */
  value: string | number | boolean | null;
  /** For a link to a page, its title when the link was made, so search and lists need not look it up. */
  label?: string;
  /** For a choice, the values to pick from. */
  options?: string[];
}

const MAX_FIELDS = 64;
const isType = (value: unknown): value is FieldType => (FIELD_TYPES as readonly unknown[]).includes(value);

function readValue(type: FieldType, value: unknown): Field['value'] {
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value) ? value : null;
  if (type === 'checkbox') return value === true;
  return typeof value === 'string' ? value : null;
}

/** The fields in a page's `view`, tolerant of anything else that may be there. */
export function readFields(view: Record<string, unknown> | undefined | null): Field[] {
  const properties = view?.properties;
  const list = properties && typeof properties === 'object' ? (properties as { fields?: unknown }).fields : undefined;
  if (!Array.isArray(list)) return [];
  const fields: Field[] = [];
  for (const raw of list.slice(0, MAX_FIELDS)) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.name !== 'string' || !isType(item.type)) continue;
    const field: Field = { id: item.id, name: item.name, type: item.type, value: readValue(item.type, item.value) };
    if (typeof item.label === 'string') field.label = item.label;
    if (Array.isArray(item.options)) field.options = item.options.filter((o): o is string => typeof o === 'string');
    fields.push(field);
  }
  return fields;
}

/** The merge patch for `setPage` that stores the fields. No fields removes the key. */
export function viewPatch(fields: readonly Field[]): Record<string, unknown> {
  return { properties: fields.length === 0 ? null : { fields } };
}

/** What a field shows in a list: checkboxes read as Yes or No in `yes` and `no`. */
export function displayValue(field: Field, words: { yes: string; no: string }): string {
  if (field.type === 'checkbox') return field.value === true ? words.yes : words.no;
  if (field.type === 'page') return field.label ?? '';
  if (field.value === null) return '';
  return String(field.value);
}

/** Orders two values of one field type for sorting. Empty values sort last, whichever way the sort runs. */
export function compareValues(a: Field | undefined, b: Field | undefined): number {
  const empty = (field: Field | undefined) => field === undefined || field.value === null || field.value === '';
  if (empty(a) && empty(b)) return 0;
  if (empty(a)) return 1;
  if (empty(b)) return -1;
  const left = a as Field;
  const right = b as Field;
  if (left.type === 'number' && right.type === 'number') return (left.value as number) - (right.value as number);
  if (left.type === 'checkbox' && right.type === 'checkbox') return Number(right.value === true) - Number(left.value === true);
  return String(left.type === 'page' ? left.label : left.value).localeCompare(
    String(right.type === 'page' ? right.label : right.value),
    undefined,
    { numeric: true, sensitivity: 'base' },
  );
}

/** The field of a page that has this name, ignoring case. */
export function fieldNamed(fields: readonly Field[], name: string): Field | undefined {
  const wanted = name.trim().toLowerCase();
  return fields.find((field) => field.name.trim().toLowerCase() === wanted);
}
