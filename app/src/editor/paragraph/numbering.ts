// The list numbering engine (spec 6.9, R-LIST-1 to R-LIST-3; text DESIGN.md 7.1). It reads `data.lists`. It works
// out the number of every list item from the item's place and its `paras` list reference. Then it formats the label
// by the level's number format (numberFormats.ts) and its `%1` to `%9` pattern.
import type { Node as PMNode } from '@tiptap/pm/model';
import { LIST_ID, paraFormat, points } from './attributes';
import { NUMBER_FORMATS, levelText } from './numberFormats';
import type { NumberFormat } from './numberFormats';

export { NUMBER_FORMATS, formatNumber, levelText } from './numberFormats';
export type { NumberFormat } from './numberFormats';

export const MAX_LEVELS = 9;
export const MAX_LISTS = 256;
export const MAX_START = 32_767;
/** The highest start number a Markdown ordered list may have (spec 7.2). */
const MARKDOWN_START_MAX = 999_999_999;

/** A Markdown list's start number as a whole number from 0 to MARKDOWN_START_MAX. */
const markdownStart = (value: unknown) => Math.min(MARKDOWN_START_MAX, Math.max(0, Math.trunc(Number(value)) || 0));

// ---- List definitions ----

export interface ListLevel {
  format: NumberFormat;
  text: string;
  start: number;
  /** Where the text starts, in points. */
  indent: number;
  /** How far the number hangs before the text, in points. */
  hanging: number;
  symbol: string | null;
  font: string | null;
  align: 'start' | 'center' | 'end';
}

/** The partial levels of each list definition, checked. A definition or level that is not valid reads as none. */
export type ListDefinitions = ReadonlyMap<string, readonly Partial<ListLevel>[]>;

