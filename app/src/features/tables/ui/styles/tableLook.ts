// The table looks gallery's writer (DESIGN 3.5): the look's name and the Table Style Options checkboxes, which are
// `data.sheet.table.look`, `.band`, and `.emphasis`. The 21 looks and their drawing are the render lane's.
import { sheetPatch } from '../../sheet/model';
import type { Sheet } from '../../sheet/model';
import { clone, isObject, own, ownObject, put } from '../../sheet/model/json';
import type { JsonObject } from '../../sheet/model/json';

export interface LookOptions {
  look: string | null;
  band: { rows: boolean; cols: boolean };
  emphasis: { firstCol: boolean; lastCol: boolean; totalRow: boolean };
}

/** The look and options a sheet has now. A look that is not a name (a custom look object) reads as none. */
export function lookOf(sheet: Sheet): LookOptions {
  const table = ownObject(sheet, 'table');
  const look = own(table, 'look');
  const band = ownObject(table, 'band');
  const emphasis = ownObject(table, 'emphasis');
  return {
    look: typeof look === 'string' ? look : null,
    band: { rows: own(band, 'rows') === true, cols: own(band, 'cols') === true },
    emphasis: {
      firstCol: own(emphasis, 'firstCol') === true,
      lastCol: own(emphasis, 'lastCol') === true,
      totalRow: own(emphasis, 'totalRow') === true,
    },
  };
}

/** The sheet with the look and options written, and the merge patch (null when nothing changed). */
export function setLook(before: Sheet, options: LookOptions): { sheet: Sheet; patch: JsonObject | null } {
  const sheet = clone(before);
  const table = ownObject(sheet, 'table') ?? {};
  if (options.look === null) delete table.look;
  else put(table, 'look', options.look);
  const flags = (key: string, values: Record<string, boolean>) => {
    const old = own(table, key);
    const group: JsonObject = isObject(old) ? { ...old } : {};
    for (const [name, on] of Object.entries(values)) {
      if (on) put(group, name, true);
      else delete group[name];
    }
    if (Object.keys(group).length > 0) put(table, key, group);
    else delete table[key];
  };
  flags('band', options.band);
  flags('emphasis', options.emphasis);
  if (Object.keys(table).length > 0) put(sheet, 'table', table);
  else delete sheet.table;
  return { sheet, patch: sheetPatch(before, sheet) };
}
