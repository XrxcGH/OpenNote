// Style interning and garbage collection (format spec R-SHT-6, DESIGN 3.4). A style's ID comes from its content, so
// the same style made on two devices gets the same ID, and a table stores each distinct style once.

import {
  canonical,
  clone,
  COPY_DEPTH,
  fnv1a64,
  isObject,
  jsonEqual,
  own,
  ownObject,
  put,
  type Json,
  type JsonObject,
} from './json';
import { styleProblems } from './schema';
import type { CellStyle, Sheet } from './types';

const ID_SPACE = 36n ** 6n;

/** The most distinct styles a table holds (spec section 16). */
export const STYLE_LIMIT = 4096;

/** Thrown when a new style would pass the limit of 4,096 styles, with unused styles already removed. */
export class StyleLimitError extends Error {
  constructor() {
    super('A table holds at most 4,096 styles.');
    this.name = 'StyleLimitError';
  }
}

/** The 6 base-36 characters of a hash modulo 36^6, padded with `0`. */
function base36(hash: bigint): string {
  return (hash % ID_SPACE).toString(36).padStart(6, '0');
}

/**
 * The ID a writer gives `style` (R-SHT-6): FNV-1a 64 of its compact canonical JSON, modulo 36^6, in base 36. When the
 * ID already names a different style in `taken`, `#1`, `#2`, and so on go after the JSON text until it is free.
 */
export function styleId(style: CellStyle | JsonObject, taken: Readonly<Record<string, Json>> = {}): string {
  const body = canonical(style as Json);
  for (let n = 0; ; n++) {
    const id = base36(fnv1a64(n === 0 ? body : `${body}#${n}`));
    const held = Object.hasOwn(taken, id) ? taken[id] : undefined;
    if (held === undefined || jsonEqual(held, style as Json)) return id;
  }
}

/**
 * A style without empty objects, so `{font: {}}` and `{}` are one style. Objects below COPY_DEPTH are shared as they
 * are, as `ordered` does, so a very deep unknown value never runs out of stack.
 */
export function compact(style: JsonObject, depth = 0): JsonObject {
  if (depth >= COPY_DEPTH) return style;
  const out: JsonObject = {};
  for (const key of Object.keys(style)) {
    const value = style[key];
    if (isObject(value)) {
      const inner = compact(value, depth + 1);
      if (Object.keys(inner).length > 0) put(out, key, inner);
    } else if (value !== undefined) put(out, key, value);
  }
  return out;
}

/**
 * Adds `style` to the sheet's style sheet if it is not there yet, and returns its ID. Changes `sheet` in place.
 * An empty style has no ID: the caller removes the reference instead, and this returns null. At the limit, unused
 * styles go first; if the sheet is still full, it throws StyleLimitError.
 */
export function intern(sheet: Sheet, style: CellStyle | JsonObject): string | null {
  const body = compact(style as JsonObject);
  if (Object.keys(body).length === 0) return null;
  let styles = ownObject(sheet, 'styles') ?? {};
  const id = styleId(body, styles);
  if (!Object.hasOwn(styles, id)) {
    if (Object.keys(styles).length >= STYLE_LIMIT) {
      gc(sheet);
      styles = ownObject(sheet, 'styles') ?? {};
      if (Object.keys(styles).length >= STYLE_LIMIT) throw new StyleLimitError();
    }
    put(styles, id, clone(body));
  }
  put(sheet, 'styles', styles);
  return id;
}

/**
 * The keys a problem's path names in `style`, below the root name `s`. A key may hold a dot, so each step takes the
 * longest own key that the rest of the path starts with. The path stops at an array: a problem inside one drops the
 * whole array, as `[i]` names an item, not a key.
 */
function keysOf(style: JsonObject, where: string): string[] {
  const keys: string[] = [];
  let node: Json | undefined = style;
  let rest = where.startsWith('s.') ? where.slice(2) : '';
  while (rest !== '' && isObject(node)) {
    const here: JsonObject = node;
    const key = Object.keys(here)
      .filter((k) => rest === k || rest.startsWith(`${k}.`) || rest.startsWith(`${k}[`))
      .sort((a, b) => b.length - a.length)[0];
    // A required key that is missing is not in the object: it is the rest of the path.
    const step = key ?? rest;
    keys.push(step);
    node = here[step];
    rest = rest.slice(step.length).replace(/^\./, '');
    if (rest.startsWith('[')) break;
  }
  return keys;
}

/** Removes the path of a problem from a copy of a style: the key itself, or its object when a key is required. */
function drop(style: JsonObject, problem: string): void {
  const at = problem.lastIndexOf(': ');
  const where = problem.slice(0, problem.indexOf(': '));
  const parts = keysOf(style, where);
  if (problem.slice(at + 2) === 'required') parts.pop();
  if (parts.length === 0) return;
  let node: Json | undefined = style;
  for (const part of parts.slice(0, -1)) node = own(node, part);
  if (isObject(node)) delete node[parts[parts.length - 1]];
}

/** The part of a stored style this version understands: unknown keys and invalid values read as missing (R-NUM-1). */
export function validStyle(style: Json | undefined): CellStyle {
  if (!isObject(style)) return {};
  const problems = styleProblems(style, 's');
  if (problems.length === 0) return style as CellStyle;
  const copy = clone(style);
  for (const problem of problems) drop(copy, problem);
  return compact(copy) as CellStyle;
}

/** The valid style an ID names in the sheet, or undefined when the sheet has no such style. */
export function styleById(sheet: Sheet, id: Json | undefined): CellStyle | undefined {
  if (typeof id !== 'string') return undefined;
  const style = own(ownObject(sheet, 'styles'), id);
  return style === undefined ? undefined : validStyle(style);
}

/** Every style ID the sheet refers to: the table, its look, columns, rows, cells, and conditional formats. */
export function usedStyles(sheet: Sheet): Set<string> {
  const used = new Set<string>();
  const add = (id: Json | undefined) => {
    if (typeof id === 'string') used.add(id);
  };
  const table = ownObject(sheet, 'table');
  add(own(table, 'style'));
  const look = ownObject(table, 'look');
  if (look) Object.values(look).forEach(add);
  for (const key of ['cols', 'rows']) {
    for (const entry of Object.values(ownObject(sheet, key) ?? {})) add(own(entry, 'style'));
  }
  for (const byCol of Object.values(ownObject(sheet, 'cells') ?? {})) {
    if (isObject(byCol)) Object.values(byCol).forEach(add);
  }
  for (const rule of Object.values(ownObject(sheet, 'conditional') ?? {})) add(own(rule, 'style'));
  return used;
}

/**
 * Removes the styles nothing refers to (DESIGN 3.4). Changes `sheet` in place. A sheet of a later data version
 * (`v` above 1) may refer to styles from keys this version does not know, so its styles are left alone.
 */
export function gc(sheet: Sheet): void {
  const v = own(sheet, 'v');
  if (typeof v === 'number' && v > 1) return;
  const styles = ownObject(sheet, 'styles');
  if (!styles) return;
  const used = usedStyles(sheet);
  for (const id of Object.keys(styles)) if (!used.has(id)) delete styles[id];
  if (Object.keys(styles).length === 0) delete sheet.styles;
}
