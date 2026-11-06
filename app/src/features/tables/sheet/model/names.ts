// Names (format spec R-SHT-13, DESIGN 6.9): a formula text and a scope. A table name is seen in its own table, a
// page name in every table of the page. Names are unique within their scope without regard to case.

import { isObject, own, ownObject, put } from './json';
import { isName } from './schema';
import type { NameEntry, Sheet } from './types';

export const NAME_LIMIT = 1024;

export interface NamedRef extends NameEntry {
  name: string;
  scope: 'table' | 'page';
  comment: string;
}

const length = (text: string) => [...text].length;

function entryOf(name: string, value: unknown): NamedRef | null {
  if (!isName(name) || !isObject(value) || typeof value.ref !== 'string') return null;
  if (length(value.ref) < 1 || length(value.ref) > 8192) return null;
  const scope = value.scope === 'page' ? 'page' : 'table';
  const comment = typeof value.comment === 'string' ? value.comment : '';
  return { name, ref: value.ref, scope, comment };
}

/** The valid names of a table, in the order the file holds them. */
export function namesOf(sheet: Sheet): NamedRef[] {
  const names = ownObject(sheet, 'names') ?? {};
  return Object.keys(names)
    .map((name) => entryOf(name, names[name]))
    .filter((n): n is NamedRef => n !== null);
}

/** The name a table holds, found without regard to case. */
export function findName(sheet: Sheet, name: string, scope?: 'table' | 'page'): NamedRef | undefined {
  const key = name.toLowerCase();
  return namesOf(sheet).find((n) => n.name.toLowerCase() === key && (scope === undefined || n.scope === scope));
}

export type NameRefusal = 'name' | 'ref' | 'comment' | 'limit';

/**
 * Sets a name. Changes `sheet` in place. A name that differs from one already there only by case replaces it, so
 * the table never holds two. Refuses a name that breaks R-SHT-13, a ref or comment out of range, or the limit.
 */
export function setName(sheet: Sheet, name: string, entry: NameEntry): NameRefusal | null {
  if (!isName(name)) return 'name';
  if (length(entry.ref) < 1 || length(entry.ref) > 8192) return 'ref';
  if (entry.comment !== undefined && length(entry.comment) > 255) return 'comment';
  const names = ownObject(sheet, 'names') ?? {};
  const same = Object.keys(names).filter((n) => n.toLowerCase() === name.toLowerCase());
  if (same.length === 0 && Object.keys(names).length >= NAME_LIMIT) return 'limit';
  for (const old of same) delete names[old];
  const value: Record<string, string> = { ref: entry.ref };
  if (entry.scope === 'page') value.scope = 'page';
  if (entry.comment) value.comment = entry.comment;
  put(names, name, value);
  put(sheet, 'names', names);
  return null;
}

export function deleteName(sheet: Sheet, name: string): void {
  const names = ownObject(sheet, 'names');
  if (!names) return;
  for (const key of Object.keys(names)) if (key.toLowerCase() === name.toLowerCase()) delete names[key];
  if (Object.keys(names).length === 0) delete sheet.names;
}

export interface PageName extends NamedRef {
  /** The table that holds it, by its place in the page's reading order. */
  table: number;
}

/**
 * The page names of every table of a page, by lowercase name. When two tables hold one page name, the first table
 * on the page wins, and `conflicts` lists the name so the Name manager can flag it.
 */
export function pageNames(sheets: readonly Sheet[]): { names: Map<string, PageName>; conflicts: string[] } {
  const names = new Map<string, PageName>();
  const conflicts = new Set<string>();
  sheets.forEach((sheet, table) => {
    for (const entry of namesOf(sheet)) {
      if (entry.scope !== 'page') continue;
      const key = entry.name.toLowerCase();
      if (names.has(key)) conflicts.add(key);
      else names.set(key, { ...entry, table });
    }
  });
  return { names, conflicts: [...conflicts] };
}

/** What a name means in a table: its own table name first, then a page name (DESIGN 6.9). */
export function lookupName(sheet: Sheet, page: readonly Sheet[], name: string): NamedRef | undefined {
  return findName(sheet, name, 'table') ?? pageNames(page).names.get(name.toLowerCase());
}

/** The name formulas use for the table, or undefined when it has none (R-SHT-10). */
export function tableName(sheet: Sheet): string | undefined {
  const name = own(ownObject(sheet, 'table'), 'name');
  return isName(name) ? name : undefined;
}
