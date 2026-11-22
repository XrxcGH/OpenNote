// Named cell styles (Normal, Heading, Total, Input, Output, Note, Good, Bad, Neutral, Warning, and the accents), and
// custom styles. A named style is a set of properties kept in `data.sheet.named`, keyed by its name; a built-in style
// has its definition here and is stored only once someone changes it. Applying a style gives each cell the style's
// content, so the cell's style ID is the style's ID, and "the cells that use a style" are the cells that hold that ID.
// Changing a style gives it new content and moves every use to the new ID in one patch, so one Undo takes it back.
//
// Cell colors are document data (they travel in the file), so they are literal values, as the looks' fills are.
// checks-disable-file brand-consistency: cell colors here are document data of the file format, not interface styling
import { applyToRange, canonical, changeStyle, sheetPatch, tidy, validStyle } from '../../sheet/model';
import type { Box, CellStyle, Sheet, StyleChange, TableLike } from '../../sheet/model';
import { clone, isObject, own, ownObject, put } from '../../sheet/model/json';
import type { Json, JsonObject } from '../../sheet/model/json';
import { intern, StyleLimitError } from '../../sheet/model/styles';

const box = (color: string) => ({ style: 'thin', color });
const around = (color: string) => ({ t: box(color), r: box(color), b: box(color), l: box(color) });

/** The built-in styles, in the order the gallery shows them. The key is the style's name and its string key. */
export const BUILTIN_STYLES: Readonly<Record<string, CellStyle>> = {
  normal: {},
  heading: { font: { bold: true, size: 14 }, border: { b: { style: 'medium', color: 'theme:accent1' } } },
  total: { font: { bold: true }, border: { t: { style: 'thin' }, b: { style: 'double' } } },
  input: { fill: '#fdf3d0', font: { color: '#6b4a00' }, border: around('#c9a64a') },
  output: { fill: '#eeeeee', font: { bold: true }, border: around('#777777') },
  note: { fill: '#fff8c4', font: { italic: true }, border: { l: { style: 'medium', color: '#d6b400' } } },
  good: { fill: '#d9efd5', font: { color: '#1f5a1a' } },
  bad: { fill: '#f6d5d2', font: { color: '#8a1f17' } },
  neutral: { fill: '#f4e6b8', font: { color: '#6a5200' } },
  warning: { fill: '#fbdcc0', font: { color: '#8a3b00', bold: true } },
  accent1: { fill: 'theme:accent1', font: { color: '#ffffff' } },
  accent2: { fill: 'theme:accent2', font: { color: '#ffffff' } },
  accent3: { fill: 'theme:accent3', font: { color: '#ffffff' } },
  accent4: { fill: 'theme:accent4', font: { color: '#ffffff' } },
  accent5: { fill: 'theme:accent5', font: { color: '#ffffff' } },
  accent6: { fill: 'theme:accent6', font: { color: '#ffffff' } },
};

export const BUILTIN_KEYS: readonly string[] = Object.keys(BUILTIN_STYLES);

/** The most characters of a custom style's name. */
export const NAME_MAX = 60;

/** What a writer did: the new sheet and its merge patch (null when nothing changed). */
export interface Written {
  sheet: Sheet;
  patch: JsonObject | null;
  refused?: 'styles' | 'name';
}

export const isBuiltin = (key: string): boolean => Object.hasOwn(BUILTIN_STYLES, key);

/** A style name a person may give: not empty, not too long, and not one that would shadow an object's own keys. */
export function validName(name: string): boolean {
  const text = name.trim();
  return text.length > 0 && text.length <= NAME_MAX && text !== '__proto__' && text !== 'constructor';
}

const namedOf = (sheet: Sheet): JsonObject => ownObject(sheet, 'named') ?? {};

/** The definition of a style: the stored one (valid parts only), or the built-in one. Undefined for an unknown name. */
export function styleDef(sheet: Sheet, key: string): CellStyle | undefined {
  const stored = own(namedOf(sheet), key);
  if (isObject(stored)) return validStyle(stored);
  return isBuiltin(key) ? BUILTIN_STYLES[key] : undefined;
}

export interface NamedStyle {
  key: string;
  builtin: boolean;
  /** True when the sheet stores the style: a custom style, or a built-in one someone changed. */
  stored: boolean;
  style: CellStyle;
}

/** Every style the sheet offers: the built-in ones in their order, then the custom ones by name. */
export function listStyles(sheet: Sheet): NamedStyle[] {
  const named = namedOf(sheet);
  const custom = Object.keys(named)
    .filter((key) => !isBuiltin(key) && isObject(named[key]))
    .sort((a, b) => a.localeCompare(b));
  return [...BUILTIN_KEYS, ...custom].map((key) => ({
    key,
    builtin: isBuiltin(key),
    stored: Object.hasOwn(named, key),
    style: styleDef(sheet, key) ?? {},
  }));
}

export const CLEAR_ALL: StyleChange = {
  fmt: null,
  font: null,
  fill: null,
  border: null,
  align: null,
  pad: null,
  protect: null,
};

