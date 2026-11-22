// The Name manager's rules (ADR 0062, DESIGN 6.9): which names a table sees, which conflict, defining and deleting a
// name in a table's data.sheet, and Create from selection. A table name is seen in its own table; a page name in
// every table of the page, stored in the table where it was defined. Names are unique in their scope, without regard
// to case; the first table on the page wins when two tables define one page name.
import { deleteName, isName, namesOf, pageNames, setName } from '../../sheet/model';
import type { NameRefusal, Sheet } from '../../sheet/model';
import { cellText } from '../formulaBar/scan';

export interface NameRow {
  readonly name: string;
  readonly ref: string;
  readonly scope: 'table' | 'page';
  readonly comment: string;
  /** The table on the page that stores it. */
  readonly table: number;
  /** A page name that more than one table defines. */
  readonly conflict: boolean;
  /** A page name that the bar's own table hides with a table name of the same spelling. */
  readonly shadowed: boolean;
}

/** The names the table `own` sees, and the page names it does not see because it hides them, in name order. */
export function nameRows(sheets: readonly Sheet[], own: number): NameRow[] {
  const { conflicts } = pageNames(sheets);
  const ownSheet = sheets[own] ?? {};
  const local = new Set(
    namesOf(ownSheet)
      .filter((n) => n.scope === 'table')
      .map((n) => n.name.toLowerCase()),
  );
  const rows: NameRow[] = [];
  sheets.forEach((sheet, table) => {
    for (const entry of namesOf(sheet)) {
      if (entry.scope === 'table' && table !== own) continue;
      const key = entry.name.toLowerCase();
      rows.push({
        ...entry,
        table,
        conflict: entry.scope === 'page' && conflicts.includes(key),
        shadowed: entry.scope === 'page' && local.has(key),
      });
    }
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.table - b.table);
}

export type DefineRefusal = NameRefusal | 'taken';

export interface Definition {
  readonly name: string;
  /** What the name refers to, as typed: "=A1:B4", "0.0825", or "A1*2". Stored without "=". */
  readonly ref: string;
  readonly scope: 'table' | 'page';
  readonly comment?: string;
}

/**
 * Defines a name in the table `own`. Returns that table's new sheet, or why it was refused. A page name another table
 * already defines is refused, so the page never gets a new conflict.
 */
export function defineName(
  sheets: readonly Sheet[],
  own: number,
  definition: Definition,
): { sheet: Sheet } | { refused: DefineRefusal } {
  const name = definition.name.trim();
  const ref = definition.ref.trim().replace(/^=/, '').trim();
  if (definition.scope === 'page') {
    const taken = sheets.some(
      (sheet, table) =>
        table !== own && namesOf(sheet).some((n) => n.scope === 'page' && n.name.toLowerCase() === name.toLowerCase()),
    );
    if (taken) return { refused: 'taken' };
  }
  const sheet = structuredClone(sheets[own] ?? {}) as Sheet;
  // A name of the other scope with the same spelling in this table is replaced, so one table never holds both.
  const refused = setName(sheet, name, {
    ref,
    scope: definition.scope,
    ...(definition.comment ? { comment: definition.comment } : {}),
  });
  return refused ? { refused } : { sheet };
}

/** The table's sheet without the name. */
export function removeName(sheet: Sheet, name: string): Sheet {
  const next = structuredClone(sheet) as Sheet;
  deleteName(next, name);
  return next;
}

/** A label made into a name: spaces and other marks become low lines, and a leading digit gets one in front. */
export function nameFromLabel(label: string): string | null {
  let name = label.trim().replace(/[^\p{L}\p{N}_.]+/gu, '_');
  if (/^[\p{N}.]/u.test(name)) name = `_${name}`;
  return isName(name) ? name : null;
}

/**
 * Create from selection: each column of the box (grid cells, header row counted when `header`) becomes a name from
 * its top cell, referring to the cells under it; or each row from its left cell. Absolute references, as a
 * spreadsheet makes them.
 */
export function namesFromSelection(
  texts: readonly (readonly string[])[],
  box: { top: number; left: number; bottom: number; right: number },
  header: boolean,
  from: 'top' | 'left',
): Definition[] {
  const shift = header ? 1 : 0;
  const cell = (row: number, col: number) => cellText({ row: row - shift, col, colAbs: true, rowAbs: true });
  const out: Definition[] = [];
  if (from === 'top') {
    if (box.bottom <= box.top) return out;
    for (let c = box.left; c <= box.right; c += 1) {
      const name = nameFromLabel(texts[box.top]?.[c] ?? '');
      const first = box.top + 1;
      if (!name || first - shift < 0) continue;
      out.push({ name, ref: `${cell(first, c)}:${cell(box.bottom, c)}`, scope: 'table' });
    }
  } else {
    if (box.right <= box.left) return out;
    for (let r = Math.max(box.top, shift); r <= box.bottom; r += 1) {
      const name = nameFromLabel(texts[r]?.[box.left] ?? '');
      if (!name) continue;
      out.push({ name, ref: `${cell(r, box.left + 1)}:${cell(r, box.right)}`, scope: 'table' });
    }
  }
  return out;
}