/** Bullets of the default set, by level, repeating: a bullet, a white circle, and a small square. */
export const DEFAULT_BULLETS = ['•', '◦', '▪'];
const DEFAULT_NUMBERED: readonly NumberFormat[] = ['decimal', 'lowerLetter', 'lowerRoman'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** One code point that is not a control character (R-LIST-1). */
function symbol(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const chars = [...value];
  return chars.length === 1 && !/\p{Cc}/u.test(value) ? value : undefined;
}

function readLevel(value: unknown): Partial<ListLevel> | null {
  if (!isRecord(value)) return null;
  const level: Partial<ListLevel> = {};
  if (typeof value.format === 'string' && (NUMBER_FORMATS as readonly string[]).includes(value.format)) {
    level.format = value.format as NumberFormat;
  }
  if (typeof value.text === 'string' && [...value.text].length <= 64) level.text = value.text;
  const start = points(value.start, 0, MAX_START, 1);
  if (start !== undefined) level.start = start;
  const indent = points(value.indent, 0, 1584);
  if (indent !== undefined) level.indent = indent;
  const hanging = points(value.hanging, 0, 1584);
  if (hanging !== undefined) level.hanging = hanging;
  const bullet = symbol(value.symbol);
  if (bullet !== undefined) level.symbol = bullet;
  if (typeof value.font === 'string' && value.font.length > 0 && value.font.length <= 64) level.font = value.font;
  if (value.align === 'start' || value.align === 'center' || value.align === 'end') level.align = value.align;
  return level;
}

/** The list definitions of a block's `data.lists`. Keys that are not list IDs, and extra lists or levels, are ignored. */
export function readLists(value: unknown): ListDefinitions {
  const out = new Map<string, Partial<ListLevel>[]>();
  if (!isRecord(value)) return out;
  for (const [id, definition] of Object.entries(value)) {
    if (out.size >= MAX_LISTS) break;
    if (!LIST_ID.test(id) || !isRecord(definition) || !Array.isArray(definition.levels)) continue;
    const levels = definition.levels.slice(0, MAX_LEVELS).map(readLevel);
    if (levels.length === 0 || levels.some((level) => level === null)) continue;
    out.set(id, levels as Partial<ListLevel>[]);
  }
  return out;
}

/** Level `depth` (0 for the outermost) of a list with the defaults filled in. */
export function levelOf(levels: readonly Partial<ListLevel>[] | undefined, depth: number, ordered: boolean): ListLevel {
  const own = levels?.[depth] ?? {};
  const format = own.format ?? (ordered ? DEFAULT_NUMBERED[depth % DEFAULT_NUMBERED.length] : 'bullet');
  const bullet = own.symbol ?? DEFAULT_BULLETS[depth % DEFAULT_BULLETS.length];
  return {
    format,
    text: own.text ?? (format === 'bullet' ? bullet : `%${depth + 1}.`),
    start: own.start ?? 1,
    indent: own.indent ?? 36 * (depth + 1),
    hanging: own.hanging ?? 18,
    symbol: format === 'bullet' ? bullet : (own.symbol ?? null),
    font: own.font ?? null,
    align: own.align ?? 'start',
  };
}

// ---- Numbering a document ----

export interface ItemNumber {
  /** The position of the list item. */
  pos: number;
  /** 0 for an item of an outermost list. */
  depth: number;
  /** The list ID the item names, or null for a plain Markdown list. */
  listId: string | null;
  /** The number of the item and of the items it is under, outermost first. */
  values: number[];
  /** What the item shows before its text. */
  label: string;
}

interface Counters {
  values: (number | undefined)[];
}

/**
 * The number of every list item in a document. An item that names a list counts on from the last item of the same
 * level of that list before it, wherever that item is (R-LIST-2), and starts again at `restart`. An item before it
 * at a higher level starts its level again, as in Word. A plain Markdown list counts from its own start number.
 */
export function numberItems(doc: PMNode, lists: ListDefinitions = new Map()): ItemNumber[] {
  const out: ItemNumber[] = [];
  const byList = new Map<string, Counters>();
  const visit = (list: PMNode, listPos: number, depth: number, outer: number[]) => {
    const ordered = list.type.name === 'orderedList';
    let markdownValue = ordered ? markdownStart(list.attrs.start) : 1;
    list.forEach((item, offset) => {
      const pos = listPos + 1 + offset;
      if (item.type.name !== 'listItem') return;
      const ref = paraFormat(item.attrs).list;
      const levels = ref ? lists.get(ref.id) : undefined;
      const levelAt = (k: number) => levelOf(levels, k, ordered);
      const level = levelAt(depth);
      let values: number[];
      if (ref) {
        const counters = byList.get(ref.id) ?? { values: [] };
        byList.set(ref.id, counters);
        const last = counters.values[depth];
        counters.values[depth] = ref.restart || last === undefined ? level.start : last + 1;
        counters.values.length = depth + 1;
        values = Array.from({ length: depth + 1 }, (_, k) => counters.values[k] ?? levelAt(k).start);
      } else {
        values = [...outer, markdownValue];
      }
      markdownValue = Math.min(MARKDOWN_START_MAX, markdownValue + 1);
      const formats = values.map((_, k) => levelAt(k).format);
      const label = level.format === 'bullet' ? (level.symbol ?? '') : levelText(level.text, values, formats);
      out.push({ pos, depth, listId: ref?.id ?? null, values, label });
      item.forEach((child, childOffset) => {
        if (child.type.name === 'bulletList' || child.type.name === 'orderedList') {
          visit(child, pos + 1 + childOffset, depth + 1, values);
        }
      });
    });
  };
  const walk = (node: PMNode, pos: number) => {
    node.forEach((child, offset) => {
      const at = pos + offset;
      if (child.type.name === 'bulletList' || child.type.name === 'orderedList') visit(child, at, 0, []);
      else if (!child.isTextblock && !child.isAtom) walk(child, at + 1);
    });
  };
  walk(doc, 0);
  return out;
}

/**
 * The Markdown start number each ordered list should have, for down-level readers: the number its first item shows,
 * when that item names a list (R-LIST-3). So a list that continues from three items writes `4.`, and a restart `1.`.
 * Lists whose first item names no list keep the start they have.
 */
export function shownStarts(doc: PMNode, lists: ListDefinitions = new Map()): { pos: number; start: number }[] {
  const firsts = new Map<number, ItemNumber>();
  for (const item of numberItems(doc, lists)) firsts.set(item.pos, item);
  const out: { pos: number; start: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) return false;
    if (node.type.name !== 'orderedList' || !node.firstChild) return true;
    const first = firsts.get(pos + 1);
    if (!first?.listId) return true;
    const start = Math.min(MARKDOWN_START_MAX, first.values[first.depth]);
    if (start !== node.attrs.start) out.push({ pos, start });
    return true;
  });
  return out;
}