/** The IDs in the sheet's style sheet whose content is `style`. */
function idsOf(sheet: Sheet, style: CellStyle): string[] {
  const body = canonical(style as Json);
  const styles = ownObject(sheet, 'styles') ?? {};
  return Object.keys(styles).filter((id) => canonical(styles[id]) === body);
}

/** Gives every cell of `target` the style's content in place of the formatting it had. One patch covers all of it. */
export function applyStyle(before: Sheet, table: TableLike, target: Box, key: string): Written {
  const def = styleDef(before, key);
  if (!def) return { sheet: before, patch: null };
  const from: [string, string] = [table.rows[target.top].id, table.columns[target.left].id];
  const to: [string, string] = [table.rows[target.bottom].id, table.columns[target.right].id];
  let sheet = before;
  for (const change of [CLEAR_ALL, def as StyleChange]) {
    const done = applyToRange(sheet, table, from, to, change);
    if (done.refused) return { sheet: before, patch: null, refused: 'styles' };
    sheet = done.sheet;
  }
  return { sheet, patch: sheetPatch(before, sheet) };
}

/** Replaces every use of the style ID `from` (cells, rows, columns, the table) with `to`. */
function moveUses(sheet: Sheet, from: string, to: string | null): void {
  const swap = (holder: JsonObject | undefined, field: string) => {
    if (!holder || own(holder, field) !== from) return;
    if (to === null) delete holder[field];
    else put(holder, field, to);
  };
  swap(ownObject(sheet, 'table'), 'style');
  for (const key of ['rows', 'cols']) {
    for (const line of Object.values(ownObject(sheet, key) ?? {})) if (isObject(line)) swap(line, 'style');
  }
  for (const byCol of Object.values(ownObject(sheet, 'cells') ?? {})) {
    if (!isObject(byCol)) continue;
    for (const col of Object.keys(byCol)) swap(byCol, col);
  }
}

/** The number of cells, rows, columns, and tables that hold the style's content. */
export function usesOf(sheet: Sheet, key: string): number {
  const def = styleDef(sheet, key);
  if (!def) return 0;
  const ids = new Set(idsOf(sheet, def));
  if (ids.size === 0) return 0;
  let count = 0;
  if (ids.has(String(own(ownObject(sheet, 'table'), 'style')))) count++;
  for (const k of ['rows', 'cols']) {
    for (const line of Object.values(ownObject(sheet, k) ?? {})) if (ids.has(String(own(line, 'style')))) count++;
  }
  for (const byCol of Object.values(ownObject(sheet, 'cells') ?? {})) {
    if (isObject(byCol)) for (const id of Object.values(byCol)) if (ids.has(String(id))) count++;
  }
  return count;
}

/** Runs a change on a copy of the sheet, tidies it, and returns the patch. */
function edit(before: Sheet, table: TableLike, command: (sheet: Sheet) => void): Written {
  const sheet = clone(before);
  try {
    command(sheet);
  } catch (error) {
    if (error instanceof StyleLimitError) return { sheet: before, patch: null, refused: 'styles' };
    throw error;
  }
  const named = ownObject(sheet, 'named');
  if (named && Object.keys(named).length === 0) delete sheet.named;
  tidy(sheet, table);
  return { sheet, patch: sheetPatch(before, sheet) };
}

/** Gives a style new content as a whole. Every use of the old content takes the new, in the same patch. */
export function setNamed(before: Sheet, table: TableLike, key: string, next: CellStyle): Written {
  if (!validName(key)) return { sheet: before, patch: null, refused: 'name' };
  const old = styleDef(before, key);
  return edit(before, table, (sheet) => {
    const oldIds = old ? idsOf(sheet, old) : [];
    const named = ownObject(sheet, 'named') ?? {};
    if (isBuiltin(key) && canonical(next as Json) === canonical(BUILTIN_STYLES[key] as Json)) delete named[key];
    else put(named, key, clone(next as JsonObject));
    put(sheet, 'named', named);
    if (oldIds.length === 0) return;
    const to = intern(sheet, next);
    for (const id of oldIds) if (id !== to) moveUses(sheet, id, to);
  });
}

/** Changes a style's properties: values set them, `null` clears them. Every use follows. */
export function changeNamed(before: Sheet, table: TableLike, key: string, change: StyleChange): Written {
  const old = styleDef(before, key);
  if (!old) return { sheet: before, patch: null };
  return setNamed(before, table, key, changeStyle(old, change) as CellStyle);
}

/**
 * Removes a custom style (cells that use it keep their formatting), or returns a changed built-in style to its
 * original (cells that use it follow).
 */
export function removeNamed(before: Sheet, table: TableLike, key: string): Written {
  if (isBuiltin(key)) return setNamed(before, table, key, BUILTIN_STYLES[key]);
  return edit(before, table, (sheet) => {
    const named = ownObject(sheet, 'named');
    if (named) delete named[key];
  });
}

/** A name for a new style: `base`, or `base 2`, `base 3` until it is free. The labels of built-in styles count as taken. */
export function freeName(sheet: Sheet, base: string, builtinLabels: readonly string[] = []): string {
  const taken = new Set([...Object.keys(namedOf(sheet)), ...builtinLabels]);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`.slice(0, NAME_MAX);
}
